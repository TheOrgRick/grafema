'use strict';
// Android: el núcleo preparado para el APK + el puente de la interfaz, de punta a punta con el plugin simulado.
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), cp = require('child_process');
const { test, run, assert } = require('./helpers');
const root = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grafema-and-'));

cp.execFileSync(process.execPath, [path.join(root, 'android/preparar.js')], { stdio: 'ignore' });

// Plugin simulado: lo que la interfaz envía llega al núcleo y la respuesta vuelve por evento.
function makeEnv(dataDir) {
  const handlers = {}, listeners = {};
  global.__grafemaTestBridge = { channel: { on: (n, f) => { handlers[n] = f; }, send: (n, d) => { (listeners[n] || []).forEach((f) => f({ args: [d] })); } } };
  process.env.GRAFEMA_DATA_DIR = dataDir;
  const mainPath = path.join(root, 'android/www/nodejs/main.js');
  delete require.cache[mainPath];
  require(mainPath);
  const NodePlugin = {
    addListener: (n, f) => { (listeners[n] = listeners[n] || []).push(f); },
    whenReady: async () => {},
    send: ({ eventName, args }) => { handlers[eventName](args[0]); },
  };
  return NodePlugin;
}
function loadBridge(NodePlugin, extra) {
  const picks = { file: null }, shared = [], written = [];
  const win = { Capacitor: { Plugins: Object.assign({ CapacitorNodeJS: NodePlugin,
    Filesystem: { writeFile: async (o) => { written.push(o); return { uri: 'file:///cache/' + o.path }; } },
    Share: { share: async (o) => { shared.push(o); } } }, extra) } };
  const doc = { documentElement: { classList: { add: (c) => { doc.cls = c; } } }, body: { appendChild() {} },
    createElement: () => { const el = { style: {}, listeners: {}, addEventListener(n, f) { el.listeners[n] = f; }, remove() {}, click() { el.files = picks.file ? [picks.file] : []; el.listeners.change(); } }; return el; } };
  class FR { readAsDataURL(f) { this.result = 'data:application/octet-stream;base64,' + f.b64; setTimeout(() => this.onload(), 0); } }
  const ctx = vm.createContext({ window: win, document: doc, FileReader: FR, navigator: { userAgent: 'Android' }, setTimeout, clearTimeout, Promise });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/renderer/js/android-bridge.js'), 'utf8'), ctx);
  return { win, doc, picks, shared, written };
}

