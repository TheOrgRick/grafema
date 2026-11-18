'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/home/claude/.npm-global/lib/node_modules'; require('module').Module._initPaths();
const assert = require('assert'); const path = require('path'); const fs = require('fs');
const { launch, register } = require('./harness');
const ok = (n) => console.log('  ✓ ' + n);
(async () => {
  console.log('\n▶ biblia (Chromium real)');
  const t = await launch({ width: 1280, height: 800 }); const p = t.page;
  try {
    await p.waitForSelector('.auth-card'); await register(t);
    await p.waitForSelector('.home'); 
    await p.getByRole('button', { name: 'Crear mi primer proyecto' }).click(); await p.getByLabel('Nombre del proyecto').fill('Novela'); await p.getByRole('button', { name: 'Crear proyecto' }).click();
    await p.waitForSelector('.ed-content');
    await p.locator('[data-nav=bible]').click(); await p.waitForSelector('.bb');
    assert.ok((await p.locator('.bb-type').count()) >= 11); ok('la biblia se crea con 11 plantillas (personaje, objeto, ciudad, lugar, sistema, pista…)');
    await p.locator('.bb-type', { hasText: 'Personaje' }).click();
    await p.getByRole('button', { name: /Nuevo personaje/ }).click();
    await p.getByLabel('Nombre del perfil').fill('Marta Ríos');
    await p.getByLabel('Alias o apodo').fill('La Zorra');
    await p.getByLabel('Edad').fill('34');
    await p.getByLabel('Rol en la historia').selectOption('Protagonista');
    await p.getByLabel('Personalidad').fill('Astuta y reservada.');
    await p.getByLabel('Etiquetas').fill('detective'); await p.keyboard.press('Enter');
    ok('crear perfil de personaje y llenar campos de distintos tipos');
    await p.getByRole('button', { name: /Nuevo personaje/ }).click();
    await p.getByLabel('Nombre del perfil').fill('Julián Soto');
    await p.locator('.bb-type', { hasText: 'Ciudad' }).click();
    await p.getByRole('button', { name: /Nuevo ciudad/ }).click();
    await p.getByLabel('Nombre del perfil').fill('Puerto Viejo');
    await p.getByLabel('Habitantes notables').first().isVisible().catch(() => {});
    await p.locator('.bb-field', { hasText: 'Habitantes notables' }).getByRole('button', { name: 'Vincular perfil' }).click();
    await p.locator('.pick-list .menu-item', { hasText: 'Marta Ríos' }).click();
    assert.ok(await p.locator('.bb-field', { hasText: 'Habitantes notables' }).locator('.link-chip', { hasText: 'Marta Ríos' }).isVisible());
    ok('vincular perfiles (ciudad → personaje)');
    // imagen
    const png = path.join(t.dir, 'x.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    await p.locator('.bb-field', { hasText: 'Imagen' }).locator('input[type=file]').setInputFiles(png);
    await p.waitForSelector('.img-prev:not(.none)');
    ok('subir una imagen al perfil');
    // buscar
    await p.locator('.bb-type', { hasText: 'Todos' }).click(); await p.getByLabel('Buscar perfiles').fill('astuta');
    assert.strictEqual(await p.locator('.bb-item').count(), 1); ok('la búsqueda encuentra texto dentro de los campos');
    await p.getByLabel('Buscar perfiles').fill('');
    // plantilla
    await p.locator('.bb-type', { hasText: 'Personaje' }).click();
    await p.getByRole('button', { name: 'Editar la plantilla de este tipo' }).click();
    await p.getByRole('button', { name: 'Agregar campo' }).click();
    await p.locator('.tpl-row').last().getByLabel(/Nombre del campo/).fill('Tipo de sangre');
    await p.getByRole('button', { name: 'Guardar', exact: true }).click();
    await p.locator('.bb-item', { hasText: 'Marta Ríos' }).click();
    assert.ok(await p.getByLabel('Tipo de sangre').isVisible()); ok('agregar un campo nuevo a la plantilla de Personaje');
    // nuevo tipo
    await p.getByRole('button', { name: 'Nuevo tipo de perfil' }).click();
    await p.getByLabel('Nombre del tipo').fill('Criatura');
    await p.getByRole('button', { name: 'Guardar', exact: true }).click();
    assert.ok(await p.locator('.bb-type', { hasText: 'Criatura' }).isVisible()); ok('crear un tipo de perfil propio');
    await p.getByRole('button', { name: 'Nuevo tipo de perfil' }).click();
    await p.getByRole('button', { name: 'Guardar', exact: true }).click();
    assert.ok(await p.locator('.field.invalid, .err:not(:empty)').first().isVisible()); await p.keyboard.press('Escape'); ok('un tipo sin nombre se rechaza con mensaje');
    // persistencia
    assert.strictEqual(await p.evaluate(() => G.flushAll()), true);
    const pid = await p.evaluate(() => G.state.project.id);
    const saved = (await t.call('bible:read', { projectId: pid })).data;
    const marta = saved.profiles.find((x) => x.name === 'Marta Ríos'); assert.ok(marta); assert.ok(Object.values(marta.values).includes('34') || Object.values(marta.values).includes(34));
    assert.ok(saved.profiles.find((x) => x.name === 'Puerto Viejo')); ok('todo queda guardado en bible.json');
    // eliminar perfil: limpia vínculos
    await p.locator('.bb-type', { hasText: 'Todos' }).click();
    await p.locator('.bb-item', { hasText: 'Marta Ríos' }).click();
    await p.getByRole('button', { name: 'Más acciones' }).click(); await p.getByRole('menuitem', { name: 'Eliminar perfil' }).click();
    await p.getByRole('button', { name: 'Eliminar perfil' }).click();
    await p.waitForFunction(() => !document.body.innerText.includes('Marta Ríos'));
    await p.evaluate(() => G.flushAll());
    const after = (await t.call('bible:read', { projectId: pid })).data;
    assert.ok(after.profiles.every((x) => Object.values(x.values).every((v) => !(Array.isArray(v) && v.includes(marta.id))))); ok('eliminar un perfil quita sus vínculos en otros perfiles');
    await p.screenshot({ path: '/tmp/s-bible.png' });
    assert.deepStrictEqual(t.errors, [], t.errors.join('\n')); ok('sin errores de consola');
  } catch (e) { console.log('  ✗ FALLO: ' + (e.stack || e).split('\n').slice(0, 6).join('\n    ')); console.log(t.errors); await p.screenshot({ path: '/tmp/bible-fail.png' }); process.exitCode = 1; }
  finally { await t.close(); }
})();
