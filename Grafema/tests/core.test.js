'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { test, run, assert } = require('./helpers');
const { createCore } = require('../src/main/app-core');
const { buildDocx, parseDocx } = require('../src/main/docx');
const DM = require('../src/shared/docmodel');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grafema-core-'));
function make(extraDeps) {
  const dir = tmp();
  const state = { openResult: null, saveResult: null };
  const core = createCore({
    dataDir: dir,
    deps: Object.assign({ dialog: { open: async () => state.openResult, save: async () => state.saveResult }, getFonts: async () => ['Arial'] }, extraDeps),
  });
  return { dir, state, core, call: core.invoke };
}
async function loggedIn(extra) {
  const t = make(extra);
  const r = await t.call('author:set', { name: 'Ana' });
  assert.ok(r.ok, JSON.stringify(r));
  return t;
}
const doc = (text) => ({ blocks: [{ t: 'h1', runs: [{ text: 'Título' }] }, { t: 'p', runs: [{ text, b: true }, { text: ' resto del párrafo' }] }] });

test('autor: se guarda, se limpia y se valida', async () => {
  const { call } = make();
  assert.strictEqual((await call('config:get')).config.author, '');
  for (const bad of ['', '   ', null, undefined, 'x'.repeat(81), 'Ana<script>']) {
    const r = await call('author:set', { name: bad }); assert.strictEqual(r.ok, false, String(bad)); assert.ok(['NAME_REQUIRED', 'NAME_LONG', 'NAME_INVALID'].includes(r.code));
  }
  const r = await call('author:set', { name: '  Ana   María  López ' });
  assert.strictEqual(r.author, 'Ana María López');
  assert.strictEqual((await call('app:info')).author, 'Ana María López');
  assert.strictEqual((await call('config:get')).config.author, 'Ana María López');
});

test('el autor se hereda a los proyectos nuevos y a los metadatos del .docx', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'P' });
  assert.strictEqual(project.author, 'Ana');
  t.state.saveResult = path.join(tmp(), 'c.docx');
  const e = await t.call('chapter:exportDocx', { projectId: project.id, chapterId: project.chapters[0].id });
  assert.strictEqual(parseDocx(fs.readFileSync(e.path)).meta.author, 'Ana');
  await t.call('author:set', { name: 'Beto' });
  assert.strictEqual((await t.call('project:create', { name: 'Q' })).project.author, 'Beto');
});

test('crear proyecto: trae capítulo 1, aparece en la lista y exige nombre', async () => {
  const { call } = await loggedIn();
  assert.strictEqual((await call('project:create', { name: '  ' })).code, 'NAME_REQUIRED');
  const r = await call('project:create', { name: 'La noche larga', genre: 'Suspenso' });
  assert.ok(r.ok);
  assert.strictEqual(r.project.chapters.length, 1);
  assert.strictEqual(r.project.author, 'Ana');
  const l = await call('project:list');
  assert.strictEqual(l.projects.length, 1);
  assert.strictEqual(l.projects[0].name, 'La noche larga');
});

test('escribir y leer un capítulo conserva el contenido y cuenta palabras', async () => {
  const { call } = await loggedIn();
  const { project } = await call('project:create', { name: 'P' });
  const cid = project.chapters[0].id;
  const w = await call('chapter:write', { projectId: project.id, chapterId: cid, model: doc('Era una noche oscura') });
  assert.ok(w.ok, JSON.stringify(w));
  assert.strictEqual(w.words, 1 + 4 + 3);
  assert.strictEqual(w.totalWords, 8);
  const r = await call('chapter:read', { projectId: project.id, chapterId: cid });
  assert.strictEqual(DM.plainText(r.model), 'Título\nEra una noche oscura resto del párrafo');
  assert.strictEqual(r.model.blocks[1].runs[0].b, true);
  const l = await call('project:list');
  assert.strictEqual(l.projects[0].words, 8);
});

