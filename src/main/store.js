'use strict';
// Almacenamiento local con escritura atómica (archivo temporal + renombrado) y copia .bak.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[a-f0-9]{16}$/;
const isId = (x) => typeof x === 'string' && ID_RE.test(x);
const newId = () => crypto.randomBytes(8).toString('hex');
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

function sleep(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { /* noop */ }
}

function writeAtomic(file, data, opts) {
  opts = opts || {};
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    try { fs.fsyncSync(fd); } catch (_) { /* algunos sistemas no lo permiten */ }
  } finally { fs.closeSync(fd); }
  try {
    if (opts.backup && fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak'); } catch (_) { /* no crítico */ } }
    let lastErr;
    for (let i = 0; i < 8; i++) {
      try { fs.renameSync(tmp, file); return; } catch (e) {
        lastErr = e;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break;
        sleep(25 * (i + 1)); // antivirus / indexador de Windows bloqueando brevemente
      }
    }
    throw lastErr;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* noop */ }
    throw e;
  }
}

function tryParse(file) {
  try { return { value: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }; } catch (_) { return null; }
}

// Lee JSON; si está dañado usa la copia .bak; si tampoco, aparta el archivo dañado (no lo pierde).
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return { value: fallback, recovered: false, missing: true };
  const main = tryParse(file);
  if (main) return { value: main.value, recovered: false };
  const bak = tryParse(file + '.bak');
  if (bak) return { value: bak.value, recovered: true };
  try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch (_) { /* noop */ }
  return { value: fallback, recovered: false, corrupt: true };
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }

module.exports = { isId, newId, ensureDir, writeAtomic, readJson, rmrf };
