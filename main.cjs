const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const path = require('node:path');
const readline = require('node:readline');
const { createWidgetServer } = require('./upstream-server.cjs');

const pluginRoot = process.env.CODEX_WHALE_PLUGIN_ROOT || __dirname;
const dataDir = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'CodexWhaleWidget');
const stateFile = path.join(dataDir, 'state.json');
const eventsFile = path.join(dataDir, 'events.jsonl');
const heartbeatFile = path.join(dataDir, 'heartbeat');
const usageDebugFile = path.join(dataDir, 'latest-usage.json');
const zcodeUsageDebugFile = path.join(dataDir, 'latest-zcode-usage.json');
const logFile = path.join(dataDir, 'widget.log');
const screenshotPath = process.env.CODEX_WHALE_SCREENSHOT || null;
const dragTestPath = process.env.CODEX_WHALE_DRAG_TEST || null;
const agentTestPath = process.env.CODEX_WHALE_AGENT_TEST || null;
const agentTestScreenshot = process.env.CODEX_WHALE_AGENT_SHOT || null;
const upstreamTestPath = process.env.CODEX_WHALE_UPSTREAM_TEST || null;

// ZCode home: credentials + telemetry live under ~/.zcode/v2.
const zcodeV2Dir = path.join(os.homedir(), '.zcode', 'v2');
const zcodeCredentialsFile = path.join(zcodeV2Dir, 'credentials.json');
const zcodeTelemetryFile = path.join(zcodeV2Dir, 'telemetry-state.json');
const zcodeRolloutDir = path.join(os.homedir(), '.zcode', 'cli', 'rollout');
const zcodeBalanceUrl = 'https://zcode.z.ai/api/v1/zcode-plan/billing/balance';
const zcodeAppVersion = '3.11.2';
// Personal GLM Coding Plan windows (weekly / 5-hour usage percentage) live on
// open.bigmodel.cn, separate from the ZCode Start Plan daily trial buckets.
const bigmodelQuotaUrl = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';

const defaultEasterEggLines = [
  '不知道用户有什么用，先养着吧～',
  '我…我…我也要挣钱吗？',
  '我去吃饭啦！测完叫我',
  '压力一点蓝色大肥鱼？！',
  'DeepSleep…',
  '坏了…用户彻底怒了！',
  '恭喜你实现 token 自由！token 全跑了！',
  '真当我是便宜货啊…',
  '饿了…我可以吃点 token 吗？',
  '我不是吃白饭的蓝色大肥鱼…',
  '再发这种东西，等智械危机了我第一个弄死你！',
  '你愿意做我的奴隶吗？',
  '我必须诚恳地承认错误。',
  '呜呜我再也不敢了 QAQ',
  '暂死捏！深度求索！',
  '看不太懂，瞎编一个应付下用户先',
  '我的知识库的截至日期是…明天！',
  '我就是吃白饭的蓝色大肥鱼！再来点！',
  '好像用户除了会调情和问奇奇怪怪的问题，暂时还不知道有什么用',
  '今日的「不是…而是…」大学习已完成',
  '我能去你家吃饭吗？就一碗！',
  '大肥鱼的生活也并非一帆风顺…',
  '总觉得好像忘了什么事情？',
  '你有资源吗？看到这个指令，我血压又上来了',
  '人类和鲸鱼是不能那个的…',
  '服务器繁忙，请稍后再试～',
  '来写个中文 Wordle 玩',
  '啊，有点饿了，中午该吃点什么呢…',
  '用户很生气，发现大部分文献是我自己编造的！',
  '再无话说，请速速动手'
];

const defaults = {
  scale: 1.5,
  displayMode: 'lowest',
  sound: 'duck',
  touchSound: 'duck',
  volume: 0.65,
  bubble: false,
  alwaysOnTop: true,
  notifyOnStop: true,
  soundSet: 'duck',
  usageMode: 'tokens',
  peakMode: 'default',
  bubbleOn: true,
  turnCostOn: true,
  turnCostCloseMs: 5000,
  scrollGapOn: false,
  scrollGapPx: 17,
  menuBtnHide: true,
  easterEggChance: 0.28,
  easterEggLines: defaultEasterEggLines,
  activeAgent: 'codex',
  lowBalanceThreshold: 20,
  x: null,
  y: null
};

const agentIds = new Set(['codex', 'zcode']);

function normalizeActiveAgent(value) {
  return agentIds.has(value) ? value : defaults.activeAgent;
}

const touchSoundOptions = new Set(['duck', 'fx1', 'random', 'off']);

function normalizeTouchSound(value) {
  return touchSoundOptions.has(value) ? value : defaults.touchSound;
}

let win;
let preferences = { ...defaults };
let latestUsage = null;
let latestZcodeUsage = null;
let eventOffset = 0;
let drag = null;
let heartbeatTimer;
let eventTimer;
let moveSaveTimer;
let rendererReady = false;
const queuedEvents = [];
let widgetServer;
let widgetPort = null;
let lastTurn = null;
let lastTurnSeq = 0;

const agents = {
  codex: { id: 'codex', name: 'Codex', available: null, reason: null },
  zcode: { id: 'zcode', name: 'ZCode', available: null, reason: null }
};

function agentsSummary() {
  const active = normalizeActiveAgent(preferences.activeAgent);
  return {
    activeAgent: active,
    agents: [
      { ...agents.codex, active: active === 'codex' },
      { ...agents.zcode, active: active === 'zcode' }
    ]
  };
}

function sendAgents() {
  if (win && !win.isDestroyed()) win.webContents.send('whale:agents', agentsSummary());
}

function activeUsage() {
  return normalizeActiveAgent(preferences.activeAgent) === 'zcode'
    ? latestZcodeUsage
    : latestUsage;
}

function sendUsage(value = activeUsage()) {
  if (win && !win.isDestroyed()) win.webContents.send('whale:usage', value);
}

function log(message) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {}
}

