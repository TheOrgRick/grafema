'use strict';
const fs = require('fs'), path = require('path');
const { test, run, assert } = require('./helpers');
const { createCore } = require('../src/main/app-core');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const rendererFiles = fs.readdirSync(path.join(root, 'src/renderer/js')).map((f) => 'src/renderer/js/' + f);
const preloadChannels = () => [...read('src/main/preload.js').match(/const INVOKE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const ELECTRON_ONLY = ['app:flushed', 'window:setSize', 'spell:info', 'spell:setLanguages', 'app:pendingFile'];

test('los canales del preload coinciden con los handlers del núcleo', () => {
  const core = createCore({ dataDir: require('os').tmpdir() + '/gx-ipc-' + Date.now(), fastKdf: true });
  const pre = preloadChannels();
  assert.deepStrictEqual(core.channels.filter((c) => !pre.includes(c)), []);
  assert.deepStrictEqual(pre.filter((c) => !core.channels.includes(c) && !ELECTRON_ONLY.includes(c)), []);
});
test('todo canal que usa la interfaz está permitido en el preload', () => {
  const pre = new Set(preloadChannels()); const used = new Set();
  for (const f of rendererFiles) for (const m of read(f).matchAll(/(?:G\.call|\.invoke)\(\s*'([a-z]+:[A-Za-z]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 25, 'se esperaban muchos canales, hay ' + used.size);
  assert.deepStrictEqual([...used].filter((c) => !pre.has(c)), []);
});
test('main.js registra los canales exclusivos de Electron', () => {
  const main = read('src/main/main.js');
  for (const c of ELECTRON_ONLY) assert.ok(main.includes("'" + c + "'"), 'falta ' + c);
});
test('index.html carga solo scripts y estilos que existen', () => {
  const html = read('src/renderer/index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) assert.ok(fs.existsSync(path.join(root, 'src/renderer', m[1])), 'no existe ' + m[1]);
  assert.match(html, /Content-Security-Policy/); assert.ok(!/unsafe-eval/.test(html));
});
test('ventana segura: aislamiento de contexto, sandbox y sin integración de Node', () => {
  const main = read('src/main/main.js');
  assert.match(main, /contextIsolation: true/); assert.match(main, /nodeIntegration: false/); assert.match(main, /sandbox: true/);
});
test('el icono existe y es un .ico válido con 256 px', () => {
  const b = fs.readFileSync(path.join(root, 'build/icon.ico'));
  assert.strictEqual(b.readUInt16LE(0), 0); assert.strictEqual(b.readUInt16LE(2), 1);
  const n = b.readUInt16LE(4); const sizes = []; for (let i = 0; i < n; i++) sizes.push(b[6 + i * 16] || 256);
  assert.ok(sizes.includes(256) && sizes.includes(16), JSON.stringify(sizes));
});
test('package.json: punto de entrada, instalador NSIS y dependencias', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.main, 'src/main/main.js'); assert.ok(fs.existsSync(path.join(root, pkg.main)));
  assert.ok(pkg.devDependencies.electron && pkg.devDependencies['electron-builder'] && pkg.dependencies['pdf-lib']);
  assert.ok(pkg.build.win.target.some((t) => t.target === 'nsis'));
  assert.strictEqual(pkg.build.nsis.oneClick, false);
});
module.exports = () => run('integración / empaquetado');
if (require.main === module) module.exports().then((r) => process.exit(r.failed ? 1 : 0));
