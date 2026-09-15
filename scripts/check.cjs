const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  '.codex-plugin/plugin.json',
  'hooks/hooks.json',
  'main.cjs',
  'preload.cjs',
  'ui/index.html',
  'ui/style.css',
  'ui/renderer-v2.js',
  'assets/DSniang1.png',
  'assets/rua.gif'
];
let failed = false;
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`missing: ${file}`);
    failed = true;
  }
}
for (const file of ['.codex-plugin/plugin.json', 'hooks/hooks.json', 'package.json']) {
  try { JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) {
    console.error(`invalid JSON: ${file}: ${error.message}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('Codex Whale Widget files are valid.');