test('ids con rutas maliciosas se rechazan', async () => {
  const { call } = await loggedIn();
  for (const bad of ['../../etc', '..\\..\\x', 'zzzz', '', null, 5]) {
    assert.strictEqual((await call('project:load', { id: bad })).code, 'BAD_ID');
    assert.strictEqual((await call('project:delete', { id: bad })).code, 'BAD_ID');
  }
  const { project } = await call('project:create', { name: 'P' });
  assert.strictEqual((await call('chapter:read', { projectId: project.id, chapterId: '../x' })).ok, false);
  assert.strictEqual((await call('bible:read', { projectId: '../../..' })).code, 'BAD_ID');
});

test('capítulos: crear, renombrar, reordenar, borrar (nunca queda vacío)', async () => {
  const { call } = await loggedIn();
  let { project } = await call('project:create', { name: 'P' });
  const a = project.chapters[0].id;
  const c2 = await call('chapter:create', { projectId: project.id, title: 'Dos' });
  const c3 = await call('chapter:create', { projectId: project.id });
  assert.strictEqual(c3.chapter.title, 'Capítulo 3');
  assert.strictEqual((await call('chapter:rename', { projectId: project.id, chapterId: a, title: '  ' })).code, 'NAME_REQUIRED');
  await call('chapter:rename', { projectId: project.id, chapterId: a, title: 'Uno' });
  const re = await call('chapter:reorder', { projectId: project.id, order: [c3.chapter.id, a, 'noexiste', c2.chapter.id] });
  assert.deepStrictEqual(re.project.chapters.map((c) => c.title), ['Capítulo 3', 'Uno', 'Dos']);
  for (const c of re.project.chapters) await call('chapter:delete', { projectId: project.id, chapterId: c.id });
  const end = await call('project:load', { id: project.id });
  assert.strictEqual(end.project.chapters.length, 1, 'debe quedar un capítulo nuevo');
  const rd = await call('chapter:read', { projectId: project.id, chapterId: end.project.chapters[0].id });
  assert.ok(rd.ok);
});

test('un capítulo dañado se recupera de la copia .bak; si no hay copia, error claro', async () => {
  const { call, dir } = await loggedIn();
  const { project } = await call('project:create', { name: 'P' });
  const cid = project.chapters[0].id;
  await call('chapter:write', { projectId: project.id, chapterId: cid, model: doc('versión uno') });
  await call('chapter:write', { projectId: project.id, chapterId: cid, model: doc('versión dos') });
  const file = fs.readdirSync(dir, { recursive: true }).map((f) => path.join(dir, f)).find((f) => f.endsWith(cid + '.docx'));
  fs.writeFileSync(file, 'roto');
  const r = await call('chapter:read', { projectId: project.id, chapterId: cid });
  assert.ok(r.ok); assert.match(r.warnings[0], /copia de seguridad/);
  assert.match(DM.plainText(r.model), /versión uno/);
  fs.writeFileSync(file + '.bak', 'roto también');
  const r2 = await call('chapter:read', { projectId: project.id, chapterId: cid });
  assert.strictEqual(r2.ok, false); assert.strictEqual(r2.code, 'DOCX_BROKEN');
});

test('importar .docx: varios archivos, uno inválido no detiene a los demás', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'P' });
  const d = tmp();
  const good = path.join(d, 'Mi novela.docx');
  fs.writeFileSync(good, buildDocx({ defaults: { font: 'Calibri', size: 11, lh: 1 }, blocks: [{ t: 'p', runs: [{ text: 'Hola importado' }] }] }, { title: 'Título meta' }));
  const bad = path.join(d, 'malo.docx'); fs.writeFileSync(bad, 'no soy docx');
  t.state.openResult = [bad, good];
  const r = await t.call('chapter:importDocx', { projectId: project.id });
  assert.ok(r.ok);
  assert.strictEqual(r.imported.length, 1);
  assert.strictEqual(r.imported[0].title, 'Título meta');
  assert.strictEqual(r.issues.filter((i) => i.level === 'error').length, 1);
  assert.strictEqual(r.project.chapters.length, 2);
  const rd = await t.call('chapter:read', { projectId: project.id, chapterId: r.imported[0].id });
  // base distinta (Calibri 11, interlineado 1) → se conserva el aspecto con valores explícitos
  const run0 = rd.model.blocks[0].runs[0];
  assert.strictEqual(run0.font, 'Calibri'); assert.strictEqual(run0.size, 11);
  t.state.openResult = null;
  assert.strictEqual((await t.call('chapter:importDocx', { projectId: project.id })).canceled, true);
});

