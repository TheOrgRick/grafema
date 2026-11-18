'use strict';
// Lógica de la aplicación sin dependencias de Electron (se inyectan diálogos, PDF y shell).
// Cada handler devuelve un objeto; el envoltorio lo convierte en { ok:true, ... } o { ok:false, code, message }.
const fs = require('fs');
const path = require('path');
const S = require('./store');
const { AppError } = require('./errors');
const DocModel = require('../shared/docmodel');
const { buildDocx, parseDocx } = require('./docx');
const Exporter = require('./exporter');
const Templates = require('../shared/templates');
const ProjectFile = require('./projectfile');

const MAX_DOCX_BYTES = 60 * 1024 * 1024;
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const THEMES = ['dark', 'light', 'system'];
const MATERIALS = ['mica', 'acrylic', 'none'];
const PAPERS = ['auto', 'light', 'dark'];
const SPELL_LANGS = ['es-MX', 'es-ES', 'es-419', 'es', 'en-US', 'en-GB', 'fr', 'pt-BR', 'it', 'de'];

function defaultConfig() {
  return {
    theme: 'dark', material: 'mica', paper: 'auto', navCollapsed: false, animations: true,
    window: { width: 1280, height: 800 },
    spell: ['es-MX', 'en-US'],
    author: '',
    defaults: Object.assign({}, DocModel.DEFAULT_DEFAULTS),
  };
}
function sanitizeConfig(raw) {
  const d = defaultConfig();
  const r = raw && typeof raw === 'object' ? raw : {};
  const num = (v, min, max, def) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
  return {
    theme: THEMES.includes(r.theme) ? r.theme : d.theme,
    material: MATERIALS.includes(r.material) ? r.material : d.material,
    paper: PAPERS.includes(r.paper) ? r.paper : d.paper,
    navCollapsed: typeof r.navCollapsed === 'boolean' ? r.navCollapsed : d.navCollapsed,
    animations: typeof r.animations === 'boolean' ? r.animations : d.animations,
    window: {
      width: num(r.window && r.window.width, 640, 7680, d.window.width),
      height: num(r.window && r.window.height, 480, 4320, d.window.height),
    },
    spell: Array.isArray(r.spell) ? [...new Set(r.spell.filter((l) => SPELL_LANGS.includes(l)))].slice(0, 4) : d.spell,
    defaults: DocModel.sanitizeDefaults(r.defaults || d.defaults),
    author: typeof r.author === 'string' ? r.author.replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '',
  };
}

const clip = (v, max, def) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : def);
const nowIso = () => new Date().toISOString();

