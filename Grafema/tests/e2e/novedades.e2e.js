'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/home/claude/.npm-global/lib/node_modules'; require('module').Module._initPaths();
const assert = require('assert');
const fs = require('fs');
const { launch, register } = require('./harness');
const DM = require('../../src/shared/docmodel');
const results = []; const ok = (n) => { results.push(n); console.log('  ✓ ' + n); };

(async () => {
  console.log('\n▶ novedades 1.1 (Chromium real)');
  const t = await launch({ width: 1366, height: 800 });
  const p = t.page;
  const ed = p.locator('.ed-content');
  const html = () => p.evaluate(() => document.querySelector('.ed-content').innerHTML);
  const text = () => p.evaluate(() => document.querySelector('.ed-content').innerText);
  const pid = () => p.evaluate(() => G.state.project.id);
  const cid = () => p.evaluate(() => G.state.project.chapters[0].id);
  const saved = async () => { await p.evaluate(() => G.flushAll()); return (await t.call('chapter:read', { projectId: await pid(), chapterId: await cid() })).model; };
  const setCaret = (node, off) => p.evaluate(([n, o]) => { const e = document.querySelector('.ed-content'); const tn = (n === 'first' ? e.querySelector('p').firstChild : n); const r = document.createRange(); r.setStart(tn, o); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); }, [node, off]);
  const selectText = (a, b) => p.evaluate(([x, y]) => { const e = document.querySelector('.ed-content'); const tn = e.querySelector('p').firstChild; const r = document.createRange(); r.setStart(tn, x); r.setEnd(tn, y); getSelection().removeAllRanges(); getSelection().addRange(r); }, [a, b]);
  const reopen = async () => {
    await p.evaluate(() => { const e = document.querySelector('.ed-content'); if (e) e.setAttribute('data-old', '1'); });
    await p.evaluate(async () => { await G.flushAll(); await G.openProject(G.state.project.id, 'editor'); });
    await p.waitForSelector('.ed-content:not([data-old])');
    await p.waitForTimeout(120);
  };
  try {
    await p.waitForSelector('.auth-card');
    await register(t);
    await p.waitForSelector('.home');

    // ------------------------------------------------------------ plantillas de inicio
    await p.getByRole('button', { name: 'Crear mi primer proyecto' }).click();
    assert.strictEqual(await p.locator('.tpl').count(), 5);
    assert.strictEqual(await p.locator('.tpl.on').getAttribute('data-id'), 'blank');
    await p.locator('.tpl[data-id="suspenso"]').click();
    assert.strictEqual(await p.locator('select.select').first().inputValue(), 'Suspenso', 'el género sigue a la plantilla');
    await p.locator('.tpl[data-id="novela"]').click();
    assert.strictEqual(await p.locator('.tpl.on').count(), 1);
    assert.strictEqual(await p.locator('.tpl.on').getAttribute('aria-checked'), 'true');
    await p.getByLabel('Nombre del proyecto').fill('La noche larga');
    await p.getByRole('button', { name: 'Crear proyecto' }).click();
    await p.waitForSelector('.ed-content');
    assert.deepStrictEqual(await p.evaluate(() => G.state.project.chapters.map((c) => c.title)), ['Prólogo', 'Acto I — Planteamiento', 'Acto II — Confrontación', 'Acto III — Resolución', 'Epílogo']);
    assert.ok((await text()).startsWith('Guía:'));
    ok('plantillas: la galería crea el proyecto con capítulos y texto guía');

    // Se reemplaza el contenido del primer capítulo por texto propio para el resto de las pruebas.
    const writeChapter = async (blocks, extra) => {
      await p.evaluate(() => G.flushAll());   // que el editor abierto no pise lo que se escribe por fuera
      await t.call('chapter:write', { projectId: await pid(), chapterId: await cid(), model: DM.sanitizeModel(Object.assign({ defaults: {}, blocks }, extra || {})) });
      await reopen();
    };
    await writeChapter([{ t: 'p', runs: [{ text: 'Ana ve a Luis. Luis ve a Ana. Ana saluda.' }] }]);

    // ------------------------------------------------------------ buscar y reemplazar con regex
    await ed.click(); await p.keyboard.press('Control+f');
    await p.locator('.findbar input[type=search], .findbar input').first().fill('(\\w+) ve a (\\w+)');
    await p.locator('#f-re').check();
    await p.waitForTimeout(150);
    assert.match(await p.locator('.findbar').innerText(), /2 coincidencias/);
    const rep = p.locator('.findbar input').nth(1);
    await rep.fill('$2 vio a $1');
    await p.getByRole('button', { name: /Reemplazar todo|Todo/ }).first().click();
    assert.strictEqual((await text()).trim(), 'Luis vio a Ana. Ana vio a Luis. Ana saluda.');
    ok('regex: grupos de captura ($1, $2) en el reemplazo');
    await p.locator('.findbar input').first().fill('(sin cerrar');
    await p.waitForTimeout(150);
    assert.match(await p.locator('.findbar').innerText(), /no válida/);
    await p.locator('.findbar input').first().fill('Ana');
    await p.locator('#f-re').uncheck(); await p.locator('#f-word').check();
    await p.waitForTimeout(150);
    assert.match(await p.locator('.findbar').innerText(), /3 coincidencias/);
    await p.locator('.findbar input').first().fill('An');
    await p.waitForTimeout(150);
    assert.match(await p.locator('.findbar').innerText(), /Sin coincidencias/, '"An" no es una palabra completa');
    await p.locator('#f-word').uncheck(); await p.waitForTimeout(150);
    assert.match(await p.locator('.findbar').innerText(), /3 coincidencias/);
    ok('regex: expresión inválida avisa; "palabra completa" distingue "An" de "Ana"');
    await p.keyboard.press('Escape');

    // ------------------------------------------------------------ esquema (navegación por encabezados)
    await writeChapter([
      { t: 'h1', runs: [{ text: 'El comienzo' }] }, { t: 'p', runs: [{ text: 'uno dos tres cuatro cinco' }] },
      ...Array.from({ length: 40 }, () => ({ t: 'p', runs: [{ text: 'Relleno para que haya que desplazarse por el documento.' }] })),
      { t: 'h2', runs: [{ text: 'La mitad' }] }, { t: 'p', runs: [{ text: 'seis siete' }] },
      ...Array.from({ length: 40 }, () => ({ t: 'p', runs: [{ text: 'Más relleno para seguir desplazando el contenido.' }] })),
      { t: 'h3', runs: [{ text: 'El final' }] }, { t: 'p', runs: [{ text: 'fin' }] },
    ]);
    await p.getByRole('tab', { name: 'Esquema' }).click();
    assert.strictEqual(await p.locator('.ol-item').count(), 3);
    assert.deepStrictEqual(await p.locator('.ol-item .ol-t').allTextContents(), ['El comienzo', 'La mitad', 'El final']);
    assert.ok(await p.locator('.ol-item.l2').count() === 1 && await p.locator('.ol-item.l3').count() === 1);
    await p.locator('.ol-item').nth(2).click();
    const visible = () => p.evaluate(() => { const h3 = document.querySelector('.ed-content h3').getBoundingClientRect(); const sc = document.querySelector('.ed-scroll').getBoundingClientRect(); return h3.top >= sc.top - 2 && h3.top < sc.bottom; });
    await p.waitForFunction(() => { const h3 = document.querySelector('.ed-content h3').getBoundingClientRect(); const sc = document.querySelector('.ed-scroll').getBoundingClientRect(); return h3.top >= sc.top - 2 && h3.top < sc.bottom; }, null, { timeout: 4000 });
    assert.ok(await visible(), 'el encabezado queda visible');
    await p.waitForTimeout(300);
    assert.ok(await p.locator('.ol-item.on').count() >= 1, 'se marca la sección actual');
    await p.locator('.ol-search input').fill('mitad');
    assert.strictEqual(await p.locator('.ol-item').count(), 1);
    ok('esquema: lista encabezados por nivel, salta a la sección y filtra');
    await p.getByRole('tab', { name: 'Capítulos' }).click();

    // ------------------------------------------------------------ notas al pie
    await writeChapter([{ t: 'p', runs: [{ text: 'Era una noche oscura y fría de noviembre.' }] }]);
    await ed.click(); await setCaret('first', 7);
    await p.keyboard.press('Control+Alt+f');
    assert.strictEqual(await p.locator('.fn').count(), 1);
    assert.strictEqual(await p.locator('.side-tab.on').innerText().then((x) => x.replace(/\d+/, '').trim()), 'Revisión');
    await p.locator('.rv-note textarea').fill('Primera nota\ncon dos líneas');
    await ed.click(); await p.keyboard.press('End'); await p.keyboard.press('Control+Alt+f');
    assert.strictEqual(await p.locator('.fn').count(), 2);
    // El número lo dibuja un contador CSS (se renumera solo al agregar o quitar notas).
    const css = await p.evaluate(() => { const s = document.querySelectorAll('.ed-content .fn'); return [getComputedStyle(s[0]).counterIncrement, getComputedStyle(s[1]).counterIncrement, getComputedStyle(s[1], '::after').content, getComputedStyle(document.querySelector('.ed-content')).counterReset]; });
    assert.deepStrictEqual(css, ['gfn 1', 'gfn 1', 'counter(gfn)', 'gfn 0'], 'numeración automática');
    await p.locator('.rv-note textarea').nth(1).fill('Segunda');
    let m = await saved();
    assert.deepStrictEqual(m.notes.map((n) => n.text), ['Primera nota\ncon dos líneas', 'Segunda']);
    assert.strictEqual(DM.plainText(m), 'Era una noche oscura y fría de noviembre.');
    await reopen();
    assert.strictEqual(await p.locator('.fn').count(), 2);
    await p.locator('.fn').first().click();
    assert.strictEqual(await p.locator('.rv-note textarea').first().inputValue(), 'Primera nota\ncon dos líneas');
    // borrar una marca elimina su nota
    await ed.click(); await p.keyboard.press('End'); await p.keyboard.press('Backspace');
    assert.strictEqual(await p.locator('.fn').count(), 1);
    m = await saved(); assert.strictEqual(m.notes.length, 1);
    ok('notas al pie: se insertan, numeran, se editan, se guardan en el .docx y se borran con su marca');

    // ------------------------------------------------------------ comentarios
    await writeChapter([{ t: 'p', runs: [{ text: 'Era una noche oscura y fría.' }] }, { t: 'p', runs: [{ text: 'Segundo párrafo del capítulo.' }] }]);
    await ed.click();
    await selectText(4, 13);
    await p.keyboard.press('Control+Alt+m');
    await p.waitForSelector('.cm-col .cm-card');
    assert.strictEqual(await p.locator('.ed-content .cm').innerText(), 'una noche');
    await p.keyboard.type('¿Seguro que es de noche?');
    assert.strictEqual(await p.locator('.cm-col').isVisible(), true);
    const noOverflow = await p.evaluate(() => { const c = document.querySelector('.cm-col').getBoundingClientRect(), s = document.querySelector('.ed-scroll').getBoundingClientRect(); return c.right <= s.right + 1; });
    assert.ok(noOverflow, 'la columna de comentarios cabe en el área de edición');
    m = await saved();
    assert.strictEqual(m.comments.length, 1); assert.strictEqual(m.comments[0].text, '¿Seguro que es de noche?'); assert.strictEqual(m.comments[0].author, 'Ana López');
    await reopen();
    assert.strictEqual(await p.locator('.cm-col .cm-card textarea').inputValue(), '¿Seguro que es de noche?');
    await p.locator('.cm-col .cm-card').getByRole('button', { name: 'Resolver comentario' }).click();
    await p.waitForTimeout(150);
    assert.strictEqual(await p.locator('.cm-col .cm-card').count(), 0, 'resuelto: sale del margen');
    m = await saved(); assert.strictEqual(m.comments[0].resolved, true);
    await p.getByRole('tab', { name: /Revisión/ }).click();
    assert.match(await p.locator('.rv').innerText(), /Mostrar resueltos \(1\)/);
    await p.getByRole('button', { name: /Mostrar resueltos/ }).click();
    await p.locator('.rv').getByRole('button', { name: 'Reabrir comentario' }).click();
    await p.waitForTimeout(200);
    assert.strictEqual(await p.locator('.cm-col .cm-card').count(), 1);
    await p.locator('.cm-col .cm-card').getByRole('button', { name: 'Eliminar comentario' }).click();
    assert.strictEqual(await p.locator('.ed-content .cm').count(), 0);
    m = await saved(); assert.ok(!m.comments);
    // un comentario vacío se descarta solo
    await ed.click(); await selectText(0, 3); await p.keyboard.press('Control+Alt+m');
    await p.waitForSelector('.cm-col .cm-card'); await p.keyboard.press('Escape'); await p.waitForTimeout(500);
    assert.strictEqual(await p.locator('.ed-content .cm').count(), 0, 'comentario vacío descartado');
    ok('comentarios: margen, texto, resolver/reabrir, eliminar, persistencia y descarte de vacíos');

    // ------------------------------------------------------------ control de cambios
    await writeChapter([{ t: 'p', runs: [{ text: 'Hola mundo cruel' }] }]);
    await ed.click(); await p.keyboard.press('Control+End');
    await p.keyboard.press('Control+Shift+t');
    assert.strictEqual(await p.locator('.st-track').isVisible(), true);
    assert.strictEqual(await p.getByRole('button', { name: 'Control de cambios' }).first().getAttribute('aria-pressed'), 'true');
    await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
    assert.strictEqual(await p.locator('.tc.del').allInnerTexts().then((a) => a.join('')), 'el');
    await p.keyboard.type(' amigo');
    assert.strictEqual(await p.locator('.tc.ins').innerText(), ' amigo');
    assert.strictEqual(await p.locator('.tc.ins').count(), 1, 'lo tecleado seguido es un solo cambio');
    await p.keyboard.press('Backspace');
    assert.strictEqual(await p.locator('.tc.ins').innerText(), ' amig', 'borrar lo propio lo quita de verdad');
    await selectText(5, 10);
    await p.keyboard.type('MUNDO');
    assert.strictEqual(await p.locator('.tc.del').first().innerText(), 'mundo');
    assert.strictEqual(await p.locator('.ed-content .tc.ins').first().innerText(), 'MUNDO');
    m = await saved();
    assert.strictEqual(m.track, true);
    const runs = m.blocks[0].runs;
    assert.ok(runs.some((r) => r.tc && r.tc.t === 'del' && r.text === 'mundo') && runs.some((r) => r.tc && r.tc.t === 'ins' && r.text === 'MUNDO'));
    assert.strictEqual(DM.plainText(m), 'Hola MUNDO cru amig', 'el texto "final" sin lo eliminado');
    assert.strictEqual(await p.locator('.st-words, .ed-status').first().innerText().then((x) => /palabras/.test(x)), true);
    await reopen();
    assert.strictEqual(await p.locator('.st-track').isVisible(), true, 'el estado de seguimiento se conserva');
    assert.strictEqual(await p.locator('.tc').count() >= 3, true);
    await p.getByRole('tab', { name: /Revisión/ }).click();
    const items = await p.locator('.tc-item').count();
    assert.ok(items >= 3, 'se listan los cambios');
    // rechazar el reemplazo de "mundo"
    const first = p.locator('.tc-item', { hasText: 'mundo' }).first();
    await first.getByRole('button', { name: 'Rechazar cambio' }).click();
    assert.ok((await text()).includes('mundo') && true);
    await p.getByRole('button', { name: 'Aceptar todos' }).click();
    assert.strictEqual(await p.locator('.tc').count(), 0);
    assert.ok(!/\bcruel\b/.test(await text()), 'lo eliminado se quitó');
    m = await saved(); assert.ok(m.blocks[0].runs.every((r) => !r.tc));
    await p.keyboard.press('Control+Shift+t');
    ok('control de cambios: marcar borrados e insertados, borrar lo propio, reemplazar, guardar, aceptar y rechazar');

    // ------------------------------------------------------------ modo enfoque y lectura
    await writeChapter([{ t: 'p', runs: [{ text: 'Primer párrafo del texto.' }] }, { t: 'p', runs: [{ text: 'Segundo párrafo del texto.' }] }, { t: 'p', runs: [{ text: 'Tercero.' }, { fn: 'f1' }] }], { notes: [{ id: 'f1', text: 'Nota de lectura' }] });
    await ed.click(); await p.keyboard.press('Control+Home');
    await p.keyboard.press('Control+Shift+f');
    assert.strictEqual(await p.evaluate(() => document.querySelector('.ed').classList.contains('mode-focus')), true);
    assert.strictEqual(await p.locator('.ed-side').isVisible(), false, 'el panel se oculta en modo enfoque');
    await p.keyboard.press('ArrowDown');
    await p.waitForTimeout(100);
    const op = await p.evaluate(() => [...document.querySelectorAll('.ed-content > p')].map((e) => Number(getComputedStyle(e).opacity)));
    await p.waitForTimeout(400);
    const op2 = await p.evaluate(() => [...document.querySelectorAll('.ed-content > p')].map((e) => Number(getComputedStyle(e).opacity).toFixed(2)));
    assert.deepStrictEqual(op2, ['0.30', '1.00', '0.30'], 'solo el párrafo actual se ve completo: ' + op2);
    void op;
    await p.keyboard.press('End');
    await p.keyboard.type(' Extra');
    assert.ok((await text()).includes('Segundo párrafo del texto. Extra'), 'se puede escribir en modo enfoque');
    await p.keyboard.press('Escape');
    assert.strictEqual(await p.evaluate(() => document.querySelector('.ed').classList.contains('mode-focus')), false);
    assert.strictEqual(await p.locator('.ed-side').isVisible(), true, 'el panel vuelve');
    // lectura
    await p.keyboard.press('Control+Shift+l');
    assert.strictEqual(await ed.getAttribute('contenteditable'), 'false');
    const before = await text();
    await p.keyboard.type('NO DEBE ENTRAR');
    assert.strictEqual(await text(), before, 'el modo lectura no edita');
    assert.strictEqual(await p.locator('.ed-toolbar').isVisible(), false);
    await p.locator('.fn').click();
    assert.match(await p.locator('.note-pop').innerText(), /Nota de lectura/);
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Letra más grande' }).click();
    assert.ok(await p.evaluate(() => getComputedStyle(document.querySelector('.ed')).getPropertyValue('--read-scale').trim()) === '1.1');
    await p.getByRole('button', { name: 'Salir (Esc)' }).click();
    assert.strictEqual(await ed.getAttribute('contenteditable'), 'true');
    ok('modos enfoque y lectura: atenuado, panel, solo lectura, nota emergente y salida');

    // ------------------------------------------------------------ animaciones
    await p.evaluate(() => G.go('home'));
    await p.waitForSelector('.proj-card');
    assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.anim), 'on');
    const animOn = await p.evaluate(() => getComputedStyle(document.querySelector('.proj-card')).animationName);
    assert.notStrictEqual(animOn, 'none');
    await p.evaluate(() => G.go('settings'));
    await p.waitForSelector('input[aria-label="Animaciones de la interfaz"]');
    await p.locator('input[aria-label="Animaciones de la interfaz"]').evaluate((e) => e.click());
    assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.anim), 'off');
    assert.strictEqual((await t.call('config:get')).config.animations, false, 'se guarda');
    await p.evaluate(() => G.go('home')); await p.waitForSelector('.proj-card');
    const animOff = await p.evaluate(() => { const c = document.querySelector('.proj-card'); const cs = getComputedStyle(c); return [cs.animationName, cs.transitionDuration, getComputedStyle(document.querySelector('.hero-art .art') || c).animationName]; });
    assert.deepStrictEqual(animOff, ['none', '0s', 'none'], 'sin animaciones ni transiciones');
    assert.strictEqual(await p.evaluate(() => G.anim()), false);
    await p.evaluate(() => G.go('settings')); await p.waitForSelector('input[aria-label="Animaciones de la interfaz"]');
    await p.locator('input[aria-label="Animaciones de la interfaz"]').evaluate((e) => e.click());
    assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.anim), 'on');
    ok('animaciones: activadas por defecto, el ajuste las apaga por completo y se recuerda');

    // ------------------------------------------------------------ varios mapas
    await p.evaluate(() => G.go('home')); await p.waitForSelector('.proj-card');
    await p.locator('.proj-card').first().click();
    await p.evaluate(() => G.go('map')); await p.waitForSelector('.mm-canvas');
    assert.deepStrictEqual(await p.locator('.map-tab .ellip').allTextContents(), ['Mapa 1']);
    await p.getByRole('button', { name: 'Crear una nota' }).click();
    await p.waitForTimeout(200);
    assert.strictEqual(await p.locator('.map-tab.on .n').innerText(), '1');
    await p.getByRole('button', { name: 'Nuevo mapa' }).click();
    await p.getByLabel('Nombre del mapa').fill('Tramas');
    await p.getByRole('button', { name: 'Crear mapa' }).click();
    await p.waitForFunction(() => document.querySelectorAll('.map-tab').length === 2);
    assert.strictEqual(await p.locator('.map-tab.on .ellip').innerText(), 'Tramas');
    assert.strictEqual(await p.locator('.mm-node').count(), 0, 'el mapa nuevo está vacío');
    await p.getByRole('button', { name: 'Crear una nota' }).click(); await p.waitForTimeout(100);
    await p.getByRole('button', { name: 'Agregar una nota en el centro' }).click(); await p.waitForTimeout(100);
    assert.strictEqual(await p.locator('.mm-node').count(), 2);
    await p.locator('.map-tab', { hasText: 'Mapa 1' }).click();
    await p.waitForFunction(() => document.querySelector('.map-tab.on .ellip').textContent === 'Mapa 1');
    assert.strictEqual(await p.locator('.mm-node').count(), 1, 'cada mapa conserva sus nodos');
    // renombrar
    await p.getByRole('button', { name: 'Opciones de este mapa' }).click();
    await p.getByRole('menuitem', { name: 'Renombrar mapa' }).click();
    await p.getByLabel('Nombre del mapa').fill('Personajes'); await p.getByRole('button', { name: 'Renombrar' }).click();
    await p.waitForFunction(() => document.querySelector('.map-tab.on .ellip').textContent === 'Personajes');
    // duplicar
    await p.getByRole('button', { name: 'Opciones de este mapa' }).click();
    await p.getByRole('menuitem', { name: 'Duplicar mapa' }).click();
    await p.waitForFunction(() => document.querySelectorAll('.map-tab').length === 3);
    assert.strictEqual(await p.locator('.map-tab.on .ellip').innerText(), 'Personajes (copia)');
    assert.strictEqual(await p.locator('.mm-node').count(), 1);
    // eliminar la copia
    await p.getByRole('button', { name: 'Opciones de este mapa' }).click();
    await p.getByRole('menuitem', { name: 'Eliminar mapa' }).click();
    await p.getByRole('button', { name: 'Eliminar mapa' }).click();
    await p.waitForFunction(() => document.querySelectorAll('.map-tab').length === 2);
    // se recuerda el último mapa abierto
    await p.locator('.map-tab', { hasText: 'Tramas' }).click();
    await p.waitForFunction(() => document.querySelector('.map-tab.on .ellip').textContent === 'Tramas');
    await p.evaluate(() => G.go('bible')); await p.waitForTimeout(200);
    await p.evaluate(() => G.go('map')); await p.waitForSelector('.mm-canvas');
    assert.strictEqual(await p.locator('.map-tab.on .ellip').innerText(), 'Tramas', 'abre el último mapa usado');
    ok('mapas múltiples: crear, cambiar, renombrar, duplicar, eliminar y recordar el último');

    // ------------------------------------------------------------ PDF ampliado
    const proj = await pid();
    await t.call('bible:write', { projectId: proj, data: { version: 1, types: [{ id: 't1', name: 'Personaje', color: '#FFD712', fields: [{ id: 'f1', label: 'Rol', kind: 'short' }] }], profiles: [{ id: 'p1', typeId: 't1', name: 'Ana Ríos', values: { f1: 'Detective' } }, { id: 'p2', typeId: 't1', name: 'Luis Vega', values: { f1: 'Sospechoso' } }] } });
    await p.evaluate(() => G.go('export')); await p.waitForSelector('.xs');
    assert.strictEqual(await p.locator('.xs').count(), 4);
    assert.ok(!(await p.locator('.gx-sheet').innerText()).includes('Detective'));
    await p.locator('.xs', { hasText: 'Biblia del proyecto' }).locator('.sw-track').click();
    await p.waitForFunction(() => document.querySelector('.gx-sheet').innerText.includes('Detective'));
    await p.locator('.xs', { hasText: 'Mapas de ideas' }).locator('.sw-track').click();
    await p.waitForFunction(() => document.querySelectorAll('.gx-sheet svg').length >= 1);
    await p.locator('.xs', { hasText: 'Índice al inicio' }).locator('.sw-track').click();
    await p.waitForFunction(() => document.querySelector('.gx-sheet .gx-toc'));
    // filtrar tipos: sin ninguno, la biblia no aparece
    const out = require('path').join(t.dir, 'completo.pdf');
    t.state.saveResult = out;
    await p.getByRole('button', { name: 'Exportar a PDF' }).click();
    await p.waitForFunction(() => /PDF guardado/.test(document.body.innerText), null, { timeout: 60000 });
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.load(fs.readFileSync(out));
    const sizes = pdf.getPages().map((pg) => pg.getWidth() > pg.getHeight() ? 'H' : 'V');
    assert.ok(sizes.includes('V') && sizes.includes('H'), 'páginas verticales y horizontales: ' + sizes.join(''));
    assert.ok(sizes.lastIndexOf('V') < sizes.indexOf('H'), 'los mapas van al final: ' + sizes.join(''));
    assert.strictEqual(pdf.getAuthor(), 'Ana López');
    assert.ok((await t.call('project:load', { id: proj })).project.export.bible === true, 'las opciones se recuerdan');
    ok('PDF ampliado: índice + biblia + mapas horizontales en un solo archivo, con sus opciones guardadas');

    // ------------------------------------------------------------ pantallas pequeñas
    await p.setViewportSize({ width: 1024, height: 640 });
    await p.evaluate(() => G.go('editor')); await p.waitForSelector('.ed-content');
    await p.getByRole('tab', { name: /Revisión/ }).click();
    const overflow = await p.evaluate(() => { const b = document.body; const bad = []; for (const sel of ['.ed-toolbar', '.ed-side', '.side-tabs', '.ed-status']) { const e = document.querySelector(sel); if (e && e.scrollWidth > e.clientWidth + 1) bad.push(sel + ' ' + e.scrollWidth + '>' + e.clientWidth); } return bad.concat(b.scrollWidth > innerWidth ? ['body'] : []); });
    assert.deepStrictEqual(overflow, [], 'nada se desborda a 1024×640');
    ok('diseño: sin desbordes a 1024×640 con el panel de revisión abierto');

    assert.deepStrictEqual(t.errors, [], 'errores de consola: ' + t.errors.join('\n'));
    ok('sin errores de consola');
    console.log(`\n${results.length} comprobaciones de las novedades OK`);
  } catch (e) {
    console.log('  ✗ FALLO: ' + (e.stack || e).split('\n').slice(0, 8).join('\n    '));
    console.log('  errores de consola:', t.errors);
    await p.screenshot({ path: '/tmp/novedades-fail.png' });
    process.exitCode = 1;
  } finally { await t.close(); }
})();