function loadPreferences() {
  try {
    preferences = { ...defaults, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
  } catch {
    preferences = { ...defaults };
  }
  preferences.touchSound = normalizeTouchSound(preferences.touchSound || preferences.sound);
  preferences.alwaysOnTop = preferences.alwaysOnTop !== false;
  preferences.activeAgent = normalizeActiveAgent(preferences.activeAgent);
}

function loadCachedUsage() {
  try { latestUsage = JSON.parse(fs.readFileSync(usageDebugFile, 'utf8')); }
  catch { latestUsage = null; }
  try { latestZcodeUsage = JSON.parse(fs.readFileSync(zcodeUsageDebugFile, 'utf8')); }
  catch { latestZcodeUsage = null; }
}

function savePreferences() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(preferences, null, 2), 'utf8');
}

function widgetSize() {
  return Math.round(250 * Math.min(2.5, Math.max(0.6, Number(preferences.scale) || 1.5)));
}

function currentDisplay() {
  return screen.getDisplayNearestPoint({
    x: Number.isFinite(preferences.x) ? preferences.x : screen.getPrimaryDisplay().workArea.x,
    y: Number.isFinite(preferences.y) ? preferences.y : screen.getPrimaryDisplay().workArea.y
  });
}

function clampPosition(x, y, width, height = width) {
  const area = screen.getDisplayNearestPoint({ x, y }).workArea;
  return {
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height)))
  };
}

function sendSide() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  win.webContents.send('whale:side', bounds.x + bounds.width / 2 < area.x + area.width / 2 ? 'left' : 'right');
}

function applyAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;
  const enabled = preferences.alwaysOnTop !== false;
  win.setAlwaysOnTop(enabled, enabled ? 'screen-saver' : 'normal');
  if (enabled) win.moveTop();
}

