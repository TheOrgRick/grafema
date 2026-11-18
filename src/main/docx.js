'use strict';
// Motor .docx de Grafema: escribe y lee documentos de Word (OOXML) sin dependencias externas.
const { createZip, readZip } = require('./zip');
const X = require('./xml');
const DocModel = require('../shared/docmodel');

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = X.esc;

// ======================================================================
// ESCRITURA
// ======================================================================
const NS_W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const NS_W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';
const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const paraId = (i) => (0x10000000 + i).toString(16).toUpperCase().padStart(8, '0');

// Contexto de escritura: numera las notas, enlaza comentarios y reparte ids de revisión.
function makeCtx(model) {
  const comments = model.comments || [];
  const ctx = {
    now: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    noteText: new Map((model.notes || []).map((n) => [n.id, n.text])),
    fnOrder: [], fnNums: new Map(),
    comments, comMap: new Map(comments.map((c, i) => [c.id, i])), started: new Set(), last: new Map(), pos: 0,
    rev: 1000,
    fnNum(id) {
      if (!this.noteText.has(id)) return 0;
      if (!this.fnNums.has(id)) { this.fnOrder.push(id); this.fnNums.set(id, this.fnOrder.length); }
      return this.fnNums.get(id);
    },
    revId() { return ++this.rev; },
    date(d) { if (!d) return this.now; const x = String(d).replace(/\.\d+/, ''); return /Z$/.test(x) ? x : x + 'Z'; },
  };
  // Posición (nº de tramo de texto) del último tramo de cada comentario: el rango se abre una vez y se cierra allí.
  let pos = 0;
  for (const b of model.blocks) for (const r of b.runs || []) {
    if (r.br || r.fn !== undefined) continue;
    pos++;
    for (const id of r.cm || []) if (ctx.comMap.has(id)) ctx.last.set(id, pos);
  }
  return ctx;
}

function runXml(r, ctx) {
  if (r.br) return '<w:r><w:br/></w:r>';
  if (r.fn !== undefined) {
    const n = ctx ? ctx.fnNum(r.fn) : 0;
    return n ? `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${n}"/></w:r>` : '';
  }
  const rp = [];
  if (r.font) rp.push(`<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:eastAsia="${esc(r.font)}" w:cs="${esc(r.font)}"/>`);
  if (r.b) rp.push('<w:b/><w:bCs/>');
  if (r.i) rp.push('<w:i/><w:iCs/>');
  if (r.s) rp.push('<w:strike/>');
  if (r.color) rp.push(`<w:color w:val="${r.color.slice(1)}"/>`);
  if (r.size) rp.push(`<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`);
  if (r.u) rp.push('<w:u w:val="single"/>');
  if (r.bg) rp.push(`<w:shd w:val="clear" w:color="auto" w:fill="${r.bg.slice(1)}"/>`);
  if (r.sup) rp.push('<w:vertAlign w:val="superscript"/>');
  else if (r.sub) rp.push('<w:vertAlign w:val="subscript"/>');
  const pr = rp.length ? `<w:rPr>${rp.join('')}</w:rPr>` : '';
  const del = !!(r.tc && r.tc.t === 'del');
  // Divide por tabuladores y saltos de línea incrustados.
  let inner = '';
  const pieces = String(r.text).split(/(\t|\r?\n)/);
  for (const p of pieces) {
    if (p === '') continue;
    if (p === '\t') inner += '<w:tab/>';
    else if (p === '\n' || p === '\r\n') inner += '<w:br/>';
    else inner += del ? `<w:delText xml:space="preserve">${esc(p)}</w:delText>` : `<w:t xml:space="preserve">${esc(p)}</w:t>`;
  }
  if (!inner) return '';
  let xml = `<w:r>${pr}${inner}</w:r>`;
  if (r.tc && ctx) xml = `<w:${r.tc.t} w:id="${ctx.revId()}" w:author="${esc(r.tc.a || 'Autor')}" w:date="${ctx.date(r.tc.d)}">${xml}</w:${r.tc.t}>`;
  return xml;
}

