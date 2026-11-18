'use strict';
const { test, run, assert } = require('./helpers');
const { buildDocx, parseDocx } = require('../src/main/docx');
const { readZip } = require('../src/main/zip');
const DM = require('../src/shared/docmodel');

const sample = () => ({
  defaults: { font: 'Times New Roman', size: 12, lh: 1.5 },
  blocks: [
    { t: 'h1', runs: [{ text: 'Capítulo 1: La noche & el <viento>' }] },
    { t: 'p', align: 'justify', fi: 720, runs: [
      { text: 'Hola ' }, { text: 'negrita', b: true }, { text: ' ' }, { text: 'cursiva', i: true },
      { text: ' ' }, { text: 'sub', u: true, s: true }, { text: ' fuente', font: 'Georgia', size: 14, color: '#FF0000', bg: '#FFFF00' },
      { br: true }, { text: 'tras salto\ty tab ñandú 😀' }] },
    { t: 'p', align: 'center', lh: 2, runs: [{ text: 'Centrado' }] },
    { t: 'p', align: 'right', runs: [] },
    { t: 'li', list: { ordered: false, level: 0 }, runs: [{ text: 'Viñeta uno' }] },
    { t: 'li', list: { ordered: false, level: 1 }, runs: [{ text: 'Sub viñeta' }] },
    { t: 'p', runs: [{ text: 'Entre listas' }] },
    { t: 'li', list: { ordered: true, level: 0 }, runs: [{ text: 'Primero' }] },
    { t: 'li', list: { ordered: true, level: 0 }, runs: [{ text: 'Segundo' }] },
    { t: 'li', list: { ordered: true, level: 1 }, runs: [{ text: 'Segundo-a' }] },
    { t: 'pb' },
    { t: 'h2', runs: [{ text: 'Sección' }] },
    { t: 'h3', runs: [{ text: 'Sub' }] },
    { t: 'p', runs: [{ text: 'x', sup: true }, { text: 'y', sub: true }] },
  ],
});

test('construye un ZIP con las partes obligatorias de OOXML', () => {
  const files = readZip(buildDocx(sample(), { title: 'T', author: 'Ana' }));
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/settings.xml', 'docProps/core.xml'])
    assert.ok(files.has(n), 'falta ' + n);
  assert.match(files.get('docProps/core.xml').toString(), /<dc:creator>Ana<\/dc:creator>/);
});

test('ida y vuelta conserva texto, formato, alineación, listas y saltos', () => {
  const m = DM.sanitizeModel(sample());
  const back = parseDocx(buildDocx(m, { title: 'Libro', author: 'Ana' }));
  assert.deepStrictEqual(back.model.blocks, m.blocks);
  assert.deepStrictEqual(back.model.defaults, m.defaults);
  assert.strictEqual(back.meta.author, 'Ana');
  assert.strictEqual(back.meta.title, 'Libro');
});

test('página: tamaño y márgenes se escriben y se leen', () => {
  const page = { size: 'a4', margins: { top: 720, right: 1080, bottom: 1440, left: 2880 } };
  const back = parseDocx(buildDocx(sample(), { page }));
  assert.deepStrictEqual(back.page, page);
});

test('listas numeradas separadas reinician su numeración (numId distintos)', () => {
  const m = { blocks: [
    { t: 'li', list: { ordered: true, level: 0 }, runs: [{ text: 'a' }] },
    { t: 'p', runs: [{ text: 'corte' }] },
    { t: 'li', list: { ordered: true, level: 0 }, runs: [{ text: 'b' }] } ] };
  const xml = readZip(buildDocx(m)).get('word/document.xml').toString();
  const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"/g)].map((x) => x[1]);
  assert.deepStrictEqual(ids, ['2', '3']);
});

test('caracteres de control inválidos no rompen el XML', () => {
  const m = { blocks: [{ t: 'p', runs: [{ text: 'a\u0001b\u0008c' }] }] };
  const back = parseDocx(buildDocx(m));
  assert.strictEqual(DM.plainText(back.model), 'abc');
});

test('archivo que no es .docx produce error claro con código', () => {
  assert.throws(() => parseDocx(Buffer.from('esto no es un zip')), (e) => e.code === 'DOCX_INVALID' && /docx/.test(e.message));
  const { createZip } = require('../src/main/zip');
  assert.throws(() => parseDocx(createZip([{ name: 'x.txt', data: 'hola' }])), (e) => e.code === 'DOCX_INVALID');
});

test('sanitizeModel descarta basura sin lanzar', () => {
  const m = DM.sanitizeModel({ blocks: [null, 5, { t: 'zzz' }, { t: 'p', runs: [null, { text: 5 }, { text: 'ok', size: 9999, color: 'rojo', font: "Ar'ial;{}" }] }] });
  assert.deepStrictEqual(m.blocks, [{ t: 'p', runs: [{ text: 'ok', font: 'Arial' }] }]);
  assert.strictEqual(DM.sanitizeModel(null).blocks.length, 1);
});

test('conteo de palabras con acentos, guiones y apóstrofos', () => {
  assert.strictEqual(DM.countWordsInText('Él no pudo — ¡jamás! — dormir; co-op isn’t "ñandú" 12'), 9);
  assert.strictEqual(DM.countWordsInText(''), 0);
});

test('modelToHtml escapa HTML y no permite inyectar estilos', () => {
  const html = DM.modelToHtml({ blocks: [{ t: 'p', runs: [{ text: '<img src=x onerror=alert(1)>', font: 'A";background:url(x)', color: 'red' }] }] });
  assert.ok(!/<img/.test(html));
  assert.ok(!/;background|"[^>]*onerror/.test(html));
  assert.ok(html.includes('&lt;img'));
});

test('modelToHtml: listas anidadas con tipos mezclados cierran bien', () => {
  const html = DM.modelToHtml({ blocks: [
    { t: 'li', list: { ordered: false, level: 0 }, runs: [{ text: 'a' }] },
    { t: 'li', list: { ordered: true, level: 1 }, runs: [{ text: 'b' }] },
    { t: 'li', list: { ordered: false, level: 0 }, runs: [{ text: 'c' }] },
    { t: 'p', runs: [{ text: 'z' }] }] });
  assert.strictEqual(html, '<ul><li>a<ol><li>b</li></ol></li><li>c</li></ul><p>z</p>');
});

module.exports = () => run('docx / modelo');
if (require.main === module) module.exports().then((r) => process.exit(r.failed ? 1 : 0));
