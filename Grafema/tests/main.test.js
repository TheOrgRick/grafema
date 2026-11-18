'use strict';
// Prueba de humo del proceso principal con un "Electron" simulado (no necesita Windows ni red).
const fs = require('fs'), os = require('os'), path = require('path'), Module = require('module'), EventEmitter = require('events');
const { test, run, assert } = require('./helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grafema-main-'));
process.env.GRAFEMA_USER_DIR = path.join(tmp, 'user'); process.env.GRAFEMA_DATA_DIR = path.join(tmp, 'user', 'datos');
const sent = [], handlers = {}, sessionOn = {}; let permReq = null, lastWin = null, quit = 0, menuSet = 'unset';
class FakeSession extends EventEmitter { constructor() { super(); this.langs = []; this.availableSpellCheckerLanguages = ['es', 'es-MX', 'en-US']; }
  setSpellCheckerLanguages(l) { this.langs = l; } getSpellCheckerLanguages() { return this.langs; } addWordToSpellCheckerDictionary() {}
  setPermissionRequestHandler(f) { permReq = f; } setPermissionCheckHandler() {} }
const defaultSession = new FakeSession();
class WC extends EventEmitter { constructor() { super(); this.session = defaultSession; }
  setWindowOpenHandler() {} send(c, d) { sent.push([c, d]); } isLoading() { return false; } isCrashed() { return false; } }
class BrowserWindow extends EventEmitter {
  constructor(o) { super(); this.opts = o; this.webContents = new WC(); this.size = [o.width, o.height]; lastWin = this; this.closed = false; }
  once(ev, fn) { if (ev === 'ready-to-show') setImmediate(fn); else super.once(ev, fn); return this; }
  loadFile(p, o) { this.loaded = [p, o]; return Promise.resolve(); } show() {} isDestroyed() { return this.closed; } isMaximized() { return false; } isFullScreen() { return false; } isMinimized() { return false; }
  unmaximize() {} setContentSize(w, h) { this.size = [w, h]; } getContentSize() { return this.size; } center() {} destroy() { this.closed = true; }
  close() { const e = { prevented: false, preventDefault() { this.prevented = true; } }; this.emit('close', e); if (!e.prevented) { this.closed = true; this.emit('closed'); } }
  setBackgroundMaterial(m) { this.material = m; } setBackgroundColor() {} setTitleBarOverlay(o) { this.overlay = o; }
}
const app = Object.assign(new EventEmitter(), { getPath: (n) => path.join(tmp, n), setPath() {}, requestSingleInstanceLock: () => true, quit() { quit++; }, whenReady: () => Promise.resolve(), getVersion: () => '1.0.0', isPackaged: false });
const fake = { app, BrowserWindow, ipcMain: { handle: (c, f) => { handlers[c] = f; } }, dialog: {}, shell: {}, session: { defaultSession }, Menu: { setApplicationMenu: (m) => { menuSet = m; }, buildFromTemplate: () => ({ popup() {} }) }, nativeTheme: { themeSource: 'system', shouldUseDarkColors: true }, screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1366, height: 728 } }) } };
const orig = Module._load; Module._load = function (req, ...a) { return req === 'electron' ? fake : orig.call(this, req, ...a); };
require('../src/main/main.js'); Module._load = orig;

