const api = window.codexWhale;
const widget = document.getElementById('widget');
const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const label = document.getElementById('label');
const amount = document.getElementById('amount');
const detail = document.getElementById('detail');
const menu = document.getElementById('menu');
const eggEditor = document.getElementById('eggEditor');
const eggLines = document.getElementById('eggLines');
const controls = {
  scale: document.getElementById('scale'),
  touchSound: document.getElementById('touchSound'),
  volume: document.getElementById('volume'),
  alwaysOnTop: document.getElementById('alwaysOnTop'),
  notifyOnStop: document.getElementById('notifyOnStop')
};

const DEFAULT_EGGS = [
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

let preferences = {};
let usage = null;
let viewMode = 'idle';
let bubbleTimer = null;
let dragging = false;
let moved = false;
let dragOrigin = null;
let activePointerId = null;
let pressTimer = null;
let dragSafetyTimer = null;
let visualLockUntil = 0;
let touchGesture = null;
let turnBaseline = null;
let completionState = null;

function remaining(windowValue) {
  return windowValue && Number.isFinite(windowValue.remainingPercent)
    ? Math.round(windowValue.remainingPercent)
    : null;
}

function usageSnapshot(value) {
  return {
    primaryRemaining: remaining(value?.primary),
    secondaryRemaining: remaining(value?.secondary),
    todayTokens: Number.isFinite(value?.todayTokens) ? value.todayTokens : null
  };
}

function formatTokens(value) {
  if (!Number.isFinite(value)) return null;
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}K`;
  return String(Math.round(value));
}

function consumedPercent(before, after) {
  if (!Number.isFinite(before.primaryRemaining) || !Number.isFinite(after.primaryRemaining)) return null;
  const delta = Math.round((before.primaryRemaining - after.primaryRemaining) * 10) / 10;
  return delta > 0 ? delta : null;
}

function resetText(windowValue) {
  if (!windowValue?.resetsAt) return '重置时间暂不可用';
  const date = new Date(windowValue.resetsAt * 1000);
  const now = new Date();
  const options = date.toDateString() === now.toDateString()
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return `${new Intl.DateTimeFormat('zh-CN', options).format(date)} 重置`;
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  viewMode = 'idle';
  completionState = null;
  bubble.classList.remove('open', 'egg');
  amount.classList.remove('warn', 'danger');
}

function scheduleHide(delay = 9000) {
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, delay);
}

function renderAllowance(kind) {
  const isPrimary = kind === 'primary';
  const windowValue = isPrimary ? usage?.primary : usage?.secondary;
  const value = remaining(windowValue);
  viewMode = kind;
  bubble.classList.remove('egg');
  bubble.classList.add('open');
  label.textContent = isPrimary ? 'Codex · 5小时' : 'Codex · 每周';
  amount.textContent = value == null ? '--%' : `${value}%`;
  detail.textContent = value == null ? '正在读取套餐用量…' : resetText(windowValue);
  amount.classList.toggle('warn', value != null && value <= 30 && value > 10);
  amount.classList.toggle('danger', value != null && value <= 10);
  scheduleHide();
}

function showEgg() {
  const lines = Array.isArray(preferences.easterEggLines) && preferences.easterEggLines.length
    ? preferences.easterEggLines
    : DEFAULT_EGGS;
  const line = lines[Math.floor(Math.random() * lines.length)];
  viewMode = 'egg';
  bubble.classList.add('open', 'egg');
  label.textContent = '鲸鱼悄悄话';
  amount.textContent = line;
  detail.textContent = '';
  amount.classList.remove('warn', 'danger');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => renderAllowance('secondary'), 3000);
}

function play(name) {
  const el = document.getElementById(name);
  if (!el) return;
  playAudio(el);
}

function playAudio(el) {
  el.volume = Math.max(0, Math.min(1, Number(preferences.volume ?? .65)));
  el.currentTime = 0;
  el.play().catch(() => {});
}

function selectedTouchSet() {
  const selected = preferences.touchSound || preferences.sound || 'duck';
  if (selected === 'off') return null;
  if (selected === 'random') return Math.random() < .5 ? 'duck' : 'fx1';
  return selected === 'fx1' ? 'fx1' : 'duck';
}

function touchAudio(set, phase) {
  if (!set) return null;
  return document.getElementById(`${set}${phase === 'press' ? 'Press' : 'Release'}`);
}

function playTouchRelease(gesture) {
  if (!gesture || gesture.releasePlayed) return;
  gesture.releasePlayed = true;
  playAudio(gesture.release);
}

function beginTouchSound() {
  if (touchGesture?.timer) clearTimeout(touchGesture.timer);
  const set = selectedTouchSet();
  if (!set || Number(preferences.volume ?? .65) <= 0) {
    touchGesture = null;
    return;
  }
  const press = touchAudio(set, 'press');
  const release = touchAudio(set, 'release');
  if (!press || !release) return;
  press.pause();
  release.pause();
  const gesture = { press, release, released: false, releasePlayed: false, timer: null };
  touchGesture = gesture;
  press.onended = () => {
    if (touchGesture !== gesture) return;
    if (gesture.released) playTouchRelease(gesture);
  };
  playAudio(press);
}

function endTouchSound() {
  const gesture = touchGesture;
  if (!gesture) return;
  gesture.released = true;
  const duration = gesture.press.duration;
  const remainingMs = Number.isFinite(duration) && duration > 0
    ? Math.max(0, (duration - gesture.press.currentTime) * 1000)
    : null;
  if (remainingMs == null) return;
  gesture.timer = setTimeout(() => {
    gesture.timer = null;
    if (touchGesture === gesture) playTouchRelease(gesture);
  }, Math.max(0, remainingMs - 100));
}

function previewTouchSound() {
  beginTouchSound();
  setTimeout(endTouchSound, 120);
}

function showMessage(title, value, sub, duration = 3200) {
  clearTimeout(bubbleTimer);
  viewMode = 'message';
  bubble.classList.remove('egg');
  bubble.classList.add('open');
  label.textContent = title;
  amount.textContent = value;
  detail.textContent = sub || '';
  amount.classList.remove('warn', 'danger');
  if (duration > 0) bubbleTimer = setTimeout(hideBubble, duration);
}

function tokenCountFromEvent(value) {
  const candidates = [
    value?.usage,
    value?.tokenUsage,
    value?.token_usage,
    value?.turn?.usage,
    value?.turn?.tokenUsage,
    value?.turn?.token_usage
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const total = candidate.totalTokens ?? candidate.total_tokens ?? candidate.tokens;
    if (Number.isFinite(total) && total >= 0) return Math.round(total);
    const input = candidate.inputTokens ?? candidate.input_tokens;
    const output = candidate.outputTokens ?? candidate.output_tokens;
    if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
      return Math.round(input + output);
    }
  }
  return null;
}

function renderCompletionUsage(state) {
  const after = usageSnapshot(usage);
  const percent = consumedPercent(state.before, after);
  const tokenDelta = Number.isFinite(state.before.todayTokens) && Number.isFinite(after.todayTokens)
    ? Math.max(0, after.todayTokens - state.before.todayTokens)
    : null;
  const tokenText = state.eventTokens != null
    ? `本轮 ${formatTokens(state.eventTokens)} tokens`
    : tokenDelta != null && tokenDelta > 0
    ? `本轮约 ${formatTokens(tokenDelta)} tokens`
    : after.todayTokens != null
      ? `今日 ${formatTokens(after.todayTokens)} tokens`
      : 'token 计数暂不可用';
  showMessage(
    '任务结束 · 5小时剩余',
    after.primaryRemaining != null ? `${after.primaryRemaining}%` : '--%',
    `${percent != null ? `本轮 -${percent}% · ` : ''}${tokenText}`,
    6500
  );
}

function showCompletionUsage(event) {
  completionState = {
    before: turnBaseline || usageSnapshot(usage),
    eventTokens: tokenCountFromEvent(event)
  };
  turnBaseline = null;
  // Do not wait for App Server: it can occasionally take several seconds to
  // update rate-limit data. The main process refreshes in the background and
  // onUsage below redraws this same message when fresher values arrive.
  renderCompletionUsage(completionState);
}

function showPrimaryAllowance() {
  clearTimeout(bubbleTimer);
  renderAllowance('primary');
}

function eventName(value) {
  return value?.hook_event_name || value?.event_name || value?.event || value?.type || '';
}

function handleCodexEvent(value) {
  const name = eventName(value);
  if (name === 'UserPromptSubmit') {
    completionState = null;
    turnBaseline = usageSnapshot(usage);
    showMessage('Codex', '工作中…', '鲸鱼正在帮你处理任务', 2600);
    play('duckPress');
  } else if (name === 'PermissionRequest') {
    showMessage('Codex', '请确认', '任务正在等待你的操作', 0);
    play('duckRelease');
  } else if (name === 'PreToolUse') {
    if (!turnBaseline) turnBaseline = usageSnapshot(usage);
    document.body.classList.add('press');
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => document.body.classList.remove('press'), 130);
  } else if (name === 'Stop') {
    if (preferences.notifyOnStop !== false) showCompletionUsage(value);
    else api.refreshUsage();
    play('fx1Press');
  } else if (name === 'Interrupt') {
    showMessage('Codex', '已停止', '任务已被中断', 3200);
    play('fx1Release');
    setTimeout(() => api.refreshUsage(), 450);
  } else if (name === 'SessionStart') {
    api.refreshUsage();
  }
}

function saveControls() {
  const previousScale = Number(preferences.scale);
  preferences = {
    ...preferences,
    scale: Number(controls.scale.value),
    touchSound: controls.touchSound.value,
    volume: Number(controls.volume.value),
    alwaysOnTop: controls.alwaysOnTop.checked,
    notifyOnStop: controls.notifyOnStop.checked
  };
  if (Number(preferences.scale) !== previousScale) visualLockUntil = 0;
  api.savePreferences(preferences);
}

function applyPreferences() {
  controls.scale.value = preferences.scale ?? 1.5;
  controls.touchSound.value = preferences.touchSound || preferences.sound || 'duck';
  controls.volume.value = preferences.volume ?? .65;
  controls.alwaysOnTop.checked = preferences.alwaysOnTop !== false;
  controls.notifyOnStop.checked = preferences.notifyOnStop !== false;
  eggLines.value = (preferences.easterEggLines?.length ? preferences.easterEggLines : DEFAULT_EGGS).join('\n');
  hideBubble();
}

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.('.interactive'));
}

function syncVisualSize() {
  widget.style.width = `${window.innerWidth}px`;
  widget.style.height = `${window.innerHeight}px`;
}

syncVisualSize();
window.addEventListener('resize', () => {
  if (!dragging && Date.now() >= visualLockUntil) syncVisualSize();
});

document.addEventListener('mousemove', (event) => {
  api.setInteractive(dragging || isInteractiveTarget(event.target));
});
document.addEventListener('mouseleave', () => {
  if (!dragging && !menu.classList.contains('open') && !eggEditor.classList.contains('open')) {
    api.setInteractive(false);
  }
});

function finishDrag(allowClick) {
  if (!dragging) return;
  dragging = false;
  visualLockUntil = Date.now() + 1000;
  clearTimeout(dragSafetyTimer);
  widget.classList.remove('dragging');
  if (activePointerId != null && pet.hasPointerCapture?.(activePointerId)) {
    try { pet.releasePointerCapture(activePointerId); } catch {}
  }
  activePointerId = null;
  api.endDrag();
  endTouchSound();
  if (allowClick && !moved) {
    document.body.classList.add('press');
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => document.body.classList.remove('press'), 120);
    showPrimaryAllowance();
  }
}

pet.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0 || dragging) return;
  event.preventDefault();
  dragging = true;
  visualLockUntil = Number.POSITIVE_INFINITY;
  moved = false;
  activePointerId = event.pointerId;
  dragOrigin = { x: event.screenX, y: event.screenY };
  menu.classList.remove('open');
  eggEditor.classList.remove('open');
  widget.classList.add('dragging');
  clearTimeout(dragSafetyTimer);
  dragSafetyTimer = setTimeout(() => finishDrag(false), 30000);
  try { pet.setPointerCapture(event.pointerId); } catch {}
  beginTouchSound();
  api.beginDrag({ screenX: event.screenX, screenY: event.screenY });
});
pet.addEventListener('pointermove', (event) => {
  if (!dragging || event.pointerId !== activePointerId) return;
  if ((event.buttons & 1) === 0) {
    finishDrag(false);
    return;
  }
  moved = moved || Math.hypot(event.screenX - dragOrigin.x, event.screenY - dragOrigin.y) > 4;
  api.moveDrag({ screenX: event.screenX, screenY: event.screenY });
});
pet.addEventListener('pointerup', (event) => {
  if (event.pointerId === activePointerId) finishDrag(true);
});
pet.addEventListener('pointercancel', () => finishDrag(false));
pet.addEventListener('lostpointercapture', () => finishDrag(false));
window.addEventListener('blur', () => finishDrag(false));
window.addEventListener('mouseup', () => finishDrag(true));

pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  finishDrag(false);
  eggEditor.classList.remove('open');
  menu.classList.toggle('open');
  api.setInteractive(true);
});

document.addEventListener('pointerdown', (event) => {
  if (event.button === 2 || menu.contains(event.target) || eggEditor.contains(event.target)) return;
  menu.classList.remove('open');
}, true);

bubble.addEventListener('click', () => {
  if (viewMode === 'primary') {
    const chance = Math.max(0, Math.min(1, Number(preferences.easterEggChance ?? .28)));
    if (Math.random() < chance) showEgg();
    else renderAllowance('secondary');
  } else if (viewMode === 'egg') {
    renderAllowance('secondary');
  } else if (viewMode === 'secondary' || viewMode === 'message') {
    hideBubble();
  }
  play('fx1Press');
});

document.getElementById('openEggEditor').addEventListener('click', () => {
  menu.classList.remove('open');
  eggLines.value = (preferences.easterEggLines?.length ? preferences.easterEggLines : DEFAULT_EGGS).join('\n');
  eggEditor.classList.add('open');
  eggLines.focus();
});
document.getElementById('cancelEggs').addEventListener('click', () => eggEditor.classList.remove('open'));
document.getElementById('resetEggs').addEventListener('click', () => { eggLines.value = DEFAULT_EGGS.join('\n'); });
document.getElementById('saveEggs').addEventListener('click', () => {
  const lines = eggLines.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 100);
  preferences = { ...preferences, easterEggLines: lines.length ? lines : [...DEFAULT_EGGS] };
  eggLines.value = preferences.easterEggLines.join('\n');
  api.savePreferences(preferences);
  eggEditor.classList.remove('open');
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  finishDrag(false);
  menu.classList.remove('open');
  eggEditor.classList.remove('open');
});

Object.values(controls).forEach((control) => control.addEventListener('change', saveControls));
controls.touchSound.addEventListener('change', previewTouchSound);
document.getElementById('refresh').addEventListener('click', () => api.refreshUsage());
document.getElementById('quit').addEventListener('click', () => api.quit());

api.onUsage((value) => {
  usage = value;
  if (completionState && viewMode === 'message') renderCompletionUsage(completionState);
  else if (viewMode === 'primary' || viewMode === 'secondary') renderAllowance(viewMode);
});
api.onCodexEvent(handleCodexEvent);
api.onSide((side) => {
  widget.classList.toggle('left', side === 'left');
  widget.classList.toggle('right', side !== 'left');
});

api.getState().then((state) => {
  preferences = state.preferences || {};
  usage = state.usage || null;
  applyPreferences();
  setTimeout(() => api.refreshUsage(), 100);
});