const commentEnd = (n) => `<w:commentRangeEnd w:id="${n}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${n}"/></w:r>`;

// Runs de un párrafo. Cada comentario abre su rango en su primer tramo y lo cierra tras el último.
function blockRunsXml(runs, ctx) {
  let out = '';
  for (const r of runs) {
    if (r.br || r.fn !== undefined) { out += runXml(r, ctx); continue; }
    ctx.pos++;
    const mine = (r.cm || []).filter((id) => ctx.comMap.has(id));
    for (const id of mine) if (!ctx.started.has(id)) { out += `<w:commentRangeStart w:id="${ctx.comMap.get(id)}"/>`; ctx.started.add(id); }
    out += runXml(r, ctx);
    for (const id of mine) if (ctx.last.get(id) === ctx.pos) out += commentEnd(ctx.comMap.get(id));
  }
  return out;
}

function buildDocument(model, page) {
  const pg = DocModel.sanitizePage(page);
  const dims = DocModel.PAGE_SIZES[pg.size];
  const ctx = makeCtx(model);
  let body = '';
  let orderedCount = 0;   // 1 = viñetas; 2+ = listas numeradas (cada lista nueva reinicia en 1)
  let curOrdered = null;
  for (const b of model.blocks) {
    if (b.t === 'pb') { body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; curOrdered = null; continue; }
    const pp = [];
    if (b.t === 'h1') pp.push('<w:pStyle w:val="Heading1"/>');
    else if (b.t === 'h2') pp.push('<w:pStyle w:val="Heading2"/>');
    else if (b.t === 'h3') pp.push('<w:pStyle w:val="Heading3"/>');
    if (b.t !== 'li') curOrdered = null;
    else {
      pp.push('<w:pStyle w:val="ListParagraph"/>');
      const lvl = b.list.level;
      let id = 1;
      if (b.list.ordered) {
        if (curOrdered === null) { orderedCount++; curOrdered = 1 + orderedCount; }
        id = curOrdered;
      } else if (lvl === 0) curOrdered = null;
      pp.push(`<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`);
    }
    if (b.lh) pp.push(`<w:spacing w:line="${Math.round(b.lh * 240)}" w:lineRule="auto"/>`);
    if (b.fi) pp.push(`<w:ind w:firstLine="${Math.round(b.fi)}"/>`);
    if (b.align) pp.push(`<w:jc w:val="${b.align === 'justify' ? 'both' : b.align}"/>`);
    const ppr = pp.length ? `<w:pPr>${pp.join('')}</w:pPr>` : '';
    body += `<w:p>${ppr}${blockRunsXml(b.runs, ctx)}</w:p>`;
  }
  const sect = `<w:sectPr><w:pgSz w:w="${dims.w}" w:h="${dims.h}"/><w:pgMar w:top="${pg.margins.top}" w:right="${pg.margins.right}" w:bottom="${pg.margins.bottom}" w:left="${pg.margins.left}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  return { xml: `${HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${body}${sect}</w:body></w:document>`, orderedCount, ctx };
}

function footnotesXml(ctx) {
  const sep = (type, id, inner) => `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r>${inner}</w:r></w:p></w:footnote>`;
  let body = sep('separator', -1, '<w:separator/>') + sep('continuationSeparator', 0, '<w:continuationSeparator/>');
  ctx.fnOrder.forEach((id, i) => {
    const paras = String(ctx.noteText.get(id) || '').split(/\r?\n/);
    const ps = paras.map((t, k) => `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${k === 0 ? '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' : ''}<w:r><w:t xml:space="preserve">${k === 0 ? ' ' : ''}${esc(t)}</w:t></w:r></w:p>`).join('');
    body += `<w:footnote w:id="${i + 1}">${ps}</w:footnote>`;
  });
  return `${HEAD}<w:footnotes xmlns:w="${NS_W}" xmlns:r="${NS_R}">${body}</w:footnotes>`;
}

function commentsXml(ctx) {
  const initials = (a) => ((String(a || 'A').match(/\p{L}/gu) || ['A']).slice(0, 1).join('') + (String(a || '').split(/\s+/)[1] || '').charAt(0)).toUpperCase();
  let body = '';
  ctx.comments.forEach((c, i) => {
    const paras = String(c.text || '').split(/\r?\n/);
    const ps = paras.map((t, k) => {
      const last = k === paras.length - 1;
      const pid = last ? ` w14:paraId="${paraId(i)}" w14:textId="77777777"` : '';
      const ref = k === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : '';
      return `<w:p${pid}><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${ref}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
    }).join('');
    body += `<w:comment w:id="${i}" w:author="${esc(c.author || 'Autor')}" w:date="${ctx.date(c.date)}" w:initials="${esc(initials(c.author))}">${ps}</w:comment>`;
  });
  return `${HEAD}<w:comments xmlns:w="${NS_W}" xmlns:w14="${NS_W14}" xmlns:mc="${NS_MC}" mc:Ignorable="w14">${body}</w:comments>`;
}
function commentsExtXml(ctx) {
  const body = ctx.comments.map((c, i) => `<w15:commentEx w15:paraId="${paraId(i)}" w15:done="${c.resolved ? 1 : 0}"/>`).join('');
  return `${HEAD}<w15:commentsEx xmlns:mc="${NS_MC}" xmlns:w15="${NS_W15}" mc:Ignorable="w15">${body}</w15:commentsEx>`;
}

