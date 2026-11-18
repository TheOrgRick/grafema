/* Grafema — modelo de documento compartido entre el proceso principal y la interfaz.
 *
 * Modelo:
 *   { defaults:{font,size,lh}, blocks:[ Block ] }
 *   Block = { t:'p'|'h1'|'h2'|'h3'|'li'|'pb', align?, lh?, fi?, list?:{ordered,level}, runs:[Run] }
 *   Run   = { text, b,i,u,s,sup,sub, font, size(pt), color('#RRGGBB'), bg('#RRGGBB'),
 *             cm?:[idComentario], tc?:{ t:'ins'|'del', id, a(autor), d(fecha ISO) } }
 *         | { br:true } | { fn:idNota }   (referencia de nota al pie)
 *   Extras del modelo: notes:[{id,text}], comments:[{id,author,date,text,resolved}], track:true
 *   (control de cambios activo). Solo se guardan los que están referenciados en el texto.
 *   Medidas: fi en twips (1/20 pt), size en puntos.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DocModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PAGE_SIZES = {
    carta: { name: 'Carta (21.6 × 27.9 cm)', w: 12240, h: 15840, inches: [8.5, 11], pdf: 'Letter' },
    a4: { name: 'A4 (21 × 29.7 cm)', w: 11906, h: 16838, inches: [8.27, 11.69], pdf: 'A4' },
    a5: { name: 'A5 (14.8 × 21 cm)', w: 8392, h: 11906, inches: [5.83, 8.27], pdf: 'A5' },
    media: { name: 'Media carta (14 × 21.6 cm)', w: 7920, h: 12240, inches: [5.5, 8.5], pdf: null },
  };
  const MARGIN_PRESETS = [
    { id: 'normal', name: 'Normal (2.54 cm)', m: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
    { id: 'estrecho', name: 'Estrecho (1.27 cm)', m: { top: 720, right: 720, bottom: 720, left: 720 } },
    { id: 'moderado', name: 'Moderado (2.54 / 1.91 cm)', m: { top: 1440, right: 1080, bottom: 1440, left: 1080 } },
    { id: 'ancho', name: 'Ancho (2.54 / 5.08 cm)', m: { top: 1440, right: 2880, bottom: 1440, left: 2880 } },
  ];
  const DEFAULT_DEFAULTS = { font: 'Times New Roman', size: 12, lh: 1.5 };
  const BLOCK_TYPES = ['p', 'h1', 'h2', 'h3', 'li'];
  const ALIGNS = ['left', 'center', 'right', 'justify'];

  const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const round2 = (n) => Math.round(n * 100) / 100;

  function defaultPage() {
    return { size: 'carta', margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 } };
  }
  function sanitizePage(p) {
    const d = defaultPage();
    if (!p || typeof p !== 'object') return d;
    const size = PAGE_SIZES[p.size] ? p.size : d.size;
    const m = p.margins || {};
    const fix = (v, def) => (isNum(v) ? clamp(Math.round(v), 0, 4320) : def);
    const margins = {
      top: fix(m.top, d.margins.top), right: fix(m.right, d.margins.right),
      bottom: fix(m.bottom, d.margins.bottom), left: fix(m.left, d.margins.left),
    };
    const ps = PAGE_SIZES[size];
    // Evita márgenes que dejen la página sin espacio de escritura.
    if (margins.left + margins.right > ps.w - 2000) { margins.left = d.margins.left; margins.right = d.margins.right; }
    if (margins.top + margins.bottom > ps.h - 2000) { margins.top = d.margins.top; margins.bottom = d.margins.bottom; }
    return { size, margins };
  }

  // ---------- utilidades de texto ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function safeFont(f) {
    return String(f == null ? '' : f).replace(/['"\\;<>{}()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function safeColor(c) {
    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : null;
  }
  function sanitizeDefaults(d) {
    const o = Object.assign({}, DEFAULT_DEFAULTS);
    if (d && typeof d === 'object') {
      const f = safeFont(d.font);
      if (f) o.font = f;
      if (isNum(d.size)) o.size = clamp(Math.round(d.size * 2) / 2, 6, 72);
      if (isNum(d.lh)) o.lh = clamp(round2(d.lh), 0.8, 4);
    }
    return o;
  }

  // ---------- revisión: notas al pie, comentarios y cambios ----------
  const safeId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
  const clipStr = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n) : '');
  const validDate = (d) => (typeof d === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z?$/.test(d) ? d : '');
  function sanitizeTc(t) {
    if (!t || typeof t !== 'object') return null;
    const type = t.t === 'del' ? 'del' : t.t === 'ins' ? 'ins' : null;
    const id = safeId(t.id);
    if (!type || !id) return null;
    const o = { t: type, id };
    const a = clipStr(t.a, 80).replace(/[<>]/g, ''); if (a) o.a = a;
    const d = validDate(t.d); if (d) o.d = d;
    return o;
  }
  const isDel = (r) => !!(r && r.tc && r.tc.t === 'del');
  function sameStyle(a, b) {
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'font', 'size', 'color', 'bg']) if (a[k] !== b[k]) return false;
    if ((a.cm || []).join(' ') !== (b.cm || []).join(' ')) return false;
    const x = a.tc, y = b.tc;
    if (!!x !== !!y) return false;
    return !x || (x.t === y.t && x.id === y.id);
  }

  function sanitizeModel(m) {
    const out = { defaults: sanitizeDefaults(m && m.defaults), blocks: [] };
    const src = m && Array.isArray(m.blocks) ? m.blocks : [];
    for (const b of src) {
      if (!b || typeof b !== 'object') continue;
      if (b.t === 'pb') { out.blocks.push({ t: 'pb' }); continue; }
      if (!BLOCK_TYPES.includes(b.t)) continue;
      const nb = { t: b.t, runs: [] };
      if (ALIGNS.includes(b.align) && b.align !== 'left') nb.align = b.align;
      if (isNum(b.lh) && b.lh >= 0.5 && b.lh <= 5) nb.lh = round2(b.lh);
      if (isNum(b.fi) && b.fi > 0 && b.fi < 20000) nb.fi = Math.round(b.fi);
      if (b.t === 'li') nb.list = { ordered: !!(b.list && b.list.ordered), level: clamp(Math.round((b.list && b.list.level) || 0), 0, 8) };
      for (const r of Array.isArray(b.runs) ? b.runs : []) {
        if (!r || typeof r !== 'object') continue;
        if (r.br) { nb.runs.push({ br: true }); continue; }
        if (r.fn !== undefined) { const fid = safeId(r.fn); if (fid) nb.runs.push({ fn: fid }); continue; }
        if (typeof r.text !== 'string' || r.text === '') continue;
        const nr = { text: r.text };
        if (r.b) nr.b = true;
        if (r.i) nr.i = true;
        if (r.u) nr.u = true;
        if (r.s) nr.s = true;
        if (r.sup) nr.sup = true;
        else if (r.sub) nr.sub = true;
        const f = safeFont(r.font); if (f) nr.font = f;
        if (isNum(r.size) && r.size >= 1 && r.size <= 400) nr.size = Math.round(r.size * 2) / 2;
        const c = safeColor(r.color); if (c) nr.color = c;
        const bg = safeColor(r.bg); if (bg) nr.bg = bg;
        if (Array.isArray(r.cm)) { const ids = [...new Set(r.cm.map(safeId).filter(Boolean))].slice(0, 20); if (ids.length) nr.cm = ids; }
        const tc = sanitizeTc(r.tc); if (tc) nr.tc = tc;
        nb.runs.push(nr);
      }
      out.blocks.push(nb);
    }
    if (!out.blocks.length) out.blocks.push({ t: 'p', runs: [] });
    // Notas y comentarios: solo los que el texto referencia (si se borra la marca, desaparece su contenido).
    const noteSrc = new Map();
    for (const n of Array.isArray(m && m.notes) ? m.notes : []) { const id = n && safeId(n.id); if (id && !noteSrc.has(id)) noteSrc.set(id, clipStr(n.text, 5000)); }
    const comSrc = new Map();
    for (const c of Array.isArray(m && m.comments) ? m.comments : []) {
      const id = c && safeId(c.id);
      if (id && !comSrc.has(id)) { const o = { id, author: clipStr(c.author, 80).replace(/[<>]/g, ''), text: clipStr(c.text, 5000), resolved: !!c.resolved }; const d = validDate(c.date); if (d) o.date = d; comSrc.set(id, o); }
    }
    const fnIds = [], cmIds = [];
    for (const b of out.blocks) for (const r of b.runs || []) {
      if (r.fn !== undefined) { if (!fnIds.includes(r.fn)) fnIds.push(r.fn); continue; }
      if (r.cm) { r.cm = r.cm.filter((id) => comSrc.has(id)); if (!r.cm.length) delete r.cm; else for (const id of r.cm) if (!cmIds.includes(id)) cmIds.push(id); }
    }
    if (fnIds.length) out.notes = fnIds.map((id) => ({ id, text: noteSrc.get(id) || '' }));
    if (cmIds.length) out.comments = cmIds.map((id) => comSrc.get(id));
    if (m && m.track) out.track = true;
    return out;
  }

  // Aplica o descarta los cambios marcados: accept=true deja el texto final; false vuelve al original.
  function applyRevisions(model, accept) {
    const out = Object.assign({}, model, {
      blocks: model.blocks.map((b) => (b.t === 'pb' ? b : Object.assign({}, b, {
        runs: (b.runs || []).filter((r) => !(r.tc && (accept ? r.tc.t === 'del' : r.tc.t === 'ins'))).map((r) => { if (!r.tc) return r; const c = Object.assign({}, r); delete c.tc; return c; }),
      }))),
    });
    delete out.track;
    return out;
  }
  function stripComments(model) {
    const out = Object.assign({}, model, { blocks: model.blocks.map((b) => (b.t === 'pb' ? b : Object.assign({}, b, { runs: (b.runs || []).map((r) => { if (!r.cm) return r; const c = Object.assign({}, r); delete c.cm; return c; }) }))) });
    delete out.comments;
    return out;
  }
  // Antepone un prefijo a los ids (para unir varios capítulos sin choques).
  function prefixIds(model, pre) {
    const pf = (id) => pre + id;
    const out = Object.assign({}, model, {
      blocks: model.blocks.map((b) => (b.t === 'pb' ? b : Object.assign({}, b, {
        runs: (b.runs || []).map((r) => {
          if (r.fn !== undefined) return { fn: pf(r.fn) };
          if (!r.cm && !r.tc) return r;
          const c = Object.assign({}, r);
          if (c.cm) c.cm = c.cm.map(pf);
          if (c.tc) c.tc = Object.assign({}, c.tc, { id: pf(c.tc.id) });
          return c;
        }),
      }))),
    });
    if (model.notes) out.notes = model.notes.map((n) => Object.assign({}, n, { id: pf(n.id) }));
    if (model.comments) out.comments = model.comments.map((c) => Object.assign({}, c, { id: pf(c.id) }));
    return out;
  }

  function emptyModel(defaults) {
    return { defaults: sanitizeDefaults(defaults), blocks: [{ t: 'p', runs: [] }] };
  }

  // ---------- conteo ----------
  function blockText(b) {
    let s = '';
    for (const r of b.runs || []) { if (r.fn !== undefined || isDel(r)) continue; s += r.br ? ' ' : r.text; }
    return s;
  }
  function plainText(model) {
    return model.blocks.filter((b) => b.t !== 'pb').map(blockText).join('\n');
  }
  function countWordsInText(text) {
    const m = String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
    return m ? m.length : 0;
  }
  function countWords(model) {
    return countWordsInText(plainText(model));
  }

  // ---------- modelo -> HTML ----------
  // ctx (solo para imprimir): { print:true, revisions:'final'|'markup', count, list, notes:Map }
  function runHtml(r, ctx) {
    if (r.br) return '<br>';
    if (r.fn !== undefined) {
      if (ctx && ctx.print) { const n = ++ctx.count; ctx.list.push({ n, text: ctx.notes.get(r.fn) || '' }); return '<sup class="fnref">' + n + '</sup>'; }
      return '<span class="fn" data-fn="' + esc(r.fn) + '" contenteditable="false">\u200B</span>';   // el número lo dibuja el CSS
    }
    if (ctx && ctx.print && r.tc && r.tc.t === 'del' && ctx.revisions !== 'markup') return '';
    let t = esc(r.text || '');
    const st = [];
    const f = safeFont(r.font);
    if (f) st.push("font-family:'" + f + "'");
    if (isNum(r.size)) st.push('font-size:' + r.size + 'pt');
    const c = safeColor(r.color); if (c) st.push('color:' + c);
    const bg = safeColor(r.bg); if (bg) st.push('background-color:' + bg);
    if (st.length) t = '<span style="' + st.join(';') + '">' + t + '</span>';
    if (r.sup) t = '<sup>' + t + '</sup>';
    else if (r.sub) t = '<sub>' + t + '</sub>';
    if (r.s) t = '<s>' + t + '</s>';
    if (r.u) t = '<u>' + t + '</u>';
    if (r.i) t = '<em>' + t + '</em>';
    if (r.b) t = '<strong>' + t + '</strong>';
    if (ctx && ctx.print) {
      if (r.tc && ctx.revisions === 'markup') { const tag = r.tc.t === 'del' ? 'del' : 'ins'; t = '<' + tag + ' class="rv-' + tag + '">' + t + '</' + tag + '>'; }
      return t;
    }
    if (r.cm && r.cm.length) t = '<span class="cm" data-cm="' + r.cm.map(esc).join(' ') + '">' + t + '</span>';
    // Marca de cambio: <span> (no <ins>/<del>) para que el navegador conserve sus atributos al editar.
    if (r.tc) { const tt = r.tc.t === 'del' ? 'del' : 'ins'; t = '<span class="tc ' + tt + '" data-tc="' + esc(r.tc.id) + '" data-tt="' + tt + '" data-a="' + esc(r.tc.a || '') + '" data-d="' + esc(r.tc.d || '') + '">' + t + '</span>'; }
    return t;
  }
  function innerHtml(b, ctx) {
    const runs = b.runs || [];
    if (!runs.length) return '<br>';
    let s = '';
    for (const r of runs) s += runHtml(r, ctx);
    if (runs[runs.length - 1].br) s += '<br>';
    return s;
  }
  function blockStyle(b) {
    const st = [];
    if (b.align && b.align !== 'left') st.push('text-align:' + b.align);
    if (isNum(b.lh)) st.push('line-height:' + b.lh);
    if (isNum(b.fi) && b.fi > 0) st.push('text-indent:' + round2(b.fi / 20) + 'pt');
    return st.length ? ' style="' + st.join(';') + '"' : '';
  }

  // opt = { print:true, revisions } para exportar; sin opciones genera el HTML editable.
  function modelToHtml(model, opt) {
    const ctx = opt && opt.print ? { print: true, revisions: opt.revisions === 'markup' ? 'markup' : 'final', count: 0, list: [], notes: new Map((model.notes || []).map((n) => [n.id, n.text])) } : null;
    if (opt && opt.print) opt.result = ctx;
    let out = '';
    const stack = [];
    const closeTo = (n) => { while (stack.length > n) out += '</li></' + stack.pop() + '>'; };
    for (const b of model.blocks) {
      if (b.t === 'li') {
        const level = clamp((b.list && b.list.level) || 0, 0, 8);
        const tag = b.list && b.list.ordered ? 'ol' : 'ul';
        closeTo(level + 1);
        if (stack.length === level + 1) {
          if (stack[level] !== tag) { out += '</li></' + stack.pop() + '>'; }
          else out += '</li>';
        }
        while (stack.length < level + 1) {
          out += '<' + tag + '>';
          stack.push(tag);
          if (stack.length < level + 1) out += '<li style="list-style:none">';
        }
        out += '<li' + blockStyle(b) + '>' + innerHtml(b, ctx);
        continue;
      }
      closeTo(0);
      if (b.t === 'pb') { out += '<div class="pagebreak" contenteditable="false"></div>'; continue; }
      const tag = b.t === 'h1' || b.t === 'h2' || b.t === 'h3' ? b.t : 'p';
      out += '<' + tag + blockStyle(b) + '>' + innerHtml(b, ctx) + '</' + tag + '>';
    }
    closeTo(0);
    return out;
  }

  // ---------- DOM -> modelo (solo en la interfaz) ----------
  const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
  const FONT_SIZE_KEYWORDS = { 'xx-small': 7, 'x-small': 8, small: 10, medium: 12, large: 14, 'x-large': 18, 'xx-large': 24, 'xxx-large': 36 };
  const FONT_TAG_SIZES = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };

  function cssToPt(v) {
    v = String(v || '').trim().toLowerCase();
    if (FONT_SIZE_KEYWORDS[v]) return FONT_SIZE_KEYWORDS[v];
    const m = v.match(/^([\d.]+)(pt|px)$/);
    if (!m) return null;
    const n = parseFloat(m[1]) * (m[2] === 'px' ? 0.75 : 1);
    return n > 0 ? Math.round(n * 2) / 2 : null;
  }
  function cssToTwips(v) {
    const m = String(v || '').trim().toLowerCase().match(/^(-?[\d.]+)(pt|px|cm|mm|in)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const mul = { pt: 20, px: 15, cm: 566.93, mm: 56.693, in: 1440 }[m[2] || 'pt'];
    return Math.round(n * mul);
  }
  function toHex(css) {
    css = String(css || '').trim().toLowerCase();
    if (!css || css === 'transparent' || css === 'inherit' || css === 'initial') return null;
    let m = css.match(/^#([0-9a-f]{3})$/);
    if (m) return ('#' + m[1].split('').map((c) => c + c).join('')).toUpperCase();
    m = css.match(/^#([0-9a-f]{6})$/);
    if (m) return ('#' + m[1]).toUpperCase();
    m = css.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
      const h = (n) => clamp(parseInt(n, 10), 0, 255).toString(16).padStart(2, '0');
      return ('#' + h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
    }
    return null;
  }
  function firstFamily(ff) {
    const m = String(ff || '').match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
    const name = m ? (m[1] || m[2] || m[3] || '').trim() : '';
    const generic = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit'];
    return generic.includes(name.toLowerCase()) ? '' : safeFont(name);
  }

  function styleFor(el, parent) {
    const s = Object.assign({}, parent);
    const t = el.tagName;
    if (t === 'B' || t === 'STRONG') s.b = true;
    if (t === 'I' || t === 'EM') s.i = true;
    if (t === 'U') s.u = true;
    if (t === 'S' || t === 'STRIKE' || (t === 'DEL' && !el.hasAttribute('data-tc'))) s.s = true;
    if (el.hasAttribute && el.hasAttribute('data-cm')) {
      const ids = String(el.getAttribute('data-cm')).split(/\s+/).filter(Boolean);
      s.cm = [...new Set([].concat(parent.cm || [], ids))];
    }
    if (el.hasAttribute && el.hasAttribute('data-tc')) {
      s.tc = { t: (el.getAttribute('data-tt') || (t === 'DEL' ? 'del' : 'ins')) === 'del' ? 'del' : 'ins', id: el.getAttribute('data-tc'), a: el.getAttribute('data-a') || '', d: el.getAttribute('data-d') || '' };
    }
    if (t === 'SUB') { s.sub = true; delete s.sup; }
    if (t === 'SUP') { s.sup = true; delete s.sub; }
    if (t === 'FONT') {
      const face = el.getAttribute('face'); if (face) { const f = firstFamily(face); if (f) s.font = f; }
      const col = toHex(el.getAttribute('color')); if (col) s.color = col;
      const sz = FONT_TAG_SIZES[el.getAttribute('size')]; if (sz) s.size = sz;
    }
    const st = el.style;
    if (st) {
      if (st.fontFamily) { const f = firstFamily(st.fontFamily); if (f) s.font = f; }
      if (st.fontSize) { const pt = cssToPt(st.fontSize); if (pt) s.size = pt; }
      if (st.color) { const c = toHex(st.color); if (c) s.color = c; }
      if (st.backgroundColor) { const c = toHex(st.backgroundColor); if (c) s.bg = c; else delete s.bg; }
      if (st.fontWeight) s.b = st.fontWeight === 'bold' || st.fontWeight === 'bolder' || parseInt(st.fontWeight, 10) >= 600;
      if (st.fontStyle) s.i = st.fontStyle === 'italic' || st.fontStyle === 'oblique';
      const td = st.textDecorationLine || st.textDecoration || '';
      if (td) {
        if (td.indexOf('underline') >= 0) s.u = true;
        if (td.indexOf('line-through') >= 0) s.s = true;
        if (td === 'none') { s.u = false; s.s = false; }
      }
      if (st.verticalAlign === 'super') { s.sup = true; delete s.sub; }
      if (st.verticalAlign === 'sub') { s.sub = true; delete s.sup; }
    }
    return s;
  }

  function addText(runs, text, style) {
    text = String(text).replace(/[\u200B\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\r/g, '');
    if (!text) return;
    const r = { text };
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub']) if (style[k]) r[k] = true;
    if (style.font) r.font = style.font;
    if (style.size) r.size = style.size;
    if (style.color) r.color = style.color;
    if (style.bg) r.bg = style.bg;
    if (style.cm && style.cm.length) r.cm = style.cm.slice();
    if (style.tc) r.tc = Object.assign({}, style.tc);
    const prev = runs[runs.length - 1];
    if (prev && !prev.br && prev.fn === undefined && sameStyle(prev, r)) { prev.text += text; return; }
    runs.push(r);
  }

  function inlineNode(ch, style, runs) {
    if (ch.nodeType === 3) { addText(runs, ch.nodeValue, style); return; }
    if (ch.nodeType !== 1) return;
    const tag = ch.tagName;
    if (tag === 'BR') { runs.push({ br: true }); return; }
    if ((tag === 'SUP' || tag === 'SPAN') && ch.hasAttribute && ch.hasAttribute('data-fn')) { const id = ch.getAttribute('data-fn'); if (id) runs.push({ fn: id }); return; }
    if (tag === 'UL' || tag === 'OL') return;
    if (ch.classList && ch.classList.contains('pagebreak')) return;
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'IMG' || tag === 'CANVAS' || tag === 'SVG') return;
    if (BLOCK_TAGS.has(tag) && runs.length && !runs[runs.length - 1].br) runs.push({ br: true });
    const s = styleFor(ch, style);
    for (const c of ch.childNodes) inlineNode(c, s, runs);
  }
  function trimTrailingBr(runs) {
    if (runs.length && runs[runs.length - 1].br) runs.pop();
  }

  function blockProps(el, inh) {
    const p = Object.assign({}, inh);
    const st = el.style || {};
    const raw = String((st.textAlign || (el.getAttribute && el.getAttribute('align')) || '')).toLowerCase();
    if (raw === 'justify') p.align = 'justify';
    else if (raw === 'center') p.align = 'center';
    else if (raw === 'right' || raw === 'end') p.align = 'right';
    else if (raw === 'left' || raw === 'start') delete p.align;
    if (st.lineHeight) {
      const lh = String(st.lineHeight).trim();
      if (/^[\d.]+$/.test(lh) && parseFloat(lh) > 0 && parseFloat(lh) < 10) p.lh = round2(parseFloat(lh));
      else if (lh === 'normal') delete p.lh;
    }
    if (st.textIndent) {
      const tw = cssToTwips(st.textIndent);
      if (tw && tw > 0) p.fi = tw; else delete p.fi;
    }
    return p;
  }
  function withProps(block, props) {
    if (props.align) block.align = props.align;
    if (props.lh) block.lh = props.lh;
    if (props.fi) block.fi = props.fi;
    return block;
  }

  // extra (opcional): { notes, comments, track } para que las marcas del texto conserven su contenido al sanitizar.
  function domToModel(rootEl, defaults, extra) {
    const blocks = [];

    function listWalk(listEl, level, inh) {
      const ordered = listEl.tagName === 'OL';
      const lp = blockProps(listEl, inh);
      for (const li of listEl.children) {
        if (li.tagName === 'UL' || li.tagName === 'OL') { listWalk(li, level + 1, lp); continue; }
        if (li.tagName !== 'LI') continue;
        const props = blockProps(li, lp);
        const runs = [];
        const nested = [];
        for (const c of li.childNodes) {
          if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c);
          else inlineNode(c, {}, runs);
        }
        trimTrailingBr(runs);
        if (runs.length || !nested.length) blocks.push(withProps({ t: 'li', list: { ordered, level }, runs }, props));
        for (const n of nested) listWalk(n, level + 1, props);
      }
    }

    function hasBlockChild(el) {
      for (const c of el.children) if (BLOCK_TAGS.has(c.tagName) || (c.classList && c.classList.contains('pagebreak'))) return true;
      return false;
    }

    function walk(parent, inh) {
      let pending = null;
      const flush = () => {
        if (pending) {
          trimTrailingBr(pending);
          if (pending.length) blocks.push(withProps({ t: 'p', runs: pending }, inh));
        }
        pending = null;
      };
      for (const ch of parent.childNodes) {
        if (ch.nodeType === 3) {
          if (!pending && !ch.nodeValue.trim()) continue;
          pending = pending || [];
          addText(pending, ch.nodeValue, {});
          continue;
        }
        if (ch.nodeType !== 1) continue;
        const tag = ch.tagName;
        if (ch.classList && ch.classList.contains('pagebreak')) { flush(); blocks.push({ t: 'pb' }); continue; }
        if (!BLOCK_TAGS.has(tag)) { pending = pending || []; inlineNode(ch, {}, pending); continue; }
        flush();
        if (tag === 'HR') continue;
        if (tag === 'UL' || tag === 'OL') { listWalk(ch, 0, inh); continue; }
        const props = blockProps(ch, inh);
        if (/^H[1-6]$/.test(tag)) {
          const runs = []; for (const c of ch.childNodes) inlineNode(c, {}, runs); trimTrailingBr(runs);
          blocks.push(withProps({ t: 'h' + Math.min(3, parseInt(tag[1], 10)), runs }, props));
          continue;
        }
        if (hasBlockChild(ch)) { walk(ch, props); continue; }
        const runs = []; for (const c of ch.childNodes) inlineNode(c, {}, runs); trimTrailingBr(runs);
        blocks.push(withProps({ t: 'p', runs }, props));
      }
      flush();
    }

    walk(rootEl, {});
    return sanitizeModel({ defaults, blocks, notes: extra && extra.notes, comments: extra && extra.comments, track: extra && extra.track });
  }

  // Reajusta un modelo importado a otros valores base sin cambiar su aspecto.
  function rebase(model, target) {
    const from = sanitizeDefaults(model.defaults);
    const to = sanitizeDefaults(target);
    for (const b of model.blocks) {
      if (b.t === 'pb') continue;
      if (b.t === 'p' || b.t === 'li') {
        if (!isNum(b.lh) && Math.abs(from.lh - to.lh) > 0.001) b.lh = from.lh;
        else if (isNum(b.lh) && Math.abs(b.lh - to.lh) < 0.001) delete b.lh;
      }
      for (const r of b.runs) {
        if (r.br || r.fn !== undefined) continue;
        if (!r.font && from.font.toLowerCase() !== to.font.toLowerCase() && b.t !== 'h1' && b.t !== 'h2' && b.t !== 'h3') r.font = from.font;
        if (!r.size && from.size !== to.size && b.t !== 'h1' && b.t !== 'h2' && b.t !== 'h3') r.size = from.size;
      }
    }
    model.defaults = to;
    return model;
  }

  return {
    PAGE_SIZES, MARGIN_PRESETS, DEFAULT_DEFAULTS,
    defaultPage, sanitizePage, sanitizeDefaults, sanitizeModel, emptyModel,
    modelToHtml, domToModel, rebase,
    plainText, countWords, countWordsInText, blockText,
    applyRevisions, stripComments, prefixIds, safeId, validDate,
    esc, safeFont, safeColor,
  };
});
