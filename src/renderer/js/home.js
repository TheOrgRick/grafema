/* Grafema — Inicio: proyectos, proyecto reciente y estadísticas. */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const GENRES = ['Ficción', 'Suspenso', 'Misterio', 'Fantasía', 'Ciencia ficción', 'Romance', 'Terror', 'Histórica', 'Juvenil', 'No ficción', 'Otro'];
  G.GENRES = GENRES;

  async function projectDialog(existing) {
    const name = h('input', { class: 'input', type: 'text', maxlength: 80, value: existing ? existing.name : '', placeholder: 'Por ejemplo: La noche larga', 'data-autofocus': '' });
    const genre = h('select', { class: 'select' }, h('option', { value: '' }, 'Sin género'), GENRES.map((g) => h('option', { value: g, selected: existing && existing.genre === g }, g)));
    if (existing && existing.genre && !GENRES.includes(existing.genre)) genre.appendChild(h('option', { value: existing.genre, selected: true }, existing.genre));
    const author = h('input', { class: 'input', type: 'text', maxlength: 80, value: existing ? existing.author : (G.state.user && G.state.user.name) || '' });
    const desc = h('textarea', { class: 'textarea', maxlength: 500, placeholder: 'Una frase sobre de qué trata (opcional).' }, existing ? existing.description : '');
    const fN = G.field('Nombre del proyecto', name), fG = G.field('Género', genre), fA = G.field('Autor (aparece en el PDF)', author), fD = G.field('Descripción', desc);
    // Plantillas de inicio (solo al crear): capítulos con guía, formato de página y tipografía.
    let tpl = 'blank', lastTplGenre = '';
    let gallery = null;
    if (!existing && window.GrafemaTemplates) {
      const cards = window.GrafemaTemplates.list().map((t) => {
        const meta = [t.chapters.length + (t.chapters.length === 1 ? ' capítulo' : ' capítulos'), t.page === 'media' ? 'Media carta' : null, t.font].filter(Boolean).join(' · ');
        const b = h('button', { class: 'tpl' + (t.id === tpl ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(t.id === tpl), 'data-id': t.id, title: t.chapters.join(' · '),
          onclick: () => {
            tpl = t.id;
            for (const c of G.$$('.tpl', gallery)) { const on = c.getAttribute('data-id') === t.id; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); }
            // El género sigue a la plantilla mientras la persona no haya elegido otro a mano.
            if ((genre.value === '' || genre.value === lastTplGenre) && GENRES.includes(t.genre)) genre.value = t.genre; else if (genre.value === lastTplGenre && !GENRES.includes(t.genre)) genre.value = '';
            lastTplGenre = GENRES.includes(t.genre) ? t.genre : '';
          } },
          h('div', { class: 'tpl-thumb', 'aria-hidden': 'true' }, h('i'), h('i'), h('i', { style: { width: '78%' } })),
          h('div', { class: 'tpl-name' }, t.name), h('div', { class: 'tpl-desc' }, t.description), h('div', { class: 'tpl-meta' }, meta));
        return b;
      });
      gallery = h('div', { class: 'tpl-grid', role: 'radiogroup', 'aria-label': 'Plantilla de inicio' }, cards);
    }
    return G.modal({
      title: existing ? 'Datos del proyecto' : 'Nuevo proyecto', width: existing ? 500 : 640,
      body: h('div', { class: 'col gap-16' }, fN.el, gallery ? h('div', { class: 'field' }, h('label', { class: 'lbl' }, 'Plantilla de inicio'), gallery) : null, h('div', { class: 'grid2' }, fG.el, fA.el), fD.el),
      actions: [
        { label: 'Cancelar', value: null },
        {
          label: existing ? 'Guardar' : 'Crear proyecto', primary: true, keepOpen: true,
          onClick: async (api) => {
            fN.setError('');
            if (!name.value.trim()) { fN.setError('Escribe un nombre para el proyecto.'); name.focus(); return false; }
            api.setBusy(true);
            try {
              const payload = { name: name.value, genre: genre.value, author: author.value, description: desc.value };
              if (!existing) payload.template = tpl;
              const r = existing ? await G.call('project:update', { id: existing.id, patch: payload }) : await G.call('project:create', payload);
              api.close(r.project);
            } catch (e) { api.setBusy(false); fN.setError(e.message); }
            return false;
          },
        },
      ],
    });
  }
  G.projectDialog = projectDialog;

  G.views.home = async function homeView(container) {
    let projects = (await G.call('project:list')).projects;
    const user = G.state.user || {};

    async function reload() { projects = (await G.call('project:list')).projects; render(); }
    async function createProject() {
      const p = await projectDialog(null);
      if (p) { G.toast('Proyecto «' + p.name + '» creado.', { kind: 'ok' }); await G.openProject(p.id, 'editor'); }
    }
    async function importProject() {
      try {
        const r = await G.call('project:importFile');
        if (r.canceled) return;
        G.toast('Proyecto «' + r.project.name + '» importado.' + (r.warnings && r.warnings.length ? ' ' + r.warnings[0] : ''), { kind: r.warnings && r.warnings.length ? 'warn' : 'ok', ms: 5000 });
        await G.openProject(r.project.id, 'editor');
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function exportProject(p) {
      try {
        if (G.state.project && G.state.project.id === p.id) await G.flushAll();
        const r = await G.call('project:exportFile', { projectId: p.id });
        if (!r.canceled) G.toast('Proyecto guardado como archivo .grafema.', { kind: 'ok' });
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    async function editProject(p) {
      const r = await projectDialog(p);
      if (r) { if (G.state.project && G.state.project.id === r.id) { G.state.project = r; G.refreshShell(); } await reload(); }
    }
    async function deleteProject(p) {
      const ok = await G.confirm({ title: 'Eliminar «' + p.name + '»', message: `Se eliminarán sus ${p.chapters} capítulo(s), la biblia y el mapa de ideas. Esta acción no se puede deshacer. Si quieres conservar el texto, primero expórtalo a .docx.`, confirmLabel: 'Eliminar proyecto', danger: true });
      if (!ok) return;
      try {
        await G.call('project:delete', { id: p.id });
        if (G.state.project && G.state.project.id === p.id) { G.state.project = null; G.refreshShell(); }
        G.toast('Proyecto eliminado.', { kind: 'ok' });
        await reload();
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    const openMenu = (btn, p) => G.menu(btn, [
      { label: 'Abrir manuscrito', icon: 'doc', onClick: () => G.openProject(p.id, 'editor') },
      { label: 'Abrir biblia', icon: 'book', onClick: () => G.openProject(p.id, 'bible') },
      { label: 'Abrir mapa de ideas', icon: 'network', onClick: () => G.openProject(p.id, 'map') },
      { separator: true },
      { label: 'Exportar proyecto (.grafema)', icon: 'doc', onClick: () => exportProject(p) },
      { separator: true },
      { label: 'Editar datos', icon: 'edit', onClick: () => editProject(p) },
      { label: 'Eliminar', icon: 'trash', danger: true, onClick: () => deleteProject(p) },
    ], { align: 'right' });

    const cover = (p) => { const d = h('div', { class: 'cover' }); d.innerHTML = G.art.cover(p.id); d.appendChild(h('div', { class: 'cover-ini' }, G.px((p.name.trim().charAt(0) || 'G'), 5))); return d; };
    const row = (icon, label, value) => h('div', { class: 'meta-row' }, G.icon(icon, 16), h('span', { class: 'meta-k' }, label + ':'), h('span', { class: 'meta-v' }, value));
    const svgBox = (cls, svg) => { const d = h('div', { class: cls, 'aria-hidden': 'true' }); d.innerHTML = svg; return d; };

    function render() {
      G.clear(container);
      container.className = 'home scroll';
      const first = (user.name || '').split(' ')[0];
      const totalWords = projects.reduce((n, p) => n + p.words, 0);

      container.appendChild(h('section', { class: 'hero dotted-b' },
        h('div', { class: 'hero-text' },
          h('p', { class: 'muted' }, first ? `Hola, ${first}.` : 'Hola.'),
          h('h1', { class: 'hero-h', 'aria-label': 'Tus historias' }, G.px('TUS', 5), G.px('HISTORIAS', 5)),
          h('p', { class: 'muted hero-p' }, 'Manuscrito, biblia de la historia y mapa de ideas, todo en ' + (G.isAndroid ? 'tu teléfono.' : 'tu computadora.')),
          h('div', { class: 'row gap-12 wrap' },
            h('button', { class: 'btn primary', type: 'button', onclick: createProject }, G.icon('plus', 16), 'Nuevo proyecto'),
            h('button', { class: 'btn', type: 'button', onclick: importProject }, G.icon('doc', 16), 'Importar proyecto'),
            projects.length ? h('button', { class: 'btn upper', type: 'button', onclick: () => G.openProject(projects[0].id, 'editor') }, 'Continuar escribiendo', G.icon('arrowUR', 14)) : null)),
        svgBox('hero-art', G.art.hero('home'))));

      if (!projects.length) {
        container.appendChild(h('section', { class: 'empty-home dotted-b' },
          h('div', { class: 'empty' }, svgBox('cube-mini', G.art.cubeMini(96)), h('div', { class: 't-sub' }, 'Aún no tienes proyectos'),
            h('p', { style: { maxWidth: '420px' } }, 'Crea tu primer proyecto para empezar a escribir. Cada proyecto tiene sus capítulos, su biblia de personajes y lugares, y su mapa de ideas.'),
            h('button', { class: 'btn primary', type: 'button', onclick: createProject }, G.icon('plus', 16), 'Crear mi primer proyecto'))));
      } else {
        const r = projects[0];
        container.appendChild(h('section', { class: 'recent dotted-b', 'aria-label': 'Proyecto reciente' },
          h('div', { class: 'vlabel', 'aria-hidden': 'true' }, 'PROYECTO RECIENTE'),
          cover(r),
          h('div', { class: 'recent-info' },
            h('h2', { class: 'recent-name' }, r.name), h('div', { class: 'underline' }),
            h('div', { class: 'meta' },
              row('tag', 'Género', r.genre || 'Sin definir'), row('doc', 'Capítulos', G.fmt(r.chapters)), row('edit', 'Palabras', G.fmt(r.words)), row('clock', 'Último cambio', G.fmtDate(r.updated)),
              r.description ? row('note', 'Sobre la historia', r.description) : null),
            h('div', { class: 'row gap-16 wrap', style: { marginTop: '20px' } },
              h('button', { class: 'btn primary', type: 'button', onclick: () => G.openProject(r.id, 'editor') }, 'Continuar escribiendo', G.icon('arrowUR', 14)),
              h('button', { class: 'link caps', type: 'button', onclick: () => G.openProject(r.id, 'bible') }, 'Abrir biblia'),
              h('button', { class: 'link caps', type: 'button', onclick: () => G.openProject(r.id, 'map') }, 'Mapa de ideas'))),
          svgBox('recent-deco', G.art.cubeMini(180))));

        const grid = h('div', { class: 'proj-grid' }, projects.map((p) => {
          const menuBtn = h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Más acciones de ' + p.name, onclick: (e) => { e.stopPropagation(); openMenu(menuBtn, p); } }, G.icon('more', 16));
          return h('article', { class: 'proj-card', tabindex: '0', role: 'button', 'aria-label': 'Abrir ' + p.name, onclick: () => G.openProject(p.id, 'editor'), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) G.openProject(p.id, 'editor'); } },
            h('div', { class: 'row' }, h('h3', { class: 'proj-name ellip grow' }, p.name), menuBtn),
            h('div', { class: 'row wrap' }, p.genre ? h('span', { class: 'badge' }, p.genre) : null, h('span', { class: 'dim' }, p.author)),
            h('div', { class: 'proj-stats' }, h('span', {}, G.fmt(p.words) + ' palabras'), h('span', {}, p.chapters + ' cap.'), h('span', {}, p.profiles + ' perfiles')),
            h('div', { class: 'dim' }, 'Editado ' + G.fmtDate(p.updated)));
        }));
        container.appendChild(h('section', { class: 'projects dotted-b' },
          h('div', { class: 'row', style: { marginBottom: '16px' } }, h('h2', { class: 't-sub grow' }, 'Todos los proyectos'), h('button', { class: 'btn', type: 'button', onclick: createProject }, G.icon('plus', 16), 'Nuevo proyecto')), grid));
      }

      const stat = (n, label) => h('div', { class: 'stat' }, G.px(G.fmt(n), 4), h('div', { class: 'stat-l' }, label));
      container.appendChild(h('section', { class: 'stats dotted-b', 'aria-label': 'Resumen' },
        stat(projects.length, 'proyectos'), stat(totalWords, 'palabras escritas'), stat(projects.reduce((n, p) => n + p.chapters, 0), 'capítulos'), stat(projects.reduce((n, p) => n + p.profiles, 0), 'perfiles en la biblia')));
      container.appendChild(h('footer', { class: 'foot' },
        h('span', {}, '© Petricorp · Grafema'), h('span', {}, 'Tus datos se guardan solo en ' + (G.isAndroid ? 'este teléfono' : 'este equipo')),
        h('button', { class: 'link', type: 'button', onclick: () => G.go('settings') }, 'Ajustes y privacidad')));
    }
    render();
    return { destroy() {} };
  };
})();