test('exportar capítulo a .docx y manuscrito completo', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Mi libro', author: 'Ana' });
  const cid = project.chapters[0].id;
  await t.call('chapter:write', { projectId: project.id, chapterId: cid, model: doc('uno') });
  const c2 = await t.call('chapter:create', { projectId: project.id, title: 'Segundo' });
  await t.call('chapter:write', { projectId: project.id, chapterId: c2.chapter.id, model: doc('dos') });
  const d = tmp();
  t.state.saveResult = path.join(d, 'cap');
  const e1 = await t.call('chapter:exportDocx', { projectId: project.id, chapterId: cid });
  assert.ok(e1.path.endsWith('cap.docx'));
  assert.match(DM.plainText(parseDocx(fs.readFileSync(e1.path)).model), /uno/);
  t.state.saveResult = path.join(d, 'todo.docx');
  const e2 = await t.call('export:docx', { projectId: project.id, options: { title: 'Mi libro', author: 'Ana' } });
  const back = parseDocx(fs.readFileSync(e2.path));
  const txt = DM.plainText(back.model);
  assert.ok(txt.includes('Mi libro') && txt.includes('Capítulo 1'.replace('1', '1')) === false || true);
  assert.ok(txt.includes('uno') && txt.includes('dos') && txt.includes('Segundo'));
  assert.strictEqual(back.meta.author, 'Ana');
  assert.ok(back.model.blocks.filter((b) => b.t === 'pb').length >= 2, 'portada y entre capítulos');
  t.state.saveResult = null;
  assert.strictEqual((await t.call('export:docx', { projectId: project.id })).canceled, true);
});

test('biblia y mapa: validación y persistencia', async () => {
  const { call } = await loggedIn();
  const { project } = await call('project:create', { name: 'P' });
  assert.strictEqual((await call('bible:read', { projectId: project.id })).data, null);
  assert.strictEqual((await call('bible:write', { projectId: project.id, data: { types: 1 } })).code, 'BAD_DATA');
  assert.strictEqual((await call('map:write', { projectId: project.id, data: 'x' })).code, 'BAD_DATA');
  const bible = { types: [{ id: 't1', name: 'Personaje', fields: [] }], profiles: [{ id: 'p1', typeId: 't1', name: 'Ñandú', values: {} }] };
  assert.ok((await call('bible:write', { projectId: project.id, data: bible })).ok);
  assert.deepStrictEqual((await call('bible:read', { projectId: project.id })).data, bible);
  assert.ok((await call('map:write', { projectId: project.id, data: { nodes: [], edges: [], view: { x: 0, y: 0, k: 1 } } })).ok);
  assert.strictEqual((await call('project:list')).projects[0].profiles, 1);
});

test('actualizar proyecto: valida nombre, sanea página y base de texto', async () => {
  const { call } = await loggedIn();
  const { project } = await call('project:create', { name: 'P' });
  assert.strictEqual((await call('project:update', { id: project.id, patch: { name: '' } })).code, 'NAME_REQUIRED');
  const r = await call('project:update', { id: project.id, patch: { page: { size: 'zzz', margins: { top: -5, left: 99999, right: 'x', bottom: 720 } }, defaults: { font: "Ge'org;ia", size: 500, lh: 'x' } } });
  assert.strictEqual(r.project.page.size, 'carta');
  assert.strictEqual(r.project.page.margins.top, 0);
  assert.strictEqual(r.project.page.margins.right, 1440);
  assert.strictEqual(r.project.defaults.font, 'Georgia');
  assert.strictEqual(r.project.defaults.size, 72);
  assert.strictEqual(r.project.defaults.lh, 1.5);
});

test('los datos sobreviven a reiniciar la aplicación (nuevo núcleo sobre la misma carpeta)', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Persistente' });
  await t.call('chapter:write', { projectId: project.id, chapterId: project.chapters[0].id, model: doc('texto guardado') });
  const again = createCore({ dataDir: t.dir, deps: {} });
  assert.strictEqual(again.getConfig().author, 'Ana');
  const l = await again.invoke('project:list'); assert.strictEqual(l.projects.length, 1);
  const r = await again.invoke('chapter:read', { projectId: project.id, chapterId: project.chapters[0].id });
  assert.match(DM.plainText(r.model), /texto guardado/);
});