test('el núcleo preparado para Android arranca y responde por mensajes (sin Electron)', async () => {
  const B = loadBridge(makeEnv(tmp()));
  const g = B.win.grafema;
  assert.strictEqual(g.platform, 'android'); assert.strictEqual(B.doc.cls, 'android');
  assert.ok((await g.invoke('author:set', { name: 'Ana' })).ok);
  const r = await g.invoke('project:create', { name: 'Móvil', template: 'cuento' });
  assert.ok(r.ok && r.project.name === 'Móvil');
  assert.strictEqual((await g.invoke('project:list')).projects.length, 1);
});
test('exportar en Android: arma el .grafema, lo escribe en caché y abre «Compartir»', async () => {
  const B = loadBridge(makeEnv(tmp()));
  const g = B.win.grafema;
  await g.invoke('author:set', { name: 'Ana' });
  const p = (await g.invoke('project:create', { name: 'La noche larga' })).project;
  const r = await g.invoke('project:exportFile', { projectId: p.id });
  assert.ok(r.ok && !r.canceled, JSON.stringify(r));
  assert.strictEqual(B.written[0].path, 'La noche larga.grafema'); assert.strictEqual(B.written[0].directory, 'CACHE');
  assert.strictEqual(B.shared.length, 1); assert.ok(B.shared[0].url.endsWith('.grafema'));
  const zip = Buffer.from(B.written[0].data, 'base64'); assert.strictEqual(zip.readUInt32LE(0), 0x04034b50); // es un ZIP
});
test('importar en Android: un .grafema de otro dispositivo (Windows) se abre y no pisa nada', async () => {
  const A = loadBridge(makeEnv(tmp())); const ga = A.win.grafema;      // "Windows" (otro núcleo)
  await ga.invoke('author:set', { name: 'Ana' });
  const p = (await ga.invoke('project:create', { name: 'Desde la PC', template: 'suspenso' })).project;
  await ga.invoke('project:exportFile', { projectId: p.id });
  const b64 = A.written[0].data;
  const B = loadBridge(makeEnv(tmp())); const gb = B.win.grafema;      // "Android"
  await gb.invoke('author:set', { name: 'Ana' });
  B.picks.file = { name: 'Desde la PC.grafema', b64 };
  const r = await gb.invoke('project:importFile');
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.project.name, 'Desde la PC');
  assert.strictEqual(r.project.chapters.length, p.chapters.length);
  B.picks.file = { name: 'foto.jpg', b64: 'AAAA' };
  const bad = await gb.invoke('project:importFile'); assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'FILE_INVALID');
  B.picks.file = null;
  const cancel = await gb.invoke('project:importFile'); assert.ok(cancel.ok && cancel.canceled);
});
test('funciones aún no disponibles en Android avisan con un mensaje claro (no fallan en silencio)', async () => {
  const g = loadBridge(makeEnv(tmp())).win.grafema;
  for (const c of ['export:pdf', 'chapter:importDocx', 'window:setSize']) { const r = await g.invoke(c, {}); assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'NOT_SUPPORTED'); assert.ok(r.message.length > 20); }
});
test('si falta el plugin de Node, la app muestra la causa en pantalla (no se queda en blanco)', async () => {
  const win = { Capacitor: { Plugins: {}, getPlatform: () => 'android' } };
  const doc = { documentElement: { classList: { add() {} } } };
  vm.runInContext(fs.readFileSync(path.join(root, 'src/renderer/js/android-bridge.js'), 'utf8'), vm.createContext({ window: win, document: doc, navigator: { userAgent: 'Android' }, setTimeout, clearTimeout, Promise }));
  assert.ok(win.G.isAndroid, 'debe marcar Android aunque falle el motor');
  const r = await win.grafema.invoke('project:list');
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'ENGINE'); assert.ok(/plugin de Node/.test(r.message), r.message);
});
test('en Windows (Electron) el puente de Android no hace nada', () => {
  const win = { grafema: { marker: 1 }, Capacitor: { Plugins: { CapacitorNodeJS: {} } } };
  vm.runInContext(fs.readFileSync(path.join(root, 'src/renderer/js/android-bridge.js'), 'utf8'), vm.createContext({ window: win, document: {} }));
  assert.strictEqual(win.grafema.marker, 1);
});
test('index.html carga el puente antes que la aplicación y el APK usa rutas relativas válidas', () => {
  const html = fs.readFileSync(path.join(root, 'android/www/index.html'), 'utf8');
  assert.ok(html.indexOf('android-bridge.js') < html.indexOf('js/app.js'));
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) assert.ok(fs.existsSync(path.join(root, 'android/www', m[1])), 'no existe ' + m[1]);
});