function stylesXml(defaults) {
  const d = DocModel.sanitizeDefaults(defaults);
  const f = esc(d.font);
  const hs = Math.round(d.size * 2);
  const heading = (n, sz, before, after) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  return `${HEAD}<w:styles xmlns:w="${NS_W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/><w:sz w:val="${hs}"/><w:szCs w:val="${hs}"/><w:lang w:val="es-MX" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${Math.round(d.lh * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>` +
    heading(1, 40, 360, 120) + heading(2, 32, 280, 100) + heading(3, 28, 240, 80) +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>` +
    `<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:uiPriority w:val="99"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>` +
    `</w:styles>`;
}

function numberingXml(orderedCount) {
  const bullets = ['•', '◦', '▪'];
  const fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
  const lvls = (kind) => {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const left = 720 * (i + 1);
      if (kind === 'bullet') {
        s += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bullets[i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
      } else {
        s += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmts[i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
      }
    }
    return s;
  };
  let nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
  for (let i = 0; i < Math.max(1, orderedCount); i++) {
    let ov = '';
    for (let l = 0; l < 9; l++) ov += `<w:lvlOverride w:ilvl="${l}"><w:startOverride w:val="1"/></w:lvlOverride>`;
    nums += `<w:num w:numId="${2 + i}"><w:abstractNumId w:val="1"/>${ov}</w:num>`;
  }
  return `${HEAD}<w:numbering xmlns:w="${NS_W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('ordered')}</w:abstractNum>${nums}</w:numbering>`;
}