test('main.js se carga completo y crea la ventana tras iniciar', async () => {
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(lastWin, 'debe crear la ventana');
  assert.match(lastWin.loaded[0], /renderer[\\/]index\.html$/);
  assert.strictEqual(menuSet, null);
});
test('la ventana nunca excede el área de trabajo (1366×728) aunque la configuración pida 1280×800', () => {
  assert.ok(lastWin.opts.width <= 1366 && lastWin.opts.height <= 728, JSON.stringify([lastWin.opts.width, lastWin.opts.height]));
  assert.strictEqual(lastWin.opts.useContentSize, true);
});
test('opciones de seguridad y apariencia de la ventana', () => {
  const o = lastWin.opts;
  assert.strictEqual(o.webPreferences.contextIsolation, true); assert.strictEqual(o.webPreferences.nodeIntegration, false); assert.strictEqual(o.webPreferences.sandbox, true);
  assert.strictEqual(o.titleBarStyle, 'hidden'); assert.strictEqual(o.titleBarOverlay.height, 40);
  assert.ok(o.minWidth <= 640 && o.minHeight <= 480);
  assert.strictEqual(o.backgroundMaterial, 'none', 'sin Windows 11 no debe pedir Mica'); assert.match(o.backgroundColor, /^#[0-9A-F]{6}$/i);
});
test('todos los canales del núcleo y de Electron quedan registrados', () => {
  const need = ['author:set', 'project:create', 'chapter:write', 'bible:write', 'map:write', 'export:pdf', 'export:docx', 'fonts:list', 'app:flushed', 'window:setSize', 'spell:info', 'spell:setLanguages', 'config:set'];
  assert.deepStrictEqual(need.filter((c) => !handlers[c]), []);
});
test('guardar el autor funciona de punta a punta a través del canal IPC', async () => {
  const bad = await handlers['author:set']({}, { name: '   ' });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'NAME_REQUIRED');
  const r = await handlers['author:set']({}, { name: 'Ana López' });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.author, 'Ana López');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(tmp, 'user', 'datos', 'config.json'), 'utf8')).author, 'Ana López');
  assert.strictEqual((await handlers['app:info']()).author, 'Ana López');
  const p = await handlers['project:create']({}, { name: 'Prueba' }); assert.strictEqual(p.ok, true); assert.strictEqual(p.project.author, 'Ana López');
  assert.ok(fs.existsSync(path.join(tmp, 'user', 'datos', 'proyectos', p.project.id, 'project.json')));
});
test('cambiar el tamaño: se limita a la pantalla y se recuerda', async () => {
  const r = await handlers['window:setSize']({}, { width: 3000, height: 2000 });
  assert.strictEqual(r.ok, true); assert.deepStrictEqual([r.width, r.height], [1366, 728]); assert.strictEqual(r.limited, true);
  assert.deepStrictEqual(lastWin.size, [1366, 728]);
  const bad = await handlers['window:setSize']({}, { width: 'x', height: null });
  assert.strictEqual(bad.ok, false);
  const ok = await handlers['window:setSize']({}, { width: 1000, height: 650 });
  assert.deepStrictEqual([ok.width, ok.height], [1000, 650]);
  const cfg = await handlers['config:get']({}); assert.deepStrictEqual(cfg.config.window, { width: 1000, height: 650 });
});
test('corrector: idiomas disponibles y selección', async () => {
  const r = await handlers['spell:setLanguages']({}, { languages: ['es-MX', 'klingon', 'en-US'] });
  assert.deepStrictEqual(r.languages, ['es-MX', 'en-US']);
  assert.deepStrictEqual((await handlers['spell:info']()).available, ['es', 'es-MX', 'en-US']);
});
test('permisos: solo se permite escribir en el portapapeles', () => {
  let a, b; permReq({}, 'clipboard-sanitized-write', (x) => { a = x; }); permReq({}, 'media', (x) => { b = x; });
  assert.strictEqual(a, true); assert.strictEqual(b, false);
});
test('cierre seguro: pide guardar antes de cerrar y cierra al confirmar', async () => {
  sent.length = 0;
  lastWin.close();
  assert.ok(sent.some(([c]) => c === 'app:request-flush'), 'debe pedir a la interfaz que guarde');
  assert.strictEqual(lastWin.closed, false, 'aún no debe cerrar');
  await handlers['app:flushed']();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(lastWin.closed, true); 
});
test('al cerrarse la ventana la aplicación termina', () => { app.emit('window-all-closed'); assert.ok(quit >= 1); });
module.exports = () => run('proceso principal (Electron simulado)');
if (require.main === module) module.exports().then((r) => { process.exit(r.failed ? 1 : 0); setTimeout(() => process.exit(r.failed ? 1 : 0), 100); });
