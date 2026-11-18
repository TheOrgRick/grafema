/* Grafema — bienvenida: solo se pide el nombre del autor (sin cuentas ni contraseñas). */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;

  G.views.welcome = function welcomeView(opts) {
    const name = h('input', { class: 'input', type: 'text', maxlength: 80, autocomplete: 'name', placeholder: 'Por ejemplo: Ana López', 'data-autofocus': '' });
    const f = G.field('Nombre del autor', name, { hint: 'Aparecerá como autor en tus PDF y documentos .docx. Podrás cambiarlo cuando quieras en Ajustes.' });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, 'Empezar a escribir');
    const form = h('form', { class: 'col gap-16', novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      f.setError('');
      if (!name.value.trim()) { f.setError('Escribe el nombre del autor para continuar.'); name.focus(); return; }
      try {
        const r = await G.withBusy(go, () => G.call('author:set', { name: name.value }));
        opts.onDone(r.author);
      } catch (e) { f.setError(e.message); name.focus(); }
    } }, f.el, go);

    const root = h('div', { class: 'auth' },
      h('div', { class: 'titlebar' }),
      h('div', { class: 'auth-main' },
        h('section', { class: 'auth-art' },
          h('div', { class: 'auth-brand' }, G.logo(44), h('div', { class: 'px-by' }, G.px('PETRICORP', 2))),
          h('div', { class: 'auth-title' }, G.px('GRAFEMA', 8)),
          h('p', { class: 'auth-tag' }, 'Un escritorio para escribir novelas, guiones y relatos de suspenso: manuscrito, biblia de la historia y mapa de ideas en un solo lugar.'),
          h('div', { class: 'auth-img' }),
          h('p', { class: 'auth-priv' }, G.icon('shield', 16), 'Tus textos se guardan solo en este equipo. Nada se sube a la nube.')),
        h('section', { class: 'auth-panel scroll' },
          h('div', { class: 'auth-card' },
            h('div', { class: 'col gap-4' }, h('h1', { class: 't-title' }, 'Bienvenido a Grafema'), h('p', { class: 'muted' }, 'Antes de empezar, dinos quién firma las historias.')),
            form))));
    G.$('.auth-img', root).innerHTML = G.art.hero('auth');
    setTimeout(() => name.focus(), 0);
    return root;
  };
})();
