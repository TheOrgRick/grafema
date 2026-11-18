/* Grafema — editor de manuscrito (documentos .docx). */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const DM = window.DocModel;
  const SWATCHES = ['#FFD712', '#D4B40F', '#917A0A', '#333333', '#6F6F6F', '#919191', '#B3B3B3', '#FFFFFF', '#C62828', '#E65100', '#2E7D32', '#00796B', '#1565C0', '#6A1B9A', '#AD1457', '#4E342E'];
  const HL_SWATCHES = ['#FFF176', '#FFD712', '#FFCC80', '#A5D6A7', '#80DEEA', '#90CAF9', '#CE93D8', '#F8BBD0'];
  const LH = [1, 1.15, 1.5, 2, 2.5];
  const FONT_TAG_PT = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
  const CM = (tw) => Math.round((tw / 566.93) * 100) / 100;
  const TW = (cm) => Math.round(cm * 566.93);

  G.views.editor = async function editorView(container) {
    const P = () => G.state.project;
    const pid = P().id;
    let curId = null, ed = null, loading = false, token = 0, lastRange = null, pendingSize = 12, zoom = 100, sideOpen = !G.root.classList.contains('bp-sm');
    let rafTb = 0, countTimer = 0;
    let plus = null;   // extensiones del editor (editor-plus.js): notas, comentarios, cambios, modos
    const cleanups = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };

    // ------------------------------------------------------------------ guardado
    const statusSave = h('span', { class: 'st-save', 'aria-live': 'polite' });
    function setSaveState(s, err) {
      statusSave.className = 'st-save ' + s;
      statusSave.textContent = s === 'saving' ? 'Guardando…' : s === 'dirty' ? 'Cambios sin guardar' : s === 'error' ? 'Error al guardar: ' + G.errMsg(err) + ' (reintentando)' : 'Guardado';
    }
    setSaveState('saved');
    const saver = G.saver(async () => {
      if (!ed || !curId) return;
      const id = curId;
      const model = plus.serialize();
      const r = await G.call('chapter:write', { projectId: pid, chapterId: id, model });
      const ch = P().chapters.find((c) => c.id === id);
      if (ch) ch.words = r.words;
      if (plus.sideTab() === 'chapters') renderSide();
    }, 1500, setSaveState);

    // ------------------------------------------------------------------ estructura
    const fontLabel = h('span', { class: 'ellip' }, 'Times New Roman');
    const fontBtn = h('button', { class: 'tb-font', type: 'button', title: 'Fuente (tipos instalados en tu equipo)', 'aria-label': 'Fuente', onmousedown: (e) => e.preventDefault(), onclick: () => openFontPicker(fontBtn) }, fontLabel, G.icon('chevD', 14));
    const sizeInput = h('input', { class: 'tb-size', type: 'text', inputmode: 'decimal', 'aria-label': 'Tamaño de letra en puntos', title: 'Tamaño de letra (pt)', value: '12', maxlength: 4 });
    const blockSel = h('select', { class: 'tb-block', 'aria-label': 'Estilo de párrafo', title: 'Estilo de párrafo' },
      h('option', { value: 'p' }, 'Texto normal'), h('option', { value: 'h1' }, 'Título 1'), h('option', { value: 'h2' }, 'Título 2'), h('option', { value: 'h3' }, 'Título 3'));
    const tb = (icon, label, fn, o) => {
      o = o || {};
      return h('button', { class: 'ibtn', type: 'button', title: label + (o.key ? ' (' + o.key + ')' : ''), 'aria-label': label, 'aria-pressed': o.toggle ? 'false' : null, onmousedown: (e) => e.preventDefault(), onclick: (e) => fn(e.currentTarget) }, G.icon(icon, 18));
    };
    const B = {};
    B.b = tb('bold', 'Negrita', () => exec('bold'), { key: 'Ctrl+B', toggle: true });
    B.i = tb('italic', 'Cursiva', () => exec('italic'), { key: 'Ctrl+I', toggle: true });
    B.u = tb('underline', 'Subrayado', () => exec('underline'), { key: 'Ctrl+U', toggle: true });
    B.s = tb('strike', 'Tachado', () => exec('strikeThrough'), { toggle: true });
    B.color = tb('textColor', 'Color de letra', (b) => openColor(b, false));
    B.hl = tb('highlight', 'Resaltar', (b) => openColor(b, true));
    B.clear = tb('clearFmt', 'Quitar formato', () => { exec('removeFormat'); stripBlockStyles(); });
    B.left = tb('alignL', 'Alinear a la izquierda', () => exec('justifyLeft'), { key: 'Ctrl+L', toggle: true });
    B.center = tb('alignC', 'Centrar', () => exec('justifyCenter'), { key: 'Ctrl+E', toggle: true });
    B.right = tb('alignR', 'Alinear a la derecha', () => exec('justifyRight'), { key: 'Ctrl+R', toggle: true });
    B.justify = tb('alignJ', 'Justificar', () => exec('justifyFull'), { key: 'Ctrl+J', toggle: true });
    B.ul = tb('ul', 'Lista con viñetas', () => exec('insertUnorderedList'), { toggle: true });
    B.ol = tb('ol', 'Lista numerada', () => exec('insertOrderedList'), { toggle: true });
    B.outdent = tb('outdent', 'Disminuir nivel de lista', () => exec('outdent'), { key: 'Mayús+Tab' });
    B.indent = tb('indent', 'Aumentar nivel de lista', () => exec('indent'), { key: 'Tab' });
    B.lh = tb('lineSpace', 'Interlineado', (b) => openLineSpacing(b));
    B.fl = tb('firstLine', 'Sangría de primera línea', () => toggleFirstLine(), { toggle: true });
    B.pb = tb('pagebreak', 'Insertar salto de página', () => insertPageBreak());
    B.fn = tb('footnote', 'Insertar nota al pie', () => plus.insertFootnote(), { key: 'Ctrl+Alt+F' });
    B.cm = tb('comment', 'Comentar el texto seleccionado', () => plus.addComment(), { key: 'Ctrl+Alt+M' });
    B.track = tb('track', 'Control de cambios', () => plus.toggleTrack(), { key: 'Ctrl+Mayús+T', toggle: true });
    B.view = tb('focus', 'Modo enfoque y modo lectura', (b) => plus.viewMenu(b), { key: 'Ctrl+Mayús+F / L' });
    B.undo = tb('undo', 'Deshacer', () => exec('undo'), { key: 'Ctrl+Z' });
    B.redo = tb('redo', 'Rehacer', () => exec('redo'), { key: 'Ctrl+Y' });
    B.find = tb('search', 'Buscar y reemplazar', () => toggleFind(true), { key: 'Ctrl+F' });
    B.page = h('button', { class: 'btn sm', type: 'button', title: 'Tamaño de página, márgenes y texto base', onmousedown: (e) => e.preventDefault(), onclick: (e) => openPageSettings(e.currentTarget) }, G.icon('page', 16), 'Página');
    B.docx = tb('save', 'Guardar este capítulo como .docx…', () => exportDocx());
    B.side = tb('sidebar', 'Mostrar u ocultar el panel lateral', () => { sideOpen = !sideOpen; syncSide(); }, { toggle: true });
    const sep = () => h('span', { class: 'tb-sep', 'aria-hidden': 'true' });
    const tbar = h('div', { class: 'ed-toolbar', role: 'toolbar', 'aria-label': 'Formato de texto' },
      h('div', { class: 'tg' }, fontBtn, h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Reducir tamaño', title: 'Reducir tamaño', onmousedown: (e) => e.preventDefault(), onclick: () => bumpSize(-1) }, G.icon('minus', 14)), sizeInput,
        h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Aumentar tamaño', title: 'Aumentar tamaño', onmousedown: (e) => e.preventDefault(), onclick: () => bumpSize(1) }, G.icon('plus', 14)), blockSel),
      sep(), h('div', { class: 'tg' }, B.b, B.i, B.u, B.s, B.color, B.hl, B.clear),
      sep(), h('div', { class: 'tg' }, B.left, B.center, B.right, B.justify),
      sep(), h('div', { class: 'tg' }, B.ul, B.ol, B.outdent, B.indent),
      sep(), h('div', { class: 'tg' }, B.lh, B.fl, B.pb),
      sep(), h('div', { class: 'tg' }, B.fn, B.cm, B.track),
      sep(), h('div', { class: 'tg' }, B.undo, B.redo),
      h('div', { class: 'grow' }),
      h('div', { class: 'tg' }, B.view, B.find, B.page, B.docx, B.side));

    const titleInput = h('input', { class: 'ch-title', type: 'text', maxlength: 120, 'aria-label': 'Título del capítulo', spellcheck: 'true' });
    const paper = h('div', { class: 'paper' });
    const wrap = h('div', { class: 'paper-wrap' }, titleInput, paper);
    const scroller = h('div', { class: 'ed-scroll scroll' }, h('div', { class: 'ed-sheet' }, wrap));
    const findBar = h('div', { class: 'findbar', hidden: true, role: 'search' });
    const stCounts = h('span', { class: 'st-counts' }), stSpell = h('span', { class: 'st-spell dim' });
    const zoomLbl = h('button', { class: 'btn sm ghost', type: 'button', title: 'Restablecer zoom', onclick: () => setZoom(100, true) }, '100%');
    const statusbar = h('div', { class: 'ed-status' }, stCounts, h('div', { class: 'grow' }), stSpell, statusSave,
      h('div', { class: 'row', style: { gap: '2px' } }, h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Alejar', onclick: () => setZoom(zoom - 10, true) }, G.icon('minus', 14)), zoomLbl,
        h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Acercar', onclick: () => setZoom(zoom + 10, true) }, G.icon('plus', 14))));
    const side = h('aside', { class: 'ed-side', 'aria-label': 'Panel lateral' });
    container.className = 'ed';
    container.append(tbar, h('div', { class: 'ed-body' }, h('div', { class: 'ed-main' }, findBar, scroller, statusbar), side));
    plus = G.editorPlus({
      container, scroller, wrap, sheet: G.$('.ed-sheet', scroller), statusbar, B, P, pid,
      getEd: () => ed, getCurId: () => curId, getSide: () => side,
      focusEd: () => focusEd(), inEd: (n) => inEd(n), afterEdit: () => afterEdit(), changed: () => changed(), setOn: (b, v) => setOn(b, v),
      openChapter: (id) => openChapter(id), renderSide: () => renderSide(),
      getSideOpen: () => sideOpen, setSideOpen: (v) => { sideOpen = !!v; syncSide(); },
      getZoom: () => zoom, fitZoom: () => fitZoom(),
    });

    // ------------------------------------------------------------------ página
    function applyPage() {
      const pg = DM.sanitizePage(P().page), d = DM.sanitizeDefaults(P().defaults), ps = DM.PAGE_SIZES[pg.size];
      const inch = (tw) => tw / 1440 + 'in';
      const s = container.style;
      s.setProperty('--page-w', inch(ps.w)); s.setProperty('--page-h', inch(ps.h));
      s.setProperty('--m-t', inch(pg.margins.top)); s.setProperty('--m-r', inch(pg.margins.right)); s.setProperty('--m-b', inch(pg.margins.bottom)); s.setProperty('--m-l', inch(pg.margins.left));
      s.setProperty('--content-h', (ps.h - pg.margins.top - pg.margins.bottom) / 1440 + 'in');
      s.setProperty('--ed-font', "'" + DM.safeFont(d.font) + "'"); s.setProperty('--ed-size', d.size + 'pt'); s.setProperty('--ed-lh', String(d.lh));
      pendingSize = d.size;
      scheduleCounts();
    }
    let autoZoom = true;
    function setZoom(z, manual) {
      if (manual) autoZoom = false;
      zoom = G.clamp(Math.round(z / 10) * 10, 50, 200);
      wrap.style.zoom = plus && plus.mode() === 'read' ? '' : zoom / 100;
      if (plus) plus.scheduleLayout();   // las tarjetas del margen se realinean con el nuevo zoom
      zoomLbl.textContent = zoom + '%';
    }

    // ------------------------------------------------------------------ selección y comandos
    const inEd = (n) => !!(ed && n && ed.contains(n.nodeType === 3 ? n.parentNode : n));
    function onSel() {
      if (!ed || (document.activeElement !== ed && !ed.contains(document.activeElement))) return;
      const s = getSelection();
      if (s.rangeCount && inEd(s.anchorNode)) { lastRange = s.getRangeAt(0).cloneRange(); scheduleToolbar(); scheduleCounts(); plus.onSelection(); }
    }
    function focusEd() {
      if (!ed) return false;
      const s = getSelection();
      const fine = document.activeElement === ed && s.rangeCount && inEd(s.anchorNode);
      if (!fine) {
        ed.focus({ preventScroll: true });
        if (lastRange && ed.contains(lastRange.commonAncestorContainer)) { s.removeAllRanges(); s.addRange(lastRange); }
        else if (!(s.rangeCount && inEd(s.anchorNode))) { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
      }
      return true;
    }
    function unwrap(el) { const p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); }
    // Convierte <font> en <span style>, aplica el tamaño elegido en puntos y elimina estilos duplicados.
    function normalize() {
      if (!ed) return;
      const s = getSelection();
      const saved = s.rangeCount && inEd(s.anchorNode) ? { an: s.anchorNode, ao: s.anchorOffset, fn: s.focusNode, fo: s.focusOffset } : null;
      const map = new Map(), fresh = [];
      for (const f of G.$$('font', ed)) {
        const span = document.createElement('span');
        const size = f.getAttribute('size'), face = f.getAttribute('face'), color = f.getAttribute('color'), st = f.getAttribute('style');
        if (st) span.setAttribute('style', st);
        if (size === '7') { span.style.fontSize = pendingSize + 'pt'; fresh.push(['font-size', span]); }
        else if (size && FONT_TAG_PT[size]) span.style.fontSize = FONT_TAG_PT[size] + 'pt';
        if (face) { span.style.fontFamily = "'" + DM.safeFont(face) + "'"; fresh.push(['font-family', span]); }
        if (color) { span.style.color = color; fresh.push(['color', span]); }
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span); map.set(f, span);
      }
      for (const sp of G.$$('span[style]', ed)) {
        if (/xxx-large/.test(sp.style.fontSize)) { sp.style.fontSize = pendingSize + 'pt'; fresh.push(['font-size', sp]); }
      }
      for (const [prop, span] of fresh) for (const d of G.$$('span[style]', span)) if (d !== span && d.style.getPropertyValue(prop)) d.style.removeProperty(prop);
      for (const sp of G.$$('span', ed)) if (!sp.hasAttribute('data-cm') && !sp.hasAttribute('data-tc') && !sp.hasAttribute('data-fn') && (!sp.getAttribute('style') || !sp.style.cssText.trim())) unwrap(sp);
      if (saved) {
        const rm = (n) => (map.has(n) ? map.get(n) : n);
        const an = rm(saved.an), fn = rm(saved.fn);
        try { if (an.isConnected && fn.isConnected) s.setBaseAndExtent(an, Math.min(saved.ao, an.nodeType === 3 ? an.length : an.childNodes.length), fn, Math.min(saved.fo, fn.nodeType === 3 ? fn.length : fn.childNodes.length)); } catch (_) { /* noop */ }
      }
    }
    function changed() { if (loading) return; saver.touch(); scheduleCounts(); if (typeof rescanSoon === 'function') rescanSoon(); if (plus) plus.refresh(); }
    function captureRange() { const s = getSelection(); if (s.rangeCount && inEd(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange(); }
    function afterEdit() { normalize(); captureRange(); changed(); scheduleToolbar(); }
    function exec(cmd, val, css) {
      if (!focusEd()) return false;
      document.execCommand('styleWithCSS', false, !!css);
      const ok = document.execCommand(cmd, false, val == null ? null : val);
      afterEdit();
      return ok;
    }
    function blocksInSelection() {
      const s = getSelection();
      if (!s.rangeCount || !inEd(s.anchorNode)) return [];
      const r = s.getRangeAt(0), out = [];
      for (const el of G.$$('p,h1,h2,h3,li,div:not(.pagebreak)', ed)) {
        if (!r.intersectsNode(el)) continue;
        if (el.querySelector('p,h1,h2,h3,li,div:not(.pagebreak)')) continue;
        out.push(el);
      }
      if (!out.length) {
        let n = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
        while (n && n !== ed && !/^(P|H1|H2|H3|LI|DIV)$/.test(n.tagName)) n = n.parentElement;
        if (n && n !== ed) out.push(n);
      }
      return out;
    }
    function stripBlockStyles() { blocksInSelection().forEach((b) => { b.style.lineHeight = ''; b.style.textIndent = ''; b.style.textAlign = ''; if (!b.getAttribute('style')) b.removeAttribute('style'); }); changed(); scheduleToolbar(); }

    let sizing = false, sizeDirty = false;
    function applySize(pt) {
      if (sizing) return;
      sizing = true; sizeDirty = false;
      try {
        pt = G.clamp(Math.round(pt * 2) / 2, 6, 96);
        pendingSize = pt;
        sizeInput.value = String(pt);
        exec('fontSize', '7', false);
      } finally { sizing = false; }
    }
    function bumpSize(d) { const cur = parseFloat(sizeInput.value) || DM.sanitizeDefaults(P().defaults).size; applySize(cur + d); }
    on(sizeInput, 'input', () => { sizeDirty = true; });
    on(sizeInput, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const v = parseFloat(sizeInput.value.replace(',', '.')); if (v > 0) applySize(v); else { sizeDirty = false; scheduleToolbar(); } focusEd(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bumpSize(1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bumpSize(-1); }
      else if (e.key === 'Escape') { sizeDirty = false; scheduleToolbar(); focusEd(); }
    });
    on(sizeInput, 'blur', () => { if (!sizeDirty || sizing) return; const v = parseFloat(sizeInput.value.replace(',', '.')); if (v > 0) applySize(v); else { sizeDirty = false; scheduleToolbar(); } });
    on(blockSel, 'change', () => { exec('formatBlock', '<' + blockSel.value + '>'); });
    function currentSizePt() {
      const s = getSelection();
      if (!s.rangeCount || !inEd(s.anchorNode)) return null;
      const el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
      return Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75 * 2) / 2;
    }

    function setLineSpacing(v) { blocksInSelection().forEach((b) => { b.style.lineHeight = v ? String(v) : ''; if (!b.getAttribute('style')) b.removeAttribute('style'); }); changed(); scheduleToolbar(); }
    function toggleFirstLine() {
      const bl = blocksInSelection().filter((b) => b.tagName !== 'LI');
      if (!bl.length) return;
      const allOn = bl.every((b) => b.style.textIndent);
      bl.forEach((b) => { b.style.textIndent = allOn ? '' : '36pt'; if (!b.getAttribute('style')) b.removeAttribute('style'); });
      changed(); scheduleToolbar();
    }
    function insertPageBreak() {
      if (!focusEd()) return;
      document.execCommand('insertHTML', false, '<div class="pagebreak" contenteditable="false"></div><p><br></p>');
      afterEdit();
    }

    // ------------------------------------------------------------------ ventanas emergentes
    async function openFontPicker(btn) {
      if (!G.state.fonts && G.fontsPromise) await G.fontsPromise;
      const fonts = G.state.fonts || [];
      const cur = fontLabel.textContent;
      G.togglePopover(btn, (close) => {
        const search = h('input', { class: 'input sm', type: 'search', placeholder: 'Buscar fuente…', 'aria-label': 'Buscar fuente' });
        const list = h('div', { class: 'font-list', role: 'listbox', 'aria-label': 'Fuentes instaladas' });
        const count = h('div', { class: 'dim', style: { padding: '6px 4px 0' } });
        const fill = () => {
          const q = search.value.trim().toLowerCase();
          const items = fonts.filter((f) => !q || f.toLowerCase().includes(q));
          G.clear(list);
          items.slice(0, 500).forEach((f) => list.appendChild(h('button', { class: 'font-item' + (f === cur ? ' on' : ''), type: 'button', role: 'option', 'aria-selected': String(f === cur), style: { fontFamily: "'" + f + "', sans-serif" }, onclick: () => { close(); exec('fontName', f, false); } }, f)));
          if (!items.length) list.appendChild(h('div', { class: 'dim', style: { padding: '8px' } }, 'Sin resultados.'));
          count.textContent = fonts.length + ' fuentes instaladas en este equipo';
        };
        search.addEventListener('input', fill);
        fill();
        setTimeout(() => { search.focus(); const on_ = G.$('.font-item.on', list); if (on_) on_.scrollIntoView({ block: 'center' }); }, 0);
        return h('div', { class: 'font-pop' }, search, list, count);
      }, { class: 'pop-font', restoreFocus: false });
    }
    function openColor(btn, highlight) {
      G.togglePopover(btn, (close) => {
        const sw = (highlight ? HL_SWATCHES : SWATCHES).map((c) => h('button', { class: 'swatch', type: 'button', style: { background: c }, title: c, 'aria-label': (highlight ? 'Resaltar con ' : 'Color ') + c, onclick: () => { close(); apply(c); } }));
        const custom = h('input', { type: 'color', class: 'color-in', 'aria-label': 'Color personalizado', value: highlight ? '#FFF176' : '#C62828' });
        custom.addEventListener('change', () => { close(); apply(custom.value.toUpperCase()); });
        return h('div', { class: 'col gap-12', style: { width: '188px' } },
          h('div', { class: 'swatches' }, sw),
          h('div', { class: 'row' }, h('span', { class: 'muted grow' }, 'Personalizado'), custom),
          h('button', { class: 'btn sm block', type: 'button', onclick: () => { close(); clearInlineStyle(highlight ? 'background-color' : 'color'); } }, highlight ? 'Sin resaltado' : 'Color automático'));
      }, { restoreFocus: false });
      function apply(c) { if (highlight) exec('backColor', c, true); else exec('foreColor', c, false); }
    }
    function clearInlineStyle(prop) {
      if (!focusEd()) return;
      const s = getSelection();
      if (!s.rangeCount) return;
      const r = s.getRangeAt(0);
      G.$$('span[style],font', ed).forEach((el) => {
        if (!r.intersectsNode(el)) return;
        if (el.tagName === 'FONT') { el.removeAttribute('color'); return; }
        el.style.removeProperty(prop);
      });
      afterEdit();
    }
    function openLineSpacing(btn) {
      G.menu(btn, [{ label: 'Predeterminado del documento', onClick: () => setLineSpacing(null) }, { separator: true }].concat(LH.map((v) => ({ label: String(v).replace('.', ',') + (v === 1 ? ' (sencillo)' : v === 2 ? ' (doble)' : ''), onClick: () => setLineSpacing(v) }))));
    }
    function openPageSettings(btn) {
      G.togglePopover(btn, (close) => {
        const pg = DM.sanitizePage(P().page), d = DM.sanitizeDefaults(P().defaults);
        const size = h('select', { class: 'select sm' }, Object.entries(DM.PAGE_SIZES).map(([k, v]) => h('option', { value: k, selected: k === pg.size }, v.name)));
        const preset = h('select', { class: 'select sm' }, h('option', { value: '' }, 'Personalizados'), DM.MARGIN_PRESETS.map((p) => h('option', { value: p.id }, p.name)));
        const mk = (k) => h('input', { class: 'input sm', type: 'number', step: '0.1', min: '0', max: '7.5', value: String(CM(pg.margins[k])), 'aria-label': 'Margen ' + k });
        const m = { top: mk('top'), bottom: mk('bottom'), left: mk('left'), right: mk('right') };
        const font = h('select', { class: 'select sm' }, [...new Set([d.font, ...(G.state.fonts || [])])].map((f) => h('option', { value: f, selected: f === d.font }, f)));
        const fsize = h('input', { class: 'input sm', type: 'number', step: '0.5', min: '6', max: '72', value: String(d.size), 'aria-label': 'Tamaño base' });
        const lh = h('select', { class: 'select sm' }, LH.map((v) => h('option', { value: String(v), selected: v === d.lh }, String(v).replace('.', ','))));
        if (!LH.includes(d.lh)) lh.appendChild(h('option', { value: String(d.lh), selected: true }, String(d.lh)));
        const paperSel = G.seg([{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }], G.state.config.paper || 'auto', (v) => { G.setConfig({ paper: v }); }, 'Color del papel');
        preset.addEventListener('change', () => { const p = DM.MARGIN_PRESETS.find((x) => x.id === preset.value); if (p) for (const k of Object.keys(m)) m[k].value = String(CM(p.m[k])); });
        const lbl = (t, el) => h('div', { class: 'field' }, h('label', {}, t), el);
        const err = h('div', { class: 'err', role: 'alert' });
        return h('div', { class: 'col gap-12', style: { width: '320px' } },
          h('div', { class: 'strong' }, 'Formato de página'),
          lbl('Tamaño de papel', size), lbl('Márgenes predefinidos', preset),
          h('div', { class: 'grid2' }, lbl('Superior (cm)', m.top), lbl('Inferior (cm)', m.bottom), lbl('Izquierdo (cm)', m.left), lbl('Derecho (cm)', m.right)),
          h('div', { class: 'strong', style: { marginTop: '4px' } }, 'Texto base del proyecto'),
          lbl('Fuente', font), h('div', { class: 'grid2' }, lbl('Tamaño (pt)', fsize), lbl('Interlineado', lh)),
          lbl('Color del papel en pantalla', paperSel), err,
          h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn sm', type: 'button', onclick: close }, 'Cancelar'),
            h('button', { class: 'btn sm primary', type: 'button', onclick: async () => {
              const margins = {}; for (const k of Object.keys(m)) { const v = parseFloat(m[k].value); if (!(v >= 0 && v <= 7.5)) { err.textContent = 'Los márgenes deben estar entre 0 y 7,5 cm.'; return; } margins[k] = TW(v); }
              const sz = parseFloat(fsize.value); if (!(sz >= 6 && sz <= 72)) { err.textContent = 'El tamaño base debe estar entre 6 y 72 pt.'; return; }
              const next = DM.sanitizePage({ size: size.value, margins });
              if (next.margins.left !== margins.left || next.margins.top !== margins.top) { err.textContent = 'Esos márgenes dejan muy poco espacio para escribir en este papel.'; return; }
              try { await G.updateProject({ page: next, defaults: { font: font.value, size: sz, lh: parseFloat(lh.value) } }); applyPage(); close(); G.toast('Formato de página actualizado.', { kind: 'ok' }); } catch (e) { err.textContent = e.message; }
            } }, 'Aplicar')));
      }, { align: 'right', restoreFocus: false });
    }

    // ------------------------------------------------------------------ estado de la barra
    function scheduleToolbar() { if (rafTb) return; rafTb = requestAnimationFrame(() => { rafTb = 0; refreshToolbar(); }); }
    const setOn = (b, v) => { b.setAttribute('aria-pressed', v ? 'true' : 'false'); };
    function refreshToolbar() {
      if (!ed) return;
      const s = getSelection();
      if (!s.rangeCount || !inEd(s.anchorNode)) return;
      const q = (c) => { try { return document.queryCommandState(c); } catch (_) { return false; } };
      setOn(B.b, q('bold')); setOn(B.i, q('italic')); setOn(B.u, q('underline')); setOn(B.s, q('strikeThrough'));
      setOn(B.ul, q('insertUnorderedList')); setOn(B.ol, q('insertOrderedList'));
      let el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
      if (!el) return;
      const cs = getComputedStyle(el);
      const fam = (cs.fontFamily.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/) || []).slice(1).find(Boolean);
      if (fam) fontLabel.textContent = fam.trim();
      if (document.activeElement !== sizeInput) sizeInput.value = String(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2);
      let blk = el;
      while (blk && blk !== ed && !/^(P|H1|H2|H3|LI|DIV)$/.test(blk.tagName)) blk = blk.parentElement;
      if (blk && blk !== ed) {
        const al = getComputedStyle(blk).textAlign;
        setOn(B.left, al === 'left' || al === 'start'); setOn(B.center, al === 'center'); setOn(B.right, al === 'right' || al === 'end'); setOn(B.justify, al === 'justify');
        setOn(B.fl, !!blk.style.textIndent);
        const t = blk.tagName === 'LI' ? 'p' : blk.tagName.toLowerCase();
        blockSel.value = ['h1', 'h2', 'h3'].includes(t) ? t : 'p';
      }
      pendingSize = parseFloat(sizeInput.value) || pendingSize;
    }

    // ------------------------------------------------------------------ conteo
    function scheduleCounts() { clearTimeout(countTimer); countTimer = setTimeout(updateCounts, 250); }
    function updateCounts() {
      if (!ed) return;
      const text = plus.visibleText();
      const words = DM.countWordsInText(text);
      const s = getSelection();
      let sel = '';
      if (s.rangeCount && !s.isCollapsed && inEd(s.anchorNode)) { const sw = DM.countWordsInText(s.toString()); if (sw) sel = G.fmt(sw) + ' de '; }
      const contentPx = (container.style.getPropertyValue('--content-h') || '9in');
      const pxPerPage = parseFloat(contentPx) * 96;
      const pages = Math.max(1, Math.ceil((ed.scrollHeight - 2) / pxPerPage));
      const mins = Math.max(1, Math.round(words / 230));
      stCounts.textContent = `${sel}${G.fmt(words)} palabras · ${G.fmt(text.replace(/\n/g, '').length)} caracteres · ~${pages} pág. · ${words ? mins + ' min de lectura' : 'sin texto'}`;
      const total = P().chapters.reduce((n, c) => n + (c.id === curId ? words : c.words || 0), 0);
      const t = G.$('.side-total', side); if (t) t.textContent = `${P().chapters.length} capítulos · ${G.fmt(total)} palabras`;
    }
    function spellText() {
      const st = G.state.spell, langs = (G.state.config.spell || []).join(', ');
      if (st && st.state === 'download-begin') return 'Corrector: descargando diccionario…';
      if (st && st.state === 'download-failure') return 'Corrector: sin conexión para descargar el diccionario';
      return langs ? 'Corrector: ' + langs : 'Corrector desactivado';
    }
    const refreshSpell = () => { stSpell.textContent = spellText(); };
    on(document, 'g:spell', refreshSpell); on(document, 'g:config', refreshSpell); refreshSpell();

    // ------------------------------------------------------------------ buscar y reemplazar
    const fFind = h('input', { class: 'input sm', type: 'text', placeholder: 'Buscar…', 'aria-label': 'Buscar', spellcheck: 'false' });
    const fRepl = h('input', { class: 'input sm', type: 'text', placeholder: 'Reemplazar con…', 'aria-label': 'Reemplazar con', spellcheck: 'false' });
    const fCase = h('input', { type: 'checkbox', id: 'f-case' });
    const fWord = h('input', { type: 'checkbox', id: 'f-word' });
    const fRegex = h('input', { type: 'checkbox', id: 'f-re' });
    const fInfo = h('span', { class: 'dim', 'aria-live': 'polite' });
    const hasHL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
    let matches = [], mdata = [], mIdx = -1;
    const BLOCK_RE = /^(P|H1|H2|H3|LI|DIV)$/;
    function blockOf(n) { let e = n.parentElement; while (e && e !== ed && !BLOCK_RE.test(e.tagName)) e = e.parentElement; return e; }
    // Texto plano del editor con un separador entre bloques para no encontrar coincidencias a través de párrafos.
    function flatten() {
      const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      const map = []; let str = '', last = null, n;
      while ((n = w.nextNode())) {
        if (n.parentElement && n.parentElement.closest('.tc.del, .fn')) continue;
        const blk = blockOf(n);
        if (last && blk !== last) str += '\n';
        last = blk; map.push({ node: n, start: str.length }); str += n.nodeValue;
      }
      return { str, map };
    }
    function locate(map, pos, isEnd) {
      for (let i = map.length - 1; i >= 0; i--) {
        const e = map[i], len = e.node.nodeValue.length;
        if (isEnd ? (pos > e.start && pos <= e.start + len) : (pos >= e.start && pos < e.start + len)) return { node: e.node, offset: pos - e.start };
      }
      return null;
    }
    // Arma la expresión: texto literal (escapado) o regex; "palabra completa" la rodea de límites de letra.
    function buildRe() {
      const q = fFind.value;
      if (!q) return null;
      let src = fRegex.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (fWord.checked) src = '(?<![\\p{L}\\p{N}_])(?:' + src + ')(?![\\p{L}\\p{N}_])';
      return new RegExp(src, 'gmu' + (fCase.checked ? '' : 'i'));
    }
    // En modo regex, $1, $&, $<nombre> y $$ funcionan en el texto de reemplazo.
    function expand(repl, m) {
      if (!fRegex.checked) return repl;
      return repl.replace(/\$(\$|&|\d{1,2}|<([A-Za-z_]\w*)>)/g, (all, t, name) => (t === '$' ? '$' : t === '&' ? m[0] : name ? ((m.groups && m.groups[name]) || '') : (m[+t] !== undefined ? m[+t] : all)));
    }
    function scan() {
      matches = []; mdata = [];
      let bad = '';
      const q = fFind.value;
      if (q && ed) {
        let re = null;
        try { re = buildRe(); } catch (_) { bad = 'Expresión regular no válida'; }
        if (re) {
          const { str, map } = flatten();
          let m;
          while (matches.length < 20000 && (m = re.exec(str))) {
            if (!m[0].length) { re.lastIndex++; continue; }
            const a1 = locate(map, m.index, false), b1 = locate(map, m.index + m[0].length, true);
            if (a1 && b1) { const r = document.createRange(); r.setStart(a1.node, a1.offset); r.setEnd(b1.node, b1.offset); matches.push(r); mdata.push(m); }
          }
        }
      }
      if (mIdx >= matches.length) mIdx = matches.length - 1;
      paintMatches();
      fInfo.classList.toggle('bad', !!bad);
      fInfo.textContent = bad || (!q ? '' : !matches.length ? 'Sin coincidencias' : (mIdx >= 0 ? (mIdx + 1) + ' de ' : '') + matches.length + (matches.length === 1 ? ' coincidencia' : ' coincidencias'));
    }
    function paintMatches() {
      if (!hasHL) return;
      try {
        CSS.highlights.set('g-find', new Highlight(...matches));
        if (mIdx >= 0 && matches[mIdx]) CSS.highlights.set('g-find-cur', new Highlight(matches[mIdx])); else CSS.highlights.delete('g-find-cur');
      } catch (_) { /* sin soporte */ }
    }
    function clearPaint() { if (hasHL) { try { CSS.highlights.delete('g-find'); CSS.highlights.delete('g-find-cur'); } catch (_) { /* noop */ } } }
    function gotoMatch(i) {
      if (!matches.length) return false;
      mIdx = ((i % matches.length) + matches.length) % matches.length;
      const r = matches[mIdx];
      const el = r.startContainer.parentElement;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      if (!hasHL) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      paintMatches();
      fInfo.textContent = (mIdx + 1) + ' de ' + matches.length + (matches.length === 1 ? ' coincidencia' : ' coincidencias');
      return true;
    }
    // Posición de partida: la selección actual del editor (o la última conocida).
    function nearestIndex(back) {
      const ref = (() => { const s = getSelection(); return s.rangeCount && inEd(s.anchorNode) ? s.getRangeAt(0) : lastRange; })();
      if (!ref) return back ? matches.length - 1 : 0;
      if (back) { for (let i = matches.length - 1; i >= 0; i--) if (matches[i].compareBoundaryPoints(Range.START_TO_START, ref) < 0) return i; return matches.length - 1; }
      for (let i = 0; i < matches.length; i++) if (matches[i].compareBoundaryPoints(Range.START_TO_START, ref) > 0) return i;
      return 0;
    }
    function findNext(back) {
      scan();
      if (!matches.length) return false;
      if (mIdx >= 0) return gotoMatch(mIdx + (back ? -1 : 1));
      return gotoMatch(nearestIndex(back));
    }
    function replaceCurrent() {
      scan();
      if (!matches.length) return;
      if (mIdx < 0) { gotoMatch(nearestIndex(false)); return; }
      const r = matches[mIdx], m = mdata[mIdx];
      lastRange = r.cloneRange();
      plus.replaceRange(r, expand(fRepl.value, m));
      afterEdit();
      const keep = mIdx;
      scan();
      if (matches.length) gotoMatch(Math.min(keep, matches.length - 1));
    }
    function replaceAll() {
      scan();
      const n = matches.length;
      if (!n) { G.toast('No se encontraron coincidencias.', { kind: 'info' }); return; }
      if (plus.mode() === 'read') { G.toast('Sal del modo lectura para reemplazar texto.', { kind: 'info' }); return; }
      const rs = matches.slice(), ds = mdata.slice();
      for (let i = n - 1; i >= 0; i--) plus.replaceRange(rs[i], expand(fRepl.value, ds[i]));
      afterEdit(); mIdx = -1; scan();
      G.toast(`Se reemplazaron ${G.fmt(n)} coincidencias.` + (plus.tracking() ? ' Quedaron marcadas como cambios.' : ''), { kind: 'ok' });
    }
    findBar.append(fFind, fRepl,
      h('label', { class: 'check', for: 'f-case' }, fCase, h('span', {}, 'Mayús./minús.')),
      h('label', { class: 'check', for: 'f-word', title: 'Solo coincide con palabras enteras' }, fWord, h('span', {}, 'Palabra')),
      h('label', { class: 'check', for: 'f-re', title: 'Expresión regular. En el reemplazo: $1, $2, $& y $<nombre>' }, fRegex, h('span', {}, 'Regex')),
      h('button', { class: 'ibtn sm', type: 'button', title: 'Anterior (Mayús+Enter)', 'aria-label': 'Coincidencia anterior', onclick: () => findNext(true) }, G.icon('chevU', 16)),
      h('button', { class: 'ibtn sm', type: 'button', title: 'Siguiente (Enter)', 'aria-label': 'Coincidencia siguiente', onclick: () => findNext(false) }, G.icon('chevD', 16)),
      h('button', { class: 'btn sm', type: 'button', onclick: replaceCurrent }, 'Reemplazar'), h('button', { class: 'btn sm', type: 'button', onclick: replaceAll }, 'Reemplazar todo'),
      fInfo, h('div', { class: 'grow' }), h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Cerrar búsqueda', onclick: () => toggleFind(false) }, G.icon('close', 16)));
    on(fFind, 'input', () => { mIdx = -1; scan(); });
    on(fFind, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey); } });
    on(fRepl, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); } });
    for (const c of [fCase, fWord, fRegex]) on(c, 'change', () => { mIdx = -1; scan(); });
    const rescanSoon = G.debounce(() => { if (!findBar.hidden) scan(); }, 300);
    function toggleFind(open) {
      findBar.hidden = !open;
      if (open) { const s = getSelection(); if (s.rangeCount && !s.isCollapsed && inEd(s.anchorNode) && s.toString().length < 80 && !s.toString().includes('\n')) fFind.value = s.toString(); fFind.focus(); fFind.select(); mIdx = -1; scan(); }
      else { clearPaint(); matches = []; mIdx = -1; fInfo.textContent = ''; focusEd(); }
    }
    cleanups.push(clearPaint);

    // ------------------------------------------------------------------ capítulos
    function syncSide() { side.hidden = !sideOpen; setOn(B.side, sideOpen); if (typeof fitZoom === 'function') setTimeout(fitZoom, 0); }
    function renderSide() {
      G.clear(side);
      side.append(plus.tabsEl());
      if (plus.sideTab() !== 'chapters') { plus.renderPanel(side); return; }
      const chs = P().chapters;
      side.append(
        h('div', { class: 'side-head' }, h('h2', { class: 'strong grow' }, 'Capítulos'),
          h('button', { class: 'ibtn sm', type: 'button', title: 'Importar documentos .docx', 'aria-label': 'Importar documentos .docx', onclick: importDocx }, G.icon('import', 16)),
          h('button', { class: 'ibtn sm', type: 'button', title: 'Nuevo capítulo', 'aria-label': 'Nuevo capítulo', onclick: newChapter }, G.icon('plus', 16))),
        h('div', { class: 'side-list scroll', role: 'list' }, chs.map((c, i) => {
          const more = h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Acciones del capítulo ' + c.title, onclick: (e) => { e.stopPropagation(); chapterMenu(more, c, i); } }, G.icon('more', 16));
          return h('div', { class: 'ch-item' + (c.id === curId ? ' active' : ''), role: 'listitem', 'data-id': c.id },
            h('button', { class: 'ch-main', type: 'button', 'aria-current': c.id === curId ? 'true' : null, onclick: () => openChapter(c.id) }, h('span', { class: 'ch-n' }, String(i + 1)), h('span', { class: 'ch-t ellip' }, c.title), h('span', { class: 'ch-w' }, G.fmt(c.words || 0))), more);
        })),
        h('div', { class: 'side-total dim' }));
      updateCounts();
    }
    function chapterMenu(btn, c, i) {
      const chs = P().chapters;
      G.menu(btn, [
        { label: 'Renombrar', icon: 'edit', onClick: () => renameChapter(c) },
        { label: 'Mover arriba', icon: 'arrowUp', disabled: i === 0, onClick: () => moveChapter(i, -1) },
        { label: 'Mover abajo', icon: 'arrowDown', disabled: i === chs.length - 1, onClick: () => moveChapter(i, 1) },
        { label: 'Guardar como .docx…', icon: 'save', onClick: async () => { if (c.id === curId) exportDocx(); else { try { const r = await G.call('chapter:exportDocx', { projectId: pid, chapterId: c.id }); if (!r.canceled) G.toast('Capítulo guardado en ' + r.path, { kind: 'ok' }); } catch (e) { G.toast(e.message, { kind: 'err' }); } } } },
        { separator: true },
        { label: 'Eliminar capítulo', icon: 'trash', danger: true, onClick: () => deleteChapter(c) },
      ], { align: 'right' });
    }
    async function renameChapter(c) {
      if (c.id === curId) { titleInput.focus(); titleInput.select(); return; }
      const t = await G.prompt({ title: 'Renombrar capítulo', label: 'Título', value: c.title, confirmLabel: 'Renombrar' });
      if (t) { try { G.state.project = (await G.call('chapter:rename', { projectId: pid, chapterId: c.id, title: t })).project; renderSide(); } catch (e) { G.toast(e.message, { kind: 'err' }); } }
    }
    async function moveChapter(i, d) {
      const order = P().chapters.map((c) => c.id); const j = i + d;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      try { G.state.project = (await G.call('chapter:reorder', { projectId: pid, order })).project; renderSide(); } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function deleteChapter(c) {
      const ok = await G.confirm({ title: 'Eliminar «' + c.title + '»', message: `Se borrará el capítulo con sus ${G.fmt(c.words || 0)} palabras. Esta acción no se puede deshacer; si dudas, primero guárdalo como .docx.`, confirmLabel: 'Eliminar capítulo', danger: true });
      if (!ok) return;
      try {
        if (c.id === curId) { saver.destroy(); }
        const r = await G.call('chapter:delete', { projectId: pid, chapterId: c.id });
        G.state.project = r.project;
        if (c.id === curId) { curId = null; ed = null; await openChapter(r.project.lastChapter || r.project.chapters[0].id, true); } else renderSide();
        G.toast('Capítulo eliminado.', { kind: 'ok' });
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function newChapter() {
      if (!(await saver.flush())) return;
      try {
        const r = await G.call('chapter:create', { projectId: pid });
        G.state.project = r.project;
        await openChapter(r.chapter.id, true);
        titleInput.focus(); titleInput.select();
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function importDocx() {
      try {
        if (!(await saver.flush())) return;
        const r = await G.call('chapter:importDocx', { projectId: pid });
        if (r.canceled) return;
        G.state.project = r.project;
        const errs = r.issues.filter((i) => i.level === 'error'), warns = r.issues.filter((i) => i.level === 'warn');
        if (r.imported.length) { await openChapter(r.imported[r.imported.length - 1].id, true); G.toast(`Se importaron ${r.imported.length} documento(s).` + (warns.length ? ' ' + warns.map((w) => w.file + ': ' + w.messages.join(' ')).join(' ') : ''), { kind: warns.length ? 'info' : 'ok', ms: warns.length ? 9000 : 4200 }); }
        else renderSide();
        if (errs.length) G.toast(errs.map((e) => e.file + ': ' + e.messages.join(' ')).join(' · '), { kind: 'err' });
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function exportDocx() {
      try {
        const model = plus.serialize();
        const r = await G.call('chapter:exportDocx', { projectId: pid, chapterId: curId, model });
        if (!r.canceled) G.toast('Guardado como ' + r.path, { kind: 'ok' });
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    on(titleInput, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); focusEd(); } else if (e.key === 'Escape') { titleInput.value = (P().chapters.find((c) => c.id === curId) || {}).title || ''; titleInput.blur(); } });
    on(titleInput, 'blur', async () => {
      const ch = P().chapters.find((c) => c.id === curId);
      if (!ch) return;
      const t = titleInput.value.trim();
      if (!t) { titleInput.value = ch.title; return; }
      if (t === ch.title) return;
      try { G.state.project = (await G.call('chapter:rename', { projectId: pid, chapterId: curId, title: t })).project; renderSide(); } catch (e) { titleInput.value = ch.title; G.toast(e.message, { kind: 'err' }); }
    });

    // ------------------------------------------------------------------ cargar capítulo
    async function openChapter(id, force) {
      if (id === curId && !force) return;
      if (curId && ed && !(await saver.flush())) {
        if (!(await G.confirm({ title: 'No se pudo guardar este capítulo', message: 'Si cambias de capítulo ahora podrías perder los últimos cambios. ¿Cambiar de todos modos?', confirmLabel: 'Cambiar', cancelLabel: 'Quedarme', danger: true }))) return;
      }
      const my = ++token;
      loading = true;
      try {
        const r = await G.call('chapter:read', { projectId: pid, chapterId: id });
        if (my !== token) return;
        curId = id;
        const el = h('div', { class: 'ed-content', contenteditable: 'true', spellcheck: 'true', lang: 'es', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texto del capítulo' });
        el.innerHTML = DM.modelToHtml(r.model) || '<p><br></p>';
        if (G.anim()) el.classList.add('paper-in');
        if (ed) ed.replaceWith(el); else paper.appendChild(el);
        ed = el;
        bindEditor(el);
        plus.load(r.model);
        titleInput.value = r.title;
        P().lastChapter = id;
        G.call('project:update', { id: pid, patch: { lastChapter: id } }).catch(() => {});
        if (r.warnings && r.warnings.length) G.toast(r.warnings.join(' '), { kind: 'info', ms: 8000 });
        lastRange = null;
        setSaveState('saved');
        renderSide();
        scheduleToolbar();
      } catch (e) {
        G.toast(e.message, { kind: 'err' });
        if (!ed) { paper.appendChild(h('div', { class: 'empty' }, G.icon('warn', 28), h('div', {}, e.message))); }
      } finally { if (my === token) loading = false; }
    }

    function insertPlain(text) {
      text = text.replace(/\r\n?/g, '\n');
      if (plus.tracking()) { plus.insertTracked(text); afterEdit(); return; }
      const lines = text.split('\n');
      if (lines.length === 1) { document.execCommand('insertText', false, lines[0]); }
      else {
        const html = lines.map((l) => '<p>' + (DM.esc(l) || '<br>') + '</p>').join('');
        document.execCommand('insertHTML', false, html);
      }
      afterEdit();
    }
    function bindEditor(el) {
      document.execCommand('defaultParagraphSeparator', false, 'p');
      plus.attach(el);
      el.addEventListener('input', () => { normalize(); captureRange(); changed(); scheduleToolbar(); });
      el.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); if (t) insertPlain(t); });
      el.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault(); });
      el.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (e.key === 'Tab') {
          e.preventDefault();
          const inList = document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList');
          if (inList) exec(e.shiftKey ? 'outdent' : 'indent'); else if (!e.shiftKey) { document.execCommand('insertText', false, '\t'); afterEdit(); }
        } else if (e.ctrlKey && !e.shiftKey && !e.altKey && ['l', 'e', 'r', 'j'].includes(k)) {
          e.preventDefault(); exec({ l: 'justifyLeft', e: 'justifyCenter', r: 'justifyRight', j: 'justifyFull' }[k]);
        }
      });
      el.addEventListener('focus', scheduleToolbar);
      // El evento selectionchange llega tarde: se captura la selección al salir del editor y tras teclado/ratón.
      for (const ev of ['blur', 'keyup', 'mouseup']) el.addEventListener(ev, captureRange);
    }
    on(document, 'selectionchange', onSel);
    on(container, 'keydown', (e) => {
      if (plus.onKey(e)) return;
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saver.touch(); saver.flush().then((ok) => G.toast(ok ? 'Guardado en el proyecto.' : 'No se pudo guardar.', { kind: ok ? 'ok' : 'err', ms: 1800 })); }
      else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFind(true); }
      else if (e.key === 'Escape' && !findBar.hidden && findBar.contains(document.activeElement)) { toggleFind(false); }
    });
    on(scroller, 'wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom + (e.deltaY < 0 ? 10 : -10), true); } }, { passive: false });
    on(scroller, 'mousedown', (e) => { if (ed && (e.target === scroller || e.target.classList.contains('ed-sheet') || e.target === wrap)) { e.preventDefault(); focusEd(); } });

    // ------------------------------------------------------------------ inicio
    function fitZoom() {
      if (!autoZoom || !scroller.clientWidth || plus.mode() === 'read') return;
      const ps = DM.PAGE_SIZES[DM.sanitizePage(P().page).size];
      const avail = scroller.clientWidth - 56 - plus.marginWidth();
      const need = (ps.w / 1440) * 96;
      setZoom(avail < need ? Math.max(50, Math.floor((avail / need) * 10) * 10) : 100);
    }
    on(window, 'resize', G.debounce(fitZoom, 120));
    applyPage(); syncSide(); renderSide();
    const first = P().chapters.some((c) => c.id === P().lastChapter) ? P().lastChapter : P().chapters[0].id;
    await openChapter(first, true);
    return {
      destroy() { saver.destroy(); plus.destroy(); cleanups.forEach((f) => f()); clearTimeout(countTimer); cancelAnimationFrame(rafTb); },
      afterMount() { fitZoom(); if (ed) ed.focus({ preventScroll: true }); },
    };
  };
})();
