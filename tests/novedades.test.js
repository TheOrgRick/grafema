'use strict';
// Pruebas de la versión 1.1: notas al pie, comentarios, control de cambios, mapas múltiples,
// plantillas de inicio, animaciones y PDF ampliado (biblia + mapas).
const fs = require('fs'), os = require('os'), path = require('path');
const { test, run, assert } = require('./helpers');
const { createCore } = require('../src/main/app-core');
const { buildDocx, parseDocx } = require('../src/main/docx');
const { readZip } = require('../src/main/zip');
const Exporter = require('../src/main/exporter');
const { mapToSvg } = require('../src/main/maprender');
const DM = require('../src/shared/docmodel');
const T = require('../src/shared/templates');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grafema-nov-'));
async function fakePdf({ pdf }) {
  const { PDFDocument } = require('pdf-lib');
  const d = await PDFDocument.create();
  const [w, h] = typeof pdf.pageSize === 'string' ? [612, 792] : [pdf.pageSize.width * 72, pdf.pageSize.height * 72];
  d.addPage([w, h]); d.addPage([w, h]);
  return Buffer.from(await d.save());
}
function make(extraDeps) {
  const state = { saveResult: null, prints: [] };
  const core = createCore({
    dataDir: tmp(),
    deps: Object.assign({
      dialog: { open: async () => null, save: async () => state.saveResult }, getFonts: async () => ['Arial'],
      printPdf: async (a) => { state.prints.push(a); return fakePdf(a); },
    }, extraDeps),
  });
  return { state, core, call: core.invoke, dir: () => core.getConfig && null };
}
async function loggedIn() { const t = make(); await t.call('author:set', { name: 'Ana López' }); return t; }

const richModel = () => DM.sanitizeModel({
  defaults: {}, track: true,
  blocks: [
    { t: 'h1', runs: [{ text: 'Capítulo' }] },
    { t: 'p', runs: [{ text: 'Era una ' }, { text: 'noche', cm: ['c1'], b: true }, { fn: 'f1' }, { text: ' fría, ' }, { text: 'muy', tc: { t: 'del', id: 'r1', a: 'Ana', d: '2026-10-30T10:00:00Z' } }, { text: 'realmente', tc: { t: 'ins', id: 'r2', a: 'Ana', d: '2026-10-30T10:01:00Z' } }, { text: ' fría.' }] },
  ],
  notes: [{ id: 'f1', text: 'Primera línea.\nSegunda línea.' }, { id: 'huerfana', text: 'no se usa' }],
  comments: [{ id: 'c1', author: 'Ana', date: '2026-10-30T10:00:00Z', text: 'Revisar', resolved: true }, { id: 'c9', text: 'sin ancla' }],
});

// ------------------------------------------------------------------ modelo
test('modelo: solo se conservan notas y comentarios que el texto referencia', () => {
  const m = richModel();
  assert.deepStrictEqual(m.notes.map((n) => n.id), ['f1']);
  assert.deepStrictEqual(m.comments.map((c) => c.id), ['c1']);
  assert.strictEqual(m.comments[0].resolved, true);
  assert.strictEqual(m.track, true);
  // una marca de nota sin contenido guardado no rompe nada
  const m2 = DM.sanitizeModel({ blocks: [{ t: 'p', runs: [{ fn: 'x1' }] }] });
  assert.deepStrictEqual(m2.notes, [{ id: 'x1', text: '' }]);
  // ids con caracteres peligrosos se descartan
  const m3 = DM.sanitizeModel({ blocks: [{ t: 'p', runs: [{ text: 'a', cm: ['<b>', 'ok'] }, { fn: '"><img>' }] }], comments: [{ id: 'ok', text: 't' }] });
  assert.deepStrictEqual(m3.blocks[0].runs, [{ text: 'a', cm: ['ok'] }]);
});

test('modelo: el conteo de palabras ignora el texto eliminado y las marcas de nota', () => {
  const m = richModel();
  // "Capítulo" + "Era una noche fría, realmente fría." = 1 + 6
  assert.strictEqual(DM.countWords(m), 7);
});

