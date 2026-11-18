'use strict';
// Composición del manuscrito para PDF / vista previa / .docx completo.
const DocModel = require('../shared/docmodel');
const { mapToSvg } = require('./maprender');
const esc = DocModel.esc;
const IMG_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG = 8 * 1024 * 1024;

function sanitizeOptions(project, user, o) {
  o = o || {};
  const str = (v, max, def) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max) : def);
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  const ids = new Set((project.chapters || []).map((c) => c.id));
  return {
    title: str(o.title, 200, project.name) || project.name,
    subtitle: str(o.subtitle, 200, ''),
    author: str(o.author, 120, project.author || (user && user.name) || ''),
    cover: bool(o.cover, true),
    chapterTitles: bool(o.chapterTitles, true),
    pageBreaks: bool(o.pageBreaks, true),
    pageNumbers: bool(o.pageNumbers, true),
    header: bool(o.header, false),
    chapterIds: Array.isArray(o.chapterIds) ? o.chapterIds.filter((id) => ids.has(id)) : null,
    // Secciones y revisión (nuevas): el manuscrito sigue activo por defecto; lo demás es opcional.
    manuscript: bool(o.manuscript, true),
    toc: bool(o.toc, false),
    revisions: o.revisions === 'markup' ? 'markup' : 'final',
    bible: bool(o.bible, false),
    bibleTypeIds: idList(o.bibleTypeIds),
    bibleProfileIds: idList(o.bibleProfileIds),
    maps: bool(o.maps, false),
    mapIds: idList(o.mapIds),
  };
}
const idList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 64).slice(0, 5000) : null);

function geometry(project, opts) {
  const pg = DocModel.sanitizePage(project.page);
  const ps = DocModel.PAGE_SIZES[pg.size];
  const inch = (tw) => Math.round((tw / 1440) * 1000) / 1000;
  const wIn = inch(ps.w), hIn = inch(ps.h);
  const m = { top: inch(pg.margins.top), right: inch(pg.margins.right), bottom: inch(pg.margins.bottom), left: inch(pg.margins.left) };
  const hf = opts.pageNumbers || opts.header;
  if (hf) { m.top = Math.max(m.top, 0.6); m.bottom = Math.max(m.bottom, 0.6); }
  return { size: pg.size, wIn, hIn, margins: m, pageSize: ps.pdf || { width: wIn, height: hIn } };
}

