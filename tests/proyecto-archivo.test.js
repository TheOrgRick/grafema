'use strict';
// Pruebas del archivo de proyecto .grafema (exportar e importar el proyecto completo).
const fs = require('fs'), os = require('os'), path = require('path');
const { test, run, assert } = require('./helpers');
const { createCore } = require('../src/main/app-core');
const { createZip, readZip } = require('../src/main/zip');
const PF = require('../src/main/projectfile');
const DM = require('../src/shared/docmodel');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grafema-pf-'));
function make() {
  const state = { openResult: null, saveResult: null };
  const core = createCore({ dataDir: tmp(), deps: { dialog: { open: async () => state.openResult, save: async () => state.saveResult }, getFonts: async () => [] } });
  return { state, core, call: core.invoke };
}
const doc = (text) => ({ blocks: [{ t: 'h1', runs: [{ text: 'Título' }] }, { t: 'p', runs: [{ text, b: true }, { text: ' resto' }] }] });

async function projectWithEverything(t) {
  await t.call('author:set', { name: 'Ana' });
  const { project } = await t.call('project:create', { name: 'La noche larga', genre: 'Suspenso', template: 'suspenso' });
  const ch2 = await t.call('chapter:create', { projectId: project.id, title: 'Capítulo extra' });
  await t.call('chapter:write', { projectId: project.id, chapterId: ch2.chapter.id, model: doc('texto del capítulo extra') });
  const bible = { types: [{ id: 't1', name: 'Personaje', fields: [] }], profiles: [{ id: 'p1', typeId: 't1', name: 'Clara', values: { img: 'data:image/png;base64,AAAA' } }] };
  assert.ok((await t.call('bible:write', { projectId: project.id, data: bible })).ok);
  const m2 = await t.call('maps:create', { projectId: project.id, name: 'Mapa de pistas' });
  await t.call('map:write', { projectId: project.id, mapId: m2.map.id, data: { nodes: [{ id: 'n1', x: 5, y: 6, text: 'pista' }], edges: [] } });
  return { project, bible, mapId: m2.map.id, ch2: ch2.chapter };
}

