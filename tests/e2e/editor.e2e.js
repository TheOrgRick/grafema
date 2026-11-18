'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/home/claude/.npm-global/lib/node_modules'; require('module').Module._initPaths();
const assert = require('assert');
const { launch, register } = require('./harness');
const results = []; const ok = (n) => { results.push(n); console.log('  ✓ ' + n); };

(async () => {
  console.log('\n▶ editor (Chromium real)');
  const t = await launch({ width: 1280, height: 800 });
  const p = t.page;
  const model = () => p.evaluate(() => DocModel.domToModel(document.querySelector('.ed-content'), G.state.project.defaults));
  const flush = () => p.evaluate(() => G.flushAll());
  const html = () => p.evaluate(() => document.querySelector('.ed-content').innerHTML);
  const selectAll = async () => { await p.locator('.ed-content').click(); await p.keyboard.press('Control+A'); };
  const btn = (name) => p.getByRole('button', { name, exact: true });
  try {
    await p.waitForSelector('.auth-card');
    await register(t);
    await p.waitForSelector('.home');
    await p.getByRole('button', { name: 'Crear mi primer proyecto' }).click();
    await p.getByLabel('Nombre del proyecto').fill('La noche larga');
    await p.getByRole('button', { name: 'Crear proyecto' }).click();
    await p.waitForSelector('.ed-content');
    ok('crear proyecto abre el editor');

    // --- escribir y autoguardar
    await p.locator('.ed-content').click();
    await p.keyboard.type('Era una noche oscura');
    await p.keyboard.press('Enter');
    await p.keyboard.type('Segundo párrafo con ñandú');
    assert.strictEqual(await flush(), true);
    let r = await t.call('chapter:read', { projectId: await p.evaluate(() => G.state.project.id), chapterId: await p.evaluate(() => G.state.project.chapters[0].id) });
    assert.strictEqual(require('../../src/shared/docmodel').plainText(r.model), 'Era una noche oscura\nSegundo párrafo con ñandú');
    ok('escribir + Enter crea párrafos y se guarda en .docx');

    // --- negrita
    await selectAll(); await btn('Negrita').click();
    let m = await model(); assert.ok(m.blocks.every((b) => b.runs.every((x) => x.b)), JSON.stringify(m.blocks));
    await btn('Negrita').click(); m = await model(); assert.ok(m.blocks.every((b) => b.runs.every((x) => !x.b)));
    ok('negrita se aplica y se quita');

    // --- tamaño
    await p.locator('.tb-size').fill('20'); await p.keyboard.press('Enter');
    m = await model(); assert.ok(m.blocks.every((b) => b.runs.every((x) => x.size === 20)), JSON.stringify(m.blocks) + ' HTML=' + await html());
    ok('tamaño 20 pt en todo el texto');
    // tamaño sobre selección parcial con tamaños anidados distintos
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<p>aaa <span style="font-size:30pt">bbb</span> ccc <span style="font-size:8pt">ddd</span></p>'; });
    await selectAll(); await p.locator('.tb-size').fill('16'); await p.keyboard.press('Enter');
    m = await model(); assert.deepStrictEqual(m.blocks[0].runs.map((x) => x.size), [16], JSON.stringify(m.blocks[0].runs));
    ok('cambiar tamaño sobre texto con tamaños mezclados los unifica');
    await p.getByLabel('Aumentar tamaño').click(); m = await model(); assert.strictEqual(m.blocks[0].runs[0].size, 17);
    ok('botón + aumenta el tamaño');

    // --- fuente
    await p.getByLabel('Fuente', { exact: true }).click();
    await p.locator('.font-item', { hasText: 'Georgia' }).click();
    m = await model(); assert.strictEqual(m.blocks[0].runs[0].font, 'Georgia', JSON.stringify(m.blocks[0].runs));
    ok('seleccionar fuente instalada la aplica');
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<p>uno <span style="font-family:\'Courier New\'">dos</span> tres</p>'; });
    await selectAll(); await p.getByLabel('Fuente', { exact: true }).click(); await p.locator('.font-item', { hasText: 'DejaVu Serif' }).click();
    m = await model(); assert.deepStrictEqual(m.blocks[0].runs.map((x) => x.font), ['DejaVu Serif'], JSON.stringify(m.blocks[0].runs));
    ok('fuente sobre texto con fuentes mezcladas las unifica');

    // --- color y resaltado
    await p.getByLabel('Color de letra').click(); await p.locator('.swatch[title="#C62828"]').click();
    m = await model(); assert.strictEqual(m.blocks[0].runs[0].color, '#C62828', JSON.stringify(m.blocks[0].runs));
    await p.getByLabel('Resaltar', { exact: true }).click(); await p.locator('.swatch[title="#FFF176"]').click();
    m = await model(); assert.strictEqual(m.blocks[0].runs[0].bg, '#FFF176', JSON.stringify(m.blocks[0].runs));
    await p.getByLabel('Color de letra').click(); await p.getByRole('button', { name: 'Color automático' }).click();
    m = await model(); assert.strictEqual(m.blocks[0].runs[0].color, undefined);
    ok('color de letra, resaltado y color automático');

    // --- alineación, estilo, interlineado, sangría
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<p>Primero</p><p>Segundo</p>'; });
    await selectAll(); await btn('Justificar').click();
    m = await model(); assert.ok(m.blocks.every((b) => b.align === 'justify'), JSON.stringify(m.blocks));
    await btn('Centrar').click(); m = await model(); assert.ok(m.blocks.every((b) => b.align === 'center'));
    await btn('Alinear a la izquierda').click(); m = await model(); assert.ok(m.blocks.every((b) => !b.align));
    ok('justificar / centrar / izquierda en varios párrafos');
    await p.locator('.tb-block').selectOption('h1'); m = await model(); assert.ok(m.blocks.every((b) => b.t === 'h1'), JSON.stringify(m.blocks));
    await p.locator('.tb-block').selectOption('p'); m = await model(); assert.ok(m.blocks.every((b) => b.t === 'p'));
    ok('estilos Título 1 y texto normal');
    await btn('Interlineado').click(); await p.getByRole('menuitem', { name: /^2 \(doble\)/ }).click();
    m = await model(); assert.ok(m.blocks.every((b) => b.lh === 2), JSON.stringify(m.blocks));
    await btn('Sangría de primera línea').click(); m = await model(); assert.ok(m.blocks.every((b) => b.fi === 720), JSON.stringify(m.blocks));
    await btn('Sangría de primera línea').click(); m = await model(); assert.ok(m.blocks.every((b) => !b.fi));
    ok('interlineado doble y sangría de primera línea (activar/desactivar)');

    // --- listas
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<p>a</p><p>b</p><p>c</p>'; });
    await selectAll(); await btn('Lista con viñetas').click();
    m = await model(); assert.deepStrictEqual(m.blocks.map((b) => b.t + ':' + (b.list && b.list.ordered)), ['li:false', 'li:false', 'li:false'], await html());
    await btn('Lista con viñetas').click(); m = await model(); assert.ok(m.blocks.every((b) => b.t === 'p'));
    await btn('Lista numerada').click(); m = await model(); assert.ok(m.blocks.every((b) => b.t === 'li' && b.list.ordered));
    ok('listas con viñetas y numeradas (activar/desactivar)');
    await p.locator('.ed-content li').nth(1).click(); await p.keyboard.press('Tab');
    m = await model(); assert.strictEqual(m.blocks[1].list.level, 1, await html());
    await p.keyboard.press('Shift+Tab'); m = await model(); assert.strictEqual(m.blocks[1].list.level, 0);
    ok('Tab / Mayús+Tab cambian el nivel de lista');

    // --- salto de página
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<p>antes</p><p>después</p>'; });
    await p.locator('.ed-content p').first().click(); await p.keyboard.press('End');
    await btn('Insertar salto de página').click();
    m = await model(); assert.ok(m.blocks.some((b) => b.t === 'pb'), await html());
    assert.strictEqual(require('../../src/shared/docmodel').plainText(m).replace(/\n+/g, '|'), 'antes|después');
    ok('salto de página se inserta y se conserva en el modelo');

    // --- pegado de texto plano multilínea
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<p>inicio fin</p>'; });
    await p.locator('.ed-content p').click(); await p.keyboard.press('Home'); for (let i = 0; i < 7; i++) await p.keyboard.press('ArrowRight');
    await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'uno\ndos\ntres'); document.querySelector('.ed-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    m = await model(); const txt = m.blocks.map((b) => b.runs.map((x) => x.text || '\n').join('')).join('|');
    assert.strictEqual(txt, 'inicio uno|dos|tresfin', txt);
    ok('pegar texto plano de varias líneas en medio de un párrafo');

    // --- deshacer / rehacer
    await p.keyboard.press('Control+Z'); await p.keyboard.press('Control+Z');
    m = await model(); const after = m.blocks.map((b) => b.runs.map((x) => x.text).join('')).join('|');
    assert.notStrictEqual(after, txt);
    ok('Ctrl+Z deshace cambios del editor');

    // --- buscar y reemplazar
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<p>Marta vio a Marta y a Martín. Marta calló.</p>'; });
    await p.locator('.ed-content p').click(); await p.keyboard.press('Control+F');
    await p.getByLabel('Buscar', { exact: true }).fill('Marta'); await p.getByLabel('Reemplazar con').fill('Julia');
    assert.match(await p.locator('.findbar').innerText(), /3 coincidencias/); await p.getByLabel('Coincidencia siguiente').click(); assert.match(await p.locator('.findbar').innerText(), /1 de 3/);
    await p.getByRole('button', { name: 'Reemplazar todo' }).click();
    m = await model(); assert.strictEqual(m.blocks[0].runs.map((x) => x.text).join(''), 'Julia vio a Julia y a Martín. Julia calló.');
    ok('buscar y reemplazar todo (3 coincidencias)');
    await p.getByLabel('Cerrar búsqueda').click();

    // --- capítulos
    await p.getByRole('button', { name: 'Nuevo capítulo' }).click();
    await p.waitForFunction(() => G.state.project.chapters.length === 2);
    await p.waitForTimeout(200);
    assert.strictEqual(await p.locator('.ch-title').inputValue(), 'Capítulo 2');
    await p.locator('.ch-title').fill('El regreso'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => G.state.project.chapters[1].title === 'El regreso');
    await p.locator('.ed-content').click(); await p.keyboard.type('Texto del segundo');
    await p.locator('.ch-main').first().click();
    await p.waitForFunction(() => document.querySelector('.ed-content').innerText.includes('Julia'));
    ok('crear capítulo, renombrarlo, escribir y cambiar entre capítulos conserva el texto');
    await p.locator('.ch-item').nth(1).getByLabel(/Acciones del capítulo/).click();
    await p.getByRole('menuitem', { name: 'Mover arriba' }).click();
    await p.waitForFunction(() => G.state.project.chapters[0].title === 'El regreso');
    ok('mover capítulo arriba');
    await p.locator('.ch-item').nth(0).getByLabel(/Acciones del capítulo/).click();
    await p.getByRole('menuitem', { name: 'Eliminar capítulo' }).click();
    await p.getByRole('button', { name: 'Eliminar capítulo' }).click();
    await p.waitForFunction(() => G.state.project.chapters.length === 1);
    assert.match(await p.locator('.ed-content').innerText(), /Julia/);
    ok('eliminar capítulo y volver al restante');

    // --- recarga completa: persistencia
    await flush();
    await p.reload(); await p.waitForSelector('.home');
    await p.locator('.proj-card').first().click(); await p.waitForSelector('.ed-content');
    assert.match(await p.locator('.ed-content').innerText(), /Julia vio a Julia/);
    ok('tras recargar la aplicación el texto sigue ahí (sesión recordada)');

    // --- zoom y página
    const zoomOf = () => p.evaluate(() => parseFloat(document.querySelector('.paper-wrap').style.zoom)); const z0 = await zoomOf(); assert.ok(z0 < 1, 'el papel debe encajar solo (zoom ' + z0 + ')'); await p.getByLabel('Acercar').click(); assert.ok(Math.abs((await zoomOf()) - z0 - 0.1) < 1e-6);
    await p.getByRole('button', { name: 'Página', exact: true }).click();
    await p.getByLabel('Margen top').fill('4'); await p.getByRole('button', { name: 'Aplicar' }).click();
    await p.waitForFunction(() => G.state.project.page.margins.top === 2268);
    ok('zoom y márgenes de página (4 cm) se aplican y persisten');

    assert.deepStrictEqual(t.errors, [], 'errores de consola: ' + t.errors.join('\n'));
    ok('sin errores de consola');
    console.log(`\n${results.length} comprobaciones del editor OK`);
  } catch (e) {
    console.log('  ✗ FALLO: ' + (e.stack || e).split('\n').slice(0, 6).join('\n    '));
    console.log('  errores de consola:', t.errors);
    await p.screenshot({ path: '/tmp/editor-fail.png' });
    process.exitCode = 1;
  } finally { await t.close(); }
})();
