/* Grafema — extensiones del editor: panel de esquema, notas al pie, comentarios en el margen,
 * control de cambios, y los modos enfoque y lectura. El editor (editor.js) crea esto con G.editorPlus(ctx). */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const DM = window.DocModel;
  const BLOCK_RE = /^(P|H1|H2|H3|LI|DIV)$/;
  const MARGIN_W = 268;

  G.editorPlus = function editorPlus(ctx) {
    const { container, scroller, wrap, sheet, statusbar, B } = ctx;
    const P = ctx.P;
    const getEd = ctx.getEd;
    const cleanups = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
    const author = () => (G.state.config && G.state.config.author) || (G.state.user && G.state.user.name) || 'Autor';

    let notes = new Map();      // id -> texto de la nota al pie
    let comments = new Map();   // id -> { id, author, date, text, resolved }
    let track = false;          // control de cambios
    let mode = null;            // null | 'focus' | 'read'
    let sideTab = 'chapters';   // chapters | outline | review
    let marginOn = true, showResolved = false, typewriter = true, dimOthers = true;
    let activeCm = null, activeNote = null, sideWasOpen = true, hinted = false;
    let busy = false;           // evita reentradas mientras Grafema ejecuta sus propios comandos de edición
    let readScale = 1, outlineActive = -1;
    const cards = new Map();    // tarjetas del margen por id de comentario

    const unwrap = (el) => { const p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); };
    const blockOf = (n) => { const ed = getEd(); let e = n.nodeType === 3 ? n.parentElement : n; while (e && e !== ed && !BLOCK_RE.test(e.tagName)) e = e.parentElement; return e; };
    const elOf = (n) => (n && n.nodeType === 3 ? n.parentElement : n);
    const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.min(220, ta.scrollHeight + 2) + 'px'; };
    const touch = () => { ctx.changed(); };

    // ====================================================================== estado del documento
    function load(model) {
      notes = new Map((model.notes || []).map((n) => [n.id, n.text || '']));
      comments = new Map((model.comments || []).map((c) => [c.id, Object.assign({}, c)]));
      track = !!model.track;
      activeCm = null; activeNote = null;
      syncTrackUI();
      applyReadonly();
      paintResolved();
      scheduleLayout();
    }
    function serialize() {
      return DM.domToModel(getEd(), P().defaults, { notes: [...notes].map(([id, text]) => ({ id, text })), comments: [...comments.values()], track });
    }
    // Texto visible (sin lo marcado como eliminado) para contar palabras y caracteres.
    function visibleText() {
      const ed = getEd();
      const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let str = '', last = null, n;
      while ((n = w.nextNode())) {
        if (n.parentElement.closest('.tc.del, .fn')) continue;
        const blk = blockOf(n);
        if (last && blk !== last) str += '\n';
        last = blk; str += n.nodeValue;
      }
      return str;
    }

    // ====================================================================== notas al pie
    // El marcador es <span class="fn" data-fn>: un carácter invisible con un estilo-centinela que luego se convierte
    // en su sitio (Chromium desfigura los elementos personalizados insertados con insertHTML). Así la inserción es nativa.
    function insertFootnote() {
      const ed = getEd();
      if (!ed || mode === 'read') return;
      if (!ctx.focusEd()) return;
      const id = G.uid().slice(0, 12);
      busy = true;
      try { document.execCommand('styleWithCSS', false, true); document.execCommand('fontName', false, 'gfn-' + id); document.execCommand('insertText', false, '\u200B'); } finally { busy = false; }
      let made = null;
      for (const el of G.$$('span[style], font[face]', ed)) {
        const fam = el.tagName === 'FONT' ? el.getAttribute('face') : el.style.fontFamily;
        if (!fam || !fam.includes('gfn-' + id)) continue;
        let target = el;
        if (el.tagName === 'FONT') { target = document.createElement('span'); while (el.firstChild) target.appendChild(el.firstChild); el.replaceWith(target); }
        else { el.style.removeProperty('font-family'); if (!el.getAttribute('style')) el.removeAttribute('style'); }
        target.className = 'fn'; target.setAttribute('data-fn', id); target.setAttribute('contenteditable', 'false');
        made = target;
      }
      if (!made) { G.toast('No se pudo insertar la nota al pie en este punto.', { kind: 'err' }); return; }
      const r = document.createRange(); r.setStartAfter(made); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      notes.set(id, '');
      ctx.afterEdit();
      openReview({ note: id });
    }
    function footnoteRefs() { const ed = getEd(); return ed ? G.$$('.fn[data-fn]', ed) : []; }

    // ====================================================================== comentarios
    function mergeCm(el, id) {
      const cur = (el.getAttribute('data-cm') || '').split(/\s+/).filter(Boolean);
      if (!cur.includes(id)) cur.push(id);
      el.setAttribute('data-cm', cur.join(' '));
      el.classList.add('cm');
    }
    function addComment() {
      const ed = getEd();
      if (!ed || mode === 'read') return;
      if (!ctx.focusEd()) return;
      const s = getSelection();
      if (!s.rangeCount) return;
      if (s.isCollapsed) { try { s.modify('move', 'backward', 'word'); s.modify('extend', 'forward', 'word'); } catch (_) { /* noop */ } }
      if (s.isCollapsed || !s.toString().trim()) { G.toast('Selecciona el texto que quieres comentar.', { kind: 'info' }); return; }
      const id = G.uid();
      // Truco: se aplica una "fuente" con el id y luego se convierte en una marca de comentario.
      busy = true;
      try { document.execCommand('styleWithCSS', false, true); document.execCommand('fontName', false, 'gcm-' + id); } finally { busy = false; }
      let n = 0;
      for (const el of G.$$('span, font', ed)) {
        const fam = el.tagName === 'FONT' ? el.getAttribute('face') : el.style.fontFamily;
        if (!fam || !fam.includes('gcm-' + id)) continue;
        let target = el;
        if (el.tagName === 'FONT') { target = document.createElement('span'); while (el.firstChild) target.appendChild(el.firstChild); el.replaceWith(target); }
        else { el.style.removeProperty('font-family'); if (!el.getAttribute('style')) el.removeAttribute('style'); }
        mergeCm(target, id); n++;
      }
      if (!n) { G.toast('No se pudo agregar el comentario en esa selección.', { kind: 'err' }); return; }
      comments.set(id, { id, author: author(), date: new Date().toISOString(), text: '', resolved: false });
      activeCm = id;
      ctx.afterEdit();
      refresh(true);
      focusCard(id);
    }
    function removeComment(id) {
      const ed = getEd();
      for (const el of G.$$('[data-cm~="' + id + '"]', ed)) {
        const ids = el.getAttribute('data-cm').split(/\s+/).filter((x) => x && x !== id);
        if (ids.length) el.setAttribute('data-cm', ids.join(' '));
        else { el.removeAttribute('data-cm'); el.classList.remove('cm'); el.removeAttribute('data-res'); el.removeAttribute('data-on'); if (!el.getAttribute('style') && el.tagName === 'SPAN') unwrap(el); }
      }
      comments.delete(id);
      if (activeCm === id) activeCm = null;
      touch(); refresh(true);
    }
    function setResolved(id, v) { const c = comments.get(id); if (!c) return; c.resolved = !!v; touch(); refresh(true); }
    function paintResolved() {
      const ed = getEd(); if (!ed) return;
      for (const el of G.$$('.cm[data-cm]', ed)) {
        const ids = el.getAttribute('data-cm').split(/\s+/).filter(Boolean);
        const allRes = ids.length && ids.every((i) => comments.has(i) && comments.get(i).resolved);
        if (allRes) el.setAttribute('data-res', '1'); else el.removeAttribute('data-res');
        if (ids.includes(activeCm)) el.setAttribute('data-on', '1'); else el.removeAttribute('data-on');
      }
    }
    function selectComment(id) {
      const el = getEd() && getEd().querySelector('[data-cm~="' + id + '"]');
      if (!el) return;
      activeCm = id;
      const r = document.createRange(); r.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      el.scrollIntoView({ block: 'center', behavior: G.anim() ? 'smooth' : 'auto' });
      paintResolved(); highlightCards();
    }
    function buildCard(c, opts) {
      opts = opts || {};
      const ta = h('textarea', { class: 'cm-ta', rows: 1, maxlength: 5000, spellcheck: 'true', lang: 'es', placeholder: 'Escribe tu comentario…', 'aria-label': 'Comentario de ' + (c.author || 'autor') });
      ta.value = c.text || '';
      ta.addEventListener('input', () => { c.text = ta.value; autosize(ta); touch(); if (!opts.panel) scheduleLayout(); });
      ta.addEventListener('focus', () => { activeCm = c.id; paintResolved(); highlightCards(); });
      ta.addEventListener('blur', () => { if (!c.text.trim()) { setTimeout(() => { if (comments.has(c.id) && !(comments.get(c.id).text || '').trim() && document.activeElement !== ta) removeComment(c.id); }, 150); } });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ta.blur(); ctx.focusEd(); } });
      const card = h('div', { class: 'cm-card' + (c.resolved ? ' resolved' : ''), 'data-id': c.id },
        h('div', { class: 'cm-head' },
          h('span', { class: 'cm-by ellip' }, c.author || 'Autor'), h('span', { class: 'dim cm-when' }, when(c.date)),
          h('button', { class: 'ibtn sm', type: 'button', title: c.resolved ? 'Reabrir' : 'Marcar como resuelto', 'aria-label': c.resolved ? 'Reabrir comentario' : 'Resolver comentario', onclick: () => setResolved(c.id, !c.resolved) }, G.icon(c.resolved ? 'undo' : 'check', 15)),
          h('button', { class: 'ibtn sm', type: 'button', title: 'Eliminar comentario', 'aria-label': 'Eliminar comentario', onclick: () => removeComment(c.id) }, G.icon('trash', 15))),
        ta);
      card.addEventListener('mousedown', (e) => { if (e.target === ta) return; selectComment(c.id); });
      requestAnimationFrame(() => { autosize(ta); if (!opts.panel) scheduleLayout(); });   // con la altura final, se recoloca sin solapes
      card._ta = ta;
      return card;
    }
    function focusCard(id) {
      requestAnimationFrame(() => {
        const card = cards.get(id) || (side() && G.$('.cm-card[data-id="' + id + '"]', side()));
        if (card && card._ta) { card._ta.focus(); }
      });
    }
    function highlightCards() {
      for (const [id, el] of cards) el.classList.toggle('active', id === activeCm);
      const s = side(); if (s) for (const el of G.$$('.cm-card', s)) el.classList.toggle('active', el.getAttribute('data-id') === activeCm);
    }

    // ---- columna del margen (junto al papel) ----
    const marginCol = h('div', { class: 'cm-col', hidden: true, 'aria-label': 'Comentarios' });
    sheet.appendChild(marginCol);
    let layoutRaf = 0;
    function scheduleLayout() { if (layoutRaf) return; layoutRaf = requestAnimationFrame(() => { layoutRaf = 0; layoutMargin(); }); }
    function marginWidth() { return marginCol.hidden ? 0 : MARGIN_W + 16; }
    function layoutMargin() {
      const ed = getEd();
      const list = [...comments.values()].filter((c) => showResolved || !c.resolved);
      const visible = !!ed && marginOn && !!list.length && !mode;
      const was = !marginCol.hidden;
      marginCol.hidden = !visible;
      if (was !== visible && ctx.fitZoom) setTimeout(ctx.fitZoom, 0);
      if (!visible) { for (const el of cards.values()) el.remove(); cards.clear(); return; }
      const top0 = marginCol.getBoundingClientRect().top;
      const items = [];
      for (const c of list) {
        const el = ed.querySelector('[data-cm~="' + c.id + '"]');
        if (el) items.push({ c, y: el.getBoundingClientRect().top - top0 });
      }
      items.sort((a, b) => a.y - b.y);
      const keep = new Set(items.map((i) => i.c.id));
      for (const [id, el] of [...cards]) if (!keep.has(id)) { el.remove(); cards.delete(id); }
      let bottom = -Infinity;
      for (const it of items) {
        let card = cards.get(it.c.id);
        if (!card) { card = buildCard(it.c); cards.set(it.c.id, card); marginCol.appendChild(card); }
        card.classList.toggle('resolved', !!it.c.resolved);
        const y = Math.max(it.y, bottom + 8);
        card.style.top = Math.round(y) + 'px';
        bottom = y + card.offsetHeight;
      }
      highlightCards();
    }

    // ====================================================================== control de cambios
    // Cada marca es un <span class="tc ins|del" data-tc data-tt data-a data-d>. Se crea con un comando nativo
    // (fontName con un nombre-centinela) y se convierte en su sitio: así el deshacer del navegador sigue funcionando.
    const SENT = /gtc-(ins|del)-([A-Za-z0-9]+)/;
    const sentinelOf = (el) => { const fam = el.tagName === 'FONT' ? el.getAttribute('face') : (el.style && el.style.fontFamily); return (fam && SENT.exec(fam)) || null; };
    const newId = () => G.uid().slice(0, 12);
    const isOwn = (el) => !!el && el.getAttribute('data-a') === author();
    function convertMarks() {
      const ed = getEd(); if (!ed) return [];
      const out = [], date = new Date().toISOString();
      for (const el of G.$$('span[style], font[face]', ed)) {
        const m = sentinelOf(el);
        if (!m) continue;
        let target = el;
        if (el.tagName === 'FONT') { target = document.createElement('span'); while (el.firstChild) target.appendChild(el.firstChild); el.replaceWith(target); }
        else { el.style.removeProperty('font-family'); if (!el.getAttribute('style')) el.removeAttribute('style'); }
        if (target.hasAttribute('data-tc') || target.classList.contains('fn')) continue;   // ya era un cambio o es una nota: solo se quita el centinela
        target.classList.add('tc', m[1]);
        target.setAttribute('data-tc', m[2]); target.setAttribute('data-tt', m[1]);
        target.setAttribute('data-a', author()); target.setAttribute('data-d', date);
        out.push(target);
      }
      return out;
    }
    function cleanMarks() {
      const ed = getEd();
      for (const e of G.$$('.tc:empty', ed)) e.remove();
      // Un cambio del mismo tipo dentro de otro (p. ej. borrar de nuevo algo ya marcado) se aplana.
      for (const inner of G.$$('.tc .tc', ed)) {
        const outer = inner.parentElement.closest('.tc');
        if (outer && outer.getAttribute('data-tt') === inner.getAttribute('data-tt')) unwrap(inner);
      }
    }
    function adjacent(range, type) {
      const a = author();
      const before = (() => { const c = range.startContainer, o = range.startOffset; return c.nodeType === 3 ? (o === 0 ? c.previousSibling : null) : (o > 0 ? c.childNodes[o - 1] : c.previousSibling); })();
      const after = (() => { const c = range.endContainer, o = range.endOffset; return c.nodeType === 3 ? (o === c.length ? c.nextSibling : null) : (c.childNodes[o] || c.nextSibling); })();
      for (const n of [after, before]) if (n && n.nodeType === 1 && n.matches && n.matches('.tc.' + type) && n.getAttribute('data-a') === a) return n;
      return null;
    }
    function caretAt(node, after) {
      const r = document.createRange();
      if (after) r.setStartAfter(node); else r.setStartBefore(node);
      r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    function caretEndOf(el) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let last = null, n;
      while ((n = w.nextNode())) last = n;
      const r = document.createRange();
      if (last) r.setStart(last, last.length); else r.setStart(el, 0);
      r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }
    const sentinel = (type, id) => { document.execCommand('styleWithCSS', false, true); document.execCommand('fontName', false, 'gtc-' + type + '-' + id); };
    // Deja el "estilo de escritura" listo: lo que se teclee a continuación nace marcado como insertado.
    function prepareInsert() {
      const s = getSelection();
      if (!s.rangeCount) return;
      let cur = elOf(s.anchorNode);
      const d = cur && cur.closest('.tc.del');
      if (d) { caretAt(d, true); cur = elOf(getSelection().anchorNode); }       // no se escribe dentro de lo eliminado
      if (cur && cur.closest('.tc.ins')) return;                                // ya se escribe dentro de un tramo insertado
      const near = adjacent(getSelection().getRangeAt(0), 'ins');
      busy = true;
      try { sentinel('ins', near ? near.getAttribute('data-tc') : newId()); } finally { busy = false; }
    }
    // Los Range vivos pueden colapsarse cuando el navegador reorganiza nodos de texto; los desplazamientos
    // de texto, en cambio, no cambian con la estructura. Se usan para volver a construir el rango.
    function textOffset(container, offset) {
      const r = document.createRange(); r.selectNodeContents(getEd()); r.setEnd(container, offset);
      return r.toString().length;
    }
    function rangeAt(a, b) {
      const w = document.createTreeWalker(getEd(), NodeFilter.SHOW_TEXT);
      let n, pos = 0, sn = null, so = 0, en = null, eo = 0;
      while ((n = w.nextNode())) {
        const len = n.nodeValue.length;
        if (!sn && a <= pos + len) { sn = n; so = a - pos; }
        if (sn && b <= pos + len) { en = n; eo = b - pos; break; }
        pos += len;
      }
      const r = document.createRange();
      if (!sn || !en) { r.selectNodeContents(getEd()); r.collapse(false); return r; }
      r.setStart(sn, so); r.setEnd(en, eo);
      return r;
    }
    const insideOwnIns = (r) => {
      const a = elOf(r.startContainer).closest('.tc.ins'), b = elOf(r.endContainer).closest('.tc.ins');
      return !!a && a === b && isOwn(a);
    };
    // Marca como eliminado lo que no escribió este autor y borra de verdad lo que sí escribió.
    function markDeleted(range) {
      const ed = getEd(), s = getSelection();
      const so = textOffset(range.startContainer, range.startOffset), eo = textOffset(range.endContainer, range.endOffset);
      if (eo <= so) return { created: [], removedOwn: false };
      const near = adjacent(range, 'del');
      const id = near ? near.getAttribute('data-tc') : newId();
      const before = new Set(G.$$('.tc.del', ed));
      let removedOwn = false;
      busy = true;
      try {
        // A) se marca todo lo seleccionado (un único comando nativo, deshacible)
        s.removeAllRanges(); s.addRange(rangeAt(so, eo)); sentinel('del', id);
        convertMarks();
        // B) lo que escribió este mismo autor dentro de la selección se borra de verdad
        for (const span of G.$$('.tc.ins', ed).reverse()) {
          if (!isOwn(span)) continue;
          const a = textOffset(span, 0), b = a + span.textContent.length;
          const lo = Math.max(a, so), hi = Math.min(b, eo);
          if (hi <= lo) continue;
          s.removeAllRanges(); s.addRange(rangeAt(lo, hi)); document.execCommand('delete'); removedOwn = true;
        }
      } finally { busy = false; }
      convertMarks(); cleanMarks();
      return { created: G.$$('.tc.del', ed).filter((el) => !before.has(el)), removedOwn };
    }
    // Reemplazar = escribir lo nuevo justo después de lo seleccionado y marcar lo seleccionado como eliminado
    // (así el texto nuevo nunca queda dentro del tramo eliminado).
    function trackedReplaceSelection(text) {
      const s = getSelection();
      if (!s.rangeCount) return;
      let r = null, so = 0, eo = 0;
      if (!s.isCollapsed) {
        r = s.getRangeAt(0).cloneRange();
        so = textOffset(r.startContainer, r.startOffset); eo = textOffset(r.endContainer, r.endOffset);
        const end = r.cloneRange(); end.collapse(false); s.removeAllRanges(); s.addRange(end);
      }
      let insEl = null;
      if (text) {
        prepareInsert();
        busy = true;
        try { document.execCommand('insertText', false, text); } finally { busy = false; }
        convertMarks();
        insEl = s.anchorNode ? elOf(s.anchorNode).closest('.tc.ins') : null;
      }
      if (r) {
        const { created } = markDeleted(rangeAt(so, eo));
        if (insEl && insEl.isConnected) caretEndOf(insEl);
        else if (created.length) caretAt(created[created.length - 1], true);
      }
    }
    function trackedDelete(r, back, cut) {
      if (cut) { try { navigator.clipboard.writeText(r.toString()); } catch (_) { /* noop */ } }
      const { created, removedOwn } = markDeleted(r);
      if (created.length) { caretAt(created[back ? 0 : created.length - 1], !back); ctx.afterEdit(); return; }
      if (removedOwn) { ctx.afterEdit(); return; }
      const d = elOf(back ? r.startContainer : r.endContainer).closest('.tc.del');
      if (d) { caretAt(d, !back); return; }       // ya estaba eliminado: solo se salta
      hint();
    }
    function hint() { if (!hinted) { hinted = true; G.toast('Con el control de cambios activo no se unen párrafos. Desactívalo para hacerlo.', { kind: 'info' }); } }
    function onBeforeInput(e) {
      if (busy || !track || mode === 'read') return;
      const t = e.inputType || '';
      const s = getSelection();
      if ((t === 'insertText' || t === 'insertReplacementText') && e.data != null) {
        if (s.rangeCount && !s.isCollapsed) { e.preventDefault(); trackedReplaceSelection(e.data); ctx.afterEdit(); return; }
        prepareInsert();                           // la escritura sigue siendo nativa (y se puede deshacer)
        return;
      }
      if (t === 'insertFromDrop' || t === 'deleteByDrag') { e.preventDefault(); G.toast('Con el control de cambios activo no se pueden arrastrar textos.', { kind: 'info' }); return; }
      if (/^delete/.test(t)) {
        if (!s.rangeCount) return;
        let r = null;
        if (!s.isCollapsed) r = s.getRangeAt(0).cloneRange();
        else {
          const tr = e.getTargetRanges && e.getTargetRanges()[0];
          if (tr) { r = document.createRange(); r.setStart(tr.startContainer, tr.startOffset); r.setEnd(tr.endContainer, tr.endOffset); }
        }
        if (!r) return;
        if (r.collapsed) { e.preventDefault(); hint(); return; }
        if (insideOwnIns(r)) return;                                  // borrar lo propio: borrado normal
        const noText = !r.toString().replace(/[\s\u200B]/g, '');
        if (noText && r.cloneContents().querySelector('.fn')) return;   // quitar una marca de nota al pie
        e.preventDefault();
        trackedDelete(r, /Backward/.test(t), t === 'deleteByCut');
      }
    }
    function onInput() { if (!track) return; convertMarks(); cleanMarks(); }
    // Acentos por teclas muertas / IME: si el texto compuesto quedó sin marcar, se marca al terminar la composición.
    function onCompositionStart() { if (track && !busy && mode !== 'read') prepareInsert(); }
    function onCompositionEnd(e) {
      if (!track || busy || mode === 'read' || !e.data) return;
      convertMarks();
      const s = getSelection();
      if (!s.rangeCount || !s.isCollapsed) return;
      const n = s.anchorNode, o = s.anchorOffset;
      if (!n || n.nodeType !== 3 || o < e.data.length || n.nodeValue.slice(o - e.data.length, o) !== e.data) return;
      if (n.parentElement.closest('.tc')) return;
      const r = document.createRange(); r.setStart(n, o - e.data.length); r.setEnd(n, o);
      const sp = document.createElement('span');
      sp.className = 'tc ins'; sp.setAttribute('data-tc', newId()); sp.setAttribute('data-tt', 'ins'); sp.setAttribute('data-a', author()); sp.setAttribute('data-d', new Date().toISOString());
      r.surroundContents(sp);
      caretEndOf(sp);
      ctx.afterEdit();
    }
    function insertTracked(text) {
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      lines.forEach((l, i) => { if (i > 0) document.execCommand('insertParagraph'); if (l) trackedReplaceSelection(l); else if (!getSelection().isCollapsed) trackedReplaceSelection(''); });
    }
    function replaceRange(r, text) {
      const ed = getEd();
      if (mode === 'read') { G.toast('Sal del modo lectura para reemplazar texto.', { kind: 'info' }); return; }
      const s = getSelection();
      ed.focus({ preventScroll: true });
      s.removeAllRanges(); s.addRange(r);
      if (!track) { document.execCommand('insertText', false, text); return; }
      trackedReplaceSelection(text);
    }
    function changes() {
      const map = new Map();
      for (const el of G.$$('.tc', getEd())) {
        const id = el.getAttribute('data-tc');
        let c = map.get(id);
        if (!c) map.set(id, c = { id, type: el.getAttribute('data-tt') === 'del' ? 'del' : 'ins', author: el.getAttribute('data-a') || '', date: el.getAttribute('data-d') || '', els: [], text: '' });
        c.els.push(el); c.text += el.textContent;
      }
      return [...map.values()];
    }
    function resolveChange(c, accept) {
      for (const el of c.els) { if ((c.type === 'ins') === accept) unwrap(el); else el.remove(); }
      getEd().normalize();
      ctx.afterEdit(); refresh(true);
    }
    function resolveAll(accept) {
      const list = changes();
      if (!list.length) return;
      for (const c of list) for (const el of c.els) { if ((c.type === 'ins') === accept) unwrap(el); else el.remove(); }
      getEd().normalize();
      ctx.afterEdit(); refresh(true);
      G.toast(accept ? 'Se aceptaron todos los cambios.' : 'Se rechazaron todos los cambios.', { kind: 'ok' });
    }
    function gotoChange(c) {
      const el = c.els[0];
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: G.anim() ? 'smooth' : 'auto' });
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200);
    }
    function toggleTrack(force) {
      track = typeof force === 'boolean' ? force : !track;
      syncTrackUI(); touch(); refresh(true);
      G.toast(track ? 'Control de cambios activado: lo que escribas o borres quedará marcado.' : 'Control de cambios desactivado.', { kind: 'info', ms: 2600 });
      ctx.focusEd();
    }
    const stTrack = h('span', { class: 'st-track', hidden: true }, h('span', { class: 'dot' }), 'Control de cambios');
    statusbar.insertBefore(stTrack, statusbar.children[1] || null);
    function syncTrackUI() { stTrack.hidden = !track; ctx.setOn(B.track, track); }

    // ====================================================================== modos enfoque y lectura
    const modeBar = h('div', { class: 'mode-bar', role: 'toolbar', 'aria-label': 'Modo de escritura' });
    container.appendChild(modeBar);
    const readBar = h('div', { class: 'read-progress', 'aria-hidden': 'true' }, h('span'));
    container.appendChild(readBar);
    function drawModeBar() {
      G.clear(modeBar);
      if (!mode) return;
      const btn = (icon, label, fn, on_) => h('button', { class: 'ibtn sm' + (on_ ? ' on' : ''), type: 'button', title: label, 'aria-label': label, 'aria-pressed': on_ === undefined ? null : String(!!on_), onclick: fn }, G.icon(icon, 16));
      if (mode === 'focus') {
        modeBar.append(h('span', { class: 'mb-title' }, G.icon('focus', 15), 'Modo enfoque'),
          btn('sidebar', 'Atenuar los demás párrafos', () => { dimOthers = !dimOthers; container.classList.toggle('no-dim', !dimOthers); drawModeBar(); }, dimOthers),
          btn('arrowDown', 'Mantener la línea al centro (máquina de escribir)', () => { typewriter = !typewriter; drawModeBar(); }, typewriter),
          h('button', { class: 'btn sm', type: 'button', onclick: () => setMode(null) }, 'Salir (Esc)'));
      } else {
        const chs = P().chapters, i = chs.findIndex((c) => c.id === ctx.getCurId());
        modeBar.append(h('span', { class: 'mb-title' }, G.icon('bookOpen', 15), 'Modo lectura'),
          btn('minus', 'Letra más pequeña', () => setReadScale(readScale - 0.1)), btn('plus', 'Letra más grande', () => setReadScale(readScale + 0.1)),
          btn('chevL', 'Capítulo anterior', () => ctx.openChapter(chs[i - 1].id)), btn('chevR', 'Capítulo siguiente', () => ctx.openChapter(chs[i + 1].id)),
          h('button', { class: 'btn sm', type: 'button', onclick: () => setMode(null) }, 'Salir (Esc)'));
        const [prev, next] = [G.$$('.ibtn', modeBar)[2], G.$$('.ibtn', modeBar)[3]];
        if (prev) prev.disabled = i <= 0;
        if (next) next.disabled = i < 0 || i >= chs.length - 1;
      }
    }
    function setReadScale(v) { readScale = G.clamp(Math.round(v * 10) / 10, 0.8, 1.8); container.style.setProperty('--read-scale', String(readScale)); }
    function applyReadonly() {
      const ed = getEd(); if (!ed) return;
      ed.setAttribute('contenteditable', mode === 'read' ? 'false' : 'true');
      if (mode === 'read') { ed.setAttribute('aria-readonly', 'true'); ed.setAttribute('spellcheck', 'false'); } else { ed.removeAttribute('aria-readonly'); ed.setAttribute('spellcheck', 'true'); }
      if (mode !== 'focus') for (const e of G.$$('.cur', ed)) e.classList.remove('cur');
      container.style.setProperty('--read-scale', String(readScale));
      drawModeBar();
    }
    function setMode(m) {
      if (m === mode) m = null;
      const prev = mode;
      if (!prev && m) sideWasOpen = ctx.getSideOpen();
      mode = m;
      container.classList.toggle('mode-focus', m === 'focus');
      container.classList.toggle('mode-read', m === 'read');
      container.classList.toggle('no-dim', !dimOthers);
      if (m) ctx.setSideOpen(false); else if (prev) ctx.setSideOpen(sideWasOpen);
      wrap.style.zoom = m === 'read' ? '' : String(ctx.getZoom() / 100);
      applyReadonly();
      scheduleLayout();
      if (m === 'focus') { ctx.focusEd(); onSelection(); }
      if (m === 'read') { scroller.scrollTop = 0; onScroll(); }
      if (!m) { readBar.firstChild.style.width = '0%'; ctx.focusEd(); }
      if (ctx.fitZoom) setTimeout(ctx.fitZoom, 0);
    }
    function onSelection() {
      const ed = getEd(); if (!ed) return;
      if (mode === 'focus') {
        const s = getSelection();
        if (s.rangeCount && ctx.inEd(s.anchorNode)) {
          let top = s.anchorNode.nodeType === 3 ? s.anchorNode.parentNode : s.anchorNode;
          while (top && top.parentNode !== ed) top = top.parentNode;
          if (top && top !== ed) { for (const e of G.$$('.cur', ed)) if (e !== top) e.classList.remove('cur'); top.classList.add('cur'); }
          if (typewriter) typewrite();
        }
      }
      if (!mode) {
        const s = getSelection();
        const cm = s.rangeCount && ctx.inEd(s.anchorNode) ? elOf(s.anchorNode).closest('[data-cm]') : null;
        const id = cm ? cm.getAttribute('data-cm').split(/\s+/)[0] : null;
        if (id !== activeCm && !(document.activeElement && document.activeElement.classList.contains('cm-ta'))) { activeCm = id; paintResolved(); highlightCards(); }
      }
    }
    function typewrite() {
      const s = getSelection();
      if (!s.rangeCount) return;
      const r = s.getRangeAt(0).cloneRange();
      const rect = r.getClientRects()[0] || elOf(r.startContainer).getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const dy = rect.top - (sr.top + sr.height * 0.42);
      if (Math.abs(dy) > 28) scroller.scrollBy({ top: dy, behavior: G.anim() ? 'smooth' : 'auto' });
    }
    function onScroll() {
      if (mode === 'read') {
        const max = scroller.scrollHeight - scroller.clientHeight;
        readBar.firstChild.style.width = (max > 0 ? Math.round((scroller.scrollTop / max) * 100) : 100) + '%';
      }
      if (sideTab === 'outline') highlightOutline();
    }
    on(scroller, 'scroll', G.debounce(onScroll, 40));

    // ====================================================================== paneles laterales
    const side = () => ctx.getSide();
    function badgeCount() {
      const ed = getEd(); if (!ed) return 0;
      return footnoteRefs().length + [...comments.values()].filter((c) => !c.resolved).length + changes().length;
    }
    function tabsEl() {
      const tabs = [['chapters', 'Capítulos'], ['outline', 'Esquema'], ['review', 'Revisión']];
      const n = badgeCount();
      return h('div', { class: 'side-tabs', role: 'tablist', 'aria-label': 'Panel lateral' }, tabs.map(([id, label]) => h('button', {
        class: 'side-tab' + (sideTab === id ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(sideTab === id), id: 'tab-' + id,
        onclick: () => { if (sideTab !== id) { sideTab = id; ctx.renderSide(); } },
      }, label, id === 'review' && n ? h('span', { class: 'tab-badge' }, String(n)) : null)));
    }
    function openReview(o) {
      sideTab = 'review';
      if (o && o.note) { activeNote = o.note; }
      if (o && o.comment) activeCm = o.comment;
      ctx.setSideOpen(true);
      ctx.renderSide();
      requestAnimationFrame(() => {
        const s = side();
        if (o && o.note) { const ta = G.$('.rv-note[data-id="' + o.note + '"] textarea', s); if (ta) { ta.focus(); ta.scrollIntoView({ block: 'nearest' }); } }
      });
    }

    function renderOutline(host) {
      const ed = getEd();
      const heads = ed ? G.$$('h1,h2,h3', ed) : [];
      const search = h('input', { class: 'input sm', type: 'search', placeholder: 'Filtrar encabezados…', 'aria-label': 'Filtrar encabezados' });
      const list = h('div', { class: 'ol-list scroll', role: 'list' });
      const words = heads.map((hd, i) => {
        const r = document.createRange(); r.setStartAfter(hd);
        if (heads[i + 1]) r.setEndBefore(heads[i + 1]); else r.setEndAfter(ed.lastChild || hd);
        return DM.countWordsInText(r.toString());
      });
      const fill = () => {
        const q = search.value.trim().toLowerCase();
        G.clear(list);
        let shown = 0;
        heads.forEach((hd, i) => {
          const t = hd.textContent.trim() || 'Sin título';
          if (q && !t.toLowerCase().includes(q)) return;
          shown++;
          const lvl = Number(hd.tagName[1]);
          list.appendChild(h('button', { class: 'ol-item l' + lvl, type: 'button', role: 'listitem', 'data-i': String(i), title: t, onclick: () => gotoHeading(hd) },
            h('span', { class: 'ol-t ellip' }, t), h('span', { class: 'ol-w' }, words[i] ? G.fmt(words[i]) : '')));
        });
        if (!heads.length) list.appendChild(h('div', { class: 'rv-empty' }, G.icon('outline', 22), h('div', {}, 'Aún no hay encabezados en este capítulo.'), h('div', { class: 'dim' }, 'Usa Título 1, 2 o 3 en el estilo de párrafo y aparecerán aquí para saltar de una sección a otra.')));
        else if (!shown) list.appendChild(h('div', { class: 'dim', style: { padding: '10px' } }, 'Sin resultados.'));
        highlightOutline();
      };
      search.addEventListener('input', fill);
      host.append(h('div', { class: 'side-head' }, h('h2', { class: 'strong grow' }, 'Esquema'), h('span', { class: 'dim' }, heads.length ? heads.length + (heads.length === 1 ? ' encabezado' : ' encabezados') : '')),
        h('div', { class: 'ol-search' }, search), list);
      fill();
    }
    function gotoHeading(hd) {
      hd.scrollIntoView({ block: 'start', behavior: G.anim() ? 'smooth' : 'auto' });
      const r = document.createRange(); r.setStart(hd, 0); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      hd.classList.add('flash'); setTimeout(() => hd.classList.remove('flash'), 1200);
    }
    function highlightOutline() {
      const s = side(); const ed = getEd();
      if (!s || !ed || sideTab !== 'outline') return;
      const heads = G.$$('h1,h2,h3', ed);
      const lim = scroller.getBoundingClientRect().top + 90;
      let idx = -1;
      heads.forEach((hd, i) => { if (hd.getBoundingClientRect().top <= lim) idx = i; });
      if (idx === outlineActive && G.$('.ol-item.on', s)) return;
      outlineActive = idx;
      for (const b of G.$$('.ol-item', s)) b.classList.toggle('on', Number(b.getAttribute('data-i')) === idx);
    }

    function renderReview(host) {
      const ed = getEd();
      const refs = footnoteRefs();
      const cms = [...comments.values()].filter((c) => ed && ed.querySelector('[data-cm~="' + c.id + '"]'));
      cms.sort((a, b) => {
        const ea = ed.querySelector('[data-cm~="' + a.id + '"]'), eb = ed.querySelector('[data-cm~="' + b.id + '"]');
        return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      const chg = changes();
      const trackSw = G.switch({ checked: track, label: track ? 'Activado' : 'Desactivado', onChange: (v) => { toggleTrack(v); } });
      trackSw.input.setAttribute('aria-label', 'Control de cambios');

      // --- notas al pie
      const noteList = h('div', { class: 'rv-list' }, refs.map((sup, i) => {
        const id = sup.getAttribute('data-fn');
        const ta = h('textarea', { class: 'rv-ta', rows: 2, maxlength: 5000, spellcheck: 'true', lang: 'es', placeholder: 'Texto de la nota al pie…', 'aria-label': 'Nota al pie ' + (i + 1) });
        ta.value = notes.get(id) || '';
        ta.addEventListener('input', () => { notes.set(id, ta.value); autosize(ta); touch(); });
        ta.addEventListener('focus', () => { activeNote = id; });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); ctx.focusEd(); } });
        requestAnimationFrame(() => autosize(ta));
        return h('div', { class: 'rv-note' + (activeNote === id ? ' on' : ''), 'data-id': id },
          h('button', { class: 'rv-n', type: 'button', title: 'Ir a la nota en el texto', 'aria-label': 'Ir a la nota ' + (i + 1) + ' en el texto', onclick: () => { sup.scrollIntoView({ block: 'center', behavior: G.anim() ? 'smooth' : 'auto' }); sup.classList.add('flash'); setTimeout(() => sup.classList.remove('flash'), 1200); } }, String(i + 1)), ta);
      }));
      if (!refs.length) noteList.appendChild(h('div', { class: 'rv-empty sm' }, 'Coloca el cursor y pulsa «Nota al pie» (Ctrl+Alt+F).'));

      // --- comentarios
      const vis = cms.filter((c) => showResolved || !c.resolved);
      const cmList = h('div', { class: 'rv-list' }, vis.map((c) => buildCard(c, { panel: true })));
      if (!vis.length) cmList.appendChild(h('div', { class: 'rv-empty sm' }, cms.length ? 'Todos los comentarios están resueltos.' : 'Selecciona texto y pulsa «Comentario» (Ctrl+Alt+M).'));
      const resolvedN = cms.filter((c) => c.resolved).length;

      // --- cambios
      const chList = h('div', { class: 'rv-list' }, chg.map((c) => h('div', { class: 'tc-item ' + c.type },
        h('button', { class: 'tc-main', type: 'button', onclick: () => gotoChange(c), title: 'Ir al cambio' },
          h('span', { class: 'tc-kind' }, c.type === 'ins' ? 'Insertado' : 'Eliminado'), h('span', { class: 'tc-text ellip' }, c.text.trim() || '(espacio)'),
          h('span', { class: 'dim tc-by' }, [c.author, when(c.date)].filter(Boolean).join(' · '))),
        h('button', { class: 'ibtn sm', type: 'button', title: 'Aceptar', 'aria-label': 'Aceptar cambio', onclick: () => resolveChange(c, true) }, G.icon('check', 15)),
        h('button', { class: 'ibtn sm', type: 'button', title: 'Rechazar', 'aria-label': 'Rechazar cambio', onclick: () => resolveChange(c, false) }, G.icon('close', 15)))));
      if (!chg.length) chList.appendChild(h('div', { class: 'rv-empty sm' }, track ? 'Aún no hay cambios marcados.' : 'Activa el control de cambios para marcar lo que escribas o borres.'));

      host.append(h('div', { class: 'side-head' }, h('h2', { class: 'strong grow' }, 'Revisión')),
        h('div', { class: 'rv scroll' },
          h('section', { class: 'rv-sec', 'aria-label': 'Notas al pie' }, h('h3', { class: 'rv-h' }, 'Notas al pie', h('span', { class: 'rv-c' }, String(refs.length)), h('span', { class: 'grow' }), h('button', { class: 'btn sm', type: 'button', onclick: insertFootnote, disabled: mode === 'read' }, G.icon('footnote', 14), 'Insertar')), noteList),
          h('section', { class: 'rv-sec', 'aria-label': 'Comentarios' }, h('h3', { class: 'rv-h' }, 'Comentarios', h('span', { class: 'rv-c' }, String(cms.length)), h('span', { class: 'grow' }), h('button', { class: 'btn sm', type: 'button', onclick: addComment }, G.icon('comment', 14), 'Agregar')), cmList,
            resolvedN ? h('button', { class: 'link-btn rv-toggle', type: 'button', onclick: () => { showResolved = !showResolved; refresh(true); } }, (showResolved ? 'Ocultar' : 'Mostrar') + ' resueltos (' + resolvedN + ')') : null),
          h('section', { class: 'rv-sec', 'aria-label': 'Control de cambios' }, h('h3', { class: 'rv-h' }, 'Control de cambios', h('span', { class: 'rv-c' }, String(chg.length)), h('span', { class: 'grow' }), trackSw.el),
            chg.length ? h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => resolveAll(true) }, 'Aceptar todos'), h('button', { class: 'btn sm', type: 'button', onclick: () => resolveAll(false) }, 'Rechazar todos')) : null, chList)));
    }
    function renderPanel(host) { if (sideTab === 'outline') renderOutline(host); else renderReview(host); }

    // Refresca lo que depende del contenido (con pausa para no entorpecer la escritura).
    function doRefresh(force) {
      const ed = getEd(); if (!ed) return;
      paintResolved();
      layoutMargin();
      const s = side();
      if (s && sideTab !== 'chapters' && !s.hidden) {
        const a = document.activeElement;
        if (force || !(a && s.contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName))) ctx.renderSide();
      } else if (s) { const b = G.$('.side-tabs', s); if (b) b.replaceWith(tabsEl()); }
    }
    const refreshSoon = G.debounce(() => doRefresh(false), 380);
    function refresh(now) { if (now) doRefresh(true); else refreshSoon(); }

    // ====================================================================== enganches del editor
    function attach(el) {
      el.addEventListener('beforeinput', onBeforeInput);
      el.addEventListener('input', onInput);
      el.addEventListener('compositionstart', onCompositionStart);
      el.addEventListener('compositionend', onCompositionEnd);
      el.addEventListener('click', (e) => {
        const sup = e.target.closest && e.target.closest('.fn');
        if (sup) {
          const id = sup.getAttribute('data-fn');
          if (mode === 'read') showNotePop(sup, id); else openReview({ note: id });
          return;
        }
        if (mode === 'read') return;
        const cm = e.target.closest && e.target.closest('[data-cm]');
        if (cm) { activeCm = cm.getAttribute('data-cm').split(/\s+/)[0]; paintResolved(); highlightCards(); }
      });
      applyReadonly();
    }
    function showNotePop(sup, id) {
      const n = [...footnoteRefs()].indexOf(sup) + 1;
      G.togglePopover(sup, () => h('div', { class: 'note-pop' }, h('div', { class: 'strong' }, 'Nota ' + n), h('div', { class: 'note-pop-t' }, (notes.get(id) || '').trim() || 'Esta nota está vacía.')), { restoreFocus: false });
    }
    function onKey(e) {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && e.altKey && !e.shiftKey && k === 'f') { e.preventDefault(); insertFootnote(); return true; }
      if (e.ctrlKey && e.altKey && !e.shiftKey && k === 'm') { e.preventDefault(); addComment(); return true; }
      if (e.ctrlKey && e.shiftKey && !e.altKey && k === 't') { e.preventDefault(); toggleTrack(); return true; }
      if (e.ctrlKey && e.shiftKey && !e.altKey && k === 'f') { e.preventDefault(); setMode('focus'); return true; }
      if (e.ctrlKey && e.shiftKey && !e.altKey && k === 'l') { e.preventDefault(); setMode('read'); return true; }
      if (e.key === 'Escape' && mode && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) { setMode(null); return true; }
      return false;
    }
    function viewMenu(btn) {
      G.menu(btn, [
        { label: 'Modo enfoque', icon: mode === 'focus' ? 'check' : 'focus', onClick: () => setMode('focus') },
        { label: 'Modo lectura', icon: mode === 'read' ? 'check' : 'bookOpen', onClick: () => setMode('read') },
        { separator: true },
        { label: 'Comentarios en el margen', icon: marginOn ? 'check' : 'comment', onClick: () => { marginOn = !marginOn; layoutMargin(); } },
        { label: showResolved ? 'Ocultar comentarios resueltos' : 'Mostrar comentarios resueltos', icon: 'eye', onClick: () => { showResolved = !showResolved; refresh(true); } },
      ], { align: 'right' });
    }
    on(document, 'g:config', () => syncTrackUI());
    on(window, 'resize', G.debounce(scheduleLayout, 150));

    return {
      load, serialize, attach, onKey, onSelection, visibleText, viewMenu, setMode, toggleTrack, insertFootnote, addComment,
      tracking: () => track, mode: () => mode, insertTracked, replaceRange, marginWidth, refresh, tabsEl, renderPanel,
      sideTab: () => sideTab, setSideTab: (t) => { sideTab = t; }, openReview, scheduleLayout,
      destroy() { cleanups.forEach((f) => f()); cancelAnimationFrame(layoutRaf); },
    };
  };
})();
