'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, nativeTheme, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { createCore } = require('./app-core');
const { listFonts } = require('./fonts');

// ---- Rutas: los datos viven en %APPDATA%\Grafema\datos (igual para instalador y versión portátil) ----
const userDataDir = process.env.GRAFEMA_USER_DIR || path.join(app.getPath('appData'), 'Grafema');
app.setPath('userData', userDataDir);
const dataDir = process.env.GRAFEMA_DATA_DIR || path.join(userDataDir, 'datos');
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(userDataDir, 'grafema.log');

function log(where, err) {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${where}: ${(err && err.stack) || err}\n`);
  } catch (_) { /* noop */ }
}
process.on('uncaughtException', (e) => log('uncaughtException', e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let pendingOpened = null; // resultado de abrir un .grafema antes de que la interfaz esté lista
let allowClose = false;
let closing = false;
const supportsMaterial = () => process.platform === 'win32' && parseInt(String(os.release()).split('.')[2] || '0', 10) >= 22621;

const argNum = (name) => {
  const a = process.argv.find((x) => x.startsWith('--' + name + '='));
  const v = a ? parseInt(a.split('=')[1], 10) : parseInt(process.env['GRAFEMA_' + name.toUpperCase()] || '', 10);
  return Number.isFinite(v) ? v : null;
};

const grafemaArg = (argv) => (argv || []).slice(1).find((a) => typeof a === 'string' && /\.grafema$/i.test(a) && fs.existsSync(a)) || null;
// Importa un .grafema (doble clic en el Explorador o «Abrir con») y avisa a la interfaz.
async function openProjectFile(file) {
  const r = await core.invoke('project:importFile', { path: file });
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) send('project:opened-file', r); else pendingOpened = r;
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

const core = createCore({
  dataDir,
  log,
  deps: {
    appVersion: app.getVersion(),
    platform: process.platform,
    dialog: {
      open: async (o) => { const r = await dialog.showOpenDialog(win, o); return r.canceled ? null : r.filePaths; },
      save: async (o) => {
        const opts = Object.assign({}, o);
        if (opts.defaultPath && !path.isAbsolute(opts.defaultPath)) opts.defaultPath = path.join(app.getPath('documents'), opts.defaultPath);
        const r = await dialog.showSaveDialog(win, opts);
        return r.canceled ? null : r.filePath;
      },
    },
    shell: { showItem: (p) => shell.showItemInFolder(p), openPath: (p) => shell.openPath(p) },
    getFonts: () => listFonts(),
    materialSupported: supportsMaterial(),
    printPdf,
    onConfig: (cfg) => applyConfig(cfg),
  },
});

async function printPdf({ html, pdf }) {
  const file = path.join(os.tmpdir(), `grafema-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
  try {
    await w.loadFile(file);
    return await w.webContents.printToPDF({
      pageSize: pdf.pageSize, margins: pdf.margins, printBackground: true,
      displayHeaderFooter: pdf.displayHeaderFooter, headerTemplate: pdf.headerTemplate, footerTemplate: pdf.footerTemplate,
      preferCSSPageSize: false,
    });
  } finally {
    try { w.destroy(); } catch (_) { /* noop */ }
    try { fs.rmSync(file, { force: true }); } catch (_) { /* noop */ }
  }
}

// ---- Tema, material (Mica/Acrylic) y corrector ----
function palette(dark, transparent) {
  return { color: transparent ? '#00000000' : dark ? '#0A0A0A' : '#F6F6F4', symbolColor: dark ? '#F5F5F5' : '#333333' };
}
function applyConfig(cfg) {
  try { nativeTheme.themeSource = cfg.theme; } catch (_) { /* noop */ }
  if (!win || win.isDestroyed()) return;
  const dark = nativeTheme.shouldUseDarkColors;
  const mat = supportsMaterial() && cfg.material !== 'none';
  try { win.setBackgroundMaterial(mat ? cfg.material : 'none'); } catch (_) { /* Electron/SO sin soporte */ }
  try { win.setBackgroundColor(mat ? '#00000000' : dark ? '#0A0A0A' : '#F6F6F4'); } catch (_) { /* noop */ }
  try { win.setTitleBarOverlay(Object.assign({ height: 40 }, palette(dark, mat))); } catch (_) {
    try { win.setTitleBarOverlay(Object.assign({ height: 40 }, palette(dark, false))); } catch (_e) { /* noop */ }
  }
  applySpell(cfg.spell);
}
function applySpell(langs) {
  try {
    const ses = session.defaultSession;
    const avail = ses.availableSpellCheckerLanguages || [];
    let use = (langs || []).filter((l) => avail.includes(l));
    if (!use.length) use = avail.includes('es-MX') ? ['es-MX'] : avail.includes('es') ? ['es'] : ['en-US'];
    ses.setSpellCheckerLanguages(use);
  } catch (e) { log('spell', e); }
}