function css(project, geo) {
  const d = DocModel.sanitizeDefaults(project.defaults);
  const contentH = Math.max(2, geo.hIn - geo.margins.top - geo.margins.bottom - 0.08);
  return `.gx{font-family:'${DocModel.safeFont(d.font)}',serif;font-size:${d.size}pt;line-height:${d.lh};color:#111;background:#fff;text-align:left}
.gx *{box-sizing:border-box}
.gx p{margin:0 0 6pt;white-space:pre-wrap;overflow-wrap:break-word;orphans:2;widows:2}
.gx h1,.gx h2,.gx h3{margin:12pt 0 6pt;line-height:1.25;break-after:avoid;font-weight:700}
.gx h1{font-size:20pt}.gx h2{font-size:16pt}.gx h3{font-size:14pt}
.gx ul,.gx ol{margin:0 0 6pt;padding-left:36pt}.gx li{margin:0 0 3pt;white-space:pre-wrap;overflow-wrap:break-word}
.gx .pagebreak{break-after:page;height:0;margin:0;border:0}
.gx .gx-chapter.gx-nb{break-before:page}
.gx .gx-chapter-title{text-align:center;font-size:22pt;margin:0 0 24pt;padding-top:18pt}
.gx .gx-cover{height:${contentH}in;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;break-after:page;overflow:hidden}
.gx .gx-cover .gx-ct{font-size:34pt;font-weight:700;line-height:1.15;margin:0 0 14pt;overflow-wrap:anywhere}
.gx .gx-cover .gx-cs{font-size:16pt;margin:0 0 40pt;font-style:italic}
.gx .gx-cover .gx-ca{font-size:15pt;letter-spacing:.04em}
.gx sup.fnref{font-size:.7em;line-height:0;vertical-align:super}
.gx .gx-notes{margin-top:18pt;padding-top:6pt;border-top:.5pt solid #999;font-size:.85em;line-height:1.3;break-inside:avoid-page}
.gx .gx-notes-h{font-weight:700;margin:0 0 4pt}.gx .gx-note{margin:0 0 3pt;white-space:pre-wrap;overflow-wrap:break-word}.gx .gx-note sup{font-size:.75em;margin-right:3pt}
.gx ins.rv-ins{color:#0B6E2E;text-decoration:underline}.gx del.rv-del{color:#B3261E;text-decoration:line-through}
.gx .gx-toc{break-after:page}.gx .gx-toc-row{margin:0 0 5pt;padding-left:4pt}.gx .gx-toc-sub{margin:0 0 3pt 22pt;font-size:.92em;color:#444}.gx .gx-toc-h{font-weight:700;margin:12pt 0 5pt}
.gx .gx-bible.gx-nb{break-before:page}
.gx .gx-type{font-size:16pt;margin:18pt 0 8pt;padding-bottom:3pt;border-bottom:1.5pt solid #bbb;display:flex;align-items:center;gap:8pt;break-after:avoid}
.gx .gx-dot{display:inline-block;width:10pt;height:10pt;border-radius:50%;flex:none}
.gx .gx-prof{margin:0 0 14pt;break-inside:avoid;overflow:hidden}
.gx .gx-prof h3{font-size:13.5pt;margin:0 0 5pt}
.gx .gx-pimg{float:right;margin:0 0 6pt 12pt;max-width:1.7in;max-height:1.7in;object-fit:cover;border-radius:4pt;border:.5pt solid #ccc}
.gx .gx-field{margin:0 0 4pt;font-size:.93em;line-height:1.35}.gx .gx-fl{font-weight:700;margin-right:5pt}.gx .gx-fv{white-space:pre-wrap;overflow-wrap:break-word}
.gx .gx-map-title{font-size:16pt;margin:0 0 6pt;text-align:left}
.gx .gx-legend{display:flex;flex-wrap:wrap;gap:3pt 14pt;font-size:8.5pt;color:#444;margin-top:4pt}.gx .gx-legend i{display:inline-block;width:8pt;height:8pt;border-radius:50%;margin-right:4pt;vertical-align:-1pt}
.gx .gx-map-prev{margin:0 0 18pt;border:.5pt dashed #bbb;padding:8pt;aspect-ratio:${(geo.hIn / geo.wIn).toFixed(4)};break-inside:avoid;display:flex;flex-direction:column}
.gx .gx-map-prev .gx-map-fig{flex:1;min-height:0}
.gx .gx-map-cap{font-size:8.5pt;color:#777;margin:0 0 4pt}`;
}

function pick(chapters, opts) {
  if (!opts.manuscript) return [];
  if (!opts.chapterIds) return chapters;
  const set = new Set(opts.chapterIds);
  return chapters.filter((c) => set.has(c.id));
}

