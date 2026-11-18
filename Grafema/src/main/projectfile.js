'use strict';
// Formato de archivo de proyecto de Grafema: «.grafema».
//
// Es un paquete ZIP (sin dependencias, el mismo que usan los .docx) con esta estructura:
//   manifest.json         -> identifica el formato, su versión y un resumen del proyecto
//   project.json          -> datos del proyecto (nombre, autor, capítulos, formato de página…)
//   bible.json            -> biblia (tipos y perfiles; las imágenes van dentro como data URI)
//   maps/<id>.json        -> un archivo por mapa de ideas
//   chapters/<id>.docx    -> un .docx por capítulo (se puede abrir con Word si se renombra a .zip)
//
// No contiene rutas ni datos del sistema operativo, así que el mismo archivo sirve en Windows y en Android.
const fs = require('fs');
const path = require('path');
const { createZip, readZip } = require('./zip');
const S = require('./store');
const { AppError } = require('./errors');

const FORMAT = 'grafema-project';
const FORMAT_VERSION = 1;
const EXT = '.grafema';
const MAX_FILE_BYTES = 400 * 1024 * 1024;   // tamaño máximo del archivo .grafema
const MAX_ENTRY_BYTES = 80 * 1024 * 1024;   // máximo de una entrada ya descomprimida
const MAX_TOTAL_BYTES = 600 * 1024 * 1024;  // máximo del proyecto descomprimido
const MAX_ENTRIES = 400;                    // capítulos + mapas + archivos fijos

const RE_FIXED = /^(manifest|project|bible)\.json$/;
const RE_MAP = /^maps\/[a-f0-9]{16}\.json$/;
const RE_CHAPTER = /^chapters\/[a-f0-9]{16}\.docx$/;
const wanted = (name) => RE_FIXED.test(name) || RE_MAP.test(name) || RE_CHAPTER.test(name);

function readIf(file) { try { return fs.readFileSync(file); } catch (_) { return null; } }

// Empaqueta la carpeta de un proyecto en un Buffer .grafema.
function pack(dir, project, appVersion) {
  const entries = [];
  const manifest = {
    format: FORMAT, formatVersion: FORMAT_VERSION, app: 'Grafema', appVersion: appVersion || '',
    exportedAt: new Date().toISOString(),
    project: { id: project.id, name: project.name, author: project.author, genre: project.genre, chapters: project.chapters.length },
  };
  entries.push({ name: 'manifest.json', data: JSON.stringify(manifest, null, 1) });
  entries.push({ name: 'project.json', data: JSON.stringify(project, null, 1) });
  const bible = readIf(path.join(dir, 'bible.json'));
  if (bible) entries.push({ name: 'bible.json', data: bible });
  const mdir = path.join(dir, 'maps');
  if (fs.existsSync(mdir)) {
    for (const f of fs.readdirSync(mdir).sort()) {
      if (!/\.json$/.test(f) || !S.isId(f.slice(0, -5))) continue;
      const b = readIf(path.join(mdir, f));
      if (b) entries.push({ name: 'maps/' + f, data: b });
    }
  }
  for (const c of project.chapters) {
    const b = readIf(path.join(dir, 'chapters', c.id + '.docx'));
    if (b) entries.push({ name: 'chapters/' + c.id + '.docx', data: b });
  }
  return createZip(entries);
}

function parseJson(buf, what) {
  try { return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch (_) {
    throw new AppError('FILE_BROKEN', `El archivo está dañado: no se pudo leer ${what}.`);
  }
}

// Lee y valida un .grafema. No toca el disco. Devuelve { manifest, project, bible, maps: Map, chapters: Map, warnings }.
function unpack(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new AppError('FILE_INVALID', 'Este archivo no es un proyecto de Grafema.');
  if (buf.length > MAX_FILE_BYTES) throw new AppError('FILE_TOO_BIG', 'El archivo es demasiado grande (máximo 400 MB).');
  let files;
  try { files = readZip(buf, wanted, { maxEntry: MAX_ENTRY_BYTES, maxTotal: MAX_TOTAL_BYTES, maxCount: MAX_ENTRIES }); } catch (e) {
    if (e && e.message === 'ZIP_TOO_BIG') throw new AppError('FILE_TOO_BIG', 'El proyecto es demasiado grande o el archivo no es válido.');
    throw new AppError('FILE_INVALID', 'Este archivo no es un proyecto de Grafema o está dañado.');
  }
  if (!files.has('manifest.json')) throw new AppError('FILE_INVALID', 'Este archivo no es un proyecto de Grafema (falta el manifiesto).');
  const manifest = parseJson(files.get('manifest.json'), 'el manifiesto');
  if (!manifest || manifest.format !== FORMAT) throw new AppError('FILE_INVALID', 'Este archivo no es un proyecto de Grafema.');
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > FORMAT_VERSION) {
    throw new AppError('FILE_NEWER', 'Este proyecto se guardó con una versión más nueva de Grafema. Actualiza la aplicación para abrirlo.');
  }
  if (!files.has('project.json')) throw new AppError('FILE_INVALID', 'El archivo no contiene los datos del proyecto.');
  const project = parseJson(files.get('project.json'), 'los datos del proyecto');
  if (!project || typeof project !== 'object' || !Array.isArray(project.chapters)) throw new AppError('FILE_BROKEN', 'Los datos del proyecto no son válidos.');
  const warnings = [];
  const bible = files.has('bible.json') ? parseJson(files.get('bible.json'), 'la biblia') : null;
  const maps = new Map(), chapters = new Map();
  for (const [name, data] of files) {
    if (RE_MAP.test(name)) {
      try { const m = JSON.parse(data.toString('utf8').replace(/^\uFEFF/, '')); if (m && typeof m === 'object') maps.set(name.slice(5, -5), data); else throw new Error('x'); }
      catch (_) { warnings.push('Un mapa de ideas estaba dañado y se omitió.'); }
    } else if (RE_CHAPTER.test(name)) chapters.set(name.slice(9, -5), data);
  }
  const missing = project.chapters.filter((c) => c && S.isId(c.id) && !chapters.has(c.id)).length;
  if (missing) warnings.push(missing === 1 ? 'Falta el archivo de 1 capítulo; se creará vacío.' : `Faltan los archivos de ${missing} capítulos; se crearán vacíos.`);
  return { manifest, project, bible, maps, chapters, warnings };
}

module.exports = { pack, unpack, FORMAT, FORMAT_VERSION, EXT };