function createCore(opts) {
  const dataDir = opts.dataDir;
  const deps = Object.assign({
    dialog: { open: async () => null, save: async () => null },
    printPdf: null,
    shell: { showItem() {}, openPath: async () => '' },
    getFonts: async () => [],
    appVersion: '1.2.0',
    platform: process.platform,
  }, opts.deps || {});
  S.ensureDir(dataDir);
  const configFile = path.join(dataDir, 'config.json');
  const projectsDir = path.join(dataDir, 'proyectos');
  let lastExported = null;

  // ---------- utilidades ----------
  const projectsRoot = () => projectsDir;
  const authorName = () => getConfig().author || '';
  const projDir = (pid) => {
    if (!S.isId(pid)) throw new AppError('BAD_ID', 'Proyecto no válido.');
    return path.join(projectsRoot(), pid);
  };
  const chapterFile = (pid, cid) => {
    if (!S.isId(cid)) throw new AppError('BAD_ID', 'Capítulo no válido.');
    return path.join(projDir(pid), 'chapters', cid + '.docx');
  };

  function normalizeProject(p) {
    const chapters = (Array.isArray(p.chapters) ? p.chapters : [])
      .filter((c) => c && S.isId(c.id))
      .map((c) => ({ id: c.id, title: clip(c.title, 120, 'Sin título') || 'Sin título', words: Number.isFinite(c.words) ? c.words : 0, updated: c.updated || null }));
    return {
      id: p.id,
      name: clip(p.name, 80, 'Proyecto') || 'Proyecto',
      author: clip(p.author, 80, ''),
      genre: clip(p.genre, 40, ''),
      description: clip(p.description, 500, ''),
      created: p.created || nowIso(),
      updated: p.updated || nowIso(),
      chapters,
      page: DocModel.sanitizePage(p.page),
      defaults: DocModel.sanitizeDefaults(p.defaults),
      export: p.export && typeof p.export === 'object' && JSON.stringify(p.export).length < 10000 ? p.export : {},
      lastChapter: S.isId(p.lastChapter) ? p.lastChapter : null,
      lastMap: S.isId(p.lastMap) ? p.lastMap : null,
    };
  }
  function readProject(pid) {
    const { value } = S.readJson(path.join(projDir(pid), 'project.json'), null);
    if (!value || value.id !== pid) throw new AppError('NO_PROJECT', 'No se encontró el proyecto. Puede haberse movido o eliminado.');
    return normalizeProject(value);
  }
  function writeProject(p, touch) {
    if (touch !== false) p.updated = nowIso();
    S.writeAtomic(path.join(projDir(p.id), 'project.json'), JSON.stringify(p, null, 1), { backup: true });
    return p;
  }
  const totalWords = (p) => p.chapters.reduce((n, c) => n + (c.words || 0), 0);

  function writeChapterDocx(p, cid, model, title) {
    const buf = buildDocx(model, { title, author: p.author || authorName(), page: p.page });
    S.writeAtomic(chapterFile(p.id, cid), buf, { backup: true });
  }
  function readChapterModel(p, cid) {
    const file = chapterFile(p.id, cid);
    const attempt = (f) => parseDocx(fs.readFileSync(f)).model;
    if (!fs.existsSync(file)) {
      const model = DocModel.emptyModel(p.defaults);
      return { model, warnings: ['No se encontró el archivo de este capítulo; se creó uno vacío.'] };
    }
    try { return { model: attempt(file), warnings: [] }; } catch (e) {
      if (fs.existsSync(file + '.bak')) {
        try { return { model: attempt(file + '.bak'), warnings: ['El archivo del capítulo estaba dañado; se recuperó la copia de seguridad anterior.'] }; } catch (_) { /* cae al error */ }
      }
      throw new AppError('DOCX_BROKEN', 'No se pudo leer el archivo del capítulo: ' + e.message);
    }
  }
  function addChapter(p, title, model) {
    const id = S.newId();
    const m = DocModel.sanitizeModel(model || DocModel.emptyModel(p.defaults));
    const t = clip(title, 120, '') || `Capítulo ${p.chapters.length + 1}`;
    S.ensureDir(path.join(projDir(p.id), 'chapters'));
    writeChapterDocx(p, id, m, t);
    const ch = { id, title: t, words: DocModel.countWords(m), updated: nowIso() };
    p.chapters.push(ch);
    return ch;
  }

  function loadChaptersWithModels(p, only) {
    const out = [];
    for (const c of p.chapters) {
      if (only && !only.includes(c.id)) continue;
      let model;
      try { model = readChapterModel(p, c.id).model; } catch (_) { model = DocModel.emptyModel(p.defaults); }
      out.push({ id: c.id, title: c.title, model });
    }
    return out;
  }

  // Biblia y mapas que el exportador necesita (solo se leen si se pidieron).
  function exportExtra(p, options) {
    const o = options || {};
    const extra = { bible: null, maps: [] };
    if (o.bible || o.maps) extra.bible = S.readJson(path.join(projDir(p.id), 'bible.json'), null).value;
    if (o.maps) {
      for (const m of listMaps(p.id)) extra.maps.push({ id: m.id, name: m.name, data: readMapFile(p.id, m.id) });
    }
    return extra;
  }

  function sizeCheckJson(data, what) {
    let s;
    try { s = JSON.stringify(data); } catch (_) { throw new AppError('BAD_DATA', `Los datos de ${what} no son válidos.`); }
    if (s.length > MAX_JSON_BYTES) throw new AppError('TOO_BIG', `Los datos de ${what} son demasiado grandes.`);
    return s;
  }

  const safeFileName = (n, fallback) => (String(n || '').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || fallback);

  // ---------- mapas (varios por proyecto: maps/<id>.json) ----------
  const mapsDir = (pid) => path.join(projDir(pid), 'maps');
  const mapFile = (pid, mid) => {
    if (!S.isId(mid)) throw new AppError('BAD_ID', 'Mapa no válido.');
    return path.join(mapsDir(pid), mid + '.json');
  };
  const mapIds = (pid) => {
    const dir = mapsDir(pid);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => /\.json$/.test(f) && S.isId(f.slice(0, -5))).map((f) => f.slice(0, -5));
  };
  const cleanMap = (data, extra) => {
    const d = data && typeof data === 'object' ? data : {};
    return Object.assign({
      version: 1,
      nodes: Array.isArray(d.nodes) ? d.nodes : [], edges: Array.isArray(d.edges) ? d.edges : [],
      view: d.view && typeof d.view === 'object' ? d.view : undefined,
    }, extra);
  };
  const readMapFile = (pid, mid) => {
    const v = S.readJson(mapFile(pid, mid), null).value;
    return v && typeof v === 'object' ? v : null;
  };
  // Garantiza que haya al menos un mapa. Si existe el map.json de versiones anteriores, lo convierte en "Mapa 1"
  // (el original se conserva como map.json.migrado).
  function ensureMaps(pid) {
    if (mapIds(pid).length) return;
    S.ensureDir(mapsDir(pid));
    const legacy = path.join(projDir(pid), 'map.json');
    const old = S.readJson(legacy, null).value;
    const id = S.newId();
    S.writeAtomic(mapFile(pid, id), JSON.stringify(cleanMap(old, { name: 'Mapa 1', order: 1, created: nowIso() })), { backup: true });
    if (fs.existsSync(legacy)) { try { fs.renameSync(legacy, legacy + '.migrado'); } catch (_) { /* se deja donde está */ } }
  }
  function listMaps(pid) {
    ensureMaps(pid);
    return mapIds(pid).map((id) => {
      const m = readMapFile(pid, id) || {};
      return { id, name: clip(m.name, 60, 'Mapa') || 'Mapa', order: Number.isFinite(m.order) ? m.order : 0, created: m.created || '', nodes: Array.isArray(m.nodes) ? m.nodes.length : 0, links: Array.isArray(m.edges) ? m.edges.length : 0 };
    }).sort((a, b) => (a.order - b.order) || String(a.created).localeCompare(String(b.created)));
  }
  function pickMap(pid, mid) {
    const all = listMaps(pid);
    if (mid !== undefined && mid !== null) {
      if (!all.some((m) => m.id === mid)) throw new AppError('NO_MAP', 'No se encontró ese mapa. Puede haberse eliminado.');
      return mid;
    }
    const last = S.readJson(path.join(projDir(pid), 'project.json'), null).value;
    return all.some((m) => m.id === (last && last.lastMap)) ? last.lastMap : all[0].id;
  }

  // ---------- archivo de proyecto (.grafema) ----------
  function importProjectBuffer(buf) {
    const u = ProjectFile.unpack(buf);
    const id = S.newId();
    const p = normalizeProject(Object.assign({}, u.project, { id }));
    const warnings = u.warnings.slice();
    // Siempre se crea un proyecto nuevo: importar nunca pisa ni mezcla proyectos existentes.
    const origId = u.manifest.project && u.manifest.project.id;
    if (S.isId(origId) && fs.existsSync(path.join(projectsRoot(), origId))) p.name = clip(p.name + ' (importado)', 80, p.name);
    if (!p.author) p.author = authorName();
    if (!p.chapters.length) throw new AppError('FILE_BROKEN', 'El proyecto del archivo no tiene capítulos.');
    p.lastChapter = p.chapters.some((c) => c.id === p.lastChapter) ? p.lastChapter : p.chapters[0].id;
    p.lastMap = u.maps.has(p.lastMap) ? p.lastMap : null;
    p.created = p.created || nowIso();
    p.updated = nowIso();
    S.ensureDir(projectsRoot());
    const tmp = path.join(projectsRoot(), `.importando-${id}`);
    try {
      S.ensureDir(path.join(tmp, 'chapters'));
      let broken = 0;
      for (const c of p.chapters) {
        const data = u.chapters.get(c.id);
        if (!data) continue;
        try { parseDocx(data); } catch (_) { broken++; }
        S.writeAtomic(path.join(tmp, 'chapters', c.id + '.docx'), data);
      }
      if (broken) warnings.push(broken === 1 ? 'Un capítulo del archivo tiene problemas de formato.' : `${broken} capítulos del archivo tienen problemas de formato.`);
      if (u.bible) {
        if (!Array.isArray(u.bible.types) || !Array.isArray(u.bible.profiles)) warnings.push('La biblia del archivo no es válida y se omitió.');
        else S.writeAtomic(path.join(tmp, 'bible.json'), JSON.stringify(u.bible));
      }
      if (u.maps.size) S.ensureDir(path.join(tmp, 'maps'));
      for (const [mid, data] of u.maps) S.writeAtomic(path.join(tmp, 'maps', mid + '.json'), data);
      S.writeAtomic(path.join(tmp, 'project.json'), JSON.stringify(p, null, 1));
      fs.renameSync(tmp, projDir(id));
    } catch (e) { S.rmrf(tmp); throw e; }
    ensureMaps(id);
    return { project: readProject(id), warnings };
  }
  function exportProjectBuffer(pid) {
    const p = readProject(pid);
    return { project: p, buffer: ProjectFile.pack(projDir(pid), p, deps.appVersion) };
  }
  const readFileLimited = (file) => {
    let st;
    try { st = fs.statSync(file); } catch (_) { throw new AppError('FILE_READ', 'No se pudo abrir el archivo. Puede haberse movido o eliminado.'); }
    if (!st.isFile()) throw new AppError('FILE_READ', 'Eso no es un archivo.');
    if (st.size > 400 * 1024 * 1024) throw new AppError('FILE_TOO_BIG', 'El archivo es demasiado grande (máximo 400 MB).');
    return fs.readFileSync(file);
  };

  // ---------- configuración ----------
  function getConfig() {
    const { value } = S.readJson(configFile, null);
    return sanitizeConfig(value);
  }
  function setConfig(patch) {
    const cur = getConfig();
    const p = patch && typeof patch === 'object' ? patch : {};
    const next = sanitizeConfig(Object.assign({}, cur, p, { window: Object.assign({}, cur.window, p.window || {}), defaults: Object.assign({}, cur.defaults, p.defaults || {}) }));
    S.writeAtomic(configFile, JSON.stringify(next, null, 1), { backup: true });
    return next;
  }

  // ---------- handlers ----------
  const handlers = {
    // --- aplicación ---
    'app:info': async () => ({ version: deps.appVersion, dataDir, platform: deps.platform, author: authorName(), materialSupported: !!deps.materialSupported }),
    'config:get': async () => ({ config: getConfig() }),
    'config:set': async (patch) => {
      const config = setConfig(patch);
      if (deps.onConfig) { try { deps.onConfig(config); } catch (_) { /* no crítico */ } }
      return { config };
    },
    'fonts:list': async () => ({ fonts: await deps.getFonts() }),
    'shell:openData': async () => { await deps.shell.openPath(dataDir); return {}; },
    'shell:showExport': async () => { if (lastExported) deps.shell.showItem(lastExported); return {}; },

    // --- autor (único dato personal: el nombre que aparece en PDF y .docx) ---
    'author:set': async (d) => {
      const name = String((d && d.name) == null ? '' : d.name).normalize('NFC').replace(/\s+/g, ' ').trim();
      if (!name) throw new AppError('NAME_REQUIRED', 'Escribe el nombre del autor.', 'name');
      if (name.length > 80) throw new AppError('NAME_LONG', 'El nombre admite hasta 80 caracteres.', 'name');
      if (/[\u0000-\u001F\u007F<>]/.test(name)) throw new AppError('NAME_INVALID', 'El nombre contiene caracteres no permitidos.', 'name');
      const config = setConfig({ author: name });
      return { author: config.author, config };
    },

    // --- proyectos ---
    'project:list': async () => {
      const root = projectsRoot();
      const out = [];
      if (fs.existsSync(root)) {
        for (const id of fs.readdirSync(root)) {
          if (!S.isId(id)) continue;
          try {
            const p = readProject(id);
            const bible = S.readJson(path.join(root, id, 'bible.json'), null).value;
            let links = 0;
            const mdir = path.join(root, id, 'maps');
            if (fs.existsSync(mdir)) {
              for (const f of fs.readdirSync(mdir)) {
                if (!/\.json$/.test(f) || !S.isId(f.slice(0, -5))) continue;
                const m = S.readJson(path.join(mdir, f), null).value;
                if (m && Array.isArray(m.edges)) links += m.edges.length;
              }
            } else {
              const old = S.readJson(path.join(root, id, 'map.json'), null).value;
              if (old && Array.isArray(old.edges)) links = old.edges.length;
            }
            out.push({
              id: p.id, name: p.name, author: p.author, genre: p.genre, description: p.description, created: p.created, updated: p.updated,
              chapters: p.chapters.length, words: totalWords(p),
              profiles: bible && Array.isArray(bible.profiles) ? bible.profiles.length : 0,
              links,
            });
          } catch (_) { /* proyecto dañado: se omite */ }
        }
      }
      out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      return { projects: out };
    },
    'project:create': async (d) => {
      d = d || {};
      const name = clip(d.name, 80, '');
      if (!name) throw new AppError('NAME_REQUIRED', 'Escribe un nombre para el proyecto.', 'name');
      const id = S.newId();
      const cfg = getConfig();
      const tpl = d.template ? Templates.byId(String(d.template)) : null;
      if (d.template && !tpl) throw new AppError('BAD_TEMPLATE', 'Esa plantilla no existe.', 'template');
      const page = Object.assign(DocModel.defaultPage(), tpl && tpl.page ? tpl.page : {});
      const p = normalizeProject({
        id, name, author: clip(d.author, 80, '') || cfg.author, genre: clip(d.genre, 40, '') || (tpl ? tpl.genre : ''), description: clip(d.description, 500, ''),
        created: nowIso(), updated: nowIso(), chapters: [], page, defaults: Object.assign({}, cfg.defaults, tpl && tpl.defaults ? tpl.defaults : {}),
      });
      S.ensureDir(path.join(projDir(id), 'chapters'));
      const chs = tpl ? tpl.chapters : [{ title: 'Capítulo 1', blocks: [] }];
      for (const c of chs) addChapter(p, c.title, DocModel.sanitizeModel({ defaults: p.defaults, blocks: c.blocks.length ? c.blocks : [{ t: 'p', runs: [] }] }));
      p.lastChapter = p.chapters[0].id;
      writeProject(p);
      return { project: p };
    },
    'project:load': async (d) => ({ project: readProject(d && d.id) }),
    'project:update': async (d) => {
      const p = readProject(d && d.id);
      const patch = (d && d.patch) || {};
      if (patch.name !== undefined) { const n = clip(patch.name, 80, ''); if (!n) throw new AppError('NAME_REQUIRED', 'El nombre no puede quedar vacío.', 'name'); p.name = n; }
      if (patch.author !== undefined) p.author = clip(patch.author, 80, '');
      if (patch.genre !== undefined) p.genre = clip(patch.genre, 40, '');
      if (patch.description !== undefined) p.description = clip(patch.description, 500, '');
      if (patch.page !== undefined) p.page = DocModel.sanitizePage(patch.page);
      if (patch.defaults !== undefined) p.defaults = DocModel.sanitizeDefaults(patch.defaults);
      if (patch.export !== undefined && patch.export && typeof patch.export === 'object' && JSON.stringify(patch.export).length < 10000) p.export = patch.export;
      if (patch.lastChapter !== undefined && p.chapters.some((c) => c.id === patch.lastChapter)) p.lastChapter = patch.lastChapter;
      if (patch.lastMap !== undefined && S.isId(patch.lastMap) && fs.existsSync(mapFile(p.id, patch.lastMap))) p.lastMap = patch.lastMap;
      writeProject(p, !(Object.keys(patch).every((k) => k === 'export' || k === 'lastChapter' || k === 'lastMap')));
      return { project: p };
    },
    'project:delete': async (d) => {
      const dir = projDir(d && d.id);
      if (!fs.existsSync(dir)) throw new AppError('NO_PROJECT', 'El proyecto ya no existe.');
      S.rmrf(dir);
      return {};
    },

    // --- archivo de proyecto (.grafema): importar y exportar el proyecto completo ---
    'project:exportFile': async (d) => {
      const { project, buffer } = exportProjectBuffer(d && d.projectId);
      const file = await deps.dialog.save({
        title: 'Exportar proyecto de Grafema', defaultPath: safeFileName(project.name, 'proyecto') + ProjectFile.EXT,
        filters: [{ name: 'Proyecto de Grafema (*' + ProjectFile.EXT + ')', extensions: ['grafema'] }],
      });
      if (!file) return { canceled: true };
      const out = /\.grafema$/i.test(file) ? file : file + ProjectFile.EXT;
      S.writeAtomic(out, buffer);
      lastExported = out;
      return { path: out, bytes: buffer.length };
    },
    'project:importFile': async (d) => {
      let file = d && typeof d.path === 'string' ? d.path : null;
      if (file && !/\.grafema$/i.test(file)) throw new AppError('FILE_INVALID', 'Ese archivo no es un proyecto de Grafema (.grafema).');
      if (!file) {
        const picked = await deps.dialog.open({
          title: 'Importar proyecto de Grafema', properties: ['openFile'],
          filters: [{ name: 'Proyecto de Grafema (*' + ProjectFile.EXT + ')', extensions: ['grafema'] }],
        });
        if (!picked || !picked.length) return { canceled: true };
        file = picked[0];
      }
      const r = importProjectBuffer(readFileLimited(file));
      return { project: r.project, warnings: r.warnings };
    },
    // Variantes sin cuadros de diálogo ni rutas: las usa la versión de Android (el sistema entrega y recibe los bytes).
    'project:exportData': async (d) => {
      const { project, buffer } = exportProjectBuffer(d && d.projectId);
      return { fileName: safeFileName(project.name, 'proyecto') + ProjectFile.EXT, base64: buffer.toString('base64'), bytes: buffer.length };
    },
    'project:importData': async (d) => {
      const b64 = d && d.base64;
      if (typeof b64 !== 'string' || !b64 || b64.length > 560 * 1024 * 1024) throw new AppError('FILE_INVALID', 'Este archivo no es un proyecto de Grafema.');
      const r = importProjectBuffer(Buffer.from(b64, 'base64'));
      return { project: r.project, warnings: r.warnings };
    },

    // --- capítulos ---
    'chapter:create': async (d) => {
      const p = readProject(d && d.projectId);
      const chapter = addChapter(p, d && d.title);
      p.lastChapter = chapter.id;
      writeProject(p);
      return { project: p, chapter };
    },
    'chapter:read': async (d) => {
      const p = readProject(d && d.projectId);
      const ch = p.chapters.find((c) => c.id === (d && d.chapterId));
      if (!ch) throw new AppError('NO_CHAPTER', 'No se encontró el capítulo.');
      const r = readChapterModel(p, ch.id);
      return { title: ch.title, model: r.model, warnings: r.warnings };
    },
    'chapter:write': async (d) => {
      const p = readProject(d && d.projectId);
      const ch = p.chapters.find((c) => c.id === (d && d.chapterId));
      if (!ch) throw new AppError('NO_CHAPTER', 'No se encontró el capítulo.');
      sizeCheckJson(d.model, 'el capítulo');
      const model = DocModel.sanitizeModel(d.model);
      writeChapterDocx(p, ch.id, model, ch.title);
      ch.words = DocModel.countWords(model);
      ch.updated = nowIso();
      writeProject(p);
      return { words: ch.words, totalWords: totalWords(p), updated: ch.updated };
    },
    'chapter:rename': async (d) => {
      const p = readProject(d && d.projectId);
      const ch = p.chapters.find((c) => c.id === (d && d.chapterId));
      if (!ch) throw new AppError('NO_CHAPTER', 'No se encontró el capítulo.');
      const t = clip(d.title, 120, '');
      if (!t) throw new AppError('NAME_REQUIRED', 'El título no puede quedar vacío.', 'title');
      ch.title = t;
      writeProject(p);
      return { project: p };
    },
    'chapter:delete': async (d) => {
      const p = readProject(d && d.projectId);
      const i = p.chapters.findIndex((c) => c.id === (d && d.chapterId));
      if (i < 0) throw new AppError('NO_CHAPTER', 'No se encontró el capítulo.');
      const [gone] = p.chapters.splice(i, 1);
      try { fs.rmSync(chapterFile(p.id, gone.id), { force: true }); fs.rmSync(chapterFile(p.id, gone.id) + '.bak', { force: true }); } catch (_) { /* noop */ }
      if (!p.chapters.length) addChapter(p, 'Capítulo 1');
      if (p.lastChapter === gone.id || !p.chapters.some((c) => c.id === p.lastChapter)) p.lastChapter = p.chapters[Math.min(i, p.chapters.length - 1)].id;
      writeProject(p);
      return { project: p };
    },
    'chapter:reorder': async (d) => {
      const p = readProject(d && d.projectId);
      const order = Array.isArray(d && d.order) ? d.order : [];
      const byId = new Map(p.chapters.map((c) => [c.id, c]));
      const next = [];
      for (const id of order) if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); }
      for (const c of byId.values()) next.push(c); // los que faltaron conservan su lugar al final
      p.chapters = next;
      writeProject(p);
      return { project: p };
    },
    'chapter:importDocx': async (d) => {
      const p = readProject(d && d.projectId);
      const files = await deps.dialog.open({
        title: 'Importar documentos de Word', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Documentos de Word (*.docx)', extensions: ['docx'] }],
      });
      if (!files || !files.length) return { canceled: true, project: p, imported: [], issues: [] };
      const imported = [], issues = [];
      for (const f of files) {
        const name = path.basename(f).replace(/\.docx$/i, '');
        try {
          const st = fs.statSync(f);
          if (st.size > MAX_DOCX_BYTES) throw new Error('El archivo es demasiado grande (máximo 60 MB).');
          const r = parseDocx(fs.readFileSync(f));
          const model = DocModel.rebase(r.model, p.defaults);
          const ch = addChapter(p, (r.meta.title && r.meta.title.trim()) || name, model);
          imported.push({ id: ch.id, title: ch.title });
          if (r.warnings.length) issues.push({ file: name, messages: r.warnings, level: 'warn' });
        } catch (e) {
          issues.push({ file: name, messages: [e.message || 'No se pudo importar.'], level: 'error' });
        }
      }
      if (imported.length) { p.lastChapter = imported[imported.length - 1].id; writeProject(p); }
      return { project: p, imported, issues };
    },
    'chapter:exportDocx': async (d) => {
      const p = readProject(d && d.projectId);
      const ch = p.chapters.find((c) => c.id === (d && d.chapterId));
      if (!ch) throw new AppError('NO_CHAPTER', 'No se encontró el capítulo.');
      const model = d.model ? DocModel.sanitizeModel(d.model) : readChapterModel(p, ch.id).model;
      const file = await deps.dialog.save({
        title: 'Guardar capítulo como .docx', defaultPath: safeFileName(ch.title, 'capitulo') + '.docx',
        filters: [{ name: 'Documento de Word (*.docx)', extensions: ['docx'] }],
      });
      if (!file) return { canceled: true };
      const out = /\.docx$/i.test(file) ? file : file + '.docx';
      S.writeAtomic(out, buildDocx(model, { title: ch.title, author: p.author, page: p.page }));
      lastExported = out;
      return { path: out };
    },

    // --- biblia y mapa ---
    'bible:read': async (d) => ({ data: S.readJson(path.join(projDir(d && d.projectId), 'bible.json'), null).value }),
    'bible:write': async (d) => {
      const dir = projDir(d && d.projectId);
      const data = d && d.data;
      if (!data || typeof data !== 'object' || !Array.isArray(data.types) || !Array.isArray(data.profiles)) throw new AppError('BAD_DATA', 'Los datos de la biblia no son válidos.');
      S.writeAtomic(path.join(dir, 'bible.json'), sizeCheckJson(data, 'la biblia'), { backup: true });
      return {};
    },
    'maps:list': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const maps = listMaps(pid);
      return { maps, last: pickMap(pid) };
    },
    'maps:create': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const all = listMaps(pid);
      if (all.length >= 60) throw new AppError('TOO_MANY', 'Llegaste al máximo de 60 mapas por proyecto.');
      const id = S.newId();
      const order = Math.max(0, ...all.map((m) => m.order)) + 1;
      const name = clip(d && d.name, 60, '') || `Mapa ${all.length + 1}`;
      S.writeAtomic(mapFile(pid, id), JSON.stringify(cleanMap(null, { name, order, created: nowIso() })), { backup: true });
      return { map: { id, name } };
    },
    'maps:rename': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const mid = pickMap(pid, d && d.mapId);
      const name = clip(d && d.name, 60, '');
      if (!name) throw new AppError('NAME_REQUIRED', 'El mapa necesita un nombre.', 'name');
      const m = readMapFile(pid, mid) || cleanMap(null, {});
      S.writeAtomic(mapFile(pid, mid), JSON.stringify(Object.assign({}, m, { name })), { backup: true });
      return { map: { id: mid, name } };
    },
    'maps:duplicate': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const mid = pickMap(pid, d && d.mapId);
      const all = listMaps(pid);
      if (all.length >= 60) throw new AppError('TOO_MANY', 'Llegaste al máximo de 60 mapas por proyecto.');
      const m = readMapFile(pid, mid) || cleanMap(null, {});
      const id = S.newId();
      const name = clip(`${m.name || 'Mapa'} (copia)`, 60, 'Mapa (copia)');
      S.writeAtomic(mapFile(pid, id), JSON.stringify(Object.assign({}, m, { name, order: Math.max(0, ...all.map((x) => x.order)) + 1, created: nowIso() })), { backup: true });
      return { map: { id, name } };
    },
    'maps:delete': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const mid = pickMap(pid, d && d.mapId);
      if (listMaps(pid).length <= 1) throw new AppError('LAST_MAP', 'Un proyecto necesita al menos un mapa. Puedes renombrarlo o vaciarlo.');
      for (const f of [mapFile(pid, mid), mapFile(pid, mid) + '.bak']) { try { fs.rmSync(f, { force: true }); } catch (_) { /* noop */ } }
      return { last: pickMap(pid) };
    },
    'map:read': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const mid = pickMap(pid, d && d.mapId);
      const m = readMapFile(pid, mid);
      return { data: m, mapId: mid, name: clip(m && m.name, 60, 'Mapa') };
    },
    'map:write': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const data = d && d.data;
      if (!data || typeof data !== 'object' || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new AppError('BAD_DATA', 'Los datos del mapa no son válidos.');
      const mid = pickMap(pid, d && d.mapId);
      const cur = readMapFile(pid, mid) || {};
      const next = cleanMap(data, { name: cur.name || 'Mapa', order: Number.isFinite(cur.order) ? cur.order : 1, created: cur.created || nowIso() });
      S.writeAtomic(mapFile(pid, mid), sizeCheckJson(next, 'el mapa'), { backup: true });
      return { mapId: mid };
    },

    // --- exportación ---
    'export:preview': async (d) => {
      const p = readProject(d && d.projectId);
      const parts = Exporter.buildParts(p, { name: authorName() }, loadChaptersWithModels(p), d && d.options, exportExtra(p, d && d.options));
      return { css: parts.css, body: parts.previewBody, options: parts.opts, geometry: parts.geo, chapters: parts.chapters, maps: parts.mapPages.length, profiles: parts.bibleCount };
    },
    'export:sources': async (d) => {
      const pid = d && d.projectId; projDir(pid);
      const bible = S.readJson(path.join(projDir(pid), 'bible.json'), null).value;
      return {
        types: bible && Array.isArray(bible.types) ? bible.types.map((t) => ({ id: t.id, name: t.name, color: t.color })) : [],
        profiles: bible && Array.isArray(bible.profiles) ? bible.profiles.map((x) => ({ id: x.id, typeId: x.typeId, name: x.name })) : [],
        maps: listMaps(pid).map((m) => ({ id: m.id, name: m.name, nodes: m.nodes })),
      };
    },
    'export:pdf': async (d) => {
      const p = readProject(d && d.projectId);
      if (!deps.printPdf) throw new AppError('NO_PDF', 'La exportación a PDF no está disponible en este entorno.');
      const parts = Exporter.buildParts(p, { name: authorName() }, loadChaptersWithModels(p), d && d.options, exportExtra(p, d && d.options));
      if (!parts.hasMain && !parts.mapPages.length) throw new AppError('NO_CHAPTERS', 'Elige al menos una sección con contenido (capítulos, biblia o mapas).');
      const file = await deps.dialog.save({
        title: 'Exportar a PDF', defaultPath: safeFileName(parts.opts.title, 'manuscrito') + '.pdf',
        filters: [{ name: 'Documento PDF (*.pdf)', extensions: ['pdf'] }],
      });
      if (!file) return { canceled: true };
      const out = /\.pdf$/i.test(file) ? file : file + '.pdf';
      let buf = parts.hasMain ? await deps.printPdf({ html: Exporter.buildHtml(parts), pdf: Exporter.pdfOptions(parts) }) : null;
      if (parts.mapPages.length) {
        const mapsBuf = await deps.printPdf({ html: Exporter.buildMapsHtml(parts), pdf: Exporter.mapsPdfOptions(parts) });
        try { buf = await Exporter.mergePdfs(buf, mapsBuf, parts.opts); } catch (e) { throw new AppError('PDF_MERGE', 'No se pudieron unir los mapas al PDF: ' + (e && e.message || e)); }
      }
      let metadata = true;
      try {
        const { PDFDocument } = require('pdf-lib');
        const pdf = await PDFDocument.load(buf, { updateMetadata: false });
        pdf.setTitle(parts.opts.title);
        if (parts.opts.author) pdf.setAuthor(parts.opts.author);
        if (parts.opts.subtitle) pdf.setSubject(parts.opts.subtitle);
        pdf.setCreator('Grafema — Petricorp');
        pdf.setProducer('Grafema (Petricorp)');
        pdf.setCreationDate(new Date());
        pdf.setModificationDate(new Date());
        buf = Buffer.from(await pdf.save());
      } catch (_) { metadata = false; }
      S.writeAtomic(out, buf);
      lastExported = out;
      return { path: out, metadata, maps: parts.mapPages.length, profiles: parts.bibleCount };
    },
    'export:docx': async (d) => {
      const p = readProject(d && d.projectId);
      const { opts: o, model } = Exporter.buildManuscriptModel(p, { name: authorName() }, loadChaptersWithModels(p), d && d.options);
      if (!model.blocks.length) throw new AppError('NO_CHAPTERS', 'Selecciona al menos un capítulo para exportar.');
      const file = await deps.dialog.save({
        title: 'Exportar manuscrito a .docx', defaultPath: safeFileName(o.title, 'manuscrito') + '.docx',
        filters: [{ name: 'Documento de Word (*.docx)', extensions: ['docx'] }],
      });
      if (!file) return { canceled: true };
      const out = /\.docx$/i.test(file) ? file : file + '.docx';
      S.writeAtomic(out, buildDocx(model, { title: o.title, author: o.author, page: p.page }));
      lastExported = out;
      return { path: out };
    },
  };

  // Envoltorio: nunca lanza hacia la interfaz.
  async function invoke(channel, payload) {
    const fn = handlers[channel];
    if (!fn) return { ok: false, code: 'UNKNOWN_CHANNEL', message: 'Operación desconocida.' };
    try {
      const res = await fn(payload);
      return Object.assign({ ok: true }, res || {});
    } catch (e) {
      if (e instanceof AppError) return { ok: false, code: e.code, message: e.message, field: e.field };
      if (e && e.code === 'DOCX_INVALID') return { ok: false, code: e.code, message: e.message };
      const msg = e && e.code === 'ENOSPC' ? 'No hay espacio suficiente en el disco.'
        : e && (e.code === 'EACCES' || e.code === 'EPERM') ? 'Windows no permitió escribir el archivo (permisos o antivirus). Inténtalo de nuevo.'
          : 'Ocurrió un error inesperado: ' + ((e && e.message) || e);
      if (opts.log) opts.log(channel, e);
      return { ok: false, code: 'INTERNAL', message: msg };
    }
  }

  return { handlers, invoke, channels: Object.keys(handlers), getConfig, setConfig, sanitizeConfig };
}

module.exports = { createCore, sanitizeConfig, defaultConfig };
