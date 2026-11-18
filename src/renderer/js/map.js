/* Grafema — Mapa de ideas: nodos de la biblia y notas libres unidos por conexiones. */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const NW = 176, NH = 56, KMIN = 0.2, KMAX = 2.5;
  const COLORS = ['#FFD712', '#5BD68A', '#6CB6FF', '#FF8A65', '#C792EA', '#F06292', '#4DD0E1', '#B3B3B3'];
  const sv = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; };

  G.views.map = async function mapView(container, params) {
    const pid = G.state.project.id;
    // Un proyecto puede tener varios mapas: se abre el pedido, o el último que se usó.
    const mapList = await G.call('maps:list', { projectId: pid });
    const mapId = params && params.mapId && mapList.maps.some((m) => m.id === params.mapId) ? params.mapId : mapList.last;
    let maps = mapList.maps;
    const [bRes, mRes] = await Promise.all([G.call('bible:read', { projectId: pid }), G.call('map:read', { projectId: pid, mapId })]);
    if (G.state.project && G.state.project.lastMap !== mapId) { G.state.project.lastMap = mapId; G.call('project:update', { id: pid, patch: { lastMap: mapId } }).catch(() => {}); }
    const bible = bRes.data && Array.isArray(bRes.data.types) ? bRes.data : { types: [], profiles: [] };
    const profiles = new Map((bible.profiles || []).map((p) => [p.id, p]));
    const types = new Map((bible.types || []).map((t) => [t.id, t]));
    const raw = mRes.data || {};
    let nodes = (raw.nodes || []).filter((n) => n && n.id && Number.isFinite(n.x) && Number.isFinite(n.y)).map((n) => Object.assign({ kind: 'note', title: '', notes: '', color: COLORS[0] }, n));
    let edges = (raw.edges || []).filter((e) => e && e.id && e.from && e.to);
    const view = Object.assign({ x: 0, y: 0, k: 1 }, raw.view || {});
    let dirtyClean = false;
    // limpiar nodos de perfiles borrados y conexiones huérfanas
    const before = nodes.length;
    nodes = nodes.filter((n) => n.kind !== 'profile' || profiles.has(n.profileId));
    const nodeIds = () => new Set(nodes.map((n) => n.id));
    let ids = nodeIds();
    const eBefore = edges.length;
    edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
    if (before !== nodes.length || eBefore !== edges.length) dirtyClean = true;

    const cleanups = [];
    function on(t, ev, fn, o) { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); }
    let sel = null; // {type:'node'|'edge', id}
    const hist = []; let hi = -1;
    const snap = () => JSON.stringify({ nodes, edges });
    const nodeById = (id) => nodes.find((n) => n.id === id);
    const profOf = (n) => (n.kind === 'profile' ? profiles.get(n.profileId) : null);
    const titleOf = (n) => { const p = profOf(n); return p ? (p.name || '').trim() || 'Sin nombre' : (n.title || '').trim() || 'Nota sin título'; };
    const typeOf = (n) => { const p = profOf(n); return p ? types.get(p.typeId) : null; };
    const colorOf = (n) => { const t = typeOf(n); return t ? t.color : n.color || COLORS[0]; };

    // ------------------------------------------------------------ guardado
    const stateEl = h('span', { class: 'dim', 'aria-live': 'polite' });
    const saver = G.saver(async () => { await G.call('map:write', { projectId: pid, mapId, data: { version: 1, nodes, edges, view: { x: Math.round(view.x), y: Math.round(view.y), k: Math.round(view.k * 100) / 100 } } }); }, 600, (s, e) => { stateEl.textContent = s === 'saving' ? 'Guardando…' : s === 'dirty' ? 'Cambios sin guardar' : s === 'error' ? 'Error al guardar: ' + G.errMsg(e) : 'Guardado'; stateEl.style.color = s === 'error' ? 'var(--danger)' : ''; });
    function commit() {
      const s = snap();
      if (hist[hi] === s) { saver.touch(); return; }
      hist.length = hi + 1; hist.push(s); if (hist.length > 80) hist.shift(); hi = hist.length - 1;
      saver.touch(); syncUndo(); syncMapCount();
    }
    function syncMapCount() { const el = typeof mapbar !== 'undefined' ? G.$('.map-tab.on .n', mapbar) : null; if (el) el.textContent = String(nodes.length); }
    function restore(i) {
      const d = JSON.parse(hist[i]); nodes = d.nodes; edges = d.edges; hi = i;
      if (sel && !(sel.type === 'node' ? nodeById(sel.id) : edges.some((e) => e.id === sel.id))) sel = null;
      renderAll(); saver.touch(); syncUndo(); syncMapCount();
    }
    hist.push(snap()); hi = 0;
    if (dirtyClean) saver.touch();

    // ------------------------------------------------------------ estructura
    const btn = (icon, label, fn, text) => h('button', { class: text ? 'btn sm' : 'ibtn', type: 'button', title: label, 'aria-label': label, onclick: (e) => fn(e.currentTarget) }, G.icon(icon, text ? 14 : 18), text || null);
    const bUndo = btn('undo', 'Deshacer (Ctrl+Z)', () => { if (hi > 0) restore(hi - 1); });
    const bRedo = btn('redo', 'Rehacer (Ctrl+Y)', () => { if (hi < hist.length - 1) restore(hi + 1); });
    const zoomLbl = h('button', { class: 'btn sm ghost', type: 'button', title: 'Zoom al 100 %', onclick: () => zoomTo(1) }, '100%');
    function syncUndo() { bUndo.disabled = hi <= 0; bRedo.disabled = hi >= hist.length - 1; }
    const toolbar = h('div', { class: 'mm-toolbar', role: 'toolbar', 'aria-label': 'Herramientas del mapa' },
      btn('note', 'Agregar una nota en el centro', () => addNote(), 'Nota'),
      btn('book', 'Agregar perfiles de la biblia', (b) => pickProfiles(b), 'Perfiles'),
      btn('network', 'Agregar todos los perfiles de la biblia', () => addAllProfiles(), 'Todos'),
      h('span', { class: 'tb-sep' }), btn('layout', 'Ordenar automáticamente', () => autoLayout(), 'Ordenar'), btn('fit', 'Ajustar a la pantalla', () => fit(), 'Ajustar'),
      h('span', { class: 'tb-sep' }), h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Alejar', title: 'Alejar', onclick: () => zoomBy(1 / 1.25) }, G.icon('minus', 18)), zoomLbl, h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Acercar', title: 'Acercar', onclick: () => zoomBy(1.25) }, G.icon('plus', 18)),
      h('span', { class: 'tb-sep' }), bUndo, bRedo, h('div', { class: 'grow' }), stateEl);

    const edgeSvg = sv('svg', { class: 'mm-edges', width: 1, height: 1 });
    edgeSvg.innerHTML = '<defs><marker id="mm-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10z" fill="#919191"/></marker><marker id="mm-ar-s" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10z" fill="#FFD712"/></marker></defs>';
    const edgeG = sv('g'); edgeSvg.appendChild(edgeG);
    const labelLayer = h('div', { class: 'mm-labels' });
    const nodeLayer = h('div', { class: 'mm-nodes' });
    const world = h('div', { class: 'mm-world' }, edgeSvg, labelLayer, nodeLayer);
    const legend = h('div', { class: 'mm-legend', 'aria-label': 'Leyenda' });
    const mini = sv('svg', { class: 'mm-mini', width: 168, height: 112, 'aria-hidden': 'true' });
    const emptyHint = h('div', { class: 'mm-empty' }, h('div', { class: 'strong' }, 'Tu mapa de ideas está vacío'), h('p', {}, 'Agrega perfiles de tu biblia o crea notas, y únelos arrastrando desde los puntos de cada nodo. También puedes hacer doble clic en el lienzo para crear una nota.'),
      h('div', { class: 'row gap-8 wrap', style: { justifyContent: 'center' } }, h('button', { class: 'btn sm primary', type: 'button', onclick: () => addAllProfiles() }, 'Agregar todos los perfiles'), h('button', { class: 'btn sm', type: 'button', onclick: () => addNote() }, 'Crear una nota')));
    const canvas = h('div', { class: 'mm-canvas', tabindex: '0', role: 'application', 'aria-label': 'Lienzo del mapa de ideas. Doble clic para crear una nota; flechas para mover el nodo seleccionado; Supr para eliminar.' }, world, legend, mini, emptyHint);
    const insp = h('aside', { class: 'mm-insp scroll', 'aria-label': 'Detalles' });
    // ------------------------------------------------------------ pestañas de mapas
    const mapbar = h('div', { class: 'mapbar', role: 'tablist', 'aria-label': 'Mapas del proyecto' });
    const openMap = (id) => { if (id !== mapId) G.go('map', { mapId: id }); };
    function drawMapbar() {
      G.clear(mapbar);
      for (const m of maps) {
        const on = m.id === mapId;
        mapbar.appendChild(h('button', { class: 'map-tab' + (on ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(on), title: m.name, onclick: () => openMap(m.id) },
          h('span', { class: 'ellip' }, m.name), h('span', { class: 'n' }, String(on ? nodes.length : m.nodes))));
      }
      mapbar.append(
        h('button', { class: 'ibtn sm', type: 'button', title: 'Nuevo mapa', 'aria-label': 'Nuevo mapa', onclick: newMap }, G.icon('plus', 16)),
        h('button', { class: 'ibtn sm', type: 'button', title: 'Opciones de este mapa', 'aria-label': 'Opciones de este mapa', 'aria-haspopup': 'menu', onclick: (e) => mapMenu(e.currentTarget) }, G.icon('more', 16)));
    }
    async function newMap() {
      const name = await G.prompt({ title: 'Nuevo mapa', label: 'Nombre del mapa', placeholder: 'Por ejemplo: Tramas, La ciudad, Línea de tiempo', confirmLabel: 'Crear mapa', maxlength: 60 });
      if (!name) return;
      try { await G.flushAll(); const r = await G.call('maps:create', { projectId: pid, name }); G.go('map', { mapId: r.map.id }); } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function renameMap() {
      const cur = maps.find((m) => m.id === mapId);
      const name = await G.prompt({ title: 'Renombrar mapa', label: 'Nombre del mapa', value: cur ? cur.name : '', confirmLabel: 'Renombrar', maxlength: 60 });
      if (!name) return;
      try { const r = await G.call('maps:rename', { projectId: pid, mapId, name }); maps = maps.map((m) => (m.id === mapId ? Object.assign({}, m, { name: r.map.name }) : m)); drawMapbar(); } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function duplicateMap() {
      try { await G.flushAll(); const r = await G.call('maps:duplicate', { projectId: pid, mapId }); G.toast('Mapa duplicado.', { kind: 'ok' }); G.go('map', { mapId: r.map.id }); } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function deleteMap() {
      const cur = maps.find((m) => m.id === mapId);
      const ok = await G.confirm({ title: 'Eliminar «' + (cur ? cur.name : 'mapa') + '»', message: `Se borrará este mapa con sus ${nodes.length} nodos y ${edges.length} conexiones. Los perfiles de la biblia no se tocan. Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar mapa', danger: true });
      if (!ok) return;
      try { saver.destroy(); const r = await G.call('maps:delete', { projectId: pid, mapId }); G.toast('Mapa eliminado.', { kind: 'ok' }); G.go('map', { mapId: r.last }); } catch (e) { G.toast(e.message, { kind: 'err' }); G.go('map', { mapId }); }
    }
    function mapMenu(anchor) {
      G.menu(anchor, [
        { label: 'Renombrar mapa', icon: 'edit', onClick: renameMap },
        { label: 'Duplicar mapa', icon: 'copy', onClick: duplicateMap },
        { separator: true },
        { label: 'Eliminar mapa', icon: 'trash', danger: true, disabled: maps.length <= 1, onClick: deleteMap },
      ], { align: 'right' });
    }
    container.className = 'mm';
    container.append(mapbar, toolbar, h('div', { class: 'mm-body' }, canvas, insp));
    drawMapbar();

    // ------------------------------------------------------------ vista
    const applyView = () => { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`; canvas.style.backgroundPosition = `${view.x}px ${view.y}px`; canvas.style.backgroundSize = `${24 * view.k}px ${24 * view.k}px`; zoomLbl.textContent = Math.round(view.k * 100) + '%'; drawMini(); };
    const toWorld = (cx, cy) => { const r = canvas.getBoundingClientRect(); return [(cx - r.left - view.x) / view.k, (cy - r.top - view.y) / view.k]; };
    function zoomAt(k, sx, sy) { const nk = G.clamp(k, KMIN, KMAX); view.x = sx - ((sx - view.x) / view.k) * nk; view.y = sy - ((sy - view.y) / view.k) * nk; view.k = nk; applyView(); saver.touch(); }
    function zoomBy(f) { const r = canvas.getBoundingClientRect(); zoomAt(view.k * f, r.width / 2, r.height / 2); }
    function zoomTo(k) { const r = canvas.getBoundingClientRect(); zoomAt(k, r.width / 2, r.height / 2); }
    function bbox(list) { if (!list.length) return null; let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; for (const n of list) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + NW); y2 = Math.max(y2, n.y + NH); } return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 }; }
    function fit(list) {
      const b = bbox(list && list.length ? list : nodes); const r = canvas.getBoundingClientRect();
      if (!b) { view.x = r.width / 2; view.y = r.height / 2; view.k = 1; applyView(); return; }
      const padX = 70, padT = 50, padB = 150; // margen inferior: leyenda y minimapa
      const k = G.clamp(Math.min((r.width - 2 * padX) / b.w, (r.height - padT - padB) / b.h, 1.2), KMIN, KMAX);
      view.k = k; view.x = (r.width - b.w * k) / 2 - b.x1 * k; view.y = padT + (r.height - padT - padB - b.h * k) / 2 - b.y1 * k; applyView(); saver.touch();
    }
    function centerOn(n) { const r = canvas.getBoundingClientRect(); view.x = r.width / 2 - (n.x + NW / 2) * view.k; view.y = r.height / 2 - (n.y + NH / 2) * view.k; applyView(); saver.touch(); }
    function viewCenter() { const r = canvas.getBoundingClientRect(); return [(r.width / 2 - view.x) / view.k, (r.height / 2 - view.y) / view.k]; }

    // ------------------------------------------------------------ dibujo
    function anchor(n, tx, ty) {
      const cx = n.x + NW / 2, cy = n.y + NH / 2, dx = tx - cx, dy = ty - cy;
      if (!dx && !dy) return [cx, cy];
      const s = Math.min(dx ? NW / 2 / Math.abs(dx) : Infinity, dy ? NH / 2 / Math.abs(dy) : Infinity);
      return [cx + dx * s, cy + dy * s];
    }
    function autoEdges() {
      const out = [], seen = new Set();
      const onMap = new Map(nodes.filter((n) => n.kind === 'profile').map((n) => [n.profileId, n]));
      for (const n of onMap.values()) {
        const p = profiles.get(n.profileId), t = types.get(p.typeId);
        if (!t) continue;
        for (const f of t.fields || []) {
          if (f.kind !== 'relation') continue;
          for (const id of Array.isArray(p.values[f.id]) ? p.values[f.id] : []) {
            const o = onMap.get(id); if (!o || o === n) continue;
            const key = [n.id, o.id].sort().join('|') + '|' + f.label;
            if (seen.has(key)) continue; seen.add(key);
            out.push({ id: 'auto-' + key, from: n.id, to: o.id, label: f.label, auto: true });
          }
        }
      }
      return out;
    }
    function renderEdges() {
      while (edgeG.firstChild) edgeG.removeChild(edgeG.firstChild);
      G.clear(labelLayer);
      const all = edges.map((e) => Object.assign({}, e)).concat(autoEdges());
      const groups = new Map();
      for (const e of all) { const k = [e.from, e.to].sort().join('|'); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
      for (const list of groups.values()) {
        list.forEach((e, i) => {
          const a = nodeById(e.from), b = nodeById(e.to); if (!a || !b) return;
          const acx = a.x + NW / 2, acy = a.y + NH / 2, bcx = b.x + NW / 2, bcy = b.y + NH / 2;
          const len = Math.hypot(bcx - acx, bcy - acy) || 1;
          const off = (i - (list.length - 1) / 2) * 18, ox = (-(bcy - acy) / len) * off, oy = ((bcx - acx) / len) * off;
          const [x1, y1] = anchor(a, bcx + ox, bcy + oy), [x2, y2] = anchor(b, acx + ox, acy + oy);
          const selected = sel && sel.type === 'edge' && sel.id === e.id;
          const g = sv('g', { class: 'mm-edge' + (e.auto ? ' auto' : '') + (selected ? ' sel' : ''), 'data-id': e.id });
          const d = `M${x1 + ox} ${y1 + oy}L${x2 + ox} ${y2 + oy}`;
          g.appendChild(sv('path', { d, class: 'mm-hit' }));
          g.appendChild(sv('path', { d, class: 'mm-line', 'marker-end': selected ? 'url(#mm-ar-s)' : 'url(#mm-ar)' }));
          edgeG.appendChild(g);
          if (e.label) {
            const lab = h('div', { class: 'mm-elabel' + (e.auto ? ' auto' : '') + (selected ? ' sel' : ''), style: { left: (x1 + x2) / 2 + ox + 'px', top: (y1 + y2) / 2 + oy + 'px' }, 'data-id': e.id }, e.label);
            labelLayer.appendChild(lab);
          }
        });
      }
    }
    function nodeEl(n) {
      const t = typeOf(n), c = colorOf(n);
      const el = h('div', { class: 'mm-node' + (sel && sel.type === 'node' && sel.id === n.id ? ' sel' : '') + (n.kind === 'note' ? ' note' : ''), 'data-id': n.id, tabindex: '0', role: 'button', 'aria-label': `${titleOf(n)}, ${t ? t.name : 'nota'}`, style: { left: n.x + 'px', top: n.y + 'px', width: NW + 'px', height: NH + 'px', '--nc': c } },
        h('span', { class: 'mm-ico' }, G.icon(t ? t.icon || 'tag' : 'note', 16)),
        h('div', { class: 'mm-ntxt' }, h('div', { class: 'mm-ntitle' }, titleOf(n)), h('div', { class: 'mm-nsub' }, t ? t.name : 'Nota')),
        ['t', 'r', 'b', 'l'].map((s) => h('span', { class: 'mm-h ' + s, 'data-h': s, title: 'Arrastra hasta otro nodo para conectarlos' })));
      return el;
    }
    function renderNodes() { G.clear(nodeLayer); nodes.forEach((n) => nodeLayer.appendChild(nodeEl(n))); }
    function renderLegend() {
      G.clear(legend);
      const used = new Map();
      nodes.forEach((n) => { const t = typeOf(n); const k = t ? t.name : 'Nota'; if (!used.has(k)) used.set(k, colorOf(n)); });
      used.forEach((c, name) => legend.appendChild(h('span', { class: 'lg' }, h('span', { class: 'tdot', style: { background: c } }), name)));
      legend.hidden = !used.size;
    }
    function drawMini() {
      while (mini.firstChild) mini.removeChild(mini.firstChild);
      const r = canvas.getBoundingClientRect();
      const vx1 = -view.x / view.k, vy1 = -view.y / view.k, vw = r.width / view.k, vh = r.height / view.k;
      let x1 = vx1, y1 = vy1, x2 = vx1 + vw, y2 = vy1 + vh;
      const b = bbox(nodes); if (b) { x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
      const pad = 40; x1 -= pad; y1 -= pad; x2 += pad; y2 += pad;
      const k = Math.min(168 / (x2 - x1), 112 / (y2 - y1));
      const ox = (168 - (x2 - x1) * k) / 2, oy = (112 - (y2 - y1) * k) / 2;
      mini._m = { x1, y1, k, ox, oy };
      nodes.forEach((n) => mini.appendChild(sv('rect', { x: ox + (n.x - x1) * k, y: oy + (n.y - y1) * k, width: Math.max(2, NW * k), height: Math.max(2, NH * k), fill: colorOf(n), opacity: 0.85, rx: 1 })));
      mini.appendChild(sv('rect', { x: ox + (vx1 - x1) * k, y: oy + (vy1 - y1) * k, width: vw * k, height: vh * k, fill: 'none', stroke: '#FFD712', 'stroke-width': 1.5 }));
    }
    on(mini, 'pointerdown', (e) => {
      const m = mini._m; if (!m) return; e.stopPropagation();
      const move = (ev) => { const r = mini.getBoundingClientRect(); const wx = (ev.clientX - r.left - m.ox) / m.k + m.x1, wy = (ev.clientY - r.top - m.oy) / m.k + m.y1; const cr = canvas.getBoundingClientRect(); view.x = cr.width / 2 - wx * view.k; view.y = cr.height / 2 - wy * view.k; applyView(); };
      move(e); const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); saver.touch(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });
    function renderAll() { renderEdges(); renderNodes(); renderLegend(); renderInspector(); emptyHint.hidden = nodes.length > 0; drawMini(); }
    function setSel(s) { sel = s; renderEdges(); G.$$('.mm-node', nodeLayer).forEach((el) => el.classList.toggle('sel', !!sel && sel.type === 'node' && sel.id === el.dataset.id)); renderInspector(); }

    // ------------------------------------------------------------ interacción
    let drag = null;
    on(canvas, 'pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      nodeLayer.classList.remove('animating');
      const handle = e.target.closest('.mm-h'), nodeEl_ = e.target.closest('.mm-node'), edgeEl = e.target.closest('.mm-edge:not(.auto)'), lab = e.target.closest('.mm-elabel:not(.auto)');
      if (handle && nodeEl_) {
        e.preventDefault(); canvas.setPointerCapture(e.pointerId);
        const src = nodeById(nodeEl_.dataset.id); const line = sv('line', { class: 'mm-temp' }); edgeG.appendChild(line);
        drag = { mode: 'link', src, line }; setSel({ type: 'node', id: src.id }); return;
      }
      if (nodeEl_) {
        const n = nodeById(nodeEl_.dataset.id); setSel({ type: 'node', id: n.id });
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        drag = { mode: 'node', n, dx: wx - n.x, dy: wy - n.y, moved: false, el: nodeEl_ }; canvas.setPointerCapture(e.pointerId); return;
      }
      if (edgeEl || lab) { setSel({ type: 'edge', id: (edgeEl || lab).dataset.id }); canvas.focus(); return; }
      if (e.target.closest('.mm-legend,.mm-mini,.mm-empty')) return;
      setSel(null); canvas.focus();
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('panning');
    });
    on(canvas, 'pointermove', (e) => {
      if (!drag) return;
      if (drag.mode === 'pan') { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; applyView(); }
      else if (drag.mode === 'node') {
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        drag.n.x = Math.round(wx - drag.dx); drag.n.y = Math.round(wy - drag.dy); drag.moved = true;
        drag.el.style.left = drag.n.x + 'px'; drag.el.style.top = drag.n.y + 'px'; renderEdges(); drawMini();
      } else if (drag.mode === 'link') {
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        const [ax, ay] = anchor(drag.src, wx, wy);
        drag.line.setAttribute('x1', ax); drag.line.setAttribute('y1', ay); drag.line.setAttribute('x2', wx); drag.line.setAttribute('y2', wy);
        const over = document.elementFromPoint(e.clientX, e.clientY), tn = over && over.closest && over.closest('.mm-node');
        G.$$('.mm-node.target', nodeLayer).forEach((x) => x.classList.remove('target'));
        if (tn && tn.dataset.id !== drag.src.id) tn.classList.add('target');
      }
    });
    function endDrag(e) {
      if (!drag) return;
      const d = drag; drag = null; canvas.classList.remove('panning');
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
      if (d.mode === 'pan') saver.touch();
      else if (d.mode === 'node' && d.moved) commit();
      else if (d.mode === 'link') {
        d.line.remove(); G.$$('.mm-node.target', nodeLayer).forEach((x) => x.classList.remove('target'));
        const over = document.elementFromPoint(e.clientX, e.clientY), tn = over && over.closest && over.closest('.mm-node');
        if (tn && tn.dataset.id !== d.src.id) connect(d.src.id, tn.dataset.id, true);
      }
    }
    on(canvas, 'pointerup', endDrag); on(canvas, 'pointercancel', endDrag);
    on(canvas, 'dblclick', (e) => { if (e.target.closest('.mm-node,.mm-legend,.mm-mini,.mm-elabel,.mm-empty')) return; const [wx, wy] = toWorld(e.clientX, e.clientY); addNote(wx - NW / 2, wy - NH / 2); });
    on(canvas, 'wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomAt(view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    on(canvas, 'keydown', (e) => {
      if (e.target.matches('input,textarea,select')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) { if (hi < hist.length - 1) restore(hi + 1); } else if (hi > 0) restore(hi - 1); }
      else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); if (hi < hist.length - 1) restore(hi + 1); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
      else if (e.key === 'Enter' && e.target.classList.contains('mm-node')) { setSel({ type: 'node', id: e.target.dataset.id }); const f = G.$('input,textarea', insp); if (f) f.focus(); }
      else if (e.key.startsWith('Arrow') && sel && sel.type === 'node') {
        e.preventDefault(); const n = nodeById(sel.id), s = e.shiftKey ? 32 : 8;
        n.x += e.key === 'ArrowRight' ? s : e.key === 'ArrowLeft' ? -s : 0; n.y += e.key === 'ArrowDown' ? s : e.key === 'ArrowUp' ? -s : 0;
        renderEdges(); renderNodes(); drawMini(); const el = G.$(`.mm-node[data-id="${n.id}"]`, nodeLayer); if (el) el.focus(); clearTimeout(on._t); on._t = setTimeout(commit, 400);
      }
    });

    // ------------------------------------------------------------ acciones
    function placeNew(i) { const [cx, cy] = viewCenter(); const col = i % 4, row = Math.floor(i / 4); return [Math.round(cx - NW / 2 + (col - 1.5) * (NW + 24)), Math.round(cy - NH / 2 + row * (NH + 28))]; }
    function addNote(x, y) {
      const [px, py] = x === undefined ? placeNew(nodes.length % 3) : [Math.round(x), Math.round(y)];
      const n = { id: G.uid(), kind: 'note', title: 'Nueva nota', notes: '', color: COLORS[nodes.filter((q) => q.kind === 'note').length % COLORS.length], x: px, y: py };
      nodes.push(n); renderAll(); setSel({ type: 'node', id: n.id }); commit();
      { const el = G.$(`.mm-node[data-id="${n.id}"]`, nodeLayer); if (el && G.anim()) el.classList.add('pop-in'); }
      const t = G.$('input[data-f=title]', insp); if (t) { t.focus(); t.select(); }
    }
    function addProfiles(list) {
      const have = new Set(nodes.filter((n) => n.kind === 'profile').map((n) => n.profileId));
      const add = list.filter((p) => !have.has(p.id));
      if (!add.length) return 0;
      const fresh = add.map((p, i) => { const [x, y] = placeNew(i); return { id: G.uid(), kind: 'profile', profileId: p.id, notes: '', x, y }; });
      nodes.push(...fresh);
      renderAll(); commit();
      if (fresh.length > 3) autoLayout(true); else fit(nodes);
      return fresh.length;
    }
    function addAllProfiles() {
      const all = [...profiles.values()];
      if (!all.length) { G.toast('La biblia aún no tiene perfiles. Créalos en la sección Biblia del proyecto.', { kind: 'info' }); return; }
      const n = addProfiles(all);
      G.toast(n ? `Se agregaron ${n} perfiles al mapa.` : 'Todos los perfiles ya están en el mapa.', { kind: n ? 'ok' : 'info' });
    }
    function pickProfiles(anchorBtn) {
      G.togglePopover(anchorBtn, (close) => {
        const have = new Set(nodes.filter((n) => n.kind === 'profile').map((n) => n.profileId));
        const chosen = new Set();
        const search = h('input', { class: 'input sm', type: 'search', placeholder: 'Buscar perfil…', 'aria-label': 'Buscar perfil' });
        const list = h('div', { class: 'pick-list' });
        const ok = h('button', { class: 'btn sm primary', type: 'button', disabled: true, onclick: () => { close(); addProfiles([...chosen].map((id) => profiles.get(id))); } }, 'Agregar');
        const fill = () => {
          const q = search.value.trim().toLowerCase(); G.clear(list);
          const items = [...profiles.values()].filter((p) => !have.has(p.id) && (!q || (p.name || '').toLowerCase().includes(q))).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
          if (!items.length) list.appendChild(h('div', { class: 'dim', style: { padding: '8px' } }, profiles.size ? 'Todos los perfiles ya están en el mapa.' : 'La biblia aún no tiene perfiles.'));
          items.forEach((p) => { const t = types.get(p.typeId); const cb = h('input', { type: 'checkbox', checked: chosen.has(p.id) }); cb.addEventListener('change', () => { cb.checked ? chosen.add(p.id) : chosen.delete(p.id); ok.disabled = !chosen.size; ok.textContent = chosen.size ? `Agregar (${chosen.size})` : 'Agregar'; }); list.appendChild(h('label', { class: 'check pick-row' }, cb, h('span', { class: 'tdot', style: { background: t ? t.color : '#999' } }), h('span', { class: 'grow ellip' }, (p.name || '').trim() || 'Sin nombre'), h('span', { class: 'dim' }, t ? t.name : ''))); });
        };
        search.addEventListener('input', fill); fill(); setTimeout(() => search.focus(), 0);
        return h('div', { class: 'col gap-8', style: { width: '300px' } }, search, list, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, ok));
      }, { restoreFocus: false });
    }
    function connect(from, to, openLabel) {
      if (from === to) return;
      if (edges.some((e) => e.from === from && e.to === to && !e.label)) { G.toast('Esos dos nodos ya están conectados.', { kind: 'info' }); return; }
      const e = { id: G.uid(), from, to, label: '' };
      edges.push(e); renderEdges(); setSel({ type: 'edge', id: e.id }); commit();
      if (openLabel) { const l = G.$('input[data-f=elabel]', insp); if (l) { l.focus(); } }
    }
    function removeSel() {
      if (!sel) return;
      if (sel.type === 'node') { nodes = nodes.filter((n) => n.id !== sel.id); edges = edges.filter((e) => e.from !== sel.id && e.to !== sel.id); }
      else edges = edges.filter((e) => e.id !== sel.id);
      sel = null; renderAll(); commit(); G.toast('Eliminado del mapa.', { kind: 'info', ms: 5000, action: { label: 'Deshacer', fn: () => { if (hi > 0) restore(hi - 1); } } });
    }
    function autoLayout(quiet) {
      if (!nodes.length) return;
      const pos = nodes.map((n, i) => ({ id: n.id, x: n.x + NW / 2, y: n.y + NH / 2 }));
      const spread = new Set(pos.map((p) => Math.round(p.x / 50) + ',' + Math.round(p.y / 50))).size > Math.max(1, nodes.length * 0.6);
      if (!spread) pos.forEach((p, i) => { const a = (i / pos.length) * Math.PI * 2; p.x = Math.cos(a) * (200 + pos.length * 30); p.y = Math.sin(a) * (200 + pos.length * 30); });
      const idx = new Map(pos.map((p, i) => [p.id, i]));
      const links = edges.concat(autoEdges()).map((e) => [idx.get(e.from), idx.get(e.to)]).filter((l) => l[0] !== undefined && l[1] !== undefined);
      const N = pos.length, ITER = N > 250 ? 120 : 320;
      for (let it = 0; it < ITER; it++) {
        const cool = 1 - it / ITER;
        const fx = new Float64Array(N), fy = new Float64Array(N);
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          let dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y; const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
          const f = 260000 / d2; dx /= d; dy /= d; fx[i] += dx * f; fy[i] += dy * f; fx[j] -= dx * f; fy[j] -= dy * f;
        }
        for (const [a, b] of links) { const dx = pos[b].x - pos[a].x, dy = pos[b].y - pos[a].y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - 360) * 0.05; fx[a] += (dx / d) * f; fy[a] += (dy / d) * f; fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f; }
        for (let i = 0; i < N; i++) { fx[i] -= pos[i].x * 0.012; fy[i] -= pos[i].y * 0.012; const m = Math.hypot(fx[i], fy[i]) || 1, s = Math.min(m, 36) * cool; pos[i].x += (fx[i] / m) * s; pos[i].y += (fy[i] / m) * s; }
      }
      for (let pass = 0; pass < 30; pass++) { let moved = false; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y, ox = NW + 90 - Math.abs(dx), oy = NH + 60 - Math.abs(dy); if (ox > 0 && oy > 0) { moved = true; if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; pos[i].x -= s; pos[j].x += s; } else { const s = (dy >= 0 ? 1 : -1) * oy / 2; pos[i].y -= s; pos[j].y += s; } } } if (!moved) break; }
      nodes.forEach((n, i) => { n.x = Math.round((pos[i].x - NW / 2) / 8) * 8; n.y = Math.round((pos[i].y - NH / 2) / 8) * 8; });
      nodeLayer.classList.add('animating'); renderAll(); setTimeout(() => nodeLayer.classList.remove('animating'), 450);
      commit(); fit(); if (!quiet) G.toast('Mapa ordenado.', { kind: 'ok', ms: 1800 });
    }

    // ------------------------------------------------------------ inspector
    function renderInspector() {
      G.clear(insp);
      insp.classList.toggle('empty-insp', !sel);
      if (!sel) {
        insp.append(h('div', { class: 'mi-sec' }, h('h2', { class: 'strong' }, 'Mapa de ideas'), h('p', { class: 'muted' }, `${nodes.length} nodos · ${edges.length + autoEdges().length} conexiones`)),
          h('div', { class: 'mi-sec' }, h('div', { class: 'lbl' }, 'Cómo usarlo'), h('ul', { class: 'mi-tips' }, [
            'Doble clic en el lienzo: crea una nota.', 'Arrastra desde un punto de un nodo hasta otro para conectarlos.', 'Rueda del ratón: zoom. Arrastra el fondo: mover la vista.', 'Las líneas punteadas vienen de los campos de relación de la biblia.', 'Con un nodo seleccionado, las flechas lo mueven y Supr lo elimina.'].map((t) => h('li', {}, t)))));
        return;
      }
      if (sel.type === 'edge') {
        const e = edges.find((x) => x.id === sel.id); if (!e) { sel = null; return renderInspector(); }
        const a = nodeById(e.from), b = nodeById(e.to);
        const lab = h('input', { class: 'input', type: 'text', maxlength: 60, value: e.label, placeholder: 'Por ejemplo: sospecha de, hermano de, vive en…', 'data-f': 'elabel' });
        lab.addEventListener('input', () => { e.label = lab.value; renderEdges(); saver.touch(); });
        lab.addEventListener('change', commit); lab.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { lab.blur(); canvas.focus(); } });
        insp.append(h('div', { class: 'mi-sec' }, h('h2', { class: 'strong' }, 'Conexión'), h('p', { class: 'muted' }, `${titleOf(a)} → ${titleOf(b)}`)),
          h('div', { class: 'mi-sec' }, G.field('Etiqueta', lab).el),
          h('div', { class: 'mi-sec row wrap' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { [e.from, e.to] = [e.to, e.from]; renderAll(); commit(); } }, G.icon('swap', 14), 'Invertir dirección'), h('button', { class: 'btn sm danger', type: 'button', onclick: removeSel }, G.icon('trash', 14), 'Eliminar')));
        return;
      }
      const n = nodeById(sel.id); if (!n) { sel = null; return renderInspector(); }
      const p = profOf(n), t = typeOf(n);
      const secs = [];
      if (p) {
        secs.push(h('div', { class: 'mi-sec' }, h('div', { class: 'row' }, h('span', { class: 'tdot', style: { background: colorOf(n) } }), h('span', { class: 'dim' }, t ? t.name : '')), h('h2', { class: 'strong', style: { fontSize: '16px' } }, titleOf(n)),
          h('button', { class: 'btn sm', type: 'button', style: { marginTop: '8px' }, onclick: () => G.go('bible', { select: p.id }) }, G.icon('book', 14), 'Abrir perfil en la biblia')));
      } else {
        const title = h('input', { class: 'input', type: 'text', maxlength: 80, value: n.title, 'data-f': 'title' });
        title.addEventListener('input', () => { n.title = title.value; const el = G.$(`.mm-node[data-id="${n.id}"] .mm-ntitle`, nodeLayer); if (el) el.textContent = titleOf(n); saver.touch(); drawMini(); });
        title.addEventListener('change', () => { renderLegend(); commit(); });
        const sw = h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { class: 'swatch' + (n.color === c ? ' sel' : ''), type: 'button', style: { background: c }, 'aria-label': 'Color ' + c, onclick: () => { n.color = c; renderAll(); commit(); } })));
        secs.push(h('div', { class: 'mi-sec' }, G.field('Título de la nota', title).el), h('div', { class: 'mi-sec' }, h('div', { class: 'lbl', style: { marginBottom: '6px' } }, 'Color'), sw));
      }
      const notes = h('textarea', { class: 'textarea', rows: 4, maxlength: 4000, placeholder: 'Ideas, preguntas, pendientes…', spellcheck: 'true', lang: 'es' }, n.notes || '');
      notes.addEventListener('input', () => { n.notes = notes.value; saver.touch(); }); notes.addEventListener('change', commit);
      secs.push(h('div', { class: 'mi-sec' }, G.field('Notas', notes).el));
      // conexiones
      const mine = edges.filter((e) => e.from === n.id || e.to === n.id), autos = autoEdges().filter((e) => e.from === n.id || e.to === n.id);
      const list = h('div', { class: 'col gap-4' }, mine.map((e) => { const o = nodeById(e.from === n.id ? e.to : e.from); return h('div', { class: 'mi-link' }, h('button', { class: 'link-btn grow ellip', type: 'button', onclick: () => setSel({ type: 'edge', id: e.id }) }, (e.from === n.id ? '→ ' : '← ') + titleOf(o) + (e.label ? ' · ' + e.label : '')), h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Quitar conexión con ' + titleOf(o), onclick: () => { edges = edges.filter((x) => x.id !== e.id); renderAll(); commit(); } }, G.icon('close', 14))); }),
        autos.map((e) => { const o = nodeById(e.from === n.id ? e.to : e.from); return h('div', { class: 'mi-link auto' }, h('span', { class: 'grow ellip dim' }, '⇢ ' + titleOf(o) + ' · ' + e.label + ' (biblia)')); }));
      if (!mine.length && !autos.length) list.appendChild(h('span', { class: 'dim' }, 'Sin conexiones todavía.'));
      const others = nodes.filter((o) => o.id !== n.id);
      const target = h('select', { class: 'select sm', 'aria-label': 'Conectar con' }, h('option', { value: '' }, 'Conectar con…'), others.map((o) => h('option', { value: o.id }, titleOf(o))));
      const lbl = h('input', { class: 'input sm', type: 'text', maxlength: 60, placeholder: 'Etiqueta (opcional)', 'aria-label': 'Etiqueta de la nueva conexión' });
      secs.push(h('div', { class: 'mi-sec' }, h('div', { class: 'lbl', style: { marginBottom: '6px' } }, 'Conexiones'), list,
        others.length ? h('div', { class: 'col gap-4', style: { marginTop: '10px' } }, target, lbl, h('button', { class: 'btn sm', type: 'button', onclick: () => { if (!target.value) return; const to = target.value, lb = lbl.value.trim(); edges.push({ id: G.uid(), from: n.id, to, label: lb }); renderAll(); commit(); } }, G.icon('link', 14), 'Conectar')) : null));
      secs.push(h('div', { class: 'mi-sec' }, h('button', { class: 'btn sm danger', type: 'button', onclick: removeSel }, G.icon('trash', 14), 'Quitar del mapa')));
      insp.append(...secs);
    }

    // ------------------------------------------------------------ inicio
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawMini()) : null; if (ro) ro.observe(canvas);
    renderAll(); syncUndo(); applyView();
    const first = !raw.nodes && !raw.view;
    return {
      destroy() { saver.destroy(); if (ro) ro.disconnect(); cleanups.forEach((f) => f()); clearTimeout(on._t); },
      afterMount() {
        if (first || !raw.view) fit();
        if (params && params.focus) {
          let n = nodes.find((x) => x.kind === 'profile' && x.profileId === params.focus);
          if (!n && profiles.has(params.focus)) { addProfiles([profiles.get(params.focus)]); n = nodes.find((x) => x.profileId === params.focus); }
          if (n) { setSel({ type: 'node', id: n.id }); centerOn(n); }
        } else if (nodes.length && !raw.view) fit();
        applyView();
      },
    };
  };
})();