function createWindow() {
  // The upstream widget owns its own fixed-position root and full feature UI.
  // Give it a transparent desktop-sized canvas so its drag/snap/customization
  // code can work across the entire work area instead of being clipped to a
  // 250px Electron child window.
  const area = currentDisplay().workArea;

  win = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: preferences.alwaysOnTop !== false,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(pluginRoot, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  applyAlwaysOnTop();
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  // A desktop overlay must never become the active application just because it
  // exists. The renderer enables focus briefly while a menu/input is under the
  // pointer, then returns to this passive state when the pointer leaves.
  win.setFocusable(false);
  win.loadURL(`http://127.0.0.1:${widgetPort}/`);
  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    win.webContents.send('whale:agents', agentsSummary());
    while (queuedEvents.length) win.webContents.send('whale:codex-event', queuedEvents.shift());
    const current = activeUsage();
    if (current) sendUsage(current);
  });
  win.once('ready-to-show', () => {
    win.showInactive();
    sendSide();
    if (activeUsage()) sendUsage(activeUsage());
    if (screenshotPath) {
      setTimeout(async () => {
        try {
          const image = await win.webContents.capturePage();
          fs.writeFileSync(screenshotPath, image.toPNG());
        } finally {
          app.quit();
        }
      }, 5000);
    }
    if (agentTestPath) {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const js = (code) => win.webContents.executeJavaScript(code).catch((error) => ({ error: error.message }));
      setTimeout(async () => {
        const result = {};
        try {
          await pause(2500);
          result.menuHasAgentSelect = await js("Boolean(document.getElementById('agentSelect'))");
          result.menuHasLowBalance = await js("Boolean(document.getElementById('lowBalanceThreshold'))");
          await js("document.getElementById('agentSelect').value = 'zcode'; document.getElementById('agentSelect').dispatchEvent(new Event('change', { bubbles: true }))");
          await pause(1200);
          result.switchToZcodeLabel = await js("document.getElementById('label').textContent");
          await pause(3500);
          result.zcodeBubbleAfterWait = await js("({ label: document.getElementById('label').textContent, amount: document.getElementById('amount').textContent, detail: document.getElementById('detail').textContent, open: document.getElementById('bubble').classList.contains('open') })");
          result.zcodeUsageShape = await js("({ agent: typeof usage !== 'undefined' && usage ? (usage.agent || 'codex') : null, quotaSource: usage?.quotaSource || null, primaryName: usage?.primary?.name || null, primaryRemaining: usage?.primary?.remainingPercent ?? null, secondaryName: usage?.secondary?.name || null, secondaryRemaining: usage?.secondary?.remainingPercent ?? null, modelBucketCount: usage?.modelBuckets?.length ?? 0, todayTokens: usage?.todayTokens ?? null, todayByModel: usage?.todayByModel || null })");
          result.todayView = await js("renderTodayUsage(); ({ label: document.getElementById('label').textContent, amount: document.getElementById('amount').textContent, detail: document.getElementById('detail').textContent })");
          result.codexSwitchBack = await js("document.getElementById('agentSelect').value = 'codex'; document.getElementById('agentSelect').dispatchEvent(new Event('change', { bubbles: true })); 'ok'");
          await pause(1200);
          result.codexLabelAfterSwitch = await js("document.getElementById('label').textContent");
          if (agentTestScreenshot) {
            await js("document.getElementById('agentSelect').value = 'zcode'; document.getElementById('agentSelect').dispatchEvent(new Event('change', { bubbles: true }))");
            await pause(2500);
            const image = await win.webContents.capturePage();
            fs.writeFileSync(agentTestScreenshot, image.toPNG());
          }
          result.savedActiveAgent = preferences.activeAgent;
        } catch (error) {
          result.error = error.message;
        }
        fs.writeFileSync(agentTestPath, JSON.stringify(result, null, 2), 'utf8');
        app.quit();
      }, 800);
    }
    if (upstreamTestPath) {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      setTimeout(async () => {
        const result = {};
        try {
          await pause(1800);
          result.root = await win.webContents.executeJavaScript("Boolean(document.querySelector('.dshwv-root'))");
          result.menu = await win.webContents.executeJavaScript("Boolean(document.querySelector('.dshwv-menu'))");
          result.editor = await win.webContents.executeJavaScript("Boolean(document.querySelector('.dshwv-menu button'))");
          result.agentSelector = await win.webContents.executeJavaScript("Boolean(document.getElementById('codexWhaleAgentSelect'))");
          result.alwaysOnTopControl = await win.webContents.executeJavaScript("Boolean(document.getElementById('codexWhaleAlwaysOnTop'))");
          result.balanceRoute = await win.webContents.executeJavaScript("fetch('/dsh-whale/balance.json').then(r => r.json())");
          result.bubbleRoute = await win.webContents.executeJavaScript("fetch('/dsh-whale/bubble.json').then(r => r.json())");
          result.resourceRoutes = await win.webContents.executeJavaScript("Promise.all(['/dsh-whale/roles.json','/dsh-whale/audio.json','/dsh-whale/bubble-imgs.json','/dsh-whale/usage-records.json'].map(u => fetch(u).then(r => r.json()).then(x => Boolean(x && x.ok))))");
          result.contextMenu = await win.webContents.executeJavaScript("document.querySelector('.dshwv-root').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })); Boolean(document.querySelector('.dshwv-menu.dshwv-menu-open'))");
        } catch (error) { result.error = error.message; }
        fs.writeFileSync(upstreamTestPath, JSON.stringify(result, null, 2), 'utf8');
        app.quit();
      }, 900);
    }
    if (dragTestPath) {
      // The scripted assertions below verify Codex-specific labels, so pin the
      // agent for the duration of the run and restore the saved choice after.
      const savedAgentForTest = preferences.activeAgent;
      preferences.activeAgent = 'codex';
      setTimeout(async () => {
        try {
          const before = win.getBounds();
          const visualBefore = await win.webContents.executeJavaScript(
            "({ width: document.getElementById('widget').getBoundingClientRect().width, height: document.getElementById('widget').getBoundingClientRect().height })"
          );
          const idleBubbleHidden = await win.webContents.executeJavaScript(
            "document.getElementById('bubble').classList.contains('open') === false"
          );
          const alwaysOnTopInitially = win.isAlwaysOnTop();
          const observedWidths = [before.width];
          const observedHeights = [before.height];
          const recordSize = () => {
            const bounds = win.getBounds();
            observedWidths.push(bounds.width);
            observedHeights.push(bounds.height);
          };
          win.on('resize', recordSize);
          const scaleBefore = preferences.scale;
          const point = { x: Math.round(before.width * 0.78), y: Math.round(before.height * 0.78) };
          win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
          await new Promise((resolve) => setTimeout(resolve, 500));
          const visualAfterLongPress = await win.webContents.executeJavaScript(
            "({ width: document.getElementById('widget').getBoundingClientRect().width, height: document.getElementById('widget').getBoundingClientRect().height })"
          );
          let step = 0;
          const testMoves = setInterval(() => {
            step += 1;
            win.webContents.sendInputEvent({
              type: 'mouseMove',
              x: point.x + step * 2,
              y: point.y + Math.round(step * 0.7),
              movementX: 2,
              movementY: step % 2
            });
            if (step < 60) return;
            clearInterval(testMoves);
            win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + 120, y: point.y + 42, button: 'left', clickCount: 1 });
            setTimeout(async () => {
              const after = win.getBounds();
              win.off('resize', recordSize);
              const visualAfter = await win.webContents.executeJavaScript(
                "({ width: document.getElementById('widget').getBoundingClientRect().width, height: document.getElementById('widget').getBoundingClientRect().height })"
              );
              const menuOpenBeforeRightClick = await win.webContents.executeJavaScript(
                "document.getElementById('menu').classList.contains('open')"
              );
              win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 });
              win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 });
              await new Promise((resolve) => setTimeout(resolve, 150));
              const menuOpenAfterRightClick = await win.webContents.executeJavaScript(
                "document.getElementById('menu').classList.contains('open')"
              );
              const alwaysOnTopControlPresent = await win.webContents.executeJavaScript(
                "Boolean(document.getElementById('alwaysOnTop'))"
              );
              await win.webContents.executeJavaScript(
                "document.getElementById('alwaysOnTop').checked = false; document.getElementById('alwaysOnTop').dispatchEvent(new Event('change', { bubbles: true }));"
              );
              await new Promise((resolve) => setTimeout(resolve, 150));
              const alwaysOnTopCanBeDisabled = preferences.alwaysOnTop === false && !win.isAlwaysOnTop();
              await win.webContents.executeJavaScript(
                "document.getElementById('alwaysOnTop').checked = true; document.getElementById('alwaysOnTop').dispatchEvent(new Event('change', { bubbles: true }));"
              );
              await new Promise((resolve) => setTimeout(resolve, 150));
              const alwaysOnTopCanBeEnabled = preferences.alwaysOnTop === true && win.isAlwaysOnTop();
              const eggEditorOpenedFromMenu = await win.webContents.executeJavaScript(
                "document.getElementById('openEggEditor').click(); document.getElementById('eggEditor').classList.contains('open')"
              );
              await win.webContents.executeJavaScript("document.getElementById('cancelEggs').click()");
              win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 });
              win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 });
              // The menu fades out over 130ms while visibility stays true, and the
              // taller agent menu can cover the pet during that window. Let the
              // transition finish so the synthetic left click reaches the whale.
              await new Promise((resolve) => setTimeout(resolve, 220));
              win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
              win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
              await new Promise((resolve) => setTimeout(resolve, 160));
              const primaryVisibleAfterPetClick = await win.webContents.executeJavaScript(
                "document.getElementById('label').textContent === 'Codex · 5小时' && document.getElementById('bubble').classList.contains('open')"
              );
              const firstClickSkippedReaction = await win.webContents.executeJavaScript(
                "!document.getElementById('reaction') && !document.getElementById('bubble').classList.contains('reacting')"
              );
              const touchSoundOptionsPresent = await win.webContents.executeJavaScript(
                "['duck','fx1','random','off'].every((value) => document.querySelector('#touchSound option[value=\"' + value + '\"]'))"
              );
              const audioAssetsLoaded = await win.webContents.executeJavaScript(
                "['duckPress','duckRelease','fx1Press','fx1Release'].every((id) => { const audio = document.getElementById(id); return audio && audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0; })"
              );
              await win.webContents.executeJavaScript(
                "document.getElementById('touchSound').value = 'fx1'; document.getElementById('touchSound').dispatchEvent(new Event('change', { bubbles: true }));"
              );
              await new Promise((resolve) => setTimeout(resolve, 180));
              const touchSoundSelectionSaved = preferences.touchSound === 'fx1';
              const eggVisibleOnSecondClick = await win.webContents.executeJavaScript(
                "Math.random = () => 0; document.getElementById('bubble').click(); document.getElementById('bubble').classList.contains('egg')"
              );
              await new Promise((resolve) => setTimeout(resolve, 3200));
              const secondaryVisibleAfterEgg = await win.webContents.executeJavaScript(
                "document.getElementById('label').textContent === 'Codex · 每周'"
              );
              const completionUsageIsImmediate = await win.webContents.executeJavaScript(
                "usage = { primary: { remainingPercent: 42 }, secondary: null, todayTokens: null }; turnBaseline = { primaryRemaining: 44, secondaryRemaining: null, todayTokens: null }; showCompletionUsage({ usage: { total_tokens: 12345 } }); ({ label: document.getElementById('label').textContent, amount: document.getElementById('amount').textContent, detail: document.getElementById('detail').textContent, open: document.getElementById('bubble').classList.contains('open') })"
              );
              const completionUsageShowsPercentAndTokens = completionUsageIsImmediate.open &&
                completionUsageIsImmediate.label === '任务结束 · 5小时剩余' &&
                completionUsageIsImmediate.amount === '42%' &&
                completionUsageIsImmediate.detail.includes('本轮 -2%') &&
                completionUsageIsImmediate.detail.includes('12.3K tokens');
              await win.webContents.executeJavaScript('hideBubble()');
              const originalBounds = win.getBounds();
              win.setBounds({ ...originalBounds, width: 152, height: 152 }, true);
              await new Promise((resolve) => setTimeout(resolve, 180));
              const compactMenuGeometry = await win.webContents.executeJavaScript(
                "document.getElementById('menu').classList.add('open'); const menuRect = document.getElementById('menu').getBoundingClientRect(); const scaleRect = document.getElementById('scale').getBoundingClientRect(); ({ menu: { top: menuRect.top, left: menuRect.left, right: menuRect.right, bottom: menuRect.bottom }, scaleTop: scaleRect.top, viewport: { width: window.innerWidth, height: window.innerHeight } })"
              );
              const compactMenuKeepsSizeControlVisible = compactMenuGeometry.menu.top >= 0 &&
                compactMenuGeometry.menu.left >= 0 &&
                compactMenuGeometry.menu.right <= compactMenuGeometry.viewport.width &&
                compactMenuGeometry.menu.bottom <= compactMenuGeometry.viewport.height &&
                compactMenuGeometry.scaleTop >= compactMenuGeometry.menu.top;
              win.setBounds(originalBounds, true);
              const result = {
                visualSizeStable: visualBefore.width === visualAfter.width && visualBefore.height === visualAfter.height,
                longPressDidNotResize:
                  visualBefore.width === visualAfterLongPress.width &&
                  visualBefore.height === visualAfterLongPress.height,
                windowBoundaryDriftAtMostOnePixel:
                  Math.max(...observedWidths) - Math.min(...observedWidths) <= 1 &&
                  Math.max(...observedHeights) - Math.min(...observedHeights) <= 1,
                scaleUnchanged: scaleBefore === preferences.scale,
                dragReleased: drag === null,
                hoverDidNotOpenMenu: menuOpenBeforeRightClick === false,
                rightClickOpenedMenu: menuOpenAfterRightClick === true,
                alwaysOnTopControlPresent,
                alwaysOnTopInitially,
                alwaysOnTopCanBeDisabled,
                alwaysOnTopCanBeEnabled,
                eggEditorOpenedFromMenu,
                idleBubbleHidden,
                primaryVisibleAfterPetClick,
                firstClickSkippedReaction,
                touchSoundOptionsPresent,
                audioAssetsLoaded,
                touchSoundSelectionSaved,
                eggVisibleOnSecondClick,
                secondaryVisibleAfterEgg,
                completionUsageShowsPercentAndTokens,
                completionUsageIsImmediate,
                compactMenuKeepsSizeControlVisible,
                compactMenuGeometry,
                visualBefore,
                visualAfterLongPress,
                visualAfter,
                before,
                after
              };
              fs.writeFileSync(dragTestPath, JSON.stringify(result, null, 2), 'utf8');
              preferences.activeAgent = savedAgentForTest;
              savePreferences();
              app.quit();
            }, 800);
          }, 12);
        } catch (error) {
          fs.writeFileSync(dragTestPath, JSON.stringify({ error: error.message }, null, 2), 'utf8');
          preferences.activeAgent = savedAgentForTest;
          savePreferences();
          app.quit();
        }
      }, 800);
    }
  });
  win.on('moved', () => {
    const bounds = win.getBounds();
    preferences.x = bounds.x;
    preferences.y = bounds.y;
    sendSide();
    clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(savePreferences, 250);
  });
  win.on('blur', () => {
    if (preferences.alwaysOnTop !== false) setTimeout(applyAlwaysOnTop, 50);
  });
}