test('modelo: aceptar y rechazar cambios; quitar comentarios', () => {
  const m = richModel();
  const ok = DM.applyRevisions(m, true);
  assert.strictEqual(DM.plainText(ok).includes('muy'), false);
  assert.ok(DM.plainText(ok).includes('realmente'));
  assert.ok(!ok.blocks[1].runs.some((r) => r.tc));
  const no = DM.applyRevisions(m, false);
  assert.ok(DM.plainText(no).includes('muy'));
  assert.strictEqual(DM.plainText(no).includes('realmente'), false);
  const sc = DM.stripComments(m);
  assert.ok(!sc.blocks[1].runs.some((r) => r.cm));
  assert.strictEqual(sc.comments, undefined);
});

test('modelo: HTML editable y HTML de impresión (notas numeradas, cambios final / marcados)', () => {
  const m = richModel();
  const edit = DM.modelToHtml(m);
  assert.ok(edit.includes('<span class="fn" data-fn="f1" contenteditable="false">\u200B</span>'));
  assert.ok(edit.includes('data-cm="c1"') && edit.includes('<span class="tc del" data-tc="r1" data-tt="del"') && edit.includes('<span class="tc ins" data-tc="r2" data-tt="ins"'));
  const o = { print: true, revisions: 'final' };
  const fin = DM.modelToHtml(m, o);
  assert.ok(fin.includes('<sup class="fnref">1</sup>'));
  assert.ok(!fin.includes('muy') && fin.includes('realmente'));
  assert.deepStrictEqual(o.result.list, [{ n: 1, text: 'Primera línea.\nSegunda línea.' }]);
  const mk = DM.modelToHtml(m, { print: true, revisions: 'markup' });
  assert.ok(mk.includes('<del class="rv-del">muy</del>') && mk.includes('<ins class="rv-ins">realmente</ins>'));
});

test('modelo: unir capítulos no mezcla ids (prefixIds)', () => {
  const a = DM.prefixIds(richModel(), 'c0_'), b = DM.prefixIds(richModel(), 'c1_');
  assert.strictEqual(a.notes[0].id, 'c0_f1');
  const merged = DM.sanitizeModel({ blocks: [...a.blocks, ...b.blocks], notes: [...a.notes, ...b.notes], comments: [...a.comments, ...b.comments] });
  assert.strictEqual(merged.notes.length, 2);
  assert.strictEqual(merged.comments.length, 2);
});

// ------------------------------------------------------------------ .docx
test('.docx: notas al pie, comentarios (con estado resuelto) y cambios hacen ida y vuelta', () => {
  const m = richModel();
  const back = parseDocx(buildDocx(m, { title: 'T', author: 'Ana' })).model;
  assert.deepStrictEqual(back.notes.map((n) => n.text), ['Primera línea.\nSegunda línea.']);
  assert.strictEqual(back.comments.length, 1);
  assert.strictEqual(back.comments[0].text, 'Revisar');
  assert.strictEqual(back.comments[0].author, 'Ana');
  assert.strictEqual(back.comments[0].resolved, true);
  assert.strictEqual(back.track, true);
  const runs = back.blocks[1].runs;
  assert.ok(runs.some((r) => r.fn !== undefined), 'conserva la marca de nota');
  assert.ok(runs.some((r) => r.cm && r.text === 'noche'), 'conserva el texto comentado');
  const del = runs.find((r) => r.tc && r.tc.t === 'del'), ins = runs.find((r) => r.tc && r.tc.t === 'ins');
  assert.ok(del && del.text === 'muy' && del.tc.a === 'Ana');
  assert.ok(ins && ins.text === 'realmente');
});