test('exportar: el .grafema es un ZIP con manifiesto, proyecto, biblia, mapas y un .docx por capítulo', async () => {
  const t = make(); const { project } = await projectWithEverything(t);
  t.state.saveResult = path.join(tmp(), 'noche');            // sin extensión: se agrega
  const r = await t.call('project:exportFile', { projectId: project.id });
  assert.ok(r.ok, JSON.stringify(r)); assert.ok(r.path.endsWith('.grafema'));
  const files = readZip(fs.readFileSync(r.path));
  const names = [...files.keys()];
  for (const n of ['manifest.json', 'project.json', 'bible.json']) assert.ok(names.includes(n), 'falta ' + n);
  assert.strictEqual(names.filter((n) => /^maps\/.+\.json$/.test(n)).length, 2);
  assert.strictEqual(names.filter((n) => /^chapters\/.+\.docx$/.test(n)).length, 2 + (project.chapters.length - 1)); // capítulos de la plantilla + extra
  const man = JSON.parse(files.get('manifest.json'));
  assert.strictEqual(man.format, PF.FORMAT); assert.strictEqual(man.formatVersion, 1);
});
test('exportar: cancelar el cuadro no crea nada', async () => {
  const t = make(); const { project } = await projectWithEverything(t);
  t.state.saveResult = null;
  const r = await t.call('project:exportFile', { projectId: project.id });
  assert.ok(r.ok && r.canceled);
});
test('ida y vuelta: exportar y luego importar conserva capítulos, biblia (con imágenes) y mapas', async () => {
  const a = make(); const orig = await projectWithEverything(a);
  const out = path.join(tmp(), 'p.grafema'); a.state.saveResult = out;
  assert.ok((await a.call('project:exportFile', { projectId: orig.project.id })).ok);
  const b = make();                                           // otra "computadora" distinta
  b.state.openResult = [out];
  const r = await b.call('project:importFile');
  assert.ok(r.ok, JSON.stringify(r)); assert.notStrictEqual(r.project.id, orig.project.id);
  assert.strictEqual(r.project.name, 'La noche larga'); assert.strictEqual(r.project.genre, 'Suspenso');
  assert.strictEqual(r.project.chapters.length, orig.project.chapters.length + 1);
  const ch = await b.call('chapter:read', { projectId: r.project.id, chapterId: orig.ch2.id });
  assert.ok(ch.ok && JSON.stringify(ch.model).includes('texto del capítulo extra'));
  const bible = await b.call('bible:read', { projectId: r.project.id });
  assert.deepStrictEqual(bible.data, orig.bible);
  const maps = await b.call('maps:list', { projectId: r.project.id });
  assert.strictEqual(maps.maps.length, 2);
  const m = await b.call('map:read', { projectId: r.project.id, mapId: orig.mapId });
  assert.strictEqual(m.data.nodes[0].text, 'pista'); assert.strictEqual(m.name, 'Mapa de pistas');
  assert.strictEqual((await b.call('project:list')).projects.length, 1);
});
test('importar en el mismo equipo crea una copia y no pisa el original', async () => {
  const t = make(); const orig = await projectWithEverything(t);
  const out = path.join(tmp(), 'p.grafema'); t.state.saveResult = out;
  await t.call('project:exportFile', { projectId: orig.project.id });
  t.state.openResult = [out];
  const r = await t.call('project:importFile');
  assert.ok(r.ok); assert.strictEqual(r.project.name, 'La noche larga (importado)');
  const list = (await t.call('project:list')).projects;
  assert.strictEqual(list.length, 2);
});
test('importData/exportData (Android): mismos bytes por base64, sin diálogos ni rutas', async () => {
  const a = make(); const orig = await projectWithEverything(a);
  const e = await a.call('project:exportData', { projectId: orig.project.id });
  assert.ok(e.ok && e.fileName === 'La noche larga.grafema' && e.bytes > 100);
  const b = make();
  const r = await b.call('project:importData', { base64: e.base64 });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.project.chapters.length, orig.project.chapters.length + 1);
});
test('importar por ruta (doble clic): solo acepta .grafema', async () => {
  const t = make(); await t.call('author:set', { name: 'Ana' });
  const bad = await t.call('project:importFile', { path: path.join(tmp(), 'x.zip') });
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 'FILE_INVALID');
  const missing = await t.call('project:importFile', { path: path.join(tmp(), 'no-existe.grafema') });
  assert.strictEqual(missing.code, 'FILE_READ');
});
test('archivos inválidos: texto, ZIP ajeno, versión futura, sin proyecto y proyecto sin capítulos', async () => {
  const t = make(); await t.call('author:set', { name: 'Ana' });
  const imp = (buf) => t.call('project:importData', { base64: buf.toString('base64') });
  assert.strictEqual((await imp(Buffer.from('esto no es un zip, ni de lejos'))).code, 'FILE_INVALID');
  assert.strictEqual((await imp(createZip([{ name: 'hola.txt', data: 'x' }]))).code, 'FILE_INVALID');
  const man = (o) => JSON.stringify(Object.assign({ format: PF.FORMAT, formatVersion: 1 }, o));
  assert.strictEqual((await imp(createZip([{ name: 'manifest.json', data: man({ formatVersion: 99 }) }]))).code, 'FILE_NEWER');
  assert.strictEqual((await imp(createZip([{ name: 'manifest.json', data: man({}) }]))).code, 'FILE_INVALID');
  assert.strictEqual((await imp(createZip([{ name: 'manifest.json', data: man({}) }, { name: 'project.json', data: JSON.stringify({ name: 'x', chapters: [] }) }]))).code, 'FILE_BROKEN');
  assert.strictEqual((await t.call('project:list')).projects.length, 0, 'un archivo malo no deja restos');
});
test('seguridad: entradas con rutas peligrosas se ignoran y nunca se escriben fuera del proyecto', async () => {
  const a = make(); const orig = await projectWithEverything(a);
  const e = await a.call('project:exportData', { projectId: orig.project.id });
  const files = readZip(Buffer.from(e.base64, 'base64'));
  const entries = [...files].map(([name, data]) => ({ name, data }));
  entries.push({ name: '../../escape.txt', data: 'mal' }, { name: 'chapters/../../escape2.docx', data: 'mal' }, { name: 'otro/archivo.js', data: 'mal' });
  const b = make();
  const r = await b.call('project:importData', { base64: createZip(entries).toString('base64') });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual((await b.call('project:list')).projects.length, 1);
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'escape.txt')));
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), '..', 'escape.txt')));
});
test('zip bomb: una entrada gigante se rechaza sin agotar la memoria', async () => {
  const t = make(); await t.call('author:set', { name: 'Ana' });
  const big = Buffer.alloc(90 * 1024 * 1024, 0x61);          // 90 MB que comprimen a casi nada
  const zip = createZip([{ name: 'manifest.json', data: JSON.stringify({ format: PF.FORMAT, formatVersion: 1 }) }, { name: 'bible.json', data: big }]);
  assert.ok(zip.length < 1024 * 1024);
  const r = await t.call('project:importData', { base64: zip.toString('base64') });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'FILE_TOO_BIG');
});
test('capítulo faltante o dañado: se importa con aviso y el proyecto abre', async () => {
  const a = make(); const orig = await projectWithEverything(a);
  const e = await a.call('project:exportData', { projectId: orig.project.id });
  const files = readZip(Buffer.from(e.base64, 'base64'));
  const entries = [...files].filter(([n]) => n !== `chapters/${orig.ch2.id}.docx`).map(([name, data]) => ({ name, data }));
  const b = make();
  const r = await b.call('project:importData', { base64: createZip(entries).toString('base64') });
  assert.ok(r.ok && r.warnings.some((w) => /Falta el archivo de 1 cap/.test(w)), JSON.stringify(r.warnings));
  const ch = await b.call('chapter:read', { projectId: r.project.id, chapterId: orig.ch2.id });
  assert.ok(ch.ok);                                          // se abre vacío en lugar de fallar
});

module.exports = () => run('archivo de proyecto .grafema');
if (require.main === module) module.exports().then((r) => process.exit(r.failed ? 1 : 0));
