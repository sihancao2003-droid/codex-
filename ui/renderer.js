const api = window.codexWhale;
const widget = document.getElementById('widget');
const pet = document.getElementById('pet');
const bubble = document.getElementById('bubble');
const label = document.getElementById('label');
const amount = document.getElementById('amount');
const detail = document.getElementById('detail');
const menu = document.getElementById('menu');
const reaction = document.getElementById('reaction');
const controls = {
  displayMode: document.getElementById('displayMode'),
  scale: document.getElementById('scale'),
  volume: document.getElementById('volume'),
  notifyOnStop: document.getElementById('notifyOnStop')
};

let preferences = {};
let usage = null;
let bubbleTimer = null;
let dragging = false;
let moved = false;
let dragOrigin = null;
let activePointerId = null;
let pressTimer = null;
let dragSafetyTimer = null;
let visualLockUntil = 0;
let detailPage = 0;
let transientUntil = 0;

function remaining(windowValue) {
  return windowValue && Number.isFinite(windowValue.remainingPercent)
    ? Math.round(windowValue.remainingPercent)
    : null;
}

function selectedRemaining() {
  const primary = remaining(usage?.primary);
  const secondary = remaining(usage?.secondary);
  if (preferences.displayMode === 'primary') return primary ?? secondary;
  if (preferences.displayMode === 'secondary') return secondary ?? primary;
  return [primary, secondary].filter((v) => v != null).sort((a, b) => a - b)[0] ?? null;
}

function resetText(windowValue) {
  if (!windowValue?.resetsAt) return '';
  const date = new Date(windowValue.resetsAt * 1000);
  const now = new Date();
  const options = date.toDateString() === now.toDateString()
    ? { hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

function renderUsage() {
  const main = selectedRemaining();
  const primary = remaining(usage?.primary);
  const secondary = remaining(usage?.secondary);
  label.textContent = 'Codex 剩余';
  amount.textContent = main == null ? '--%' : `${main}%`;
  amount.classList.toggle('warn', main != null && main <= 30 && main > 10);
  amount.classList.toggle('danger', main != null && main <= 10);
  if (primary == null && secondary == null) {
    detail.textContent = '正在读取套餐用量…';
  } else if (detailPage % 2 === 0) {
    detail.textContent = `5小时 ${primary ?? '--'}% · 每周 ${secondary ?? '--'}%`;
  } else {
    const pReset = resetText(usage.primary);
    const sReset = resetText(usage.secondary);
    detail.textContent = `重置：${pReset || '--'} · ${sReset || '--'}`;
  }
}

function play(name) {
  const el = document.getElementById(name);
  if (!el) return;
  el.volume = Math.max(0, Math.min(1, Number(preferences.volume ?? .65)));
  el.currentTime = 0;
  el.play().catch(() => {});
}

function showMessage(title, value, sub, duration = 3200) {
  clearTimeout(bubbleTimer);
  transientUntil = duration > 0 ? Date.now() + duration : Number.POSITIVE_INFINITY;
  bubble.classList.remove('reacting');
  label.textContent = title;
  amount.textContent = value;
  detail.textContent = sub || '';
  amount.classList.remove('warn', 'danger');
  bubble.classList.add('open');
  if (duration > 0) {
    bubbleTimer = setTimeout(() => {
      transientUntil = 0;
      renderUsage();
      if (!preferences.bubble) bubble.classList.remove('open');
    }, duration);
  }
}

function eventName(value) {
  return value?.hook_event_name || value?.event_name || value?.event || value?.type || '';
}

function handleCodexEvent(value) {
  const name = eventName(value);
  if (name === 'UserPromptSubmit') {
    showMessage('Codex', '工作中…', '鲸鱼正在帮你处理任务', 2600);
    play('duck1');
  } else if (name === 'PermissionRequest') {
    showMessage('Codex', '请确认', '任务正在等待你的操作', 0);
    play('duck2');
  } else if (name === 'PreToolUse') {
    document.body.classList.add('press');
    setTimeout(() => document.body.classList.remove('press'), 130);
  } else if (name === 'Stop') {
    if (preferences.notifyOnStop !== false) {
      const left = selectedRemaining();
      showMessage('任务完成', left == null ? '完成啦' : `${left}%`, '当前套餐剩余用量', 5200);
      play('tap1');
    }
    setTimeout(() => api.refreshUsage(), 450);
  } else if (name === 'Interrupt') {
    showMessage('Codex', '已停止', '任务已被中断', 3200);
    play('tap2');
    setTimeout(() => api.refreshUsage(), 450);
  } else if (name === 'SessionStart') {
    api.refreshUsage();
  }
}

function saveControls() {
  const previousScale = Number(preferences.scale);
  preferences = {
    ...preferences,
    displayMode: controls.displayMode.value,
    scale: Number(controls.scale.value),
    volume: Number(controls.volume.value),
    notifyOnStop: controls.notifyOnStop.checked
  };
  if (Number(preferences.scale) !== previousScale) visualLockUntil = 0;
  api.savePreferences(preferences);
  renderUsage();
}

function applyPreferences() {
  controls.displayMode.value = preferences.displayMode || 'lowest';
  controls.scale.value = preferences.scale ?? 1.5;
  controls.volume.value = preferences.volume ?? .65;
  controls.notifyOnStop.checked = preferences.notifyOnStop !== false;
  bubble.classList.toggle('open', preferences.bubble !== false);
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
document.addEventListener('mouseleave', () => { if (!dragging) api.setInteractive(false); });

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
  if (allowClick && !moved) {
    document.body.classList.add('press');
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => document.body.classList.remove('press'), 120);
    bubble.classList.add('reacting', 'open');
    play(Math.random() > .5 ? 'duck1' : 'duck2');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => {
      bubble.classList.remove('reacting');
      renderUsage();
    }, 1800);
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
  widget.classList.add('dragging');
  clearTimeout(dragSafetyTimer);
  dragSafetyTimer = setTimeout(() => finishDrag(false), 30000);
  try { pet.setPointerCapture(event.pointerId); } catch {}
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
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    finishDrag(false);
    menu.classList.remove('open');
  }
});

pet.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  finishDrag(false);
  menu.classList.toggle('open');
  api.setInteractive(true);
});
document.addEventListener('pointerdown', (event) => {
  if (event.button === 2 || menu.contains(event.target)) return;
  menu.classList.remove('open');
}, true);

bubble.addEventListener('click', () => {
  detailPage += 1;
  renderUsage();
  play('tap1');
});
Object.values(controls).forEach((control) => control.addEventListener('change', saveControls));
document.getElementById('refresh').addEventListener('click', () => api.refreshUsage());
document.getElementById('quit').addEventListener('click', () => api.quit());

api.onUsage((value) => {
  usage = value;
  if (Date.now() >= transientUntil) renderUsage();
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
  if (Date.now() >= transientUntil) renderUsage();
  setTimeout(() => api.refreshUsage(), 100);
});