// ---------- biblia ----------
function fieldText(f, v, profById) {
  switch (f.kind) {
    case 'check': return v ? 'Sí' : '';
    case 'tags': return Array.isArray(v) ? v.join(', ') : '';
    case 'relation': return Array.isArray(v) ? v.map((id) => profById.get(id)).filter(Boolean).map((x) => String(x.name || '').trim() || 'Sin nombre').join(', ') : '';
    case 'number': return v === '' || v == null ? '' : String(v);
    case 'image': return '';
    default: return typeof v === 'string' ? v.trim() : '';
  }
}
function bibleHtml(bible, opts) {
  if (!bible || !Array.isArray(bible.types) || !Array.isArray(bible.profiles)) return { html: '', count: 0, types: [] };
  const profById = new Map(bible.profiles.map((p) => [p.id, p]));
  const typeSet = opts.bibleTypeIds ? new Set(opts.bibleTypeIds) : null;
  const profSet = opts.bibleProfileIds ? new Set(opts.bibleProfileIds) : null;
  let html = '', count = 0;
  const used = [];
  for (const t of bible.types) {
    if (typeSet && !typeSet.has(t.id)) continue;
    const profs = bible.profiles.filter((p) => p.typeId === t.id && (!profSet || profSet.has(p.id)));
    if (!profs.length) continue;
    const dot = /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#999999';
    html += `<h2 class="gx-type"><span class="gx-dot" style="background:${dot}"></span>${esc(t.name || 'Sin tipo')}</h2>`;
    for (const p of profs) {
      count++;
      const vals = p.values && typeof p.values === 'object' ? p.values : {};
      let imgs = '', rows = '';
      for (const f of t.fields || []) {
        const v = vals[f.id];
        if (f.kind === 'image') {
          if (typeof v === 'string' && v.length <= MAX_IMG && IMG_RE.test(v)) imgs += `<img class="gx-pimg" src="${v}" alt="${esc(f.label || '')}">`;
          continue;
        }
        const txt = fieldText(f, v, profById);
        if (txt) rows += `<div class="gx-field"><span class="gx-fl">${esc(f.label || '')}:</span><span class="gx-fv">${esc(txt)}</span></div>`;
      }
      html += `<div class="gx-prof"><h3>${esc(String(p.name || '').trim() || 'Sin nombre')}</h3>${imgs}${rows}</div>`;
    }
    used.push({ name: t.name || 'Sin tipo', count: profs.length });
  }
  return { html, count, types: used };
}

// ---------- mapas ----------
function mapsData(extra, opts) {
  if (!opts.maps) return [];
  const set = opts.mapIds ? new Set(opts.mapIds) : null;
  const out = [];
  for (const m of (extra && extra.maps) || []) {
    if (set && !set.has(m.id)) continue;
    const r = mapToSvg(m.data, extra && extra.bible);
    if (r) out.push({ id: m.id, name: m.name || 'Mapa', svg: r.svg, legend: r.legend, nodes: r.nodes, edges: r.edges });
  }
  return out;
}
const legendHtml = (l) => (l.length ? `<div class="gx-legend">${l.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join('')}</div>` : '');

// Geometría de las páginas de mapas: la misma hoja en horizontal.
function mapGeometry(geo) {
  return Object.assign({}, geo, { wIn: geo.hIn, hIn: geo.wIn, pageSize: { width: geo.hIn, height: geo.wIn } });
}