test('.docx: las partes de notas y comentarios existen solo cuando hacen falta', () => {
  const plain = readZip(buildDocx(DM.sanitizeModel({ blocks: [{ t: 'p', runs: [{ text: 'hola' }] }] }), {}), () => true);
  assert.ok(!plain.has('word/footnotes.xml') && !plain.has('word/comments.xml'));
  const full = readZip(buildDocx(richModel(), {}), () => true);
  for (const f of ['word/footnotes.xml', 'word/comments.xml', 'word/commentsExtended.xml']) assert.ok(full.has(f), f);
  assert.ok(full.get('word/settings.xml').toString().includes('<w:trackRevisions/>'));
  assert.ok(full.get('word/document.xml').toString().includes('<w:delText'));
});

test('.docx: un comentario en tramos no contiguos genera un solo rango válido', () => {
  const m = DM.sanitizeModel({ blocks: [{ t: 'p', runs: [{ text: 'a', cm: ['c1'] }, { text: 'b' }, { text: 'c', cm: ['c1'] }] }], comments: [{ id: 'c1', text: 'x' }] });
  const xml = readZip(buildDocx(m, {}), () => true).get('word/document.xml').toString();
  assert.strictEqual((xml.match(/<w:commentRangeStart/g) || []).length, 1);
  assert.strictEqual((xml.match(/<w:commentRangeEnd/g) || []).length, 1);
});