function createWindow() {
  const cfg = core.getConfig();
  try { nativeTheme.themeSource = cfg.theme; } catch (_) { /* noop */ }
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(argNum('width') || cfg.window.width, wa.width);
  const height = Math.min(argNum('height') || cfg.window.height, wa.height);
  const dark = nativeTheme.shouldUseDarkColors;
  const mat = supportsMaterial() && cfg.material !== 'none';
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');

  win = new BrowserWindow({
    width, height, useContentSize: true, minWidth: 640, minHeight: 480, show: false,
    title: 'Grafema',
    backgroundColor: mat ? '#00000000' : dark ? '#0A0A0A' : '#F6F6F4',
    backgroundMaterial: mat ? cfg.material : 'none',
    titleBarStyle: 'hidden',
    titleBarOverlay: Object.assign({ height: 40 }, palette(dark, mat)),
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true,
      webSecurity: true, allowRunningInsecureContent: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { w: String(width), h: String(height) } });

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_e, d) => { log('render-process-gone', JSON.stringify(d)); if (win && !win.isDestroyed()) win.reload(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (!app.isPackaged && input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  // Menú contextual: sugerencias del corrector + editar
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const s of (params.dictionarySuggestions || []).slice(0, 5)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
      if (!items.length) items.push({ label: '(Sin sugerencias)', enabled: false });
      items.push({ type: 'separator' });
      items.push({ label: 'Agregar al diccionario', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ label: 'Cortar', role: 'cut', enabled: params.editFlags.canCut }, { label: 'Copiar', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Pegar', role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { label: 'Seleccionar todo', role: 'selectAll' });
    } else if (params.selectionText) items.push({ label: 'Copiar', role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Guardado seguro antes de cerrar
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    if (win.webContents.isLoading() || win.webContents.isCrashed()) { allowClose = true; return setImmediate(() => win && !win.isDestroyed() && win.close()); }
    send('app:request-flush');
    setTimeout(() => { allowClose = true; if (win && !win.isDestroyed()) win.close(); }, 6000);
  });
  win.on('closed', () => { win = null; });

  // Recordar el tamaño que elige la persona
  let t = null;
  win.on('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen() || win.isMinimized()) return;
      const [w, h] = win.getContentSize();
      core.setConfig({ window: { width: w, height: h } });
    }, 500);
  });
}

// ---- IPC ----
for (const ch of core.channels) ipcMain.handle(ch, (_e, payload) => core.invoke(ch, payload));

ipcMain.handle('app:flushed', () => { allowClose = true; if (win && !win.isDestroyed()) setImmediate(() => win.close()); return { ok: true }; });
ipcMain.handle('window:setSize', (_e, d) => {
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const w = Math.min(Math.max(640, Math.round(Number(d && d.width))), Math.min(7680, wa.width));
    const h = Math.min(Math.max(480, Math.round(Number(d && d.height))), Math.min(4320, wa.height));
    if (!Number.isFinite(w) || !Number.isFinite(h)) return { ok: false, code: 'BAD_SIZE', message: 'Medidas no válidas.' };
    if (win) { if (win.isMaximized()) win.unmaximize(); win.setContentSize(w, h); win.center(); }
    core.setConfig({ window: { width: w, height: h } });
    return { ok: true, width: w, height: h, limited: w !== Math.round(Number(d.width)) || h !== Math.round(Number(d.height)) };
  } catch (e) { log('window:setSize', e); return { ok: false, code: 'INTERNAL', message: 'No se pudo cambiar el tamaño.' }; }
});
ipcMain.handle('spell:info', () => {
  const ses = session.defaultSession;
  return { ok: true, languages: ses.getSpellCheckerLanguages(), available: ses.availableSpellCheckerLanguages || [] };
});
ipcMain.handle('spell:setLanguages', (_e, d) => {
  const cfg = core.setConfig({ spell: d && d.languages });
  applySpell(cfg.spell);
  return { ok: true, languages: session.defaultSession.getSpellCheckerLanguages() };
});

app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const f = grafemaArg(argv);
  if (f) openProjectFile(f).catch((e) => log('open-file', e));
});
ipcMain.handle('app:pendingFile', () => { const r = pendingOpened; pendingOpened = null; return r ? Object.assign({ ok: true }, { result: r }) : { ok: true, result: null }; });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  if (!gotLock) return;
  Menu.setApplicationMenu(null);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
  for (const ev of ['spellcheck-dictionary-initialized', 'spellcheck-dictionary-download-begin', 'spellcheck-dictionary-download-success', 'spellcheck-dictionary-download-failure']) {
    ses.on(ev, (_e, lang) => send('spell:status', { state: ev.replace('spellcheck-dictionary-', ''), lang }));
  }
  createWindow();
  applySpell(core.getConfig().spell);
  const startFile = grafemaArg(process.argv);
  if (startFile) openProjectFile(startFile).catch((e) => log('open-file', e));
});
