const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const pluginRoot = process.env.CODEX_WHALE_PLUGIN_ROOT || __dirname;
const dataDir = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'CodexWhaleWidget');
const stateFile = path.join(dataDir, 'state.json');
const eventsFile = path.join(dataDir, 'events.jsonl');
const heartbeatFile = path.join(dataDir, 'heartbeat');
const usageDebugFile = path.join(dataDir, 'latest-usage.json');
const logFile = path.join(dataDir, 'widget.log');
const screenshotPath = process.env.CODEX_WHALE_SCREENSHOT || null;
const dragTestPath = process.env.CODEX_WHALE_DRAG_TEST || null;

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
  notifyOnStop: true,
  easterEggChance: 0.28,
  easterEggLines: defaultEasterEggLines,
  x: null,
  y: null
};

const touchSoundOptions = new Set(['duck', 'fx1', 'random', 'off']);

function normalizeTouchSound(value) {
  return touchSoundOptions.has(value) ? value : defaults.touchSound;
}

let win;
let preferences = { ...defaults };
let latestUsage = null;
let eventOffset = 0;
let drag = null;
let heartbeatTimer;
let eventTimer;
let moveSaveTimer;
let rendererReady = false;
const queuedEvents = [];

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
}

function loadCachedUsage() {
  try { latestUsage = JSON.parse(fs.readFileSync(usageDebugFile, 'utf8')); }
  catch { latestUsage = null; }
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

function createWindow() {
  const size = widgetSize();
  const area = currentDisplay().workArea;
  const fallbackX = area.x + area.width - size - 24;
  const fallbackY = area.y + area.height - size - 18;
  const position = clampPosition(
    Number.isFinite(preferences.x) ? preferences.x : fallbackX,
    Number.isFinite(preferences.y) ? preferences.y : fallbackY,
    size
  );

  win = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: size,
    height: size,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
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
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(pluginRoot, 'ui', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    while (queuedEvents.length) win.webContents.send('whale:codex-event', queuedEvents.shift());
  });
  win.once('ready-to-show', () => {
    win.showInactive();
    sendSide();
    if (latestUsage) win.webContents.send('whale:usage', latestUsage);
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
    if (dragTestPath) {
      setTimeout(async () => {
        try {
          const before = win.getBounds();
          const visualBefore = await win.webContents.executeJavaScript(
            "({ width: document.getElementById('widget').getBoundingClientRect().width, height: document.getElementById('widget').getBoundingClientRect().height })"
          );
          const idleBubbleHidden = await win.webContents.executeJavaScript(
            "document.getElementById('bubble').classList.contains('open') === false"
          );
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
              const eggEditorOpenedFromMenu = await win.webContents.executeJavaScript(
                "document.getElementById('openEggEditor').click(); document.getElementById('eggEditor').classList.contains('open')"
              );
              await win.webContents.executeJavaScript("document.getElementById('cancelEggs').click()");
              win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 });
              win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 });
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
                eggEditorOpenedFromMenu,
                idleBubbleHidden,
                primaryVisibleAfterPetClick,
                firstClickSkippedReaction,
                touchSoundOptionsPresent,
                audioAssetsLoaded,
                touchSoundSelectionSaved,
                eggVisibleOnSecondClick,
                secondaryVisibleAfterEgg,
                visualBefore,
                visualAfterLongPress,
                visualAfter,
                before,
                after
              };
              fs.writeFileSync(dragTestPath, JSON.stringify(result, null, 2), 'utf8');
              app.quit();
            }, 800);
          }, 12);
        } catch (error) {
          fs.writeFileSync(dragTestPath, JSON.stringify({ error: error.message }, null, 2), 'utf8');
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
    const result = await this.request('account/rateLimits/read', {});
    const normalized = normalizeUsage(result);
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

function normalizeUsage(result) {
  const byId = result?.rateLimitsByLimitId;
  const bucket = (byId && (byId.codex || Object.values(byId)[0])) || result?.rateLimits || {};
  return {
    primary: normalizeWindow(bucket.primary),
    secondary: normalizeWindow(bucket.secondary),
    planType: bucket.planType || result?.rateLimits?.planType || null,
    ordinaryUsageAllowed: result?.ordinaryUsageAllowed ?? null,
    fetchedAt: Date.now()
  };
}

const usageClient = new CodexUsageClient((usage) => {
  latestUsage = usage;
  try { fs.writeFileSync(usageDebugFile, JSON.stringify(usage, null, 2), 'utf8'); } catch {}
  if (win && !win.isDestroyed()) win.webContents.send('whale:usage', usage);
});

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
          if (rendererReady) win.webContents.send('whale:codex-event', value);
          else queuedEvents.push(value);
          const eventName = value.hook_event_name || value.event_name || value.event || value.type;
          if (eventName === 'Stop' || eventName === 'Interrupt') usageClient.refresh().catch(() => {});
        }
      } catch {}
    }
  } catch {}
}

ipcMain.handle('whale:get-state', () => ({ preferences, usage: latestUsage }));
ipcMain.handle('whale:refresh-usage', () => usageClient.refresh().catch(() => null));
ipcMain.handle('whale:save-preferences', (_event, next) => {
  const oldScale = preferences.scale;
  if (drag && next && Object.hasOwn(next, 'scale')) next = { ...next, scale: oldScale };
  preferences = { ...preferences, ...next };
  preferences.scale = Math.min(2.5, Math.max(0.6, Number(preferences.scale) || defaults.scale));
  preferences.touchSound = normalizeTouchSound(preferences.touchSound || preferences.sound);
  preferences.volume = Math.min(1, Math.max(0, Number(preferences.volume) || 0));
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
  return preferences;
});
ipcMain.on('whale:set-interactive', (_event, interactive) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true });
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.showInactive(); win.moveTop(); }
  });
  app.whenReady().then(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    loadPreferences();
    loadCachedUsage();
    try { eventOffset = Math.max(0, fs.statSync(eventsFile).size - 65536); } catch { eventOffset = 0; }
    createWindow();
    usageClient.start();
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
  try { fs.unlinkSync(heartbeatFile); } catch {}
});
