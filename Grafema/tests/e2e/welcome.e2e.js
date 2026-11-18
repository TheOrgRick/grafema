'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/home/claude/.npm-global/lib/node_modules'; require('module').Module._initPaths();
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const { launch, register } = require('./harness');
const ok = (n) => console.log('  ✓ ' + n);
(async () => {
  console.log('\n▶ bienvenida (solo autor), ajustes y exportación (Chromium real)');
  const t = await launch({ width: 1280, height: 800 }); const p = t.page;
  const expectErr = (re) => p.waitForFunction(([s, f]) => new RegExp(s, f).test([...document.querySelectorAll('.err')].map((e) => e.textContent).join(' ')), [re.source, re.flags], { timeout: 5000 });
  try {
    await p.waitForSelector('.auth-card');
    assert.ok(!(await p.getByLabel('Contraseña').count()) && !(await p.getByLabel('Correo electrónico').count()), 'no debe haber campos de cuenta'); ok('la primera pantalla no tiene correo, contraseña ni cuentas');
    await p.getByRole('button', { name: 'Empezar a escribir' }).click(); await expectErr(/Escribe el nombre del autor/); ok('nombre vacío: mensaje claro y no avanza');
    assert.strictEqual(t.core.getConfig().author, ''); ok('un intento vacío no guarda nada');
    await p.getByLabel('Nombre del autor').fill('  Ana   López '); await p.getByLabel('Nombre del autor').press('Enter');
    await p.waitForSelector('.home'); assert.ok((await p.locator('.hero-text').innerText()).includes('Hola, Ana.')); ok('Enter envía el formulario y lleva a Inicio con el saludo');
    assert.strictEqual(t.core.getConfig().author, 'Ana López'); ok('el nombre se guarda limpio («Ana López»)');
    await p.reload(); await p.waitForSelector('.home'); ok('al reiniciar entra directo a Inicio (no vuelve a pedir nada)');
    assert.strictEqual(await p.locator('[data-nav=account]').count(), 0); ok('ya no existe la sección «Cuenta»');

    // proyecto hereda el autor
    await p.getByRole('button', { name: 'Crear mi primer proyecto' }).click();
    assert.strictEqual(await p.getByLabel('Autor (aparece en el PDF)').inputValue(), 'Ana López'); ok('el diálogo de proyecto propone el autor');
    await p.getByLabel('Nombre del proyecto').fill('Mi libro'); await p.getByRole('button', { name: 'Crear proyecto' }).click(); await p.waitForSelector('.ed-content');

    // cambiar autor en Ajustes
    await p.locator('[data-nav=settings]').click(); await p.waitForSelector('.st');
    await p.getByLabel('Nombre del autor').fill(''); await p.getByRole('button', { name: 'Guardar autor' }).click(); await expectErr(/Escribe el nombre/); ok('Ajustes: autor vacío se rechaza');
    await p.getByLabel('Nombre del autor').fill('Ana M. López'); await p.getByRole('button', { name: 'Guardar autor' }).click(); await p.waitForFunction(() => /Autor actualizado/.test(document.body.innerText));
    assert.strictEqual(t.core.getConfig().author, 'Ana M. López'); ok('cambiar el autor en Ajustes');

    // tema y tamaño
    await p.getByRole('radio', { name: 'Claro' }).first().click(); assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.theme), 'light'); ok('tema claro');
    await p.getByRole('radio', { name: 'Oscuro' }).first().click(); assert.strictEqual(await p.evaluate(() => document.documentElement.dataset.theme), 'dark'); ok('tema oscuro');
    assert.strictEqual(await p.getByRole('radio', { name: 'Mica' }).isDisabled(), true); ok('Mica se desactiva donde no hay Windows 11');
    await p.getByLabel('Ancho en píxeles').fill('900'); await p.getByLabel('Alto en píxeles').fill('620'); await p.getByRole('button', { name: 'Aplicar tamaño' }).click();
    await p.waitForFunction(() => document.getElementById('app-root').style.getPropertyValue('--app-w') === '900px');
    assert.strictEqual(await p.evaluate(() => document.getElementById('app-root').style.getPropertyValue('--app-h')), '620px'); ok('tamaño configurable 900 × 620 px aplicado al contenedor principal');
    await p.getByLabel('Ancho en píxeles').fill('100'); await p.getByRole('button', { name: 'Aplicar tamaño' }).click(); await expectErr(/entre 640 y 7680/); ok('un ancho fuera de rango se rechaza');
    await p.getByLabel('Ancho en píxeles').fill('1280'); await p.getByLabel('Alto en píxeles').fill('800'); await p.getByRole('button', { name: 'Aplicar tamaño' }).click();

    // exportación con el autor
    await p.locator('[data-nav=editor]').click(); await p.waitForSelector('.ed-content');
    await p.locator('.ed-content').click(); await p.keyboard.type('Texto del capítulo para exportar.'); await p.evaluate(() => G.flushAll());
    await p.locator('[data-nav=export]').click(); await p.waitForSelector('.gx-sheet .gx-cover');
    assert.ok((await p.locator('.gx-sheet').innerText()).includes('Texto del capítulo para exportar.')); ok('vista previa con portada y texto');
    const out = path.join(t.dir, 'salida.pdf'); t.state.saveResult = out;
    await p.getByLabel('Autor', { exact: true }).fill('Ana M. López');
    await p.getByRole('button', { name: 'Exportar a PDF' }).click(); await p.waitForFunction(() => /PDF guardado/.test(document.body.innerText), null, { timeout: 20000 });
    const { PDFDocument } = require('pdf-lib'); const pdf = await PDFDocument.load(fs.readFileSync(out));
    assert.strictEqual(pdf.getAuthor(), 'Ana M. López'); assert.strictEqual(pdf.getTitle(), 'Mi libro'); ok('PDF exportado con el autor y el título en sus propiedades');
    const dout = path.join(t.dir, 'libro.docx'); t.state.saveResult = dout; await p.getByRole('button', { name: 'Manuscrito en .docx' }).click(); await p.waitForFunction(() => /Manuscrito guardado/.test(document.body.innerText), null, { timeout: 20000 });
    assert.ok(fs.existsSync(dout)); ok('manuscrito exportado a .docx');
    await p.getByRole('button', { name: 'Ninguno' }).click(); await p.getByRole('button', { name: 'Exportar a PDF' }).click(); await p.waitForSelector('.toast.err'); ok('exportar sin capítulos seleccionados avisa');
    assert.deepStrictEqual(t.errors.filter((e) => !/Failed to load resource/.test(e)), [], t.errors.join('\n')); ok('sin errores de consola');
  } catch (e) { console.log('  ✗ FALLO: ' + (e.stack || e).split('\n').slice(0, 7).join('\n    ')); console.log(t.errors); await p.screenshot({ path: '/tmp/welcome-fail.png' }); process.exitCode = 1; }
  finally { await t.close(); }
})();