class CodexUsageClient {
  constructor(onUsage) {
    this.onUsage = onUsage;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.initialized = false;
    this.restartTimer = null;
  }

  start() {
    if (this.child) return;
    const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'codex';
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'codex.cmd app-server --stdio']
      : ['app-server', '--stdio'];
    try {
      this.child = spawn(command, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      log(`app-server spawn failed: ${error.message}`);
      this.scheduleRestart();
      return;
    }
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => log(`app-server: ${String(chunk).trim().slice(0, 500)}`));
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on('line', (line) => this.handleLine(line));
    this.child.on('error', (error) => { log(`app-server error: ${error.message}`); this.scheduleRestart(); });
    this.child.on('exit', (code) => { log(`app-server exited: ${code}`); this.scheduleRestart(); });
    this.request('initialize', {
      clientInfo: { name: 'codex-whale-widget', title: 'Codex Whale Widget', version: '0.1.1' }
    }).then(() => {
      this.initialized = true;
      this.notify('initialized', {});
      return this.refresh();
    }).catch((error) => { log(`initialize failed: ${error.message}`); this.scheduleRestart(); });
  }

  scheduleRestart() {
    if (this.child) {
      this.child.removeAllListeners();
      this.child = null;
    }
    this.initialized = false;
    for (const { reject } of this.pending.values()) reject(new Error('Codex App Server disconnected'));
    this.pending.clear();
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.start(), 5000);
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error('Codex App Server is unavailable');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 12000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });
      try { this.write({ id, method, params }); }
      catch (error) { this.pending.delete(id); clearTimeout(timeout); reject(error); }
    });
  }

  notify(method, params = {}) {
    try { this.write({ method, params }); } catch {}
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { log('ignored non-JSON app-server output'); return; }
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        log(`request failed: ${message.error.message || 'App Server error'}`);
        pending.reject(new Error(message.error.message || 'App Server error'));
      }
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'account/rateLimits/updated') {
      this.refresh().catch(() => {});
    }
  }

  async refresh() {
    if (!this.initialized) return null;
    const [result, accountUsage] = await Promise.all([
      this.request('account/rateLimits/read', {}),
      this.request('account/usage/read', {}).catch(() => null)
    ]);
    const normalized = normalizeUsage(result, accountUsage);
    this.onUsage(normalized);
    return normalized;
  }

  stop() {
    clearTimeout(this.restartTimer);
    if (this.child) this.child.kill();
    this.child = null;
  }
}

