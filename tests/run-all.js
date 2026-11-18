'use strict';
// Ejecuta las pruebas automáticas (sin dependencias). Uso: node tests/run-all.js
const files = ['./docx.test.js', './core.test.js', './proyecto-archivo.test.js', './android.test.js', './novedades.test.js', './ipc.test.js', './main.test.js'];
(async () => {
  let failed = 0, passed = 0;
  for (const f of files) {
    try { const r = await require(f)(); passed = r.passed; failed = r.failed; } catch (e) { console.log('  ✗ ' + f + ': ' + e.message); failed++; }
  }
  console.log(`\n${failed ? '✗' : '✓'} ${passed} pruebas correctas, ${failed} con fallos`);
  process.exit(failed ? 1 : 0);
})();
