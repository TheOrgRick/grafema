'use strict';
// Arnés: abre la interfaz real en Chromium conectada al núcleo real (sin Electron).
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const { createCore } = require('../../src/main/app-core');
const INDEX = 'file://' + path.resolve(__dirname, '../../src/renderer/index.html');

async function launch(o) {
  o = o || {};
  const dir = o.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'grafema-e2e-'));
  const state = { openResult: null, saveResult: null, flushed: 0, log: [] };
  const browser = await chromium.launch();
  const printPage = await browser.newPage();
  const printPdf = async ({ html, pdf }) => {
    const f = path.join(dir, 'print-' + Date.now() + '.html'); fs.writeFileSync(f, html);
    await printPage.goto('file://' + f);
    const sz = typeof pdf.pageSize === 'string' ? pdf.pageSize : null;
    return printPage.pdf({ format: sz || undefined, width: sz ? undefined : pdf.pageSize.width + 'in', height: sz ? undefined : pdf.pageSize.height + 'in', margin: Object.fromEntries(Object.entries(pdf.margins).map(([k, v]) => [k, v + 'in'])), printBackground: true, displayHeaderFooter: pdf.displayHeaderFooter, headerTemplate: pdf.headerTemplate, footerTemplate: pdf.footerTemplate });
  };
  const core = createCore({ dataDir: dir, log: (c, e) => state.log.push(c + ': ' + (e && e.message)),
    deps: { dialog: { open: async () => state.openResult, save: async () => state.saveResult }, getFonts: async () => ['Arial', 'Courier New', 'DejaVu Serif', 'Georgia', 'Times New Roman'], printPdf, shell: { showItem() {}, openPath: async () => '' }, materialSupported: !!o.mica, appVersion: '1.2.0' } });
  const ctx = await browser.newContext({ viewport: { width: o.width || 1280, height: o.height || 800 }, colorScheme: o.colorScheme || 'dark', acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.exposeFunction('__invoke', (c, p) => core.invoke(c, p));
  await page.exposeFunction('__flushed', () => { state.flushed++; });
  await page.addInitScript(() => {
    window.__ev = {};
    window.grafema = { platform: 'win32', invoke: (c, p) => (c === 'app:flushed' ? window.__flushed() : window.__invoke(c, p)), on: (e, cb) => { (window.__ev[e] = window.__ev[e] || []).push(cb); return () => {}; } };
  });
  const url = (extra) => `${INDEX}?w=${o.width || 1280}&h=${o.height || 800}${extra || ''}`;
  await page.goto(url());
  return { browser, page, core, dir, state, errors, url, call: core.invoke, close: () => browser.close() };
}
// Primera pantalla: solo se pide el nombre del autor.
async function register(t, name) {
  const p = t.page;
  await p.getByLabel('Nombre del autor').fill(name || 'Ana López');
  await p.getByRole('button', { name: 'Empezar a escribir' }).click();
}
module.exports = { launch, register, INDEX };