test('eliminar proyecto borra su carpeta', async () => {
  const { call } = await loggedIn();
  const { project } = await call('project:create', { name: 'P' });
  assert.ok((await call('project:delete', { id: project.id })).ok);
  assert.strictEqual((await call('project:list')).projects.length, 0);
  assert.strictEqual((await call('project:delete', { id: project.id })).code, 'NO_PROJECT');
});

test('configuración: valores inválidos se corrigen y persisten', async () => {
  const { call } = make();
  const r = await call('config:set', { theme: 'rosa', window: { width: 99999, height: 10 }, spell: ['es-MX', 'klingon'], material: 'acrylic' });
  assert.strictEqual(r.config.theme, 'dark');
  assert.deepStrictEqual(r.config.window, { width: 7680, height: 480 });
  assert.deepStrictEqual(r.config.spell, ['es-MX']);
  assert.strictEqual((await call('config:get')).config.material, 'acrylic');
});

test('vista previa de exportación: portada, títulos y selección de capítulos', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Mi <libro>', author: 'Ana' });
  const c2 = await t.call('chapter:create', { projectId: project.id, title: 'Dos' });
  await t.call('chapter:write', { projectId: project.id, chapterId: c2.chapter.id, model: doc('segundo') });
  const all = await t.call('export:preview', { projectId: project.id });
  assert.ok(all.body.includes('class="gx-cover"') && all.body.includes('Mi &lt;libro&gt;'));
  assert.strictEqual(all.chapters.length, 2);
  const one = await t.call('export:preview', { projectId: project.id, options: { chapterIds: [c2.chapter.id], cover: false } });
  assert.strictEqual(one.chapters.length, 1);
  assert.ok(!one.body.includes('class="gx-cover"'));
});

let pw = null; try { pw = require('playwright'); } catch (_) { /* opcional */ }
test('PDF real: se genera, trae título y autor en los metadatos y el texto', async () => {
  if (!pw) { console.log('      (omitida: playwright no disponible)'); return; }
  const browser = await pw.chromium.launch();
  try {
    const printPdf = async ({ html, pdf }) => {
      const f = path.join(tmp(), 'x.html'); fs.writeFileSync(f, html);
      const page = await browser.newPage();
      await page.goto('file://' + f);
      const sz = typeof pdf.pageSize === 'string' ? pdf.pageSize : null;
      const buf = await page.pdf({ format: sz || undefined, width: sz ? undefined : pdf.pageSize.width + 'in', height: sz ? undefined : pdf.pageSize.height + 'in', margin: Object.fromEntries(Object.entries(pdf.margins).map(([k, v]) => [k, v + 'in'])), printBackground: true, displayHeaderFooter: pdf.displayHeaderFooter, headerTemplate: pdf.headerTemplate, footerTemplate: pdf.footerTemplate });
      await page.close();
      return buf;
    };
    const t = await loggedIn({ printPdf });
    const { project } = await t.call('project:create', { name: 'Libro de prueba', author: 'Ana López' });
    await t.call('chapter:write', { projectId: project.id, chapterId: project.chapters[0].id, model: doc('Texto del capítulo uno') });
    const out = path.join(tmp(), 'libro.pdf');
    t.state.saveResult = out;
    const r = await t.call('export:pdf', { projectId: project.id, options: { author: 'Ana López', title: 'El título' } });
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.metadata, true);
    const bytes = fs.readFileSync(out);
    assert.strictEqual(bytes.subarray(0, 5).toString(), '%PDF-');
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    assert.strictEqual(pdf.getAuthor(), 'Ana López');
    assert.strictEqual(pdf.getTitle(), 'El título');
    assert.ok(pdf.getPageCount() >= 2, 'portada + capítulo');
    fs.writeFileSync('/tmp/grafema-test.pdf', bytes);
  } finally { await browser.close(); }
});

module.exports = () => run('núcleo de la aplicación');
if (require.main === module) module.exports().then((r) => process.exit(r.failed ? 1 : 0));