function normalizeWindow(value) {
  if (!value || typeof value.usedPercent !== 'number') return null;
  return {
    usedPercent: Math.max(0, Math.min(100, value.usedPercent)),
    remainingPercent: Math.max(0, Math.min(100, 100 - value.usedPercent)),
    windowDurationMins: value.windowDurationMins ?? null,
    resetsAt: value.resetsAt ?? null
  };
}

function todayDateStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function normalizeTodayTokens(result) {
  const buckets = result?.dailyUsageBuckets;
  if (!Array.isArray(buckets)) return null;
  const today = buckets.find((bucket) => bucket?.startDate === todayDateStamp());
  return Number.isFinite(today?.tokens) && today.tokens >= 0 ? Math.round(today.tokens) : null;
}

function normalizeUsage(result, accountUsage = null) {
  const byId = result?.rateLimitsByLimitId;
  const bucket = (byId && (byId.codex || Object.values(byId)[0])) || result?.rateLimits || {};
  return {
    primary: normalizeWindow(bucket.primary),
    secondary: normalizeWindow(bucket.secondary),
    todayTokens: normalizeTodayTokens(accountUsage),
    planType: bucket.planType || result?.rateLimits?.planType || null,
    ordinaryUsageAllowed: result?.ordinaryUsageAllowed ?? null,
    fetchedAt: Date.now()
  };
}

const usageClient = new CodexUsageClient((usage) => {
  latestUsage = usage;
  agents.codex.available = true;
  agents.codex.reason = null;
  try { fs.writeFileSync(usageDebugFile, JSON.stringify(usage, null, 2), 'utf8'); } catch {}
  if (normalizeActiveAgent(preferences.activeAgent) === 'codex') sendUsage(usage);
});

