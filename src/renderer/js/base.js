/* Grafema — base de la interfaz: DOM, iconos, tipografía pixel, logo, arte. */
(function () {
  'use strict';
  const G = (window.G = window.G || {});
  G.views = {};
  G.state = { user: null, project: null, config: null, fonts: null, view: null, materialSupported: false };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const PROP_ATTRS = new Set(['value', 'checked', 'selected', 'disabled', 'indeterminate', 'readOnly']);

  // ---------- DOM ----------
  G.h = function h(tag, attrs) {
    const svg = tag.startsWith('svg:');
    const el = svg ? document.createElementNS(SVGNS, tag.slice(4)) : document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.setAttribute('class', v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROP_ATTRS.has(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) G.append(el, arguments[i]);
    return el;
  };
  G.append = function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach((k) => G.append(el, k)); return; }
    el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  G.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  G.$ = (sel, root) => (root || document).querySelector(sel);
  G.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  G.clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  G.debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
  G.uid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); };
  G.fmt = (n) => Number(n || 0).toLocaleString('es-MX');
  G.fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'hace un momento';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 172800) return 'ayer';
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  G.errMsg = (e) => (e && e.message) || 'Ocurrió un error inesperado.';

  // ---------- API ----------
  G.call = async function call(channel, payload) {
    let r;
    try { r = await window.grafema.invoke(channel, payload); } catch (e) { r = { ok: false, code: 'IPC', message: 'No se pudo comunicar con la aplicación: ' + e.message }; }
    if (!r || !r.ok) {
      const e = new Error((r && r.message) || 'Error desconocido.');
      e.code = r && r.code; e.field = r && r.field;
      throw e;
    }
    return r;
  };

  // ---------- Iconos (trazo, 24×24) ----------
  const I = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    book: '<path d="M5 4h9a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h9"/>',
    network: '<circle cx="12" cy="5.5" r="2.2"/><circle cx="5.5" cy="18" r="2.2"/><circle cx="18.5" cy="18" r="2.2"/><path d="M12 7.7v4.3M12 12l-5 4M12 12l5 4"/>',
    export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 15v5h14v-5"/>',
    import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 19h14"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bold: '<path d="M7 4h6a4 4 0 010 8H7zM7 12h7a4 4 0 010 8H7z"/>',
    italic: '<path d="M10 4h8M6 20h8M15 4L9 20"/>',
    underline: '<path d="M7 4v7a5 5 0 0010 0V4M5 21h14"/>',
    strike: '<path d="M5 12h14"/><path d="M16.5 7.5C16 5.8 14.3 5 12 5c-2.6 0-4.3 1.2-4.3 3 0 1.4 1 2.2 2.6 2.7M7.5 16.5c.6 1.6 2.3 2.5 4.6 2.5 2.6 0 4.4-1.2 4.4-3 0-1.2-.6-2-1.8-2.5"/>',
    alignL: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
    alignC: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
    alignR: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    alignJ: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
    ul: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    ol: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5l1.2-.7V8M3.8 11c.3-.8 2.4-1 2.4.4 0 .9-1.2 1.3-2.4 2.6h2.5M3.8 16.3h2c-.7.8-.7.7-.7 1.1.9-.3 1.4.2 1.4.9 0 1-1.3 1.3-2.4.7" stroke-width="1.2"/>',
    indent: '<path d="M4 6h16M12 10h8M12 14h8M4 18h16"/><path d="M4 9.5l3.5 2.5L4 14.5z" fill="currentColor"/>',
    outdent: '<path d="M4 6h16M12 10h8M12 14h8M4 18h16"/><path d="M7.5 9.5L4 12l3.5 2.5z" fill="currentColor"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>',
    chevD: '<path d="M6 9l6 6 6-6"/>',
    chevR: '<path d="M9 6l6 6-6 6"/>',
    chevL: '<path d="M15 6l-6 6 6 6"/>',
    chevU: '<path d="M6 15l6-6 6 6"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A9 9 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.6 6.6A17 17 0 002 12s4 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    arrowUR: '<path d="M7 17L17 7M8 7h9v9"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    pagebreak: '<path d="M3 12h4M10 12h4M17 12h4M6 3v6h12V3M6 21v-6h12v6"/>',
    textColor: '<path d="M6 17L12 4l6 13M8.3 12.5h7.4"/>',
    highlight: '<path d="M4 20h7M14 4l6 6-9 9H8l-2-2v-3z"/><path d="M12 6l6 6"/>',
    lineSpace: '<path d="M10 6h10M10 12h10M10 18h10M5 5v14M5 5L3 7M5 5l2 2M5 19l-2-2M5 19l2-2"/>',
    firstLine: '<path d="M4 6h16M10 10h10M4 14h16M4 18h16"/><path d="M4 8.5L7.5 10 4 11.5z" fill="currentColor"/>',
    clearFmt: '<path d="M6 5h12M12 5L9.5 19M14 15l6 6M20 15l-6 6"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    page: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>',
    zoomIn: '<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5M11 8v6M8 11h6"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3" fill="currentColor"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    layout: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="8" cy="18" r="2"/><circle cx="17" cy="17" r="2"/><path d="M7.7 7l8.6 .7M7 8l1 8M9.8 17.4l5.3-.2M17.5 10l-.3 5"/>',
    note: '<path d="M5 4h14v12l-5 5H5z"/><path d="M14 21v-5h5M8 9h8M8 13h4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z"/>',
    logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
    swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    pin: '<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shieldUser: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><circle cx="12" cy="10" r="2.5"/><path d="M7.5 17c.8-2 2.6-3 4.5-3s3.7 1 4.5 3"/>',
    footnote: '<path d="M4 9h8M8 9v10"/><path d="M15 6l2-1.5V11"/>',
    comment: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
    track: '<path d="M4 20h16"/><path d="M6.5 16l9.5-9.5 2.5 2.5L9 18.5H6.5z"/>',
    focus: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
    bookOpen: '<path d="M3 5.5c2-1 5-1 9 1 4-2 7-2 9-1V19c-2-1-5-1-9 1-4-2-7-2-9-1z"/><path d="M12 6.5V20"/>',
    outline: '<path d="M4 6h16M8 12h12M12 18h8"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  };
  G.icons = I;
  // ¿Se permiten animaciones? Respeta el ajuste de la app y la preferencia de movimiento reducido de Windows.
  G.anim = () => document.documentElement.dataset.anim !== 'off' && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  G.icon = function icon(name, size) {
    const s = size || 18;
    const el = document.createElementNS(SVGNS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', s); el.setAttribute('height', s);
    el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.7'); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true'); el.setAttribute('focusable', 'false');
    el.classList.add('ico');
    el.innerHTML = I[name] || I.info;
    return el;
  };
  // Los iconos de perfiles se eligen por nombre.
  G.PROFILE_ICONS = ['user', 'cube', 'pin', 'book', 'flag', 'star', 'key', 'shield', 'tag', 'clock', 'link', 'note'];

  // ---------- Tipografía pixel (5×7, dibujada aquí; no depende de ninguna fuente) ----------
  const GL = {};
  const def = (chars, rows) => { GL[chars] = rows.split(' '); };
  def('A', '01110 10001 10001 11111 10001 10001 10001'); def('B', '11110 10001 10001 11110 10001 10001 11110');
  def('C', '01110 10001 10000 10000 10000 10001 01110'); def('D', '11110 10001 10001 10001 10001 10001 11110');
  def('E', '11111 10000 10000 11110 10000 10000 11111'); def('F', '11111 10000 10000 11110 10000 10000 10000');
  def('G', '01110 10001 10000 10111 10001 10001 01111'); def('H', '10001 10001 10001 11111 10001 10001 10001');
  def('I', '01110 00100 00100 00100 00100 00100 01110'); def('J', '00111 00010 00010 00010 00010 10010 01100');
  def('K', '10001 10010 10100 11000 10100 10010 10001'); def('L', '10000 10000 10000 10000 10000 10000 11111');
  def('M', '10001 11011 10101 10101 10001 10001 10001'); def('N', '10001 11001 10101 10011 10001 10001 10001');
  def('O', '01110 10001 10001 10001 10001 10001 01110'); def('P', '11110 10001 10001 11110 10000 10000 10000');
  def('Q', '01110 10001 10001 10001 10101 10010 01101'); def('R', '11110 10001 10001 11110 10100 10010 10001');
  def('S', '01111 10000 10000 01110 00001 00001 11110'); def('T', '11111 00100 00100 00100 00100 00100 00100');
  def('U', '10001 10001 10001 10001 10001 10001 01110'); def('V', '10001 10001 10001 10001 10001 01010 00100');
  def('W', '10001 10001 10001 10101 10101 11011 10001'); def('X', '10001 10001 01010 00100 01010 10001 10001');
  def('Y', '10001 10001 01010 00100 00100 00100 00100'); def('Z', '11111 00001 00010 00100 01000 10000 11111');
  def('0', '01110 10001 10011 10101 11001 10001 01110'); def('1', '00100 01100 00100 00100 00100 00100 01110');
  def('2', '01110 10001 00001 00010 00100 01000 11111'); def('3', '11110 00001 00001 01110 00001 00001 11110');
  def('4', '00010 00110 01010 10010 11111 00010 00010'); def('5', '11111 10000 11110 00001 00001 10001 01110');
  def('6', '00110 01000 10000 11110 10001 10001 01110'); def('7', '11111 00001 00010 00100 01000 01000 01000');
  def('8', '01110 10001 10001 01110 10001 10001 01110'); def('9', '01110 10001 10001 01111 00001 00010 01100');
  def(' ', '000 000 000 000 000 000 000'); def('.', '0 0 0 0 0 0 1'); def(',', '0 0 0 0 0 1 1'); def(':', '0 0 1 0 0 1 0');
  def('!', '1 1 1 1 1 0 1'); def('?', '01110 10001 00001 00110 00100 00000 00100'); def('-', '000 000 000 111 000 000 000');
  def('+', '00000 00100 00100 11111 00100 00100 00000'); def('%', '11001 11010 00010 00100 01000 01011 10011');
  def('/', '00001 00010 00010 00100 01000 01000 10000'); def('·', '0 0 0 1 0 0 0'); def('(', '001 010 100 100 100 010 001');
  def(')', '100 010 001 001 001 010 100'); def('\'', '1 1 0 0 0 0 0');
  const ACCENTS = { '\u0301': ['00010', '00100'], '\u0300': ['01000', '00100'], '\u0303': ['01101', '10010'], '\u0308': ['01010', '00000'], '\u0302': ['00100', '01010'] };

  G.px = function px(text, scale, opts) {
    opts = opts || {};
    const s = scale || 4;
    const chars = [];
    for (const raw of String(text).toUpperCase().normalize('NFD')) {
      if (ACCENTS[raw]) { if (chars.length) chars[chars.length - 1].acc = ACCENTS[raw]; continue; }
      chars.push({ rows: GL[raw] || GL['?'] });
    }
    const hasAcc = chars.some((c) => c.acc);
    const top = hasAcc ? 2 : 0;
    let x = 0, d = '';
    chars.forEach((c, i) => {
      const w = c.rows[0].length;
      c.rows.forEach((row, y) => {
        let k = 0;
        while (k < row.length) {
          if (row[k] === '1') { let n = 1; while (row[k + n] === '1') n++; d += `M${x + k} ${top + y}h${n}v1h-${n}z`; k += n; } else k++;
        }
      });
      if (c.acc) {
        const off = Math.floor((w - 5) / 2);
        c.acc.forEach((row, y) => { for (let k = 0; k < 5; k++) if (row[k] === '1') d += `M${x + off + k} ${y}h1v1h-1z`; });
      }
      x += w + (i < chars.length - 1 ? 1 : 0);
    });
    const H = 7 + top;
    const span = G.h('span', { class: 'px', role: 'img', 'aria-label': String(text) });
    if (opts.className) span.classList.add(opts.className);
    span.innerHTML = `<svg viewBox="0 0 ${Math.max(x, 1)} ${H}" width="${Math.max(x, 1) * s}" height="${H * s}" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
    return span;
  };

  // ---------- Logo: «G» en cuadrícula 8×8 + gota de tinta ----------
  const LOGO_G = ['.XXXXXX.', 'XXXXXXXX', 'XX....XX', 'XX......', 'XX..XXXX', 'XX..XXXX', 'XXXXXXXX', '.XXXXXX.'];
  G.logo = function logo(size, opts) {
    opts = opts || {};
    let d = '';
    LOGO_G.forEach((row, y) => { for (let x = 0; x < 8; x++) if (row[x] === 'X') d += `M${x} ${y + 2}h1v1h-1z`; });
    const el = document.createElementNS(SVGNS, 'svg');
    el.setAttribute('viewBox', '0 0 11 10'); el.setAttribute('width', size); el.setAttribute('height', Math.round(size * 10 / 11));
    el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Grafema');
    el.setAttribute('class', 'logo');
    el.innerHTML = `<path d="${d}" fill="currentColor"/><path d="M8.6 0h2v2h-2z" fill="${opts.drop || 'var(--accent)'}"/>`;
    return el;
  };

  // ---------- Arte wireframe ----------
  function cubePath(cx, cy, s) {
    const a = 0.866 * s, b = 0.5 * s;
    const P = { T: [cx, cy - s], UR: [cx + a, cy - b], LR: [cx + a, cy + b], B: [cx, cy + s], LL: [cx - a, cy + b], UL: [cx - a, cy - b], C: [cx, cy] };
    const f = (n) => Math.round(n * 10) / 10;
    const m = (k) => `${f(P[k][0])} ${f(P[k][1])}`;
    return {
      outline: `M${m('T')}L${m('UR')}L${m('LR')}L${m('B')}L${m('LL')}L${m('UL')}Z`,
      front: `M${m('C')}L${m('UL')}M${m('C')}L${m('UR')}M${m('C')}L${m('B')}`,
      back: `M${m('C')}L${m('T')}M${m('C')}L${m('LL')}M${m('C')}L${m('LR')}`,
    };
  }
  function gem(cx, cy, R) {
    const pts = (r, off) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i + off; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
    const o = pts(R, -Math.PI / 2), n = pts(R * 0.52, -Math.PI / 2 + Math.PI / 6);
    const f = (p) => `${Math.round(p[0] * 10) / 10} ${Math.round(p[1] * 10) / 10}`;
    let d = 'M' + o.map(f).join('L') + 'Z M' + n.map(f).join('L') + 'Z';
    for (let i = 0; i < 6; i++) d += `M${f(o[i])}L${f(n[i])}M${f(o[i])}L${f(n[(i + 5) % 6])}`;
    return d;
  }
  function seeded(seed) { let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // Composición decorativa: cubos de varios tamaños + gema + partículas cuadradas.
  G.art = {
    hero(seed) {
      const rnd = seeded(seed || 'grafema');
      const cubes = [[120, 210, 66], [250, 120, 52], [330, 270, 60], [92, 330, 34], [420, 380, 38], [215, 330, 26]];
      let svg = `<svg viewBox="0 0 520 460" class="art" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">`;
      cubes.forEach(([x, y, s], i) => {
        const c = cubePath(x, y, s);
        svg += `<path d="${c.back}" stroke-opacity=".28" stroke-dasharray="3 4"/><path d="${c.outline}"/><path d="${c.front}"/>`;
        if (i === 3) svg += `<path d="M${x} ${y} l${0.866 * s} ${-0.5 * s} l${-0.866 * s} ${-0.5 * s} l${-0.866 * s} ${0.5 * s}z" fill="var(--accent)" fill-opacity=".85" stroke="none"/>`;
      });
      svg += `<path d="${gem(390, 150, 92)}" stroke-width="1.6"/>`;
      for (let i = 0; i < 26; i++) {
        const x = Math.round(30 + rnd() * 460), y = Math.round(20 + rnd() * 420), z = rnd() > 0.8 ? 7 : 4;
        svg += `<rect x="${x}" y="${y}" width="${z}" height="${z}" fill="${i % 9 === 0 ? 'var(--accent)' : 'currentColor'}" stroke="none" fill-opacity="${i % 9 === 0 ? 1 : 0.55}"/>`;
      }
      return svg + '</svg>';
    },
    cover(seed) {
      const rnd = seeded(seed || 'x');
      let svg = '<svg viewBox="0 0 160 200" class="art" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" preserveAspectRatio="xMidYMid slice">';
      const n = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const x = 30 + rnd() * 100, y = 40 + rnd() * 120, s = 20 + rnd() * 34, c = cubePath(x, y, s);
        svg += `<path d="${c.back}" stroke-opacity=".25" stroke-dasharray="2 3"/><path d="${c.outline}"/><path d="${c.front}"/>`;
      }
      for (let i = 0; i < 9; i++) svg += `<rect x="${Math.round(rnd() * 150)}" y="${Math.round(rnd() * 190)}" width="3" height="3" fill="${i === 0 ? 'var(--accent)' : 'currentColor'}" stroke="none" fill-opacity=".6"/>`;
      return svg + '</svg>';
    },
    cubeMini(size) {
      const c = cubePath(50, 50, 36);
      return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" class="art" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="${c.back}" stroke-opacity=".3" stroke-dasharray="3 4"/><path d="${c.outline}"/><path d="${c.front}"/></svg>`;
    },
  };
})();
