const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dataDir = path.join(process.env.LOCALAPPDATA || process.env.TEMP || __dirname, 'CodexWhaleWidget');
const eventsFile = path.join(dataDir, 'events.jsonl');
const heartbeatFile = path.join(dataDir, 'heartbeat');
const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, '..');

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => {
      try { resolve(raw.trim() ? JSON.parse(raw) : {}); }
      catch { resolve({ raw: raw.slice(0, 2000) }); }
    });
    process.stdin.resume();
  });
}

function overlayIsAlive() {
  try {
    return Date.now() - fs.statSync(heartbeatFile).mtimeMs < 10000;
  } catch {
    return false;
  }
}

function startOverlay() {
  const exe = process.platform === 'win32'
    ? path.join(pluginRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(pluginRoot, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(exe)) return;
  const child = spawn(exe, [pluginRoot], {
    cwd: pluginRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, CODEX_WHALE_PLUGIN_ROOT: pluginRoot }
  });
  child.unref();
}

(async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!overlayIsAlive()) startOverlay();
  const event = await readStdin();
  event.receivedAt = Date.now();
  fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, 'utf8');
})().catch(() => {});
