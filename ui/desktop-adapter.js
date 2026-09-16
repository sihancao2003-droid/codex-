(function () {
  'use strict';
  const api = window.codexWhale;
  if (!api) return;
  let interactive = false;
  function rectContains(rect, x, y) {
    return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }
  function hit(x, y) {
    // Do not use .dshwv-root here: it is a transparent square around the
    // whale and would make that whole square an invisible click shield.
    const selectors = ['.dshwv-img', '.dshwv-gif', '.dshwv-text', '.dshwv-pop-open', '.dshwv-menu', '.dshwv-mask', '.dshwv-resmask', '.dshwv-usage-mask', '.dshwv-rolelist', '.dshwv-audiolist', '.dshwv-rgbmenu'];
    return selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some((node) => {
      if (!node || getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') return false;
      return rectContains(node.getBoundingClientRect(), x, y);
    }));
  }
  function reportHitRegions() {
    const selectors = [
      '.dshwv-img',
      '.dshwv-pop.dshwv-pop-open',
      '.dshwv-menu.dshwv-menu-open',
      '.dshwv-menu-btn.dshwv-menu-btn-visible',
      '.dshwv-mask', '.dshwv-resmask', '.dshwv-usage-mask',
      '.dshwv-rolelist', '.dshwv-audiolist', '.dshwv-rgbmenu'
    ];
    const regions = [];
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const style = getComputedStyle(node);
        const structuralHit = selector === '.dshwv-img' || selector === '.dshwv-pop.dshwv-pop-open';
        if (style.display === 'none' || style.visibility === 'hidden' || (!structuralHit && style.pointerEvents === 'none')) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          regions.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
        }
      }
    }
    api.reportHitRegions({ regions, dragging: Boolean(document.querySelector('.dshwv-root.dshwv-dragging')) });
  }
  function update(x, y) {
    const next = hit(x, y);
    if (next === interactive) return;
    interactive = next;
    api.setInteractive(!next);
    api.setFocusable(next);
  }
  document.addEventListener('mousemove', (event) => update(event.clientX, event.clientY), true);
  document.addEventListener('pointermove', (event) => update(event.clientX, event.clientY), true);
  window.addEventListener('blur', () => { interactive = false; api.setInteractive(true); api.setFocusable(false); });
  setInterval(reportHitRegions, 100);
  const hitRegionObserver = new MutationObserver(reportHitRegions);
  hitRegionObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  setTimeout(reportHitRegions, 50);

  const style = document.createElement('style');
  style.textContent = '.codex-whale-status{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(8px);opacity:0;pointer-events:none;z-index:10020;max-width:min(420px,calc(100vw - 40px));padding:8px 14px;border-radius:12px;background:rgba(32,49,112,.92);color:#fff;font:600 13px/1.35 system-ui,sans-serif;text-align:center;transition:opacity .18s ease,transform .18s ease;white-space:pre-wrap}.codex-whale-status.open{opacity:1;transform:translateX(-50%) translateY(0)}';
  document.head.appendChild(style);
  const toast = document.createElement('div');
  toast.className = 'codex-whale-status';
  document.body.appendChild(toast);
  let timer = null;
  function show(text, duration) {
    toast.textContent = text;
    toast.classList.add('open');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('open'), duration || 2600);
  }

  function installAgentSelector() {
    const menu = document.querySelector('.dshwv-menu');
    if (!menu || document.getElementById('codexWhaleAgentSelect')) return;
    const row = document.createElement('div');
    row.className = 'dshwv-menu-row';
    const label = document.createElement('span');
    label.textContent = '智能体';
    const select = document.createElement('select');
    select.id = 'codexWhaleAgentSelect';
    select.className = 'dshwv-sound';
    for (const [value, text] of [['codex', 'Codex'], ['zcode', 'ZCode']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      api.switchAgent(select.value).then(() => window.location.reload()).catch(() => {});
    });
    row.append(label, select);
    menu.insertBefore(row, menu.firstChild);
    const topRow = document.createElement('label');
    topRow.className = 'dshwv-menu-row';
    const topLabel = document.createElement('span');
    topLabel.textContent = '固定最上层';
    const top = document.createElement('input');
    top.type = 'checkbox';
    top.className = 'dshwv-check';
    top.id = 'codexWhaleAlwaysOnTop';
    top.addEventListener('change', () => api.savePreferences({ alwaysOnTop: top.checked }));
    topRow.append(topLabel, top);
    menu.insertBefore(topRow, menu.children[1] || null);
    api.getState().then((state) => { select.value = state?.activeAgent || 'codex'; }).catch(() => {});
    api.getState().then((state) => { top.checked = state?.preferences?.alwaysOnTop !== false; }).catch(() => {});
    api.onAgents((state) => { if (state?.activeAgent) select.value = state.activeAgent; });
  }
  const agentObserver = new MutationObserver(installAgentSelector);
  agentObserver.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(installAgentSelector, 300);

  api.onCodexEvent((event) => {
    if (!event || !['codex', 'zcode'].includes(event.agent)) return;
    const type = event.hook_event_name || event.event_name || event.event || event.type || '';
    if (window.__codexWhaleHooks && typeof window.__codexWhaleHooks.onAgentEvent === 'function') {
      window.__codexWhaleHooks.onAgentEvent(event);
    }
    const agentName = event.agent === 'zcode' ? 'ZCode' : 'Codex';
    if (type === 'UserPromptSubmit' || type === 'PreToolUse') show(agentName + ' · 工作中…', 2400);
    else if (type === 'PermissionRequest') show(agentName + ' · 等待确认', 0);
    else if (type === 'Stop') show(agentName + ' · 任务完成', 3200);
    else if (type === 'Interrupt') show(agentName + ' · 已停止', 3200);
  });
})();