test('.docx: se leen cambios marcados y comentarios de un archivo hecho por Word', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const { createZip } = require('../src/main/zip');
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body><w:p><w:r><w:t>Hola </w:t></w:r><w:commentRangeStart w:id="3"/><w:del w:id="5" w:author="Luis" w:date="2026-01-02T03:04:05Z"><w:r><w:delText>viejo</w:delText></w:r></w:del><w:ins w:id="6" w:author="Luis" w:date="2026-01-02T03:04:05Z"><w:r><w:t>nuevo</w:t></w:r></w:ins><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r></w:p></w:body></w:document>`;
  const comments = `<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="3" w:author="Luis" w:date="2026-01-02T03:04:05Z"><w:p><w:r><w:t>Cambiar esto</w:t></w:r></w:p></w:comment></w:comments>`;
  const ct = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const buf = createZip([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'word/document.xml', data: doc }, { name: 'word/comments.xml', data: comments }]);
  const m = parseDocx(buf).model;
  const runs = m.blocks[0].runs;
  assert.strictEqual(runs.find((r) => r.tc && r.tc.t === 'del').text, 'viejo');
  assert.strictEqual(runs.find((r) => r.tc && r.tc.t === 'ins').text, 'nuevo');
  assert.deepStrictEqual(m.comments.map((c) => [c.author, c.text]), [['Luis', 'Cambiar esto']]);
  assert.ok(runs.filter((r) => r.cm).length === 2, 'el comentario cubre el texto marcado');
});

// ------------------------------------------------------------------ plantillas
test('plantillas: hay cinco, con capítulos y sin ids repetidos', () => {
  const l = T.list();
  assert.deepStrictEqual(l.map((x) => x.id), ['blank', 'novela', 'suspenso', 'cuento', 'guion']);
  assert.strictEqual(new Set(l.map((x) => x.id)).size, l.length);
  for (const t of T.TEMPLATES) assert.ok(t.chapters.length >= 1 && t.chapters.every((c) => c.title));
});

test('plantillas: crear un proyecto con plantilla arma capítulos, página y tipografía', async () => {
  const t = await loggedIn();
  const nov = await t.call('project:create', { name: 'Mi novela', template: 'novela' });
  assert.ok(nov.ok, JSON.stringify(nov));
  assert.deepStrictEqual(nov.project.chapters.map((c) => c.title), ['Prólogo', 'Acto I — Planteamiento', 'Acto II — Confrontación', 'Acto III — Resolución', 'Epílogo']);
  assert.strictEqual(nov.project.genre, 'Novela');
  const ch = await t.call('chapter:read', { projectId: nov.project.id, chapterId: nov.project.chapters[1].id });
  assert.ok(DM.plainText(ch.model).startsWith('Guía:'), 'trae texto guía');
  const gu = await t.call('project:create', { name: 'Guion', template: 'guion' });
  assert.strictEqual(gu.project.defaults.font, 'Courier New');
  assert.strictEqual(gu.project.defaults.lh, 1);
  const cu = await t.call('project:create', { name: 'Cuento', template: 'cuento' });
  assert.strictEqual(cu.project.page.size, 'media');
  const blank = await t.call('project:create', { name: 'Vacío', template: 'blank' });
  assert.strictEqual(blank.project.chapters.length, 1);
  const none = await t.call('project:create', { name: 'Sin plantilla' });
  assert.deepStrictEqual(none.project.chapters.map((c) => c.title), ['Capítulo 1']);
  const bad = await t.call('project:create', { name: 'X', template: 'nada' });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'BAD_TEMPLATE');
  // un género escrito por el usuario manda sobre el de la plantilla
  const g = await t.call('project:create', { name: 'G', template: 'novela', genre: 'Fantasía' });
  assert.strictEqual(g.project.genre, 'Fantasía');
});

// ------------------------------------------------------------------ animaciones
test('configuración: animaciones activadas por defecto, se pueden desactivar y se valida', async () => {
  const t = make();
  assert.strictEqual((await t.call('config:get')).config.animations, true);
  assert.strictEqual((await t.call('config:set', { animations: false })).config.animations, false);
  assert.strictEqual((await t.call('config:get')).config.animations, false);
  assert.strictEqual((await t.call('config:set', { animations: 'no' })).config.animations, true, 'un valor no booleano vuelve al valor por defecto, como el resto de ajustes');
  assert.strictEqual((await t.call('config:set', { animations: false })).config.animations, false);
  assert.strictEqual((await t.call('config:set', { theme: 'light' })).config.animations, false, 'otros cambios no lo alteran');
});

// ------------------------------------------------------------------ mapas múltiples
const node = (id, x, y, extra) => Object.assign({ id, kind: 'note', title: id, notes: '', color: '#FFD712', x, y }, extra || {});

test('mapas: el map.json antiguo pasa a ser "Mapa 1" sin perder datos y queda respaldado', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Viejo' });
  const dir = path.join(t.core.getConfig && require('os').tmpdir(), 'x'); void dir;
  // simula un proyecto de la versión 1.0: map.json suelto
  const root = (await t.call('app:info')).dataDir;
  const pdir = path.join(root, 'proyectos', project.id);
  fs.writeFileSync(path.join(pdir, 'map.json'), JSON.stringify({ version: 1, nodes: [node('a', 0, 0), node('b', 300, 0)], edges: [{ id: 'e1', from: 'a', to: 'b', label: 'conoce a' }], view: { x: 5, y: 6, k: 1 } }));
  const l = await t.call('maps:list', { projectId: project.id });
  assert.strictEqual(l.maps.length, 1);
  assert.strictEqual(l.maps[0].name, 'Mapa 1');
  assert.strictEqual(l.maps[0].nodes, 2); assert.strictEqual(l.maps[0].links, 1);
  assert.ok(fs.existsSync(path.join(pdir, 'map.json.migrado')), 'conserva el original');
  assert.ok(!fs.existsSync(path.join(pdir, 'map.json')));
  const r = await t.call('map:read', { projectId: project.id });
  assert.strictEqual(r.data.nodes.length, 2);
  assert.strictEqual(r.data.edges[0].label, 'conoce a');
  assert.deepStrictEqual(r.data.view, { x: 5, y: 6, k: 1 });
  // listar de nuevo no vuelve a migrar ni duplica
  assert.strictEqual((await t.call('maps:list', { projectId: project.id })).maps.length, 1);
});

test('mapas: crear, renombrar, duplicar, escribir por id, abrir el último y borrar', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Mapas' });
  const pid = project.id;
  const first = (await t.call('maps:list', { projectId: pid })).maps[0];
  assert.strictEqual(first.name, 'Mapa 1');
  const c = await t.call('maps:create', { projectId: pid, name: '  Ciudad   y   sus calles ' });
  assert.strictEqual(c.map.name, 'Ciudad y sus calles');
  const c2 = await t.call('maps:create', { projectId: pid });
  assert.strictEqual(c2.map.name, 'Mapa 3');
  // cada mapa guarda sus propios datos
  await t.call('map:write', { projectId: pid, mapId: c.map.id, data: { nodes: [node('n1', 10, 10)], edges: [] } });
  await t.call('map:write', { projectId: pid, mapId: c2.map.id, data: { nodes: [node('m1', 1, 1), node('m2', 2, 2)], edges: [] } });
  assert.strictEqual((await t.call('map:read', { projectId: pid, mapId: c.map.id })).data.nodes.length, 1);
  assert.strictEqual((await t.call('map:read', { projectId: pid, mapId: c2.map.id })).data.nodes.length, 2);
  assert.strictEqual((await t.call('map:read', { projectId: pid, mapId: first.id })).data.nodes.length, 0);
  // escribir no pisa el nombre
  assert.strictEqual((await t.call('map:read', { projectId: pid, mapId: c.map.id })).name, 'Ciudad y sus calles');
  // renombrar
  assert.strictEqual((await t.call('maps:rename', { projectId: pid, mapId: c.map.id, name: 'Tramas' })).map.name, 'Tramas');
  const bad = await t.call('maps:rename', { projectId: pid, mapId: c.map.id, name: '   ' });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'NAME_REQUIRED');
  // duplicar
  const d = await t.call('maps:duplicate', { projectId: pid, mapId: c2.map.id });
  assert.strictEqual(d.map.name, 'Mapa 3 (copia)');
  assert.strictEqual((await t.call('map:read', { projectId: pid, mapId: d.map.id })).data.nodes.length, 2);
  // abrir el último usado
  await t.call('project:update', { id: pid, patch: { lastMap: c.map.id } });
  assert.strictEqual((await t.call('map:read', { projectId: pid })).mapId, c.map.id);
  assert.strictEqual((await t.call('maps:list', { projectId: pid })).last, c.map.id);
  // un id de mapa inexistente se rechaza
  const missing = await t.call('map:read', { projectId: pid, mapId: 'abcdef0123456789' });
  assert.strictEqual(missing.ok, false); assert.strictEqual(missing.code, 'NO_MAP');
  const traversal = await t.call('map:read', { projectId: pid, mapId: '../../config' });
  assert.strictEqual(traversal.ok, false);
  // borrar: el último mapa que queda no se puede borrar
  for (const m of (await t.call('maps:list', { projectId: pid })).maps.slice(1)) assert.ok((await t.call('maps:delete', { projectId: pid, mapId: m.id })).ok);
  const only = (await t.call('maps:list', { projectId: pid })).maps;
  assert.strictEqual(only.length, 1);
  const last = await t.call('maps:delete', { projectId: pid, mapId: only[0].id });
  assert.strictEqual(last.ok, false); assert.strictEqual(last.code, 'LAST_MAP');
  // el proyecto sigue abriéndose con un lastMap borrado
  await t.call('project:update', { id: pid, patch: { lastMap: only[0].id } });
  assert.ok((await t.call('map:read', { projectId: pid })).ok);
});

test('mapas: la lista de proyectos suma las conexiones de todos los mapas', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Enlaces' });
  const pid = project.id;
  const a = (await t.call('maps:list', { projectId: pid })).maps[0];
  const b = (await t.call('maps:create', { projectId: pid })).map;
  const data = { nodes: [node('a', 0, 0), node('b', 1, 1)], edges: [{ id: 'e', from: 'a', to: 'b', label: '' }] };
  await t.call('map:write', { projectId: pid, mapId: a.id, data });
  await t.call('map:write', { projectId: pid, mapId: b.id, data });
  assert.strictEqual((await t.call('project:list')).projects.find((p) => p.id === pid).links, 2);
});

// ------------------------------------------------------------------ PDF ampliado
const bibleData = () => ({
  version: 1,
  types: [
    { id: 't1', name: 'Personaje', color: '#FFD712', fields: [{ id: 'f1', label: 'Rol', kind: 'short' }, { id: 'f2', label: 'Aliados', kind: 'relation' }, { id: 'f3', label: 'Foto', kind: 'image' }, { id: 'f4', label: 'Vivo', kind: 'check' }, { id: 'f5', label: 'Rasgos', kind: 'tags' }] },
    { id: 't2', name: 'Lugar', color: '#6CB6FF', fields: [{ id: 'g1', label: 'Descripción', kind: 'long' }] },
  ],
  profiles: [
    { id: 'p1', typeId: 't1', name: 'Ana <Ríos>', values: { f1: 'Detective', f2: ['p2'], f3: 'data:image/png;base64,iVBORw0KGgo=', f4: true, f5: ['terca', 'leal'] } },
    { id: 'p2', typeId: 't1', name: 'Luis', values: { f1: 'Sospechoso' } },
    { id: 'p3', typeId: 't2', name: 'El puerto', values: { g1: 'Niebla\ny sal.' } },
  ],
});

async function projectWithContent(t) {
  const { project } = await t.call('project:create', { name: 'Libro', author: 'Ana López' });
  const pid = project.id;
  await t.call('chapter:write', { projectId: pid, chapterId: project.chapters[0].id, model: richModel() });
  await t.call('bible:write', { projectId: pid, data: bibleData() });
  const m1 = (await t.call('maps:list', { projectId: pid })).maps[0];
  await t.call('map:write', { projectId: pid, mapId: m1.id, data: { nodes: [node('a', 0, 0, { title: 'Idea A' }), { id: 'n2', kind: 'profile', profileId: 'p1', notes: '', x: 300, y: 80 }, { id: 'n3', kind: 'profile', profileId: 'p2', notes: '', x: 600, y: 0 }], edges: [{ id: 'e', from: 'a', to: 'n2', label: 'sospecha de' }] } });
  return { pid, project, m1 };
}

test('PDF ampliado: sin opciones nuevas, el resultado es el de siempre (solo manuscrito)', async () => {
  const t = await loggedIn();
  const { pid } = await projectWithContent(t);
  const p = await t.call('export:preview', { projectId: pid, options: {} });
  assert.ok(!p.body.includes('gx-bible') && !p.body.includes('gx-map-prev') && !p.body.includes('gx-toc'));
  assert.strictEqual(p.maps, 0); assert.strictEqual(p.profiles, 0);
});

test('PDF ampliado: la biblia incluye tipos, perfiles, relaciones, imagen y escapa el HTML', async () => {
  const t = await loggedIn();
  const { pid } = await projectWithContent(t);
  const r = await t.call('export:preview', { projectId: pid, options: { bible: true } });
  assert.strictEqual(r.profiles, 3);
  assert.ok(r.body.includes('Biblia del proyecto'));
  assert.ok(r.body.includes('Ana &lt;Ríos&gt;') && !r.body.includes('Ana <Ríos>'));
  assert.ok(r.body.includes('Aliados:') && r.body.includes('>Luis<'), 'la relación muestra el nombre del perfil enlazado');
  assert.ok(r.body.includes('terca, leal') && r.body.includes('>Sí<'));
  assert.ok(r.body.includes('<img class="gx-pimg" src="data:image/png;base64,'));
  // una imagen que no sea data URL de imagen se ignora
  const b = bibleData(); b.profiles[0].values.f3 = 'javascript:alert(1)'; await t.call('bible:write', { projectId: pid, data: b });
  assert.ok(!(await t.call('export:preview', { projectId: pid, options: { bible: true } })).body.includes('javascript:'));
  // filtros por tipo y por perfil
  const only = await t.call('export:preview', { projectId: pid, options: { bible: true, bibleTypeIds: ['t2'] } });
  assert.strictEqual(only.profiles, 1); assert.ok(only.body.includes('El puerto') && !only.body.includes('Detective'));
  const one = await t.call('export:preview', { projectId: pid, options: { bible: true, bibleProfileIds: ['p2'] } });
  assert.strictEqual(one.profiles, 1); assert.ok(one.body.includes('Sospechoso') && !one.body.includes('El puerto'));
});

test('PDF ampliado: los mapas se dibujan en SVG con nodos, conexiones y las relaciones de la biblia', async () => {
  const t = await loggedIn();
  const { pid, m1 } = await projectWithContent(t);
  const bible = bibleData();
  const raw = (await t.call('map:read', { projectId: pid, mapId: m1.id })).data;
  const r = mapToSvg(raw, bible);
  assert.strictEqual(r.nodes, 3);
  assert.strictEqual(r.edges, 2, 'una manual + una automática (Ana → Luis por "Aliados")');
  assert.ok(r.svg.startsWith('<svg') && r.svg.includes('Idea A') && r.svg.includes('Ana &lt;Ríos&gt;') && r.svg.includes('stroke-dasharray'));
  assert.ok(r.svg.includes('sospecha de') && r.svg.includes('Aliados'));
  assert.strictEqual(mapToSvg({ nodes: [], edges: [] }, bible), null);
  // nodos de perfiles borrados no rompen el dibujo
  assert.strictEqual(mapToSvg({ nodes: [{ id: 'z', kind: 'profile', profileId: 'ya-no-existe', x: 0, y: 0 }], edges: [] }, bible), null);
  const pv = await t.call('export:preview', { projectId: pid, options: { maps: true } });
  assert.strictEqual(pv.maps, 1); assert.ok(pv.body.includes('<svg'));
});

test('PDF ampliado: notas al final del capítulo, índice y cambios marcados', async () => {
  const t = await loggedIn();
  const { pid } = await projectWithContent(t);
  const fin = await t.call('export:preview', { projectId: pid, options: { toc: true, bible: true, maps: true } });
  assert.ok(fin.body.includes('gx-toc') && fin.body.includes('Contenido') && fin.body.includes('Biblia del proyecto') && fin.body.includes('Mapas'));
  assert.ok(fin.body.includes('<sup class="fnref">1</sup>') && fin.body.includes('gx-notes') && fin.body.includes('Segunda línea.'));
  assert.ok(!fin.body.includes('>muy<'), 'por defecto se muestra el texto final');
  const mk = await t.call('export:preview', { projectId: pid, options: { revisions: 'markup' } });
  assert.ok(mk.body.includes('rv-del') && mk.body.includes('rv-ins'));
});

test('PDF ampliado: se genera en dos pasadas (vertical + mapas horizontales), se une y numera', async () => {
  const t = await loggedIn();
  const { pid } = await projectWithContent(t);
  const out = path.join(tmp(), 'todo.pdf');
  t.state.saveResult = out;
  const r = await t.call('export:pdf', { projectId: pid, options: { bible: true, maps: true, title: 'El libro', author: 'Ana López' } });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.maps, 1); assert.strictEqual(r.profiles, 3); assert.strictEqual(r.metadata, true);
  assert.strictEqual(t.state.prints.length, 2);
  const [main, maps] = t.state.prints;
  assert.ok(main.html.includes('Biblia del proyecto') && !main.html.includes('<svg'), 'la primera pasada no lleva mapas');
  assert.ok(maps.html.includes('<svg') && !maps.html.includes('Biblia del proyecto'));
  assert.ok(typeof main.pdf.pageSize === 'string' || main.pdf.pageSize.width < main.pdf.pageSize.height);
  assert.ok(maps.pdf.pageSize.width > maps.pdf.pageSize.height, 'los mapas van en horizontal');
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.load(fs.readFileSync(out));
  assert.strictEqual(pdf.getPageCount(), 4, '2 páginas del manuscrito/biblia + 2 simuladas de mapas');
  assert.ok(pdf.getPage(0).getWidth() < pdf.getPage(0).getHeight());
  assert.ok(pdf.getPage(2).getWidth() > pdf.getPage(2).getHeight());
  assert.strictEqual(pdf.getTitle(), 'El libro'); assert.strictEqual(pdf.getAuthor(), 'Ana López');
});

test('PDF ampliado: se puede exportar solo biblia o solo mapas, y sin nada seleccionado avisa', async () => {
  const t = await loggedIn();
  const { pid } = await projectWithContent(t);
  t.state.saveResult = path.join(tmp(), 'a.pdf');
  const soloMapas = await t.call('export:pdf', { projectId: pid, options: { manuscript: false, cover: false, maps: true } });
  assert.ok(soloMapas.ok, JSON.stringify(soloMapas)); assert.strictEqual(t.state.prints.length, 1);
  t.state.saveResult = path.join(tmp(), 'b.pdf');
  const soloBiblia = await t.call('export:pdf', { projectId: pid, options: { manuscript: false, cover: false, bible: true } });
  assert.ok(soloBiblia.ok, JSON.stringify(soloBiblia));
  const nada = await t.call('export:pdf', { projectId: pid, options: { manuscript: false, cover: false } });
  assert.strictEqual(nada.ok, false); assert.strictEqual(nada.code, 'NO_CHAPTERS');
});

test('manuscrito .docx: "final" acepta cambios y quita comentarios; "markup" los conserva', async () => {
  const t = await loggedIn();
  const { pid } = await projectWithContent(t);
  t.state.saveResult = path.join(tmp(), 'f.docx');
  assert.ok((await t.call('export:docx', { projectId: pid, options: { cover: false } })).ok);
  const fin = parseDocx(fs.readFileSync(t.state.saveResult)).model;
  assert.ok(!fin.comments && !fin.track && !DM.plainText(fin).includes('muy'));
  assert.strictEqual(fin.notes.length, 1, 'las notas al pie siempre se conservan');
  t.state.saveResult = path.join(tmp(), 'm.docx');
  assert.ok((await t.call('export:docx', { projectId: pid, options: { cover: false, revisions: 'markup' } })).ok);
  const mk = parseDocx(fs.readFileSync(t.state.saveResult)).model;
  assert.strictEqual(mk.comments.length, 1); assert.strictEqual(mk.track, true);
  assert.ok(mk.blocks.some((b) => (b.runs || []).some((r) => r.tc && r.tc.t === 'del')));
});

test('manuscrito .docx: dos capítulos con notas propias no se mezclan', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Dos' });
  const c2 = (await t.call('chapter:create', { projectId: project.id, title: 'Dos' })).chapter;
  const mk = (txt) => DM.sanitizeModel({ blocks: [{ t: 'p', runs: [{ text: 'x' }, { fn: 'f1' }] }], notes: [{ id: 'f1', text: txt }] });
  await t.call('chapter:write', { projectId: project.id, chapterId: project.chapters[0].id, model: mk('Nota del uno') });
  await t.call('chapter:write', { projectId: project.id, chapterId: c2.id, model: mk('Nota del dos') });
  t.state.saveResult = path.join(tmp(), 'dos.docx');
  assert.ok((await t.call('export:docx', { projectId: project.id, options: { cover: false } })).ok);
  assert.deepStrictEqual(parseDocx(fs.readFileSync(t.state.saveResult)).model.notes.map((n) => n.text), ['Nota del uno', 'Nota del dos']);
});

test('capítulo: las notas, comentarios y el control de cambios se guardan y se releen del .docx', async () => {
  const t = await loggedIn();
  const { project } = await t.call('project:create', { name: 'Guardado' });
  const cid = project.chapters[0].id;
  assert.ok((await t.call('chapter:write', { projectId: project.id, chapterId: cid, model: richModel() })).ok);
  const back = (await t.call('chapter:read', { projectId: project.id, chapterId: cid })).model;
  assert.strictEqual(back.notes.length, 1); assert.strictEqual(back.comments.length, 1); assert.strictEqual(back.track, true);
  assert.ok(back.blocks[1].runs.some((r) => r.tc && r.tc.t === 'del'));
});

module.exports = () => run('versión 1.1: revisión, plantillas, mapas y PDF ampliado');
if (require.main === module) module.exports().then((r) => process.exit(r.failed ? 1 : 0));