function buildDocx(modelIn, opts) {
  opts = opts || {};
  const model = DocModel.sanitizeModel(modelIn);
  const doc = buildDocument(model, opts.page);
  const ctx = doc.ctx;
  const hasFn = ctx.fnOrder.length > 0, hasCm = ctx.comments.length > 0;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const created = opts.created ? new Date(opts.created).toISOString().replace(/\.\d+Z$/, 'Z') : now;
  const title = esc(opts.title || '');
  const author = esc(opts.author || '');
  const ov = (part, type) => `<Override PartName="/word/${part}" ContentType="${CT}.${type}+xml"/>`;
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  const contentTypes = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>${ov('styles.xml', 'styles')}${ov('numbering.xml', 'numbering')}${ov('settings.xml', 'settings')}` +
    (hasFn ? ov('footnotes.xml', 'footnotes') : '') + (hasCm ? ov('comments.xml', 'comments') + ov('commentsExtended.xml', 'commentsExtended') : '') +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const docRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rel('rId1', `${REL}/styles`, 'styles.xml') + rel('rId2', `${REL}/numbering`, 'numbering.xml') + rel('rId3', `${REL}/settings`, 'settings.xml') +
    (hasFn ? rel('rId4', `${REL}/footnotes`, 'footnotes.xml') : '') + (hasCm ? rel('rId5', `${REL}/comments`, 'comments.xml') + rel('rId6', 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', 'commentsExtended.xml') : '') + '</Relationships>';
  const settings = `${HEAD}<w:settings xmlns:w="${NS_W}"><w:zoom w:percent="100"/>${model.track ? '<w:trackRevisions/>' : ''}<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>` +
    `${hasFn ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/document.xml', data: doc.xml },
    { name: 'word/styles.xml', data: stylesXml(model.defaults) },
    { name: 'word/numbering.xml', data: numberingXml(doc.orderedCount) },
    { name: 'word/settings.xml', data: settings },
  ];
  if (hasFn) entries.push({ name: 'word/footnotes.xml', data: footnotesXml(ctx) });
  if (hasCm) { entries.push({ name: 'word/comments.xml', data: commentsXml(ctx) }); entries.push({ name: 'word/commentsExtended.xml', data: commentsExtXml(ctx) }); }
  entries.push(
    { name: 'docProps/core.xml', data: `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><cp:lastModifiedBy>${author}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Grafema</Application><Company>Petricorp</Company><AppVersion>1.1000</AppVersion></Properties>` });
  return createZip(entries);
}

// ======================================================================
// LECTURA
// ======================================================================
const HIGHLIGHTS = {
  yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF',
};

const val = (node, name) => X.attr(X.kid(node, name), 'w:val');
const flag = (node, name) => {
  const k = X.kid(node, name);
  if (!k) return undefined;
  const v = X.attr(k, 'w:val');
  return !(v === '0' || v === 'false' || v === 'off' || v === 'none');
};

function readRPr(rpr, theme) {
  const o = {};
  if (!rpr) return o;
  const rf = X.kid(rpr, 'w:rFonts');
  if (rf) {
    let f = rf.attrs['w:ascii'] || rf.attrs['w:hAnsi'] || rf.attrs['w:cs'] || rf.attrs['w:eastAsia'];
    const th = rf.attrs['w:asciiTheme'] || rf.attrs['w:hAnsiTheme'];
    if (!f && th && theme) f = /^major/i.test(th) ? theme.major : theme.minor;
    if (f) o.font = f;
  }
  const b = flag(rpr, 'w:b'); if (b !== undefined) o.b = b;
  const i = flag(rpr, 'w:i'); if (i !== undefined) o.i = i;
  const u = flag(rpr, 'w:u'); if (u !== undefined) o.u = u;
  const s = flag(rpr, 'w:strike'); const ds = flag(rpr, 'w:dstrike');
  if (s !== undefined || ds !== undefined) o.s = !!(s || ds);
  const sz = val(rpr, 'w:sz'); if (sz && /^\d+$/.test(sz)) o.size = parseInt(sz, 10) / 2;
  const c = val(rpr, 'w:color'); if (c && /^[0-9a-fA-F]{6}$/.test(c)) o.color = '#' + c.toUpperCase();
  const hl = val(rpr, 'w:highlight'); if (hl && HIGHLIGHTS[hl]) o.bg = HIGHLIGHTS[hl];
  const shd = X.kid(rpr, 'w:shd');
  if (shd && !o.bg) { const fill = shd.attrs['w:fill']; if (fill && /^[0-9a-fA-F]{6}$/.test(fill)) o.bg = '#' + fill.toUpperCase(); }
  const va = val(rpr, 'w:vertAlign');
  if (va === 'superscript') o.sup = true; else if (va === 'subscript') o.sub = true;
  return o;
}