// chapters: [{id,title,model}] en orden. extra: { bible, maps:[{id,name,data}] } (opcional).
function buildParts(project, user, chapters, rawOpts, extra) {
  const opts = sanitizeOptions(project, user, rawOpts);
  const geo = geometry(project, opts);
  const list = pick(chapters, opts);
  const bible = opts.bible ? bibleHtml(extra && extra.bible, opts) : { html: '', count: 0, types: [] };
  const mapPages = mapsData(extra, opts);
  let body = '';
  if (opts.cover) {
    body += `<div class="gx-cover"><div class="gx-ct">${esc(opts.title)}</div>${opts.subtitle ? `<div class="gx-cs">${esc(opts.subtitle)}</div>` : ''}${opts.author ? `<div class="gx-ca">${esc(opts.author)}</div>` : ''}</div>`;
  }
  if (opts.toc && (list.length || bible.count || mapPages.length)) {
    let t = '<div class="gx-toc"><h1 class="gx-chapter-title">Contenido</h1>';
    if (list.length) { t += '<div class="gx-toc-h">Manuscrito</div>'; for (const c of list) t += `<div class="gx-toc-row">${esc(c.title)}</div>`; }
    if (bible.count) { t += `<div class="gx-toc-h">Biblia del proyecto</div>`; for (const x of bible.types) t += `<div class="gx-toc-sub">${esc(x.name)} (${x.count})</div>`; }
    if (mapPages.length) { t += '<div class="gx-toc-h">Mapas</div>'; for (const m of mapPages) t += `<div class="gx-toc-row">${esc(m.name)}</div>`; }
    body += t + '</div>';
  }
  list.forEach((c, i) => {
    const nb = opts.pageBreaks && i > 0 ? ' gx-nb' : '';
    const pr = { print: true, revisions: opts.revisions };
    const inner = DocModel.modelToHtml(c.model, pr);
    const notes = pr.result && pr.result.list.length
      ? `<div class="gx-notes"><div class="gx-notes-h">Notas</div>${pr.result.list.map((n) => `<div class="gx-note"><sup>${n.n}</sup>${esc(n.text)}</div>`).join('')}</div>` : '';
    body += `<section class="gx-chapter${nb}">${opts.chapterTitles ? `<h1 class="gx-chapter-title">${esc(c.title)}</h1>` : ''}${inner}${notes}</section>`;
  });
  if (bible.count) {
    const nb = body ? ' gx-nb' : '';
    body += `<section class="gx-bible${nb}"><h1 class="gx-chapter-title">Biblia del proyecto</h1>${bible.html}</section>`;
  }
  // Los mapas van en su propio PDF horizontal que luego se une; en la vista previa se muestran en línea.
  const mapsBody = mapPages.map((m, i) => `<section class="gx-map${i ? ' gx-nb-map' : ''}"><h2 class="gx-map-title">${esc(m.name)}</h2><div class="gx-map-fig">${m.svg}</div>${legendHtml(m.legend)}</section>`).join('');
  const previewMaps = mapPages.map((m) => `<section class="gx-map-prev"><div class="gx-map-cap">Mapa — se imprime en una página horizontal</div><h2 class="gx-map-title">${esc(m.name)}</h2><div class="gx-map-fig">${m.svg}</div>${legendHtml(m.legend)}</section>`).join('');
  return {
    opts, geo, css: css(project, geo), body, mapsBody, previewBody: body + previewMaps, mapPages,
    mapGeo: mapGeometry(geo), hasMain: !!body,
    bibleCount: bible.count,
    chapters: list.map((c) => ({ id: c.id, title: c.title })),
  };
}

function buildHtml(parts) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(parts.opts.title)}</title><style>html,body{margin:0;padding:0;background:#fff}${parts.css}</style></head><body><div class="gx">${parts.body}</div></body></html>`;
}

function mapsCss(parts) {
  const g = parts.mapGeo;
  const contentH = Math.max(2, g.hIn - g.margins.top - g.margins.bottom - 0.1);
  return `.gx{font-family:'Segoe UI',Arial,sans-serif;color:#111;background:#fff}.gx *{box-sizing:border-box}
.gx .gx-map{height:${contentH}in;display:flex;flex-direction:column;overflow:hidden}
.gx .gx-nb-map{break-before:page}
.gx .gx-map-title{font-size:16pt;margin:0 0 6pt;font-weight:700}
.gx .gx-map-fig{flex:1;min-height:0}.gx .gx-map-fig svg{display:block;width:100%;height:100%}
.gx .gx-legend{display:flex;flex-wrap:wrap;gap:3pt 14pt;font-size:8.5pt;color:#444;margin-top:4pt}.gx .gx-legend i{display:inline-block;width:8pt;height:8pt;border-radius:50%;margin-right:4pt}`;
}
function buildMapsHtml(parts) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(parts.opts.title)}</title><style>html,body{margin:0;padding:0;background:#fff}${mapsCss(parts)}</style></head><body><div class="gx">${parts.mapsBody}</div></body></html>`;
}
function mapsPdfOptions(parts) {
  return { pageSize: parts.mapGeo.pageSize, margins: parts.mapGeo.margins, printBackground: true, displayHeaderFooter: false, headerTemplate: '<div></div>', footerTemplate: '<div></div>' };
}
// Une el PDF del manuscrito/biblia con el de los mapas (horizontal) y numera las páginas de mapas a continuación.
async function mergePdfs(mainBuf, mapsBuf, opts) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const out = mainBuf ? await PDFDocument.load(mainBuf, { updateMetadata: false }) : await PDFDocument.create();
  const maps = await PDFDocument.load(mapsBuf, { updateMetadata: false });
  const start = out.getPageCount();
  const pages = await out.copyPages(maps, maps.getPageIndices());
  const font = opts && opts.pageNumbers ? await out.embedFont(StandardFonts.Helvetica) : null;
  pages.forEach((pg, i) => {
    out.addPage(pg);
    if (font) {
      const t = String(start + i + 1), { width } = pg.getSize();
      pg.drawText(t, { x: (width - font.widthOfTextAtSize(t, 8)) / 2, y: 30, size: 8, font, color: rgb(0.33, 0.33, 0.33) });
    }
  });
  return Buffer.from(await out.save());
}

