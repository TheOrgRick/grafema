'use strict';
// Núcleo de Grafema dentro de Android (nodejs-mobile). Es el MISMO código que usa la versión de Windows:
// recibe mensajes de la interfaz, ejecuta el canal pedido y devuelve el resultado.
const path = require('path');
let bridge;
try { bridge = require('bridge'); } catch (_) { bridge = global.__grafemaTestBridge; } // 'bridge' lo aporta el plugin; en pruebas se simula
if (!bridge) throw new Error('No se encontró el puente con la aplicación.');
let createCore;
try { ({ createCore } = require('./src/main/app-core')); } catch (_) { ({ createCore } = require('../../src/main/app-core')); }

const chan = bridge.channel;
const listen = (name, fn) => (typeof chan.addListener === 'function' ? chan.addListener(name, fn) : chan.on(name, fn));
let appDir = null;
try { appDir = bridge.app && typeof bridge.app.datadir === 'function' ? bridge.app.datadir() : null; } catch (_) { /* noop */ }
const base = process.env.GRAFEMA_DATA_DIR || path.join(appDir || process.env.DATADIR || process.cwd(), 'grafema-datos');
let core = null, startError = null;
try {
  core = createCore({
    dataDir: base,
    log: (where, err) => { try { console.error('[grafema]', where, (err && err.stack) || err); } catch (_) { /* noop */ } },
    deps: {
      appVersion: process.env.GRAFEMA_VERSION || '1.2.0',
      platform: 'android',
      printPdf: null, // el PDF de Windows usa Electron; en Android se activa en una fase posterior
      getFonts: async () => ['Roboto', 'Noto Sans', 'Noto Serif', 'Droid Sans Mono', 'sans-serif', 'serif', 'monospace'],
    },
  });
} catch (e) { startError = e; try { console.error('[grafema] no se pudo iniciar el núcleo', (e && e.stack) || e); } catch (_) { /* noop */ } }

listen('grafema', async (msg) => {
  const m = msg && typeof msg === 'object' ? msg : {};
  let result;
  try { if (!core) throw new Error('El núcleo no pudo iniciar: ' + ((startError && startError.message) || 'error desconocido')); result = await core.invoke(String(m.channel || ''), m.payload); } catch (e) { result = { ok: false, code: 'INTERNAL', message: String((e && e.message) || e) }; }
  chan.send('grafema-reply', { id: m.id, result });
});
chan.send('grafema-ready', { dataDir: base, error: startError ? String(startError.message || startError) : undefined });