function readPPr(ppr) {
  const o = {};
  if (!ppr) return o;
  const ps = val(ppr, 'w:pStyle'); if (ps) o.style = ps;
  const jc = val(ppr, 'w:jc');
  if (jc) o.align = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left';
  const sp = X.kid(ppr, 'w:spacing');
  if (sp) {
    const line = parseInt(sp.attrs['w:line'], 10);
    const rule = sp.attrs['w:lineRule'] || 'auto';
    if (Number.isFinite(line) && rule === 'auto') o.lh = Math.round((line / 240) * 100) / 100;
  }
  const ind = X.kid(ppr, 'w:ind');
  if (ind) {
    const fl = parseInt(ind.attrs['w:firstLine'], 10);
    if (Number.isFinite(fl)) o.fi = fl;
    if (ind.attrs['w:hanging'] !== undefined) o.fi = 0;
  }
  const np = X.kid(ppr, 'w:numPr');
  if (np) {
    o.numId = val(np, 'w:numId');
    const il = parseInt(val(np, 'w:ilvl'), 10);
    o.ilvl = Number.isFinite(il) ? il : 0;
  }
  if (X.kid(ppr, 'w:pageBreakBefore')) o.pbb = true;
  return o;
}

function readTheme(xml) {
  if (!xml) return null;
  const major = xml.match(/<a:majorFont>\s*<a:latin typeface="([^"]*)"/);
  const minor = xml.match(/<a:minorFont>\s*<a:latin typeface="([^"]*)"/);
  return { major: major ? major[1] : '', minor: minor ? minor[1] : '' };
}

function readStyles(xml, theme) {
  const out = { map: {}, defaults: { rpr: {}, ppr: {} }, normalId: 'Normal' };
  if (!xml) return out;
  const root = X.kid(X.parse(xml), 'w:styles');
  if (!root) return out;
  const dd = X.kid(root, 'w:docDefaults');
  if (dd) {
    out.defaults.rpr = readRPr(X.kid(X.kid(dd, 'w:rPrDefault'), 'w:rPr'), theme);
    out.defaults.ppr = readPPr(X.kid(X.kid(dd, 'w:pPrDefault'), 'w:pPr'));
  }
  for (const st of X.kids(root, 'w:style')) {
    const id = st.attrs['w:styleId'];
    if (!id) continue;
    out.map[id] = {
      id, type: st.attrs['w:type'], name: val(st, 'w:name') || id, basedOn: val(st, 'w:basedOn'),
      ppr: readPPr(X.kid(st, 'w:pPr')), rpr: readRPr(X.kid(st, 'w:rPr'), theme),
    };
    if (st.attrs['w:type'] === 'paragraph' && (st.attrs['w:default'] === '1' || st.attrs['w:default'] === 'true')) out.normalId = id;
  }
  return out;
}

function readNumbering(xml) {
  const out = { abs: {}, nums: {} };
  if (!xml) return out;
  const root = X.kid(X.parse(xml), 'w:numbering');
  if (!root) return out;
  for (const a of X.kids(root, 'w:abstractNum')) {
    const id = a.attrs['w:abstractNumId'];
    const lv = {};
    for (const l of X.kids(a, 'w:lvl')) lv[l.attrs['w:ilvl']] = val(l, 'w:numFmt') || 'decimal';
    out.abs[id] = lv;
  }
  for (const n of X.kids(root, 'w:num')) out.nums[n.attrs['w:numId']] = val(n, 'w:abstractNumId');
  return out;
}

function chain(styles, id) {
  const list = [];
  const seen = new Set();
  while (id && styles.map[id] && !seen.has(id)) { seen.add(id); list.unshift(styles.map[id]); id = styles.map[id].basedOn; }
  return list;
}
const merge = (list, key) => Object.assign({}, ...list.map((s) => s[key]));

