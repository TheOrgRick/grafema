/* Grafema — Exportar manuscrito a PDF (con autor y título) o a .docx. */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const DM = window.DocModel;

  G.views.export = async function exportView(container) {
    const project = G.state.project;
    const pid = project.id;
    if (G.isAndroid) {
      // En Android solo se exporta el proyecto completo como archivo .grafema (sin PDF ni .docx).
      container.className = 'ex';
      const btn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        try {
          await G.flushAll();
          const r = await G.withBusy(btn, () => G.call('project:exportFile', { projectId: pid }));
          if (r && !r.canceled) G.toast('Proyecto guardado como archivo .grafema.', { kind: 'ok' });
        } catch (e) { G.toast(e.message, { kind: 'err' }); }
      } }, G.icon('doc', 16), 'Exportar proyecto (.grafema)');
      container.append(h('div', { class: 'ex-form scroll' },
        h('div', { class: 'col gap-4' }, h('h1', { class: 't-sub' }, 'Exportar proyecto'),
          h('p', { class: 'muted' }, 'El proyecto completo (manuscrito, biblia y mapas) se guarda como un archivo .grafema que puedes enviar o abrir en Grafema para Windows y en otro teléfono.')),
        h('div', { class: 'ex-actions' }, btn)));
      return { destroy() {} };
    }
    const saved = project.export && typeof project.export === 'object' ? project.export : {};
    const user = G.state.user || {};
    const opts = {
      title: saved.title || project.name, subtitle: saved.subtitle || '', author: saved.author || project.author || user.name || '',
      cover: saved.cover !== false, chapterTitles: saved.chapterTitles !== false, pageBreaks: saved.pageBreaks !== false, pageNumbers: saved.pageNumbers !== false, header: !!saved.header,
    };
    Object.assign(opts, { manuscript: saved.manuscript !== false, toc: !!saved.toc, bible: !!saved.bible, maps: !!saved.maps, revisions: saved.revisions === 'markup' ? 'markup' : 'final' });
    // Biblia y mapas disponibles para incluir en el PDF.
    let src = { types: [], profiles: [], maps: [] };
    try { src = await G.call('export:sources', { projectId: pid }); } catch (_) { /* se muestra sin esas secciones */ }
    const restore = (all, savedIds) => { const ok = new Set(all); const sel = new Set(Array.isArray(savedIds) ? savedIds.filter((x) => ok.has(x)) : all); return sel.size || !Array.isArray(savedIds) ? sel : new Set(all); };
    const bTypes = restore(src.types.map((t) => t.id), saved.bibleTypeIds);
    const mapSel = restore(src.maps.map((m) => m.id), saved.mapIds);
    const chosen = new Set(project.chapters.map((c) => c.id));
    if (Array.isArray(saved.chapterIds)) { chosen.clear(); saved.chapterIds.forEach((id) => { if (project.chapters.some((c) => c.id === id)) chosen.add(id); }); if (!chosen.size) project.chapters.forEach((c) => chosen.add(c.id)); }

    const payload = () => ({ title: opts.title.trim() || project.name, subtitle: opts.subtitle.trim(), author: opts.author.trim(), cover: opts.cover, chapterTitles: opts.chapterTitles, pageBreaks: opts.pageBreaks, pageNumbers: opts.pageNumbers, header: opts.header, chapterIds: project.chapters.filter((c) => chosen.has(c.id)).map((c) => c.id),
      manuscript: opts.manuscript, toc: opts.toc, revisions: opts.revisions, bible: opts.bible, maps: opts.maps,
      bibleTypeIds: bTypes.size === src.types.length ? null : [...bTypes], mapIds: mapSel.size === src.maps.length ? null : [...mapSel] });
    const persist = G.saver(async () => { const r = await G.call('project:update', { id: pid, patch: { export: payload() } }); G.state.project.export = r.project.export; }, 800);

    const txt = (key, label, ph, max) => { const i = h('input', { class: 'input', type: 'text', maxlength: max || 200, value: opts[key], placeholder: ph || '' }); i.addEventListener('input', () => { opts[key] = i.value; changed(); }); return G.field(label, i); };
    const sw = (key, label, hint) => { const s = G.switch({ checked: opts[key], label, onChange: (v) => { opts[key] = v; changed(); } }); return h('div', { class: 'ex-sw' }, s.el, hint ? h('div', { class: 'hint', style: { marginLeft: '50px' } }, hint) : null); };
    const fTitle = txt('title', 'Título del documento', project.name), fSub = txt('subtitle', 'Subtítulo (opcional)', ''), fAuthor = txt('author', 'Autor', 'Tu nombre', 120);

    const pg = DM.sanitizePage(project.page);
    const pageInfo = h('p', { class: 'hint' }, `Papel: ${DM.PAGE_SIZES[pg.size].name}. Márgenes: ${(pg.margins.top / 566.93).toFixed(2).replace('.', ',')} cm arriba, ${(pg.margins.left / 566.93).toFixed(2).replace('.', ',')} cm a los lados. Se cambian en Manuscrito › Página.`);

    const chBox = h('div', { class: 'ex-chs' });
    function drawChapters() {
      G.clear(chBox);
      project.chapters.forEach((c, i) => {
        const cb = h('input', { type: 'checkbox', checked: chosen.has(c.id) });
        cb.addEventListener('change', () => { cb.checked ? chosen.add(c.id) : chosen.delete(c.id); changed(); });
        chBox.appendChild(h('label', { class: 'check ex-ch' }, cb, h('span', { class: 'dim', style: { width: '18px', textAlign: 'right' } }, String(i + 1)), h('span', { class: 'grow ellip' }, c.title), h('span', { class: 'dim' }, G.fmt(c.words || 0))));
      });
    }
    drawChapters();

    // ---- secciones del documento ----
    const miniBtns = (set, all, redraw) => h('div', { class: 'row', style: { gap: '6px' } },
      h('button', { class: 'link caps', type: 'button', onclick: () => { all.forEach((x) => set.add(x)); redraw(); changed(); } }, 'Todos'),
      h('button', { class: 'link caps', type: 'button', onclick: () => { set.clear(); redraw(); changed(); } }, 'Ninguno'));
    const section = (key, label, hint, body) => {
      const wrap = h('div', { class: 'xs' + (opts[key] ? '' : ' off') });
      const sw = G.switch({ checked: opts[key], label, onChange: (v) => { opts[key] = v; wrap.classList.toggle('off', !v); if (body) body.hidden = !v; changed(); } });
      if (body) body.hidden = !opts[key];
      wrap.append(h('div', { class: 'xs-head' }, sw.el), hint ? h('div', { class: 'xs-note' }, hint) : null, body);
      return wrap;
    };
    const chBody = h('div', { class: 'xs-sub' }, h('div', { class: 'row' }, h('div', { class: 'dim grow' }, 'Capítulos'), miniBtns(chosen, project.chapters.map((c) => c.id), drawChapters)), chBox);
    const bibBox = h('div', { class: 'col gap-8' });
    function drawBible() {
      G.clear(bibBox);
      for (const t of src.types) {
        const n = src.profiles.filter((x) => x.typeId === t.id).length;
        const cb = h('input', { type: 'checkbox', checked: bTypes.has(t.id), disabled: !n });
        cb.addEventListener('change', () => { cb.checked ? bTypes.add(t.id) : bTypes.delete(t.id); changed(); });
        bibBox.appendChild(h('label', { class: 'check ex-ch' }, cb, h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: t.color || '#999', flex: 'none', marginTop: '4px' } }), h('span', { class: 'grow ellip' }, t.name), h('span', { class: 'dim' }, n + (n === 1 ? ' perfil' : ' perfiles'))));
      }
    }
    drawBible();
    const bibBody = h('div', { class: 'xs-sub' }, src.profiles.length ? h('div', { class: 'row' }, h('div', { class: 'dim grow' }, 'Tipos de perfil'), miniBtns(bTypes, src.types.map((t) => t.id), drawBible)) : null,
      src.profiles.length ? bibBox : h('div', { class: 'xs-note' }, 'Aún no hay perfiles en la biblia del proyecto.'));
    const mapBox = h('div', { class: 'col gap-8' });
    function drawMaps() {
      G.clear(mapBox);
      for (const m of src.maps) {
        const cb = h('input', { type: 'checkbox', checked: mapSel.has(m.id), disabled: !m.nodes });
        cb.addEventListener('change', () => { cb.checked ? mapSel.add(m.id) : mapSel.delete(m.id); changed(); });
        mapBox.appendChild(h('label', { class: 'check ex-ch' }, cb, h('span', { class: 'grow ellip' }, m.name), h('span', { class: 'dim' }, m.nodes + (m.nodes === 1 ? ' nodo' : ' nodos'))));
      }
    }
    drawMaps();
    const mapsBody = h('div', { class: 'xs-sub' }, h('div', { class: 'row' }, h('div', { class: 'dim grow' }, 'Cada mapa se imprime en una página horizontal'), miniBtns(mapSel, src.maps.map((m) => m.id), drawMaps)), mapBox);
    const secs = h('div', { class: 'xs-list' },
      section('manuscript', 'Manuscrito', null, chBody),
      section('bible', 'Biblia del proyecto', 'Los perfiles de personajes, lugares, objetos y demás, con sus datos e imágenes.', bibBody),
      section('maps', 'Mapas de ideas', null, mapsBody),
      section('toc', 'Índice al inicio', 'Lista de las secciones y capítulos que incluye el documento (sin números de página).', null));
    const revSeg = G.seg([{ value: 'final', label: 'Texto final' }, { value: 'markup', label: 'Con cambios marcados' }], opts.revisions, (v) => { opts.revisions = v; changed(); }, 'Cambios de revisión');
    const revField = G.field('Control de cambios y comentarios', revSeg, { hint: 'Con «Texto final» se aceptan los cambios marcados y se omiten los comentarios. Las notas al pie van al final de cada capítulo en el PDF; en el .docx son notas al pie reales.' });

    const pdfBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => doExport('pdf') }, G.icon('export', 16), 'Exportar a PDF');
    const docxBtn = h('button', { class: 'btn', type: 'button', onclick: () => doExport('docx') }, G.icon('doc', 16), 'Manuscrito en .docx');
    const form = h('div', { class: 'ex-form scroll' },
      h('div', { class: 'col gap-4' }, h('h1', { class: 't-sub' }, 'Exportar manuscrito'), h('p', { class: 'muted' }, 'El PDF incluye el nombre del autor y el título en el propio archivo y, si quieres, en la portada y el encabezado.')),
      h('div', { class: 'col gap-12' }, fTitle.el, fSub.el, fAuthor.el), pageInfo,
      h('div', { class: 'col gap-12' }, h('div', { class: 'lbl' }, 'Contenido'),
        sw('cover', 'Portada con título y autor'), sw('chapterTitles', 'Mostrar el título de cada capítulo'), sw('pageBreaks', 'Cada capítulo en página nueva'), sw('pageNumbers', 'Numerar las páginas'), sw('header', 'Encabezado con autor y título', 'Aparece arriba de cada página.')),
      h('div', { class: 'col gap-8' }, h('div', { class: 'lbl' }, 'Secciones a incluir'), secs, revField.el),
      h('div', { class: 'ex-actions' }, pdfBtn, docxBtn));

    const sheet = h('div', { class: 'gx-sheet' });
    const styleEl = h('style');
    const prevNote = h('div', { class: 'hint' }, 'Vista previa continua; los saltos de página reales los decide el PDF.');
    const prevHost = h('div', { class: 'ex-prev scroll' }, styleEl, h('div', { class: 'ex-prev-in' }, sheet), h('div', { style: { padding: '0 24px 24px', textAlign: 'center' } }, prevNote));
    container.className = 'ex';
    container.append(form, prevHost);

    let seq = 0;
    async function refresh() {
      const my = ++seq;
      try {
        const r = await G.call('export:preview', { projectId: pid, options: payload() });
        if (my !== seq) return;
        styleEl.textContent = r.css.replace(/\.gx(?![\w-])/g, '.gx-sheet .gx');
        const g = r.geometry;
        sheet.style.setProperty('--w', g.wIn + 'in');
        sheet.style.padding = `${g.margins.top}in ${g.margins.right}in ${g.margins.bottom}in ${g.margins.left}in`;
        sheet.innerHTML = '<div class="gx">' + (r.body || '<p style="text-align:center;color:#888">No hay nada seleccionado para mostrar.</p>') + '</div>';
        fit(g.wIn);
      } catch (e) { if (my === seq) { sheet.textContent = e.message; } }
    }
    function fit(wIn) {
      const avail = prevHost.clientWidth - 56;
      const z = Math.min(1, Math.max(0.35, avail / (wIn * 96)));
      sheet.style.zoom = z;
    }
    const refreshSoon = G.debounce(refresh, 250);
    function changed() { refreshSoon(); persist.touch(); }
    const onResize = G.debounce(() => { const g = sheet.style.getPropertyValue('--w'); if (g) fit(parseFloat(g)); }, 120);
    window.addEventListener('resize', onResize);

    async function doExport(kind) {
      const o = payload();
      const hasMs = o.manuscript && o.chapterIds.length > 0;
      if (kind === 'docx' && !hasMs) { G.toast('El .docx contiene el manuscrito: activa «Manuscrito» y elige al menos un capítulo.', { kind: 'err' }); return; }
      if (kind === 'pdf' && !hasMs && !o.bible && !o.maps) { G.toast('Elige qué incluir: manuscrito con algún capítulo, la biblia o los mapas.', { kind: 'err' }); return; }
      const btn = kind === 'pdf' ? pdfBtn : docxBtn;
      try {
        await G.flushAll();
        const r = await G.withBusy(btn, () => G.call(kind === 'pdf' ? 'export:pdf' : 'export:docx', { projectId: pid, options: o }));
        if (r.canceled) return;
        const open = { label: 'Mostrar en carpeta', fn: () => G.call('shell:showExport').catch(() => {}) };
        if (kind === 'pdf' && r.metadata === false) G.toast('PDF guardado, pero no se pudo escribir el autor en sus propiedades. Aparece en la portada si la activaste.', { kind: 'info', ms: 9000, action: open });
        else G.toast((kind === 'pdf' ? 'PDF guardado' : 'Manuscrito guardado') + ': ' + r.path, { kind: 'ok', ms: 9000, action: open });
        if (kind === 'pdf' && o.bible && !r.profiles) G.toast('La biblia no tenía perfiles para los tipos elegidos, así que no se añadió.', { kind: 'info', ms: 6000 });
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }

    await refresh();
    return { destroy() { persist.destroy(); refreshSoon.cancel(); window.removeEventListener('resize', onResize); }, afterMount() { refresh(); } };
  };
})();
