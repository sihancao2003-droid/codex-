const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*'
};

function createWidgetServer({ pluginRoot, dataDir, getUsage, getAgent, getLastTurn }) {
  const store = path.join(dataDir, 'upstream');
  const roleDir = path.join(store, 'whale-roles');
  const audioDir = path.join(store, 'whale-audio');
  const imageDir = path.join(store, 'bubble-images');
  const files = {
    size: path.join(store, 'size.json'),
    bubble: path.join(store, 'bubble.json'),
    settings: path.join(store, 'usage-settings.json'),
    roles: path.join(roleDir, 'roles.json'),
    audio: path.join(audioDir, 'audio.json'),
    images: path.join(imageDir, 'bubble-imgs.json'),
    api: path.join(store, 'api-models.json')
  };
  const assets = path.join(pluginRoot, 'assets');
  const mkdir = (dir) => fs.mkdirSync(dir, { recursive: true });
  const init = () => { mkdir(store); mkdir(roleDir); mkdir(audioDir); mkdir(imageDir); };
  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };
  const writeJson = (file, value) => { init(); fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); };
  const safeId = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(String(id || ''));
  const send = (res, status, body, headers = JSON_HEADERS) => {
    res.writeHead(status, headers);
    if (body == null) return res.end();
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const body = (req, max = 30 * 1024 * 1024) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) { reject(new Error('request body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
  const urlOf = (req) => new URL(req.url || '/', 'http://127.0.0.1');
  const query = (req, key) => urlOf(req).searchParams.get(key) || '';
  const dataUrl = (value, kinds) => {
    const match = new RegExp('^data:(?:' + kinds.join('|') + ');base64,([A-Za-z0-9+/=]+)$').exec(String(value || ''));
    return match ? Buffer.from(match[1], 'base64') : null;
  };
  const usage = () => getUsage() || {};
  const primary = () => usage().primary || null;
  const secondary = () => usage().secondary || null;
  const usageBalance = () => {
    const p = primary();
    return {
      ok: Boolean(p && Number.isFinite(Number(p.remainingPercent))),
      totalBalance: p ? Number(p.remainingPercent) : null,
      currency: 'PCT',
      todayUsage: Number.isFinite(Number(usage().todayTokens)) ? Number(usage().todayTokens) : null,
      isPeak: false,
      usageMode: 'tokens',
      agent: getAgent(),
      primary: p,
      secondary: secondary(),
      quotaWindows: usage().quotaWindows || []
    };
  };
  const modelPayload = () => {
    const u = usage();
    const make = (id, name, windowValue) => ({
      id, name, currency: 'PCT', balance: windowValue?.remainingPercent ?? null,
      todayUsage: u.todayTokens ?? null, todayUsageCurrency: 'tokens',
      balanceMode: 'api', hasBalanceApi: true, error: null,
      quota: { unit: 'tokens', total: windowValue?.totalUnits ?? null, used: windowValue?.usedUnits ?? null, period: name }
    });
    return [make('codex', 'Codex · 5小时', u.primary), make('codex-weekly', 'Codex · 每周', u.secondary)];
  };
  const defaultSettings = () => ({
    taskEnd: { on: true, sel: 'frag:exp_orb' },
    alert: { on: false, below: 20, autoClose: true, ttlSec: 8, lines: [] },
    budget: { on: false, amount: 0, autoClose: true, ttlSec: 8, lines: [] },
    turnCost: { lines: [] }, models: {}
  });
  const defaultImages = () => ({ version: 1, images: [] });
  const imagePayload = () => {
    const index = readJson(files.images, defaultImages());
    const builtins = [
      { id: 'petpet', name: 'petpet', format: 'gif', builtin: true },
      { id: 'money1', name: 'money1', format: 'gif', builtin: true }
    ];
    const custom = Array.isArray(index.images) ? index.images : [];
    return { ok: true, images: builtins.concat(custom).map((item) => ({
      id: item.id, name: item.name || item.id, format: item.format || 'png',
      builtin: item.builtin === true, createdAt: item.createdAt || null,
      url: '/dsh-whale/bubble-img.png?id=' + encodeURIComponent(item.id)
    })) };
  };
  const defaultAudio = () => ({ version: 1, fragments: [], groups: [] });
  const audioPayload = () => {
    const index = readJson(files.audio, defaultAudio());
    const fragments = [
      { id: 'ya1', name: '小黄鸭·按下', preset: true }, { id: 'ya2', name: '小黄鸭·松开', preset: true },
      { id: 'd1', name: '音效1·按下', preset: true }, { id: 'd2', name: '音效1·松开', preset: true },
      { id: 'exp_orb', name: 'Minecraft·经验球', preset: true }, { id: 'end_a', name: 'A', preset: true },
      ...(Array.isArray(index.fragments) ? index.fragments : [])
    ];
    const groups = [
      { id: 'duck', name: '小黄鸭', press: 'ya1', release: 'ya2', preset: true },
      { id: 'fx1', name: '音效1', press: 'd1', release: 'd2', preset: true },
      ...(Array.isArray(index.groups) ? index.groups : [])
    ];
    return { ok: true, fragments, groups };
  };
  const rolePayload = () => {
    const index = readJson(files.roles, { roles: [] });
    const roles = [{ id: 'default', name: '小鲸鱼', format: 'png', pinned: false, createdAt: null, url: '/dsh-whale/image.png' }];
    for (const role of Array.isArray(index.roles) ? index.roles : []) {
      roles.push({ ...role, url: '/dsh-whale/role-image.png?id=' + encodeURIComponent(role.id) });
    }
    return { ok: true, roles };
  };
  const asset = (name, type) => {
    try {
      const file = path.join(assets, name);
      const data = fs.readFileSync(file);
      return { data, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': String(data.length) } };
    } catch { return null; }
  };
  const presetAudio = (id) => ({
    ya1: ['Ya1.mp3', 'audio/mpeg'], ya2: ['Ya2.mp3', 'audio/mpeg'],
    d1: ['D1.mp3', 'audio/mpeg'], d2: ['D2.mp3', 'audio/mpeg'],
    exp_orb: ['minecraft-exp-orb.wav', 'audio/wav'], end_a: ['task-end-a.wav', 'audio/wav']
  }[id] || null);
  const audioId = (req) => query(req, 'id');
  const fragmentBytes = (id) => {
    const preset = presetAudio(id);
    if (preset) return asset(preset[0], preset[1]);
    if (!safeId(id)) return null;
    try {
      const data = fs.readFileSync(path.join(audioDir, id + '.wav'));
      return { data, headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'Content-Length': String(data.length) } };
    } catch { return null; }
  };
  const roleFile = (id) => {
    if (!safeId(id) || id === 'default') return null;
    for (const ext of ['png', 'gif']) {
      const file = path.join(roleDir, id + '.' + ext);
      if (fs.existsSync(file)) return { file, type: ext === 'gif' ? 'image/gif' : 'image/png' };
    }
    return null;
  };
  const imageFile = (id) => {
    const builtin = { petpet: ['bubble-petpet.gif', 'image/gif'], money1: ['bubble-money1.gif', 'image/gif'] }[id];
    if (builtin) return asset(builtin[0], builtin[1]);
    if (!safeId(id)) return null;
    const index = readJson(files.images, defaultImages());
    const item = (index.images || []).find((x) => x.id === id);
    if (!item) return null;
    try {
      const ext = item.format === 'gif' ? 'gif' : 'png';
      const data = fs.readFileSync(path.join(imageDir, id + '.' + ext));
      return { data, headers: { 'Content-Type': ext === 'gif' ? 'image/gif' : 'image/png', 'Cache-Control': 'no-store', 'Content-Length': String(data.length) } };
    } catch { return null; }
  };
  const tokenRecords = () => {
    const u = usage();
    const models = Object.entries(u.todayByModel || {}).map(([model, tokens]) => ({ model, cost: Number(tokens) || 0, tokens: Number(tokens) || 0 }));
    const total = Number(u.todayTokens) || models.reduce((sum, item) => sum + item.tokens, 0);
    const today = new Date().toISOString().slice(0, 10);
    return { ok: true, currency: 'tokens', settings: readJson(files.settings, defaultSettings()), today: { date: today, total, models }, days7: [{ date: today, total, models }], total7: total, all: { days: [{ date: today, total, models }], events: models.map((item) => ({ ...item, date: today, ts: Date.now() })) } };
  };
  const apiTemplates = [
    { id: 'codex', name: 'Codex（本地会话）', currency: 'PCT', keyRef: '' },
    { id: 'zcode', name: 'ZCode / GLM Coding Plan', currency: 'PCT', keyRef: '' },
    { id: 'custom', name: '自定义 HTTP', currency: 'CNY', keyRef: '' }
  ];
  const apiModels = () => {
    const saved = readJson(files.api, null);
    return { ok: true, models: Array.isArray(saved) ? saved : modelPayload(), templates: apiTemplates };
  };
  const route = async (req, res) => {
    const u = urlOf(req);
    const p = u.pathname;
    try {
      if (p === '/' || p === '/index.html') {
        return send(res, 200, fs.readFileSync(path.join(pluginRoot, 'ui', 'index.html')), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      if (p === '/whale-widget.js') return send(res, 200, fs.readFileSync(path.join(pluginRoot, 'ui', 'whale-widget.js')), { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      if (p === '/desktop-adapter.js') return send(res, 200, fs.readFileSync(path.join(pluginRoot, 'ui', 'desktop-adapter.js')), { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      if (p === '/dsh-whale/image.png') { const x = asset('DSniang1.png', 'image/png'); return x ? send(res, 200, x.data, x.headers) : send(res, 404, 'not found'); }
      if (p === '/dsh-whale/rua.gif') { const x = asset('rua.gif', 'image/gif'); return x ? send(res, 200, x.data, x.headers) : send(res, 404, 'not found'); }
      if (p === '/dsh-whale/balance.json') return send(res, 200, usageBalance());
      if (p === '/dsh-whale/last-turn.json') return send(res, 200, getLastTurn() || { ok: true, seq: 0, turn: null, amount: null, tokens: null, ts: null });
      if (p === '/dsh-whale/size.json') {
        if (req.method === 'PUT' || req.method === 'POST') {
          const value = await body(req, 64 * 1024); writeJson(files.size, value); return send(res, 200, { ok: true, ...value });
        }
        return send(res, 200, readJson(files.size, { scale: 1.5, sound: true, vol: .65, soundSet: 'duck', usageMode: 'ledger', peakMode: 'default', bubbleOn: true, turnCostOn: true, turnCostCloseMs: 5000, scrollGapOn: false, scrollGapPx: 17, menuBtnHide: true }));
      }
      if (p === '/dsh-whale/usage-settings.json') {
        if (req.method === 'PUT' || req.method === 'POST') { const next = await body(req, 512 * 1024); const merged = { ...readJson(files.settings, defaultSettings()), ...next }; writeJson(files.settings, merged); return send(res, 200, { ok: true, settings: merged }); }
        return send(res, 200, { ok: true, settings: readJson(files.settings, defaultSettings()) });
      }
      if (p === '/dsh-whale/usage-records.json') return send(res, 200, tokenRecords());
      if (p === '/dsh-whale/bubble.json') {
        if (req.method === 'POST' || req.method === 'PUT') { const cfg = await body(req, 2 * 1024 * 1024); writeJson(files.bubble, { v: 1, items: cfg.items || [], lib: cfg.lib || [], tapAdvance: cfg.tapAdvance === true }); }
        return send(res, 200, { ok: true, config: readJson(files.bubble, null) });
      }
      if (p === '/dsh-whale/api-models.json') {
        if (req.method === 'POST' || req.method === 'PUT') {
          const value = await body(req, 512 * 1024); const current = apiModels().models;
          if (value.action === 'delete') writeJson(files.api, current.filter((m) => m.id !== value.id));
          else if (value.action === 'save' || value.id || value.model) {
            const incoming = value.model && typeof value.model === 'object' ? value.model : value;
            const id = incoming.id || 'custom-' + Date.now();
            writeJson(files.api, current.some((m) => m.id === id) ? current.map((m) => m.id === id ? { ...m, ...incoming, id } : m) : current.concat({ ...incoming, id }));
          }
        }
        return send(res, 200, apiModels());
      }
      if (p === '/dsh-whale/roles.json') {
        if (req.method === 'POST' || req.method === 'PUT') {
          const value = await body(req); const data = dataUrl(value.image, ['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
          if (!data) return send(res, 400, { ok: false, error: 'invalid image data' });
          const id = 'role_' + Date.now().toString(36); const ext = value.format === 'gif' ? 'gif' : 'png';
          fs.writeFileSync(path.join(roleDir, id + '.' + ext), data); const index = readJson(files.roles, { roles: [] });
          index.roles.push({ id, name: String(value.name || '新角色').slice(0, 20), format: ext, createdAt: Date.now(), pinned: false }); writeJson(files.roles, index);
        }
        return send(res, 200, rolePayload());
      }
      if (p === '/dsh-whale/role-image.png') {
        const x = roleFile(query(req, 'id')); if (!x) return send(res, 404, 'not found');
        const data = fs.readFileSync(x.file); return send(res, 200, data, { 'Content-Type': x.type, 'Cache-Control': 'no-store', 'Content-Length': String(data.length) });
      }
      if (p === '/dsh-whale/role-pin.json') {
        const value = await body(req); const index = readJson(files.roles, { roles: [] }); const item = index.roles.find((x) => x.id === value.id); if (item) item.pinned = value.pinned === true; writeJson(files.roles, index); return send(res, 200, rolePayload());
      }
      if (p === '/dsh-whale/role-delete.json') {
        const value = await body(req); const index = readJson(files.roles, { roles: [] }); const item = index.roles.find((x) => x.id === value.id); if (item) { index.roles = index.roles.filter((x) => x.id !== value.id); for (const ext of ['png', 'gif']) { try { fs.unlinkSync(path.join(roleDir, value.id + '.' + ext)); } catch {} } writeJson(files.roles, index); } return send(res, 200, rolePayload());
      }
      if (p === '/dsh-whale/audio.json') {
        if (req.method === 'POST' || req.method === 'PUT') {
          const value = await body(req, 12 * 1024 * 1024); const index = readJson(files.audio, defaultAudio()); index.fragments ||= []; index.groups ||= [];
          if (value.action === 'upload-fragment') { const data = dataUrl(value.audio, ['audio/wav']); const id = 'audio_' + Date.now().toString(36); if (data) { fs.writeFileSync(path.join(audioDir, id + '.wav'), data); index.fragments.push({ id, name: String(value.name || '未命名音频').slice(0, 40), createdAt: Date.now() }); } }
          if (value.action === 'save-group') { const item = { id: value.id || 'group_' + Date.now().toString(36), name: String(value.name || '未命名音效组').slice(0, 20), press: value.press || 'ya1', release: value.release || 'ya2', pinned: false, createdAt: Date.now() }; const at = index.groups.findIndex((x) => x.id === item.id); if (at >= 0) index.groups[at] = { ...index.groups[at], ...item }; else index.groups.push(item); }
          if (value.action === 'delete-group') index.groups = index.groups.filter((x) => x.id !== value.id || ['duck', 'fx1'].includes(x.id));
          if (value.action === 'pin-group') { const item = index.groups.find((x) => x.id === value.id); if (item) item.pinned = value.pinned === true; }
          if (value.action === 'delete-fragment') { index.fragments = index.fragments.filter((x) => x.id !== value.id); try { fs.unlinkSync(path.join(audioDir, value.id + '.wav')); } catch {} }
          writeJson(files.audio, index);
        }
        return send(res, 200, audioPayload());
      }
      if (p === '/dsh-whale/audio-fragment.wav') { const x = fragmentBytes(audioId(req)); return x ? send(res, 200, x.data, x.headers) : send(res, 404, 'not found'); }
      if (p === '/dsh-whale/sound/press.mp3' || p === '/dsh-whale/sound/release.mp3') {
        const set = query(req, 'set') || 'duck'; const audio = audioPayload(); const group = audio.groups.find((x) => x.id === set) || audio.groups[0]; const id = group[p.endsWith('press.mp3') ? 'press' : 'release']; const x = fragmentBytes(id); return x ? send(res, 200, x.data, x.headers) : send(res, 204, null);
      }
      if (p === '/dsh-whale/bubble-imgs.json') return send(res, 200, imagePayload());
      if (p === '/dsh-whale/bubble-img-upload.json') {
        const value = await body(req, 12 * 1024 * 1024); const index = readJson(files.images, defaultImages()); index.images ||= [];
        if (value.action === 'upload') { const data = dataUrl(value.data, ['image/png', 'image/gif']); if (!data) return send(res, 400, { ok: false, error: 'invalid image data' }); const id = 'bimg_' + Date.now().toString(36); const format = String(value.data).startsWith('data:image/gif') ? 'gif' : 'png'; fs.writeFileSync(path.join(imageDir, id + '.' + format), data); index.images.push({ id, name: String(value.name || id).slice(0, 40), format, createdAt: Date.now() }); }
        if (value.action === 'delete') { const item = index.images.find((x) => x.id === value.id); if (item) { index.images = index.images.filter((x) => x.id !== value.id); try { fs.unlinkSync(path.join(imageDir, value.id + '.' + (item.format === 'gif' ? 'gif' : 'png'))); } catch {} } }
        writeJson(files.images, index); return send(res, 200, imagePayload());
      }
      if (p === '/dsh-whale/bubble-img.png') { const x = imageFile(query(req, 'id')); return x ? send(res, 200, x.data, x.headers) : send(res, 404, 'not found'); }
      return send(res, 404, 'not found');
    } catch (error) {
      return send(res, 400, { ok: false, error: String(error.message || error).slice(0, 240) });
    }
  };
  init();
  const server = http.createServer((req, res) => { route(req, res).catch((error) => send(res, 500, { ok: false, error: error.message })); });
  return { server, start: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); }), stop: () => server.close() };
}

module.exports = { createWidgetServer };