// Notas al pie y comentarios: texto plano por id.
function paragraphsText(node) {
  return X.kids(node, 'w:p').map((p) => X.find(p, 'w:t').map((t) => X.text(t)).join('')).join('\n').replace(/^ /, '');
}
function readFootnotes(xml) {
  const out = new Map();
  if (!xml) return out;
  const root = X.kid(X.parse(xml), 'w:footnotes');
  for (const fn of X.kids(root, 'w:footnote')) {
    const type = fn.attrs['w:type'];
    if (type && type !== 'normal') continue;
    const id = String(fn.attrs['w:id'] || '');
    if (/^\d+$/.test(id)) out.set(id, paragraphsText(fn));
  }
  return out;
}
function readComments(xml, extXml) {
  const out = new Map();
  if (!xml) return out;
  const done = new Set();
  if (extXml) for (const e of X.find(X.parse(extXml), 'w15:commentEx')) if (e.attrs['w15:done'] === '1') done.add(e.attrs['w15:paraId']);
  const root = X.kid(X.parse(xml), 'w:comments');
  for (const c of X.kids(root, 'w:comment')) {
    const id = String(c.attrs['w:id'] || '');
    if (!/^\d+$/.test(id)) continue;
    const ids = X.kids(c, 'w:p').map((p) => p.attrs['w14:paraId']).filter(Boolean);
    out.set(id, { author: c.attrs['w:author'] || '', date: c.attrs['w:date'] || '', text: paragraphsText(c), resolved: ids.some((x) => done.has(x)) });
  }
  return out;
}