test('logo de Grafema en el APK: íconos, adaptable, monocromo y splash válidos desde build/logo.svg', () => {
  const res = path.join(tmp(), 'res');
  fs.mkdirSync(path.join(res, 'values'), { recursive: true });
  fs.mkdirSync(path.join(res, 'drawable-port-mdpi'), { recursive: true });
  const { aPng, lienzo } = require(path.join(root, 'android/identidad.js'));
  fs.writeFileSync(path.join(res, 'drawable-port-mdpi/splash.png'), aPng(lienzo(320, 480, [255, 255, 255])));
  fs.writeFileSync(path.join(res, 'values/styles.xml'), '<resources>\n    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">\n        <item name="android:background">@drawable/splash</item>\n    </style>\n</resources>');
  const salida = cp.execFileSync(process.execPath, [path.join(root, 'android/identidad.js'), res], { encoding: 'utf8' });
  assert.ok(/aplicado/.test(salida), salida);
  const medidas = (f) => { const d = fs.readFileSync(path.join(res, f)); assert.strictEqual(d.toString('ascii', 1, 4), 'PNG', f); return [d.readUInt32BE(16), d.readUInt32BE(20)]; };
  assert.deepStrictEqual(medidas('mipmap-mdpi/ic_launcher.png'), [48, 48]);
  assert.deepStrictEqual(medidas('mipmap-xxxhdpi/ic_launcher_round.png'), [192, 192]);
  assert.deepStrictEqual(medidas('mipmap-xxhdpi/ic_launcher_foreground.png'), [324, 324]);
  assert.deepStrictEqual(medidas('mipmap-hdpi/ic_launcher_monochrome.png'), [162, 162]);
  assert.deepStrictEqual(medidas('drawable-port-mdpi/splash.png'), [320, 480]); // conserva el tamaño del splash original
  assert.ok(/#0A0A0A/.test(fs.readFileSync(path.join(res, 'values/ic_launcher_background.xml'), 'utf8')));
  const xml = fs.readFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
  assert.ok(/foreground/.test(xml) && /monochrome/.test(xml));
  assert.ok(/windowSplashScreenBackground/.test(fs.readFileSync(path.join(res, 'values/styles.xml'), 'utf8')));
  cp.execFileSync(process.execPath, [path.join(root, 'android/identidad.js'), res]); // repetirlo no duplica nada
  assert.strictEqual((fs.readFileSync(path.join(res, 'values/styles.xml'), 'utf8').match(/windowSplashScreenBackground/g) || []).length, 1);
});
test('el plugin de Node se instala desde la versión de Capacitor 7 que usa el puente (CapacitorNodeJS), no la 0.0.1 de npm', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'android/package.json'), 'utf8'));
  assert.ok(/^https:\/\/github\.com\/.+capacitor-nodejs\.tgz$/.test(pkg.dependencies['capacitor-nodejs']), pkg.dependencies['capacitor-nodejs']);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'android/capacitor.config.json'), 'utf8'));
  assert.ok(cfg.plugins.CapacitorNodeJS && cfg.plugins.CapacitorNodeJS.nodeDir === 'nodejs');
});

test('Android solo exporta .grafema: sin pdf-lib en el APK y sin botones de PDF/.docx en la interfaz', () => {
  assert.ok(!fs.existsSync(path.join(root, 'android/www/nodejs/node_modules/pdf-lib')), 'pdf-lib no debe viajar en el APK');
  const ex = fs.readFileSync(path.join(root, 'android/www/js/export.js'), 'utf8');
  const rama = ex.slice(ex.indexOf('if (G.isAndroid)'), ex.indexOf('return { destroy() {} };'));
  assert.ok(/project:exportFile/.test(rama) && !/doExport|export:pdf|export:docx/.test(rama), 'la pantalla de Android solo debe exportar .grafema');
  const ed = fs.readFileSync(path.join(root, 'android/www/js/editor.js'), 'utf8');
  assert.ok(/G\.isAndroid\) B\.docx\.style\.display = 'none'/.test(ed) && /!G\.isAndroid && h\('button'[^\n]*importDocx/.test(ed) && /\.\.\.\(G\.isAndroid \? \[\] : \[\{ label: 'Guardar como \.docx/.test(ed), 'el editor debe ocultar .docx en Android');
  for (const f of ['export.js', 'editor.js', 'home.js']) cp.execFileSync(process.execPath, ['--check', path.join(root, 'android/www/js', f)]);
});

module.exports = () => run('Android');
if (require.main === module) module.exports().then((r) => process.exit(r.failed ? 1 : 0));