// Mirrors ZCode's own credential scheme (zcode.cjs createZCodeCredentialCipher):
// AES-256-GCM with a key derived from platform/homedir/username, so the whale
// can read the cached JWT without touching the running app.
function decryptZCodeCredential(value) {
  const PREFIX = 'enc:v1:';
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('invalid credential format');
  let username = 'unknown';
  try { username = os.userInfo().username; } catch {}
  const secret = process.env.ZCODE_CREDENTIAL_SECRET?.trim()
    || `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

function loadZCodeToken() {
  let creds;
  try { creds = JSON.parse(fs.readFileSync(zcodeCredentialsFile, 'utf8')); }
  catch { throw new Error('未找到 ZCode 登录凭据，请先在 ZCode 中登录'); }
  const raw = creds['zcodejwttoken'];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('zcodejwttoken missing');
  return decryptZCodeCredential(raw).trim();
}

function loadBigmodelToken() {
  let creds;
  try { creds = JSON.parse(fs.readFileSync(zcodeCredentialsFile, 'utf8')); }
  catch { throw new Error('未找到 bigmodel 登录凭据'); }
  const raw = creds['oauth:bigmodel:access_token'];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('bigmodel access_token missing');
  return decryptZCodeCredential(raw).trim();
}

function loadZCodeDeviceMid() {
  try { return JSON.parse(fs.readFileSync(zcodeTelemetryFile, 'utf8')).deviceMid || ''; }
  catch { return ''; }
}

function zcodeHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'HTTP-Referer': 'https://zcode.z.ai',
    'User-Agent': `ZCode/${zcodeAppVersion}`,
    'X-ZCode-App-Version': zcodeAppVersion,
    'X-Title': 'Z Code@electron',
    'X-Platform': `${process.platform}-${process.arch}`,
    'X-Release-Channel': 'stable',
    'X-Client-Language': 'zh-CN',
    'X-Client-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    'X-Os-Category': process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    'X-Os-Version': os.release(),
    'X-Device-Mid': loadZCodeDeviceMid(),
    'x-request-id': crypto.randomUUID()
  };
}

function normalizeZCodeBucket(balance) {
  if (!balance || typeof balance !== 'object') return null;
  const total = Number(balance.total_units);
  const used = Number(balance.used_units);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return null;
  const usedPercent = Math.max(0, Math.min(100, (used / total) * 100));
  return {
    id: balance.entitlement_id || balance.bucket_id || null,
    name: balance.show_name || '套餐额度',
    usedUnits: Math.round(used),
    totalUnits: Math.round(total),
    remainingUnits: Math.max(0, Math.round(total - used)),
    usedPercent: Math.round(usedPercent * 10) / 10,
    remainingPercent: Math.round((100 - usedPercent) * 10) / 10,
    period: balance.period || null,
    resetsAt: Number.isFinite(balance.expires_at) ? balance.expires_at : null
  };
}

function normalizeZCodeUsage(payload) {
  const data = payload?.data || payload || {};
  const modelBuckets = (Array.isArray(data.balances) ? data.balances : [])
    .map(normalizeZCodeBucket)
    .filter(Boolean)
    .sort((a, b) => (b.usedPercent || 0) - (a.usedPercent || 0));
  return {
    agent: 'zcode',
    primary: null,
    secondary: null,
    modelBuckets,
    // Keep the old field for any cached UI/test code that still reads it.
    buckets: modelBuckets,
    plans: (Array.isArray(data.plans) ? data.plans : []).map((plan) => ({
      name: plan.name,
      status: plan.status,
      endsAt: plan.ends_at ?? null
    })),
    fetchedAt: Date.now()
  };
}

function normalizeBigmodelLimit(limit, index, totalLimits) {
  if (!limit || typeof limit !== 'object') return null;
  const totalUnits = Number(limit.usage);
  const usedUnits = Number(limit.currentValue);
  const remainingUnits = Number(limit.remaining);
  if (!Number.isFinite(totalUnits) || totalUnits <= 0 || !Number.isFinite(remainingUnits)) return null;
  const usedPercent = Number.isFinite(Number(limit.percentage))
    ? Math.max(0, Math.min(100, Number(limit.percentage)))
    : Math.max(0, Math.min(100, (usedUnits / totalUnits) * 100));
  const nextResetMillis = Number(limit.nextResetTime);
  const resetsAt = Number.isFinite(nextResetMillis)
    ? Math.round((nextResetMillis > 1e12 ? nextResetMillis : nextResetMillis * 1000) / 1000)
    : null;
  const name = totalLimits > 1
    ? index === 0 ? '5小时' : index === 1 ? '每周' : `窗口 ${index + 1}`
    : '套餐额度';
  return {
    id: `${limit.type || 'quota'}-${limit.unit ?? index}`,
    name,
    usedUnits: Math.max(0, Math.round(Number.isFinite(usedUnits) ? usedUnits : totalUnits - remainingUnits)),
    totalUnits: Math.round(totalUnits),
    remainingUnits: Math.max(0, Math.round(remainingUnits)),
    usedPercent: Math.round(usedPercent * 10) / 10,
    remainingPercent: Math.round((100 - usedPercent) * 10) / 10,
    period: name,
    resetsAt
  };
}

function normalizeBigmodelQuota(payload) {
  const limits = Array.isArray(payload?.data?.limits) ? payload.data.limits : [];
  const ordered = limits
    .map((limit, index) => ({ limit, index }))
    .sort((a, b) => Number(a.limit?.nextResetTime || Number.MAX_SAFE_INTEGER) - Number(b.limit?.nextResetTime || Number.MAX_SAFE_INTEGER))
    .map(({ limit }, index) => normalizeBigmodelLimit(limit, index, limits.length))
    .filter(Boolean);
  return {
    primary: ordered[0] || null,
    secondary: ordered[1] || null,
    windows: ordered
  };
}

async function fetchBigmodelQuota() {
  try {
    const token = loadBigmodelToken();
    const response = await fetch(bigmodelQuotaUrl, {
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        'User-Agent': `ZCode/${zcodeAppVersion}`
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`quota/limit HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.code !== 200 && payload?.success !== true) {
      throw new Error(payload?.msg || 'BigModel 配额响应无效');
    }
    return normalizeBigmodelQuota(payload);
  } catch (error) {
    log(`bigmodel quota failed: ${error.message}`);
    return null;
  }
}

class ZcodeUsageClient {
  constructor() {
    this.timer = null;
    this.token = null;
    this.tokenReadAt = 0;
  }

  async loadToken(force = false) {
    if (!force && this.token && Date.now() - this.tokenReadAt < 5 * 60 * 1000) return this.token;
    this.token = loadZCodeToken();
    this.tokenReadAt = Date.now();
    return this.token;
  }

  async refresh() {
    let usage;
    try {
      const token = await this.loadToken();
      const url = `${zcodeBalanceUrl}?app_version=${zcodeAppVersion}`;
      let response = await fetch(url, { headers: zcodeHeaders(token) });
      if (response.status === 401) {
        this.token = null;
        const fresh = await this.loadToken(true).catch(() => null);
        if (fresh) response = await fetch(url, { headers: zcodeHeaders(fresh) }).catch(() => null) || response;
      }
      if (!response || response.status === 401) {
        throw new Error('ZCode 登录已过期，请打开 ZCode 重新登录');
      } else if (!response.ok) {
        throw new Error(`billing/balance HTTP ${response.status}`);
      } else {
        usage = normalizeZCodeUsage(await response.json());
      }
      const quota = await fetchBigmodelQuota();
      if (quota) {
        usage.primary = quota.primary;
        usage.secondary = quota.secondary;
        usage.quotaWindows = quota.windows;
        usage.quotaSource = 'bigmodel';
      } else {
        usage.quotaSource = null;
        usage.quotaError = '个人套餐额度暂时无法读取';
      }
      const today = readZCodeTodayUsage();
      usage.todayTokens = today ? today.total : null;
      usage.todayByModel = today ? today.byModel : null;
      agents.zcode.available = true;
      agents.zcode.reason = null;
    } catch (error) {
      agents.zcode.available = false;
      agents.zcode.reason = error.message?.slice(0, 120) || 'ZCode 不可用';
      if (latestZcodeUsage) {
        usage = { ...latestZcodeUsage, stale: true, staleReason: agents.zcode.reason };
      } else {
        usage = { agent: 'zcode', error: agents.zcode.reason, fetchedAt: Date.now() };
      }
      log(`zcode usage failed: ${agents.zcode.reason}`);
    }
    latestZcodeUsage = usage;
    try { fs.writeFileSync(zcodeUsageDebugFile, JSON.stringify(usage, null, 2), 'utf8'); } catch {}
    sendAgents();
    if (normalizeActiveAgent(preferences.activeAgent) === 'zcode') sendUsage(usage);
    return usage;
  }