function parseDocx(buf) {
  let files;
  try {
    files = readZip(buf, (n) => /^word\/[^/]+\.xml$/.test(n) || n === 'docProps/core.xml' || n === 'word/theme/theme1.xml');
  } catch (e) {
    const err = new Error('El archivo no es un .docx válido. Si es un .doc antiguo, ábrelo en Word y guárdalo como .docx.');
    err.code = 'DOCX_INVALID';
    throw err;
  }
  const get = (n) => (files.has(n) ? files.get(n).toString('utf8') : null);
  const docXml = get('word/document.xml');
  if (!docXml) {
    const err = new Error('El archivo no contiene un documento de Word legible (falta document.xml).');
    err.code = 'DOCX_INVALID';
    throw err;
  }
  const theme = readTheme(get('word/theme/theme1.xml'));
  const styles = readStyles(get('word/styles.xml'), theme);
  const numbering = readNumbering(get('word/numbering.xml'));
  const notesMap = readFootnotes(get('word/footnotes.xml'));
  const commentsMap = readComments(get('word/comments.xml'), get('word/commentsExtended.xml'));
  const setXml = get('word/settings.xml') || '';
  const track = /<w:trackRevisions\b(?![^>]*w:val="(?:0|false|off)")/.test(setXml);
  const activeCm = new Set();   // comentarios cuyo rango está abierto (pueden cruzar párrafos)
  let curTc = null;             // cambio marcado que se está leyendo (<w:ins> / <w:del>)
  const core = get('docProps/core.xml');
  const meta = {};
  if (core) {
    const t = core.match(/<dc:title>([\s\S]*?)<\/dc:title>/); if (t) meta.title = X.decode(t[1]);
    const a = core.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/); if (a) meta.author = X.decode(a[1]);
  }

  // Valores base del documento = docDefaults + estilo Normal.
  const normalChain = chain(styles, styles.normalId);
  const baseR = Object.assign({}, styles.defaults.rpr, merge(normalChain, 'rpr'));
  const baseP = Object.assign({}, styles.defaults.ppr, merge(normalChain, 'ppr'));
  const defaults = DocModel.sanitizeDefaults({
    font: baseR.font || DocModel.DEFAULT_DEFAULTS.font,
    size: baseR.size || DocModel.DEFAULT_DEFAULTS.size,
    lh: baseP.lh || 1,
  });

  const warnings = new Set();
  const counts = { images: 0, tables: 0, boxes: 0 };
  const blocks = [];
  let page = null;

  const root = X.kid(X.parse(docXml), 'w:document');
  const bodyNode = X.kid(root, 'w:body');
  if (!bodyNode) { const err = new Error('El documento está vacío o dañado.'); err.code = 'DOCX_INVALID'; throw err; }

  const isOrdered = (numId, ilvl) => {
    const abs = numbering.abs[numbering.nums[numId]];
    const fmt = abs ? abs[String(ilvl)] || abs['0'] : null;
    return fmt && fmt !== 'bullet' && fmt !== 'none';
  };

  function paragraph(p) {
    const direct = readPPr(X.kid(p, 'w:pPr'));
    const sChain = chain(styles, direct.style || styles.normalId);
    const sPr = merge(sChain, 'ppr');
    const eff = Object.assign({}, baseP, sPr, direct);
    const styleName = ((styles.map[direct.style] || {}).name || direct.style || '').toLowerCase();
    let t = 'p';
    const hm = styleName.match(/^heading\s*([1-9])$/) || (direct.style && String(direct.style).match(/^Heading([1-9])$/i));
    if (hm) t = 'h' + Math.min(3, parseInt(hm[1], 10));
    else if (styleName === 'title') t = 'h1';
    const isHeading = t !== 'p';

    // Lista
    let list = null;
    if (!isHeading) {
      let numId = direct.numId, ilvl = direct.ilvl;
      if (numId === undefined) {
        const sn = sChain.map((s) => s.ppr).filter((x) => x.numId !== undefined).pop();
        if (sn) { numId = sn.numId; ilvl = sn.ilvl; }
      }
      if (numId !== undefined && numId !== '0') {
        list = { ordered: !!isOrdered(numId, ilvl || 0), level: Math.min(8, ilvl || 0) };
      } else if (/list bullet/.test(styleName)) list = { ordered: false, level: 0 };
      else if (/list number/.test(styleName)) list = { ordered: true, level: 0 };
      if (list) t = 'li';
    }

    const styleR = isHeading ? {} : merge(sChain, 'rpr');
    let runs = [];
    const emit = (br) => {
      const blk = { t, runs };
      if (eff.align && eff.align !== 'left') blk.align = eff.align;
      if (eff.lh && Math.abs(eff.lh - defaults.lh) > 0.001) blk.lh = eff.lh;
      if (eff.fi > 0) blk.fi = eff.fi;
      if (list) blk.list = list;
      blocks.push(blk);
      runs = [];
    };

    const pushRun = (text, rp) => {
      const eR = Object.assign({}, styleR, rp);
      const r = { text };
      if (eR.b) r.b = true;
      if (eR.i) r.i = true;
      if (eR.u) r.u = true;
      if (eR.s) r.s = true;
      if (eR.sup) r.sup = true; else if (eR.sub) r.sub = true;
      if (eR.font && eR.font.toLowerCase() !== defaults.font.toLowerCase()) r.font = eR.font;
      if (eR.size && eR.size !== defaults.size && !isHeading) r.size = eR.size;
      if (eR.color) r.color = eR.color;
      if (eR.bg) r.bg = eR.bg;
      if (activeCm.size) { const ids = [...activeCm].map((id) => 'c' + id).filter((id) => commentsMap.has(id.slice(1))); if (ids.length) r.cm = ids; }
      if (curTc) r.tc = Object.assign({}, curTc);
      const prev = runs[runs.length - 1];
      const sameKeys = prev && !prev.br && prev.fn === undefined && ['b', 'i', 'u', 's', 'sup', 'sub', 'font', 'size', 'color', 'bg'].every((k) => prev[k] === r[k])
        && (prev.cm || []).join(' ') === (r.cm || []).join(' ') && ((prev.tc && prev.tc.id) || '') === ((r.tc && r.tc.id) || '');
      if (sameKeys) prev.text += text;
      else runs.push(r);
    };

    function walkInline(node) {
      for (const c of node.children) {
        if (!X.isEl(c)) continue;
        switch (c.name) {
          case 'w:r': {
            let rp = readRPr(X.kid(c, 'w:rPr'), theme);
            const rs = val(X.kid(c, 'w:rPr'), 'w:rStyle');
            if (rs) rp = Object.assign({}, merge(chain(styles, rs), 'rpr'), rp);
            for (const rc of c.children) {
              if (!X.isEl(rc)) continue;
              if (rc.name === 'w:t' || rc.name === 'w:delText') pushRun(X.text(rc), rp);
              else if (rc.name === 'w:footnoteReference') { const fid = String(rc.attrs['w:id'] || ''); if (notesMap.has(fid)) runs.push({ fn: 'f' + fid }); }
              else if (rc.name === 'w:tab') pushRun('\t', rp);
              else if (rc.name === 'w:noBreakHyphen') pushRun('-', rp);
              else if (rc.name === 'w:br' || rc.name === 'w:cr') {
                if (rc.attrs['w:type'] === 'page') {
                  if (runs.length) emit();
                  blocks.push({ t: 'pb' });
                } else runs.push({ br: true });
              } else if (rc.name === 'w:drawing' || rc.name === 'w:pict' || rc.name === 'w:object') counts.images++;
            }
            break;
          }
          case 'w:commentRangeStart': if (/^\d+$/.test(c.attrs['w:id'] || '')) activeCm.add(c.attrs['w:id']); break;
          case 'w:commentRangeEnd': activeCm.delete(c.attrs['w:id']); break;
          case 'w:ins': case 'w:moveTo': case 'w:del': case 'w:moveFrom': {
            const prevTc = curTc;
            curTc = { t: c.name === 'w:ins' || c.name === 'w:moveTo' ? 'ins' : 'del', id: 'r' + (c.attrs['w:id'] || '0'), a: c.attrs['w:author'] || '', d: c.attrs['w:date'] || '' };
            walkInline(c);
            curTc = prevTc;
            break;
          }
          case 'w:hyperlink': case 'w:smartTag': case 'w:fldSimple': case 'w:sdtContent': case 'w:sdt': case 'w:customXml':
            walkInline(c); break;
          default: break; // marcadores, proofErr, etc. se ignoran
        }
      }
    }
    if (direct.pbb) blocks.push({ t: 'pb' });
    walkInline(p);
    // Un párrafo que solo contenía un salto de página no genera párrafo vacío extra.
    const onlyPageBreak = !runs.length && blocks.length && blocks[blocks.length - 1].t === 'pb' && X.find(p, 'w:br').some((b) => b.attrs['w:type'] === 'page') && !X.find(p, 'w:t').length;
    if (!onlyPageBreak) emit();
  }

  function walkBody(node, depth) {
    for (const c of node.children) {
      if (!X.isEl(c)) continue;
      if (c.name === 'w:p') paragraph(c);
      else if (c.name === 'w:tbl') { counts.tables++; for (const tr of X.kids(c, 'w:tr')) for (const tc of X.kids(tr, 'w:tc')) walkBody(tc, depth + 1); }
      else if (c.name === 'w:sdt') walkBody(X.kid(c, 'w:sdtContent') || c, depth + 1);
      else if (c.name === 'w:sectPr' && depth === 0) {
        const sz = X.kid(c, 'w:pgSz'), mg = X.kid(c, 'w:pgMar');
        if (sz) {
          const w = parseInt(sz.attrs['w:w'], 10), h = parseInt(sz.attrs['w:h'], 10);
          let size = 'custom';
          for (const [k, v] of Object.entries(DocModel.PAGE_SIZES)) if (Math.abs(v.w - w) < 60 && Math.abs(v.h - h) < 60) size = k;
          page = { size: size === 'custom' ? 'carta' : size, margins: {} };
          if (mg) for (const k of ['top', 'right', 'bottom', 'left']) { const n = parseInt(mg.attrs['w:' + k], 10); if (Number.isFinite(n)) page.margins[k] = n; }
        }
      }
    }
  }
  walkBody(bodyNode, 0);

  if (counts.images) warnings.add(`Se omitieron ${counts.images} imagen(es) u objeto(s): Grafema guarda solo texto con formato.`);
  if (counts.tables) warnings.add(`Se convirtieron ${counts.tables} tabla(s) en párrafos de texto simple.`);

  const notes = [...notesMap].map(([id, text]) => ({ id: 'f' + id, text }));
  const comments = [...commentsMap].map(([id, c]) => ({ id: 'c' + id, author: c.author, date: c.date, text: c.text, resolved: c.resolved }));
  const model = DocModel.sanitizeModel({ defaults, blocks, notes, comments, track });
  return { model, meta, page: page ? DocModel.sanitizePage(page) : null, warnings: [...warnings] };
}

module.exports = { buildDocx, parseDocx };
