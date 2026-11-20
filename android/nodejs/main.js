'use strict';
// Núcleo de Grafema dentro de Android (nodejs-mobile). Es el MISMO código que usa la versión de Windows:
// recibe mensajes de la interfaz, ejecuta el canal pedido y devuelve el resultado.
const path = require('path');
// En nodejs-mobile el motor corre DENTRO del proceso de la app: un error sin capturar aquí cierra toda la app.
// Por eso nada se deja sin capturar: se registra en logcat y la interfaz recibe el aviso.
const logErr = (donde, e) => { try { console.error('[grafema]', donde, (e && e.stack) || e); } catch (_) { /* noop */ } };
process.on('uncaughtException', (e) => logErr('uncaughtException', e));
process.on('unhandledRejection', (e) => logErr('unhandledRejection', e));
let bridge;
try { bridge = require('bridge'); } catch (_) { bridge = global.__grafemaTestBridge; } // 'bridge' lo aporta el plugin; en pruebas se simula
if (!bridge) { logErr('inicio', new Error('No se encontró el puente con la aplicación.')); return; }
let createCore, loadError = null;
try { ({ createCore } = require('./src/main/app-core')); } catch (_) {
  try { ({ createCore } = require('../../src/main/app-core')); } catch (e) { loadError = e; logErr('no se pudo cargar app-core', e); }
}

const chan = bridge.channel;
const listen = (name, fn) => (typeof chan.addListener === 'function' ? chan.addListener(name, fn) : chan.on(name, fn));
let appDir = null;
try { appDir = bridge.app && typeof bridge.app.datadir === 'function' ? bridge.app.datadir() : null; } catch (_) { /* noop */ }
const base = process.env.GRAFEMA_DATA_DIR || path.join(appDir || process.env.DATADIR || process.cwd(), 'grafema-datos');
let core = null, startError = loadError;
try {
  if (loadError) throw loadError;
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