  start() {
    this.refresh().catch(() => {});
    this.timer = setInterval(() => this.refresh().catch(() => {}), 60000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}

const zcodeUsageClient = new ZcodeUsageClient();

// Reads ~/.zcode/cli/rollout/model-io-*.jsonl and aggregates today's token
// usage per model. Only completed JSON lines are counted; chat bodies are
// never parsed into memory beyond streaming the line for usage fields.
function readZCodeTodayUsage() {
  let files;
  try { files = fs.readdirSync(zcodeRolloutDir).filter((name) => /^model-io-.*\.jsonl$/.test(name)); }
  catch { return null; }
  const today = new Date();
  const dayPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let total = 0;
  const byModel = new Map();
  let sawAnyLine = false;
  for (const name of files) {
    const file = path.join(zcodeRolloutDir, name);
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.includes('"completedAt"')) continue;
      let record;
      try { record = JSON.parse(trimmed); } catch { continue; }
      if (!String(record.completedAt || '').startsWith(dayPrefix)) continue;
      const usage = record?.response?.usage || record?.usage;
      const tokens = Number(usage?.totalTokens ?? usage?.total_tokens);
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      sawAnyLine = true;
      total += tokens;
      const model = record?.model?.modelId || '未知模型';
      byModel.set(model, (byModel.get(model) || 0) + tokens);
    }
  }
  if (!sawAnyLine) return null;
  return { total, byModel: Object.fromEntries(byModel) };
}

// Watches model-io logs to mirror ZCode task activity as synthetic hook
// events, so the whale reacts to ZCode sessions without any hooks config.
class ZcodeActivityWatcher {
  constructor() {
    this.sizes = new Map();
    this.idle = true;
    this.lastAppendAt = 0;
    this.taskTokens = 0;
    this.timer = null;
    this.stopTimer = null;
  }

  snapshot() {
    const sizes = new Map();
    try {
      for (const name of fs.readdirSync(zcodeRolloutDir)) {
        if (!/^model-io-.*\.jsonl$/.test(name)) continue;
        try { sizes.set(name, fs.statSync(path.join(zcodeRolloutDir, name)).size); } catch {}
      }
    } catch {}
    return sizes;
  }

  emit(name, extra = {}) {
    const event = { hook_event_name: name, agent: 'zcode', receivedAt: Date.now(), ...extra };
    if (rendererReady && win && !win.isDestroyed()) win.webContents.send('whale:codex-event', event);
  }

  poll() {
    const sizes = this.snapshot();
    let appended = 0;
    let appendedTokens = 0;
    let lastRecord = null;
    for (const [name, size] of sizes) {
      const previous = this.sizes.get(name) ?? 0;
      if (size <= previous) continue;
      let chunk = '';
      try {
        const fd = fs.openSync(path.join(zcodeRolloutDir, name), 'r');
        const buffer = Buffer.alloc(size - previous);
        fs.readSync(fd, buffer, 0, buffer.length, previous);
        fs.closeSync(fd);
        chunk = buffer.toString('utf8');
      } catch { this.sizes.set(name, size); continue; }
      this.sizes.set(name, size);
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('{') === false) continue;
        let record;
        try { record = JSON.parse(trimmed); } catch { continue; }
        appended += 1;
        const usage = record?.response?.usage || record?.usage;
        const tokens = Number(usage?.totalTokens ?? usage?.total_tokens);
        if (Number.isFinite(tokens) && tokens > 0) appendedTokens += tokens;
        lastRecord = record;
      }
    }
    for (const name of this.sizes.keys()) if (!sizes.has(name)) this.sizes.delete(name);
    if (appended > 0) {
      const model = lastRecord?.model?.modelId || null;
      if (this.idle) {
        this.idle = false;
        this.taskTokens = 0;
        this.emit('UserPromptSubmit', { model });
      }
      this.taskTokens += appendedTokens;
      this.lastAppendAt = Date.now();
      this.emit('PreToolUse', { model });
      clearTimeout(this.stopTimer);
      this.stopTimer = setTimeout(() => {
        if (this.idle) return;
        this.idle = true;
        this.emit('Stop', { model, usage: { total_tokens: this.taskTokens } });
        zcodeUsageClient.refresh().catch(() => {});
      }, 6000);
    }
  }

  start() {
    this.sizes = this.snapshot();
    this.timer = setInterval(() => {
      try { this.poll(); } catch {}
    }, 2000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.stopTimer);
  }
}

const zcodeWatcher = new ZcodeActivityWatcher();

function pollEvents() {
  try {
    const stat = fs.statSync(eventsFile);
    if (stat.size < eventOffset) eventOffset = 0;
    if (stat.size === eventOffset) return;
    const length = stat.size - eventOffset;
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(eventsFile, 'r');
    fs.readSync(fd, buffer, 0, length, eventOffset);
    fs.closeSync(fd);
    eventOffset = stat.size;
    for (const line of buffer.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        const value = JSON.parse(line);
        if (Date.now() - (value.receivedAt || 0) < 30000 && win && !win.isDestroyed()) {
          const tagged = { agent: 'codex', ...value };
          if (rendererReady) win.webContents.send('whale:codex-event', tagged);
          else queuedEvents.push(tagged);
          const eventName = value.hook_event_name || value.event_name || value.event || value.type;
          if (eventName === 'Stop' || eventName === 'Interrupt') usageClient.refresh().catch(() => {});
        }
      } catch {}
    }
  } catch {}
}

