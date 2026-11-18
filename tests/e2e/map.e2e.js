'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/home/claude/.npm-global/lib/node_modules'; require('module').Module._initPaths();
const assert = require('assert');
const { launch, register } = require('./harness');
const ok = (n) => console.log('  ✓ ' + n);
(async () => {
  console.log('\n▶ mapa de ideas (Chromium real)');
  const t = await launch({ width: 1280, height: 800 }); const p = t.page;
  try {
    await p.waitForSelector('.auth-card'); await register(t); await p.waitForSelector('.home');
    await p.getByRole('button', { name: 'Crear mi primer proyecto' }).click(); await p.getByLabel('Nombre del proyecto').fill('Novela'); await p.getByRole('button', { name: 'Crear proyecto' }).click();
    await p.waitForSelector('.ed-content');
    const pid = await p.evaluate(() => G.state.project.id);
    // biblia con 4 perfiles y una relación
    const seed = await p.evaluate(() => {
      const d = G.bibleDefaults(); const pers = d.types.find((x) => x.name === 'Personaje'), city = d.types.find((x) => x.name === 'Ciudad');
      const rel = pers.fields.find((f) => f.kind === 'relation');
      const mk = (type, name) => ({ id: G.uid(), typeId: type.id, name, values: {}, created: new Date().toISOString(), updated: new Date().toISOString() });
      const a = mk(pers, 'Marta'), b = mk(pers, 'Julián'), c = mk(city, 'Puerto Viejo'), e = mk(pers, 'Elena');
      a.values[rel.id] = [b.id]; d.profiles = [a, b, c, e]; return d;
    });
    await t.call('bible:write', { projectId: pid, data: seed });
    await p.locator('[data-nav=map]').click(); await p.waitForSelector('.mm-canvas');
    assert.ok(await p.locator('.mm-empty').isVisible()); ok('mapa vacío muestra la guía de uso');
    await p.getByRole('button', { name: 'Agregar todos los perfiles de la biblia' }).click();
    await p.waitForFunction(() => document.querySelectorAll('.mm-node').length === 4);
    assert.strictEqual(await p.locator('.mm-edge.auto').count(), 1); ok('«Todos» agrega 4 perfiles y la relación de la biblia dibuja una conexión automática');
    // sin solapes tras ordenar
    const boxes = await p.$$eval('.mm-node', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], 'nodos solapados'); }
    ok('el orden automático no deja nodos encimados');
    // nota
    await p.getByRole('button', { name: 'Agregar una nota en el centro' }).click();
    await p.waitForFunction(() => document.querySelectorAll('.mm-node').length === 5);
    await p.locator('input[data-f=title]').fill('¿Quién tenía la llave?');
    assert.ok(await p.locator('.mm-node', { hasText: '¿Quién tenía la llave?' }).isVisible()); ok('crear una nota y editar su título');
    // arrastrar nodo
    const node = p.locator('.mm-node', { hasText: 'Elena' }); const b0 = await node.boundingBox();
    await p.mouse.move(b0.x + 60, b0.y + 28); await p.mouse.down(); await p.mouse.move(b0.x + 160, b0.y + 120, { steps: 6 }); await p.mouse.up();
    const b1 = await node.boundingBox(); assert.ok(Math.abs(b1.x - b0.x - 100) < 3 && Math.abs(b1.y - b0.y - 92) < 3, JSON.stringify([b0, b1])); ok('arrastrar un nodo lo mueve exactamente lo arrastrado');
    // conectar arrastrando desde el punto
    const src = p.locator('.mm-node', { hasText: 'Elena' }), dst = p.locator('.mm-node', { hasText: 'Puerto Viejo' });
    const sb = await src.boundingBox(); await p.mouse.move(sb.x + 60, sb.y + 28);
    const hb = await src.locator('.mm-h.l').boundingBox();
    const db = await dst.boundingBox();
    await p.mouse.move(hb.x + 6, hb.y + 6); await p.mouse.down(); await p.mouse.move(db.x + 60, db.y + 28, { steps: 8 }); await p.mouse.up();
    await p.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f === 'elabel');
    await p.keyboard.type('vive en'); await p.keyboard.press('Enter');
    assert.ok(await p.locator('.mm-elabel', { hasText: 'vive en' }).isVisible()); ok('conectar dos nodos arrastrando y poner etiqueta');
    // deshacer / rehacer
    const nEdges = () => p.evaluate(() => document.querySelectorAll('.mm-edge').length);
    assert.strictEqual(await nEdges(), 2);
    await p.locator('.mm-canvas').focus(); await p.keyboard.press('Control+Z'); await p.keyboard.press('Control+Z');
    assert.ok((await nEdges()) < 2); await p.keyboard.press('Control+Y'); await p.keyboard.press('Control+Y'); assert.strictEqual(await nEdges(), 2); ok('deshacer y rehacer (Ctrl+Z / Ctrl+Y)');
    // zoom
    const k0 = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.mm-world')).transform.split('(')[1])); 
    await p.mouse.move(640, 400); await p.mouse.wheel(0, -300); await p.waitForTimeout(100);
    const k1 = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.mm-world')).transform.split('(')[1])); assert.ok(k1 > k0); ok('la rueda del ratón hace zoom');
    // conexión manual desde el inspector
    await p.locator('.mm-node', { hasText: 'Julián' }).click();
    await p.getByLabel('Conectar con', { exact: true }).selectOption({ label: 'Elena' });
    await p.getByLabel('Etiqueta de la nueva conexión').fill('hermano de'); await p.getByRole('button', { name: 'Conectar', exact: true }).click();
    assert.ok(await p.locator('.mm-elabel', { hasText: 'hermano de' }).isVisible()); ok('conectar desde el panel de detalles (sin arrastrar)');
    // eliminar con teclado
    await p.locator('.mm-node', { hasText: 'Julián' }).click(); await p.locator('.mm-canvas').focus(); await p.keyboard.press('Delete');
    await p.waitForFunction(() => document.querySelectorAll('.mm-node').length === 4);
    assert.ok(!(await p.locator('.mm-elabel', { hasText: 'hermano de' }).count())); ok('Supr elimina el nodo y sus conexiones');
    // persistencia
    assert.strictEqual(await p.evaluate(() => G.flushAll()), true);
    await p.reload(); await p.waitForSelector('.home'); await p.locator('.proj-card').first().click(); await p.waitForSelector('.ed-content');
    await p.locator('[data-nav=map]').click(); await p.waitForSelector('.mm-node');
    assert.strictEqual(await p.locator('.mm-node').count(), 4); assert.ok(await p.locator('.mm-elabel', { hasText: 'vive en' }).isVisible()); ok('el mapa persiste tras recargar');
    // perfil eliminado en la biblia se limpia del mapa
    const bible = (await t.call('bible:read', { projectId: pid })).data; bible.profiles = bible.profiles.filter((x) => x.name !== 'Marta'); await t.call('bible:write', { projectId: pid, data: bible });
    await p.locator('[data-nav=bible]').click(); await p.waitForSelector('.bb'); await p.locator('[data-nav=map]').click(); await p.waitForSelector('.mm-canvas');
    assert.ok(!(await p.locator('.mm-node', { hasText: 'Marta' }).count())); ok('un perfil borrado en la biblia desaparece del mapa');
    // abrir desde la biblia
    await p.locator('[data-nav=bible]').click(); await p.waitForSelector('.bb'); await p.locator('.bb-item', { hasText: 'Puerto Viejo' }).click(); await p.getByRole('button', { name: 'Ver en el mapa' }).click();
    await p.waitForSelector('.mm-node.sel'); assert.ok(await p.locator('.mm-node.sel', { hasText: 'Puerto Viejo' }).isVisible()); ok('«Ver en el mapa» abre el mapa con el perfil seleccionado');
    await p.screenshot({ path: '/tmp/s-map.png' });
    assert.deepStrictEqual(t.errors, [], t.errors.join('\n')); ok('sin errores de consola');
  } catch (e) { console.log('  ✗ FALLO: ' + (e.stack || e).split('\n').slice(0, 6).join('\n    ')); console.log(t.errors); await p.screenshot({ path: '/tmp/map-fail.png' }); process.exitCode = 1; }
  finally { await t.close(); }
})();
