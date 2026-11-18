'use strict';
process.env.NODE_PATH = process.env.NODE_PATH || '/home/claude/.npm-global/lib/node_modules'; require('module').Module._initPaths();
const assert = require('assert');
const { launch, register } = require('./harness');
const SIZES = [[1920, 1080], [1280, 800], [1024, 700], [800, 600], [640, 480]];
const VIEWS = ['home', 'editor', 'bible', 'map', 'export', 'settings'];
(async () => {
  console.log('\n▶ tamaños configurables (ancho × alto en px)');
  const t = await launch({ width: 1280, height: 800 }); const p = t.page; let bad = 0;
  try {
    await p.waitForSelector('.auth-card');
    // pantalla de acceso en todos los tamaños
    for (const [w, h] of SIZES) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(80);
      const r = await p.evaluate(() => { const rt = document.getElementById('app-root'); return { w: rt.offsetWidth, h: rt.offsetHeight, ov: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1, card: !!document.querySelector('.auth-card') && document.querySelector('.auth-card').getBoundingClientRect().width > 200 }; });
      if (r.w !== w || r.h !== h || r.ov || !r.card) { bad++; console.log('  ✗ acceso', w, h, JSON.stringify(r)); }
    }
    console.log('  ✓ pantalla de acceso se adapta de 640×480 a 1920×1080');
    await p.setViewportSize({ width: 1280, height: 800 });
    await register(t); await p.waitForSelector('.home');
    await p.getByRole('button', { name: 'Crear mi primer proyecto' }).click(); await p.getByLabel('Nombre del proyecto').fill('La noche larga con un título bastante largo para probar el recorte'); await p.getByRole('button', { name: 'Crear proyecto' }).click(); await p.waitForSelector('.ed-content');
    const pid = await p.evaluate(() => G.state.project.id);
    const seed = await p.evaluate(() => { const d = G.bibleDefaults(); const t0 = d.types[0]; for (let i = 0; i < 12; i++) d.profiles.push({ id: G.uid(), typeId: d.types[i % 5].id, name: 'Perfil de prueba número ' + (i + 1), values: {}, created: new Date().toISOString(), updated: new Date().toISOString() }); return d; });
    await t.call('bible:write', { projectId: pid, data: seed });
    await p.evaluate(() => { document.querySelector('.ed-content').innerHTML = '<h1>Capítulo</h1>' + '<p>Texto de prueba muy largo para ocupar varias líneas dentro de la página y comprobar los desplazamientos.</p>'.repeat(30); });
    await p.evaluate(() => G.flushAll());
    for (const [w, h] of SIZES) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(150);
      for (const v of VIEWS) {
        await p.evaluate((v) => G.go(v), v); await p.waitForTimeout(250);
        if (v === 'map') { await p.getByRole('button', { name: 'Agregar todos los perfiles de la biblia' }).click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(300); }
        const r = await p.evaluate(() => {
          const rt = document.getElementById('app-root'), view = document.getElementById('view');
          const vb = view.getBoundingClientRect();
          // elementos de interfaz (no el papel/lienzo con scroll propio) que se salen del área visible
          const clipped = [...view.querySelectorAll('button,input,select,.btn,.seg')].filter((e) => { if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; if (e.closest('.ed-scroll,.mm-canvas,.mm-world,.scroll,.pop,[hidden],.mm-insp.empty-insp,.tb-font-list')) return false; const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > vb.right + 1 || b.left < vb.left - 1 || b.bottom > vb.bottom + 1); }).map((e) => (e.getAttribute('aria-label') || e.textContent || e.className).trim().slice(0, 30));
          return { w: rt.offsetWidth, h: rt.offsetHeight, docOv: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1, clipped };
        });
        if (r.w !== w || r.h !== h || r.docOv || r.clipped.length) { bad++; console.log('  ✗', w + '×' + h, v, JSON.stringify(r)); }
        if (w === 800 && h === 600) await p.screenshot({ path: `/tmp/sz-${v}-800.png` });
        if (w === 640 && h === 480 && (v === 'editor' || v === 'home')) await p.screenshot({ path: `/tmp/sz-${v}-640.png` });
      }
    }
    if (!bad) console.log('  ✓ 6 secciones × 5 tamaños (640×480 a 1920×1080): sin desbordes de la ventana ni controles cortados');
    assert.deepStrictEqual(t.errors, [], t.errors.join('\n'));
    console.log('  ✓ sin errores de consola');
    if (bad) process.exitCode = 1;
  } catch (e) { console.log('  ✗ FALLO: ' + (e.stack || e).split('\n').slice(0, 6).join('\n    ')); process.exitCode = 1; }
  finally { await t.close(); }
})();