function pdfOptions(parts) {
  const { opts, geo } = parts;
  const hf = opts.pageNumbers || opts.header;
  const base = "font-family:'Segoe UI',Arial,sans-serif;font-size:8pt;color:#555;width:100%;";
  const padL = geo.margins.left + 'in', padR = geo.margins.right + 'in';
  const header = opts.header
    ? `<div style="${base}display:flex;justify-content:space-between;padding:0 ${padR} 0 ${padL};"><span>${esc(opts.author)}</span><span>${esc(opts.title)}</span></div>`
    : '<div></div>';
  const footer = opts.pageNumbers
    ? `<div style="${base}text-align:center;"><span class="pageNumber"></span></div>`
    : '<div></div>';
  return {
    pageSize: geo.pageSize,
    margins: geo.margins,
    printBackground: true,
    displayHeaderFooter: hf,
    headerTemplate: header,
    footerTemplate: footer,
  };
}

// Manuscrito completo en un solo modelo (para exportar a .docx).
function buildManuscriptModel(project, user, chapters, rawOpts) {
  const opts = sanitizeOptions(project, user, rawOpts);
  const list = pick(chapters, opts);
  const defaults = DocModel.sanitizeDefaults(project.defaults);
  const blocks = [];
  const notes = [], comments = [];
  let track = false;
  if (opts.cover) {
    for (let i = 0; i < 8; i++) blocks.push({ t: 'p', align: 'center', runs: [] });
    blocks.push({ t: 'p', align: 'center', runs: [{ text: opts.title, b: true, size: 30 }] });
    if (opts.subtitle) blocks.push({ t: 'p', align: 'center', runs: [{ text: opts.subtitle, i: true, size: 16 }] });
    blocks.push({ t: 'p', align: 'center', runs: [] });
    if (opts.author) blocks.push({ t: 'p', align: 'center', runs: [{ text: opts.author, size: 14 }] });
    blocks.push({ t: 'pb' });
  }
  list.forEach((c, i) => {
    if (i > 0 && opts.pageBreaks) blocks.push({ t: 'pb' });
    if (opts.chapterTitles) blocks.push({ t: 'h1', align: 'center', runs: [{ text: c.title }] });
    // 'final': cambios aceptados y sin comentarios. 'markup': se conservan cambios y comentarios.
    let m = c.model;
    if (opts.revisions === 'final') m = DocModel.stripComments(DocModel.applyRevisions(m, true));
    m = DocModel.prefixIds(m, 'c' + i + '_');   // evita choques de ids entre capítulos
    for (const b of m.blocks) blocks.push(b);
    if (m.notes) notes.push(...m.notes);
    if (m.comments) comments.push(...m.comments);
    if (m.track) track = true;
  });
  return { opts, model: DocModel.sanitizeModel({ defaults, blocks, notes, comments, track }) };
}

module.exports = { sanitizeOptions, buildParts, buildHtml, buildMapsHtml, pdfOptions, mapsPdfOptions, mergePdfs, buildManuscriptModel, geometry };
