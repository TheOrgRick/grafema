/* Grafema — controlador: estructura, navegación, tema y tamaño configurable. */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const MIN_W = 640, MIN_H = 480, DEF_W = 1280, DEF_H = 800;
  const NAV = [
    { id: 'home', label: 'Inicio', icon: 'home' },
    { id: 'editor', label: 'Manuscrito', icon: 'doc', project: true },
    { id: 'bible', label: 'Biblia del proyecto', short: 'Biblia', icon: 'book', project: true },
    { id: 'map', label: 'Mapa de ideas', short: 'Mapa', icon: 'network', project: true },
    { id: 'export', label: 'Exportar', icon: 'export', project: true },
  ];
  let shell = null, navToken = 0, follow = true;

  // ---------- Tamaño configurable ----------
  function setSize(w, hgt) {
    // En Android la app ocupa siempre la pantalla real (sin el ancho mínimo de escritorio).
    if (G.isAndroid) { w = window.innerWidth || 360; hgt = window.innerHeight || 640; }
    w = G.clamp(Math.round(Number(w) || DEF_W), G.isAndroid ? 280 : MIN_W, 7680);
    hgt = G.clamp(Math.round(Number(hgt) || DEF_H), G.isAndroid ? 320 : MIN_H, 4320);
    G.root.style.setProperty('--app-w', w + 'px');
    G.root.style.setProperty('--app-h', hgt + 'px');
    G.root.classList.toggle('bp-sm', w < 900);
    G.root.classList.toggle('bp-xs', w < 720);
    G.state.size = { width: w, height: hgt };
    if (shell) syncNav();
    return G.state.size;
  }

  // ---------- Tema ----------
  G.applyTheme = function applyTheme() {
    const c = G.state.config || {};
    const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = c.theme === 'light' ? 'light' : c.theme === 'system' ? (sysDark ? 'dark' : 'light') : 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.paper = c.paper === 'light' ? 'light' : c.paper === 'dark' ? 'dark' : theme;
    G.root.classList.toggle('mat', !!G.state.materialSupported && c.material && c.material !== 'none');
    document.documentElement.dataset.anim = c.animations === false ? 'off' : 'on';
    G.state.effectiveTheme = theme;
  };
  G.setConfig = async function setConfig(patch) {
    const r = await G.call('config:set', patch);
    G.state.config = r.config;
    G.applyTheme();
    document.dispatchEvent(new CustomEvent('g:config'));
    return r.config;
  };

  // ---------- Pantallas ----------
  function clearRoot() { G.clear(G.root); shell = null; }

  async function showWelcome() {
    clearRoot();
    G.state.viewInst = null; G.state.view = 'welcome';
    G.root.appendChild(h('div', { class: 'app' }, G.views.welcome({ onDone: async (author) => { G.state.config.author = author; await enterApp(); } })));
  }

  function buildShell() {
    const crumb = h('div', { class: 'crumb', hidden: true }, h('span', { class: 'ellip', id: 'crumb-text' }));
    const titlebar = h('div', { class: 'titlebar' }, h('div', { class: 'titlebar-inner' },
      h('div', { class: 'brand' }, G.logo(22), G.px('GRAFEMA', 2)), crumb));
    const nav = h('nav', { class: 'nav', 'aria-label': 'Navegación principal' });
    const view = h('main', { class: 'view', id: 'view' });
    const wrap = h('div', { class: 'shell' }, h('div', { class: 'nav-pad' }), nav, view);
    shell = { titlebar, nav, view, crumb };
    G.root.appendChild(h('div', { class: 'app' }, titlebar, wrap));
    renderNav();
  }

  function renderNav() {
    const c = G.state.config || {};
    const collapsed = !!c.navCollapsed || G.root.classList.contains('bp-sm');
    shell.nav.classList.toggle('collapsed', collapsed);
    G.clear(shell.nav);
    shell.nav.appendChild(h('button', {
      class: 'nav-item', type: 'button', 'aria-label': 'Mostrar u ocultar el panel de navegación', title: 'Mostrar u ocultar el panel',
      'aria-expanded': String(!collapsed),
      onclick: async () => { const next = !shell.nav.classList.contains('collapsed'); if (!G.root.classList.contains('bp-sm')) await G.setConfig({ navCollapsed: next }); shell.nav.classList.toggle('collapsed', next); },
    }, G.icon('menu', 20), h('span', { class: 'nav-label' }, 'Navegación')));
    for (const n of NAV) {
      const disabled = n.project && !G.state.project;
      shell.nav.appendChild(h('button', {
        class: 'nav-item' + (G.state.view === n.id ? ' active' : ''), type: 'button', 'data-nav': n.id, disabled,
        title: disabled ? 'Abre un proyecto para usar esta sección' : n.label, 'aria-current': G.state.view === n.id ? 'page' : null,
        onclick: () => G.go(n.id),
      }, G.icon(n.icon, 20), h('span', { class: 'nav-label' }, G.isAndroid && n.short ? n.short : n.label)));
    }
    shell.nav.appendChild(h('div', { class: 'nav-sep' }));
    shell.nav.appendChild(h('button', { class: 'nav-item' + (G.state.view === 'settings' ? ' active' : ''), type: 'button', 'data-nav': 'settings', title: 'Ajustes', onclick: () => G.go('settings') }, G.icon('sliders', 20), h('span', { class: 'nav-label' }, 'Ajustes')));
    syncCrumb();
  }
  function syncNav() { if (shell) renderNav(); }
  function syncCrumb() {
    if (!shell) return;
    const p = G.state.project;
    shell.crumb.hidden = !p;
    if (p) G.$('#crumb-text', shell.crumb).textContent = p.name;
  }
  G.refreshShell = () => { syncNav(); };

  // ---------- Navegación ----------
  G.go = async function go(view, params) {
    if (!shell) return;
    if (NAV.find((n) => n.id === view && n.project) && !G.state.project) view = 'home';
    const token = ++navToken;
    if (G.state.viewInst) {
      const ok = await G.flushAll();
      if (!ok) {
        const leave = await G.confirm({ title: 'No se pudieron guardar los cambios', message: 'Hay cambios pendientes que no se guardaron (por ejemplo, por falta de espacio o permisos). Si sales ahora podrías perderlos.', confirmLabel: 'Salir de todos modos', cancelLabel: 'Quedarme', danger: true });
        if (!leave) return;
      }
      if (token !== navToken) return;
      try { G.state.viewInst.destroy && G.state.viewInst.destroy(); } catch (e) { console.error(e); }
      G.state.viewInst = null;
    }
    G.state.view = view;
    G.clear(shell.view);
    renderNav();
    shell.view.appendChild(h('div', { class: 'loading' }, h('div', { class: 'spinner' })));
    try {
      const fn = G.views[view];
      const container = h('div', { class: 'view-in' });
      const inst = await fn(container, params || {});
      if (token !== navToken) { if (inst && inst.destroy) inst.destroy(); return; }
      G.clear(shell.view);
      shell.view.appendChild(container);
      G.state.viewInst = inst || null;
      if (inst && inst.afterMount) inst.afterMount();
    } catch (e) {
      console.error(e);
      G.clear(shell.view);
      shell.view.appendChild(h('div', { class: 'empty' }, G.icon('warn', 32), h('div', { class: 'strong' }, 'No se pudo abrir esta sección'), h('div', {}, G.errMsg(e)),
        h('button', { class: 'btn', type: 'button', onclick: () => G.go('home') }, 'Volver al inicio')));
    }
  };

  G.openProject = async function openProject(id, view) {
    const r = await G.call('project:load', { id });
    G.state.project = r.project;
    syncCrumb();
    await G.go(view || 'editor');
  };
  // Muestra el resultado de importar un .grafema y abre el proyecto importado.
  G.afterImport = async function afterImport(r) {
    if (!r || !r.ok) { G.toast((r && r.message) || 'No se pudo importar el proyecto.', { kind: 'err' }); return; }
    if (!G.state.config || !G.state.config.author) return;
    G.toast('Proyecto «' + r.project.name + '» importado.' + (r.warnings && r.warnings.length ? ' ' + r.warnings[0] : ''), { kind: r.warnings && r.warnings.length ? 'warn' : 'ok', ms: 5000 });
    await G.openProject(r.project.id, 'editor');
  };
  G.closeProject = async function closeProject() { G.state.project = null; syncCrumb(); await G.go('home'); };
  G.updateProject = async function updateProject(patch) {
    const r = await G.call('project:update', { id: G.state.project.id, patch });
    G.state.project = r.project;
    syncCrumb();
    return r.project;
  };

  async function enterApp() {
    G.state.user = { name: G.state.config.author || '' };
    G.state.project = null;
    clearRoot();
    buildShell();
    G.fontsPromise = G.call('fonts:list').then((r) => { G.state.fonts = r.fonts; return r.fonts; }).catch(() => { G.state.fonts = []; return []; });
    await G.go('home');
  }
  // Cambiar el nombre del autor (desde Ajustes).
  G.setAuthor = async function setAuthor(name) {
    const r = await G.call('author:set', { name });
    G.state.config = r.config; G.state.user = { name: r.author };
    document.dispatchEvent(new CustomEvent('g:config'));
    return r.author;
  };

  // ---------- Arranque ----------
  async function boot() {
    try {
      if (!window.grafema) throw new Error('Esta interfaz debe abrirse dentro de la aplicación Grafema.');
      G.state.config = (await G.call('config:get')).config;
      try { const info = await G.call('app:info'); G.state.materialSupported = !!info.materialSupported; G.state.info = info; } catch (_) { /* noop */ }
      G.applyTheme();
      if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (G.state.config.theme === 'system') G.applyTheme(); });
      window.grafema.on('app:request-flush', async () => { try { await G.flushAll(); } finally { try { await window.grafema.invoke('app:flushed'); } catch (_) { /* noop */ } } });
      window.grafema.on('spell:status', (d) => { G.state.spell = d; document.dispatchEvent(new CustomEvent('g:spell')); });
      if (G.state.config.author) await enterApp(); else await showWelcome();
      // Proyecto .grafema abierto con doble clic: se importó al arrancar o llega con la aplicación ya abierta.
      window.grafema.on('project:opened-file', (r) => G.afterImport(r));
      try { const pend = await window.grafema.invoke('app:pendingFile'); if (pend && pend.result) G.afterImport(pend.result); } catch (_) { /* noop */ }
    } catch (e) {
      console.error(e);
      clearRoot();
      G.root.appendChild(h('div', { class: 'empty', style: { height: '100%' } }, G.icon('warn', 36), h('div', { class: 't-sub' }, 'Grafema no pudo iniciar'), h('div', {}, G.errMsg(e)),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { clearRoot(); boot(); } }, 'Reintentar')));
    }
  }

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  window.GrafemaApp = {
    // Parámetros: width y height en píxeles (por defecto 1280 × 800).
    mount(container, opts) {
      opts = opts || {};
      G.root = container;
      follow = opts.follow !== false;
      setSize(opts.width || DEF_W, opts.height || DEF_H);
      if (follow || G.isAndroid) window.addEventListener('resize', () => setSize(window.innerWidth, window.innerHeight));
      return boot();
    },
    setSize,
  };

  document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(location.search);
    GrafemaApp.mount(document.getElementById('app-root'), { width: parseInt(q.get('w'), 10) || window.innerWidth || DEF_W, height: parseInt(q.get('h'), 10) || window.innerHeight || DEF_H, follow: q.get('fixed') !== '1' });
  });
})();