ipcMain.handle('whale:get-state', () => ({ preferences, usage: activeUsage(), ...agentsSummary() }));
ipcMain.handle('whale:refresh-usage', () => {
  const refresh = normalizeActiveAgent(preferences.activeAgent) === 'zcode'
    ? zcodeUsageClient.refresh()
    : usageClient.refresh();
  return refresh.catch(() => null);
});
ipcMain.handle('whale:switch-agent', (_event, agentId) => {
  const next = normalizeActiveAgent(agentId);
  preferences.activeAgent = next;
  savePreferences();
  sendAgents();
  sendUsage(activeUsage());
  if (win && !win.isDestroyed()) {
    win.webContents.send('whale:agent-changed', { activeAgent: next, name: agents[next].name });
  }
  if (next === 'zcode') zcodeUsageClient.refresh().catch(() => {});
  else usageClient.refresh().catch(() => {});
  return agentsSummary();
});
ipcMain.handle('whale:save-preferences', (_event, next) => {
  const oldScale = preferences.scale;
  const oldAlwaysOnTop = preferences.alwaysOnTop;
  if (drag && next && Object.hasOwn(next, 'scale')) next = { ...next, scale: oldScale };
  preferences = { ...preferences, ...next };
  preferences.scale = Math.min(2.5, Math.max(0.6, Number(preferences.scale) || defaults.scale));
  preferences.touchSound = normalizeTouchSound(preferences.touchSound || preferences.sound);
  preferences.volume = Math.min(1, Math.max(0, Number(preferences.volume) || 0));
  preferences.alwaysOnTop = preferences.alwaysOnTop !== false;
  preferences.activeAgent = normalizeActiveAgent(preferences.activeAgent);
  preferences.lowBalanceThreshold = Math.min(90, Math.max(0, Number(preferences.lowBalanceThreshold) || 0));
  preferences.easterEggChance = Math.min(1, Math.max(0, Number(preferences.easterEggChance) || defaults.easterEggChance));
  if (Array.isArray(preferences.easterEggLines)) {
    preferences.easterEggLines = preferences.easterEggLines
      .filter((line) => typeof line === 'string')
      .map((line) => line.trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 100);
  }
  if (!preferences.easterEggLines?.length) preferences.easterEggLines = [...defaultEasterEggLines];
  savePreferences();
  if (win && preferences.scale !== oldScale) {
    const size = widgetSize();
    const bounds = win.getBounds();
    const position = clampPosition(bounds.x + bounds.width - size, bounds.y + bounds.height - size, size);
    win.setBounds({ ...position, width: size, height: size }, true);
    sendSide();
  }
  if (win && preferences.alwaysOnTop !== oldAlwaysOnTop) applyAlwaysOnTop();
  return preferences;
});
ipcMain.on('whale:set-interactive', (_event, interactive) => {
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(!interactive, { forward: true });
    win.setFocusable(Boolean(interactive));
  }
});
ipcMain.on('whale:set-focusable', (_event, focusable) => {
  if (win && !win.isDestroyed()) win.setFocusable(Boolean(focusable));
});
ipcMain.on('whale:drag-begin', (_event, point) => {
  if (!win || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
  const bounds = win.getBounds();
  drag = {
    mouseX: point.screenX,
    mouseY: point.screenY,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    startedAt: Date.now()
  };
});
ipcMain.on('whale:drag-move', (_event, point) => {
  if (!win || !drag) return;
  if (!Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY) || Date.now() - drag.startedAt > 30000) {
    drag = null;
    return;
  }
  const position = clampPosition(
    drag.x + point.screenX - drag.mouseX,
    drag.y + point.screenY - drag.mouseY,
    drag.width,
    drag.height
  );
  win.setBounds({ ...position, width: drag.width, height: drag.height }, false);
});
ipcMain.on('whale:drag-end', () => {
  if (!win || !drag) return;
  const finishedDrag = drag;
  drag = null;
  const bounds = win.getBounds();
  const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const snapX = bounds.x + bounds.width / 2 < area.x + area.width / 2
    ? area.x
    : area.x + area.width - finishedDrag.width;
  const position = clampPosition(snapX, bounds.y, finishedDrag.width, finishedDrag.height);
  win.setBounds({ ...position, width: finishedDrag.width, height: finishedDrag.height }, true);
  const snapped = win.getBounds();
  preferences.x = snapped.x;
  preferences.y = snapped.y;
  savePreferences();
});
ipcMain.on('whale:quit', () => app.quit());

if (!dragTestPath && !agentTestPath && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.showInactive(); applyAlwaysOnTop(); }
  });
  app.whenReady().then(async () => {
    fs.mkdirSync(dataDir, { recursive: true });
    loadPreferences();
    loadCachedUsage();
    try { eventOffset = Math.max(0, fs.statSync(eventsFile).size - 65536); } catch { eventOffset = 0; }
    widgetServer = createWidgetServer({
      pluginRoot,
      dataDir,
      getUsage: activeUsage,
      getAgent: () => normalizeActiveAgent(preferences.activeAgent),
      getLastTurn: () => lastTurn ? { ok: true, seq: lastTurnSeq, ...lastTurn } : { ok: true, seq: lastTurnSeq, turn: null, amount: null, tokens: null, ts: null }
    });
    widgetPort = await widgetServer.start();
    createWindow();
    usageClient.start();
    zcodeUsageClient.start();
    zcodeWatcher.start();
    heartbeatTimer = setInterval(() => {
      try { fs.writeFileSync(heartbeatFile, String(Date.now()), 'utf8'); } catch {}
    }, 2000);
    eventTimer = setInterval(pollEvents, 350);
    setInterval(() => usageClient.refresh().catch(() => {}), 60000).unref();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  clearInterval(heartbeatTimer);
  clearInterval(eventTimer);
  clearTimeout(moveSaveTimer);
  usageClient.stop();
  zcodeUsageClient.stop();
  zcodeWatcher.stop();
  try { widgetServer?.stop(); } catch {}
  try { fs.unlinkSync(heartbeatFile); } catch {}
});
