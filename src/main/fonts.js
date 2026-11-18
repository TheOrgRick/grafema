'use strict';
// Lista las fuentes instaladas en el equipo (Windows: GDI+ + registro; Linux: fontconfig para pruebas).
const { execFile } = require('child_process');

const FALLBACK = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Garamond', 'Georgia', 'Palatino Linotype', 'Segoe UI', 'Times New Roman', 'Verdana'];
let cache = null;

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeout || 20000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => resolve(err ? '' : String(stdout || '')));
    } catch (_) { resolve(''); }
  });
}

const STYLE_WORDS = /\s+(Bold|Italic|Regular|Light|Semilight|Semibold|Medium|Black|Thin|Oblique|Condensed|ExtraBold|ExtraLight|Heavy|Demi|Narrow)$/i;
function cleanRegistryName(raw) {
  let n = raw.replace(/\s*\((TrueType|OpenType|Type 1|All res)\)\s*$/i, '').trim();
  const out = [];
  for (let part of n.split(/\s+&\s+/)) {
    for (let i = 0; i < 4; i++) part = part.replace(STYLE_WORDS, '');
    if (part) out.push(part.trim());
  }
  return out;
}

async function windowsFonts() {
  const ps = "$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;Add-Type -AssemblyName System.Drawing;(New-Object System.Drawing.Text.InstalledFontCollection).Families|ForEach-Object{$_.Name}";
  const [a, b] = await Promise.all([
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]),
    run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']),
  ]);
  const names = a.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of b.split(/\r?\n/)) {
    const m = line.match(/^\s+(.+?)\s+REG_SZ\s+/);
    if (m) names.push(...cleanRegistryName(m[1]));
  }
  return names;
}
async function linuxFonts() {
  const out = await run('fc-list', [':', 'family']);
  return out.split(/\r?\n/).map((l) => l.split(',')[0].trim()).filter(Boolean);
}

async function listFonts(force) {
  if (cache && !force) return cache;
  let names = [];
  try {
    if (process.platform === 'win32') names = await windowsFonts();
    else if (process.platform === 'linux') names = await linuxFonts();
  } catch (_) { names = []; }
  const seen = new Map();
  for (const n of names) {
    const name = String(n).trim();
    if (!name || name.startsWith('@') || name.length > 80 || /[\u0000-\u001F]/.test(name)) continue;
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  let list = [...seen.values()].sort((x, y) => x.localeCompare(y, 'es', { sensitivity: 'base' }));
  if (list.length < 3) list = FALLBACK.slice();
  cache = list;
  return list;
}

module.exports = { listFonts, cleanRegistryName, FALLBACK };
