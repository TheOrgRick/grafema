/* Grafema — Ajustes y Cuenta. */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const LANGS = [['es-MX', 'Español (México)'], ['es-ES', 'Español (España)'], ['es-419', 'Español (Latinoamérica)'], ['en-US', 'Inglés (EE. UU.)'], ['en-GB', 'Inglés (Reino Unido)'], ['fr', 'Francés'], ['pt-BR', 'Portugués (Brasil)'], ['it', 'Italiano'], ['de', 'Alemán']];
  const section = (title, desc, ...body) => h('section', { class: 'st-sec dotted-b' }, h('div', { class: 'st-side' }, h('h2', { class: 'strong' }, title), desc ? h('p', { class: 'hint' }, desc) : null), h('div', { class: 'st-body col gap-16' }, ...body));

  G.views.settings = async function settingsView(container) {
    const cfg = G.state.config;
    let info = G.state.info || {};
    try { info = await G.call('app:info'); G.state.info = info; } catch (_) { /* noop */ }
    if (!G.state.fonts && G.fontsPromise) await G.fontsPromise;
    const fonts = G.state.fonts || [];

    // ---- autor
    const authorIn = h('input', { class: 'input', type: 'text', maxlength: 80, value: cfg.author || '', placeholder: 'Nombre del autor' });
    const fAuthor = G.field('Nombre del autor', authorIn, { hint: 'Aparece como autor en los PDF y en los documentos .docx que exportes.' });
    const authorBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      fAuthor.setError('');
      if (!authorIn.value.trim()) { fAuthor.setError('Escribe el nombre del autor.'); authorIn.focus(); return; }
      try { const n = await G.withBusy(authorBtn, () => G.setAuthor(authorIn.value)); authorIn.value = n; G.toast('Autor actualizado: ' + n, { kind: 'ok' }); } catch (e) { fAuthor.setError(e.message); }
    } }, 'Guardar autor');
    authorIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); authorBtn.click(); } });

    // ---- apariencia
    const theme = G.seg([{ value: 'dark', label: 'Oscuro', icon: 'moon' }, { value: 'light', label: 'Claro', icon: 'sun' }, { value: 'system', label: 'Sistema' }], cfg.theme, (v) => G.setConfig({ theme: v }), 'Tema');
    const matOk = !!info.materialSupported;
    const mat = G.seg([{ value: 'mica', label: 'Mica' }, { value: 'acrylic', label: 'Acrílico' }, { value: 'none', label: 'Sólido' }], matOk ? cfg.material : 'none', (v) => G.setConfig({ material: v }), 'Material de la ventana');
    if (!matOk) G.$$('.seg-btn', mat).forEach((b) => { b.disabled = true; });
    const anim = G.switch({ checked: cfg.animations !== false, label: cfg.animations !== false ? 'Activadas' : 'Desactivadas', onChange: (on) => { G.setConfig({ animations: on }); G.$('.sw-label', anim.el).textContent = on ? 'Activadas' : 'Desactivadas'; } });
    anim.input.setAttribute('aria-label', 'Animaciones de la interfaz');
    const paper = G.seg([{ value: 'auto', label: 'Automático' }, { value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }], cfg.paper, (v) => G.setConfig({ paper: v }), 'Papel del editor');

    // ---- tamaño
    const cur = G.state.size || { width: 1280, height: 800 };
    const wIn = h('input', { class: 'input', type: 'number', min: 640, max: 7680, step: 10, value: String(cur.width), 'aria-label': 'Ancho en píxeles' });
    const hIn = h('input', { class: 'input', type: 'number', min: 480, max: 4320, step: 10, value: String(cur.height), 'aria-label': 'Alto en píxeles' });
    const fW = G.field('Ancho (px)', wIn), fH = G.field('Alto (px)', hIn);
    const sizeNow = h('span', { class: 'hint' });
    const syncNow = () => { const s = G.state.size; sizeNow.textContent = `Tamaño actual: ${s.width} × ${s.height} px`; };
    syncNow();
    async function applySize(w, hh) {
      fW.setError(''); fH.setError('');
      if (!(w >= 640 && w <= 7680)) { fW.setError('El ancho debe estar entre 640 y 7680 px.'); return; }
      if (!(hh >= 480 && hh <= 4320)) { fH.setError('El alto debe estar entre 480 y 4320 px.'); return; }
      try {
        let r;
        try { r = await G.call('window:setSize', { width: w, height: hh }); } catch (e) {
          if (e.code !== 'UNKNOWN_CHANNEL') throw e;
          window.GrafemaApp.setSize(w, hh); await G.setConfig({ window: { width: w, height: hh } }); r = { width: w, height: hh };
        }
        wIn.value = r.width; hIn.value = r.height;
        setTimeout(syncNow, 150);
        G.toast(r.limited ? `Se ajustó a ${r.width} × ${r.height} px porque tu pantalla no admite más.` : `Tamaño aplicado: ${r.width} × ${r.height} px.`, { kind: r.limited ? 'info' : 'ok' });
      } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }
    document.addEventListener('g:config', syncNow);

    // ---- texto base para proyectos nuevos
    const d = G.state.config.defaults || { font: 'Times New Roman', size: 12, lh: 1.5 };
    const font = h('select', { class: 'select' }, [...new Set([d.font, ...fonts])].map((f) => h('option', { value: f, selected: f === d.font }, f)));
    const fsize = h('input', { class: 'input', type: 'number', step: '0.5', min: 6, max: 72, value: String(d.size), 'aria-label': 'Tamaño' });
    const lh = h('select', { class: 'select' }, [1, 1.15, 1.5, 2].map((v) => h('option', { value: String(v), selected: v === d.lh }, String(v).replace('.', ','))));
    if (![1, 1.15, 1.5, 2].includes(d.lh)) lh.appendChild(h('option', { value: String(d.lh), selected: true }, String(d.lh)));
    const saveDefaults = async () => { const sz = parseFloat(fsize.value); if (!(sz >= 6 && sz <= 72)) { G.toast('El tamaño debe estar entre 6 y 72 pt.', { kind: 'err' }); return; } await G.setConfig({ defaults: { font: font.value, size: sz, lh: parseFloat(lh.value) } }); G.toast('Guardado. Se usará en los proyectos nuevos.', { kind: 'ok', ms: 2500 }); };
    [font, fsize, lh].forEach((el) => el.addEventListener('change', saveDefaults));

    // ---- corrector
    const selLangs = new Set(cfg.spell || []);
    const spellMsg = h('p', { class: 'hint', 'aria-live': 'polite' });
    const langBox = h('div', { class: 'grid2' }, LANGS.map(([code, name]) => { const cb = h('input', { type: 'checkbox', checked: selLangs.has(code) }); cb.addEventListener('change', async () => {
      if (cb.checked && selLangs.size >= 4) { cb.checked = false; G.toast('Puedes activar hasta 4 idiomas a la vez.', { kind: 'info' }); return; }
      cb.checked ? selLangs.add(code) : selLangs.delete(code);
      try { let r; try { r = await G.call('spell:setLanguages', { languages: [...selLangs] }); } catch (e) { if (e.code !== 'UNKNOWN_CHANNEL') throw e; } await G.setConfig({ spell: [...selLangs] }); spellMsg.textContent = selLangs.size ? 'Activo: ' + [...selLangs].join(', ') + '. La primera vez se descarga el diccionario de internet; después funciona sin conexión.' : 'Corrector desactivado.'; } catch (e) { G.toast(e.message, { kind: 'err' }); }
    }); return h('label', { class: 'check' }, cb, h('span', {}, name)); }));
    spellMsg.textContent = selLangs.size ? 'Activo: ' + [...selLangs].join(', ') + '.' : 'Corrector desactivado.';

    container.className = 'st scroll';
    container.append(
      h('div', { class: 'st-head' }, h('h1', { class: 't-title' }, 'Ajustes'), h('p', { class: 'muted' }, 'Personaliza Grafema a tu gusto. Todo se guarda en este equipo.')),
      section('Autor', 'Es el único dato personal que pide Grafema. No hay cuentas ni contraseñas.', fAuthor.el, h('div', {}, authorBtn)),
      section('Apariencia', 'El material Mica o Acrílico da el efecto translúcido de Windows 11.', G.field('Tema', theme).el, G.field('Material de la ventana', mat, { hint: matOk ? 'Se aplica a la barra superior y al panel lateral.' : 'No disponible: requiere Windows 11. Se usa un fondo sólido.' }).el, G.field('Color del papel en el editor', paper).el, G.field('Animaciones', anim.el, { hint: 'Transiciones suaves al cambiar de sección y al abrir paneles. Desactívalas si notas lentitud: la app se vuelve más ligera. También se apagan solas si Windows tiene desactivados los efectos de animación.' }).el),
      G.isAndroid ? null : section('Tamaño de la interfaz', 'La aplicación se adapta a las medidas que elijas. Si el contenido no cabe, aparecen barras de desplazamiento.',
        h('div', { class: 'grid2' }, fW.el, fH.el), sizeNow,
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', type: 'button', onclick: () => applySize(parseInt(wIn.value, 10), parseInt(hIn.value, 10)) }, 'Aplicar tamaño'),
          [[1280, 800], [1024, 700], [1600, 900]].map(([w, hh]) => h('button', { class: 'btn ghost', type: 'button', onclick: () => applySize(w, hh) }, `${w} × ${hh}`)),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => applySize(1280, 800) }, 'Restablecer'))),
      section('Texto para proyectos nuevos', 'Fuente, tamaño e interlineado con los que empieza cada manuscrito. Se cambian por proyecto en Manuscrito › Página.',
        G.field('Fuente (tipos instalados en tu equipo)', font).el, h('div', { class: 'grid2' }, G.field('Tamaño (pt)', fsize).el, G.field('Interlineado', lh).el)),
      G.isAndroid ? null : section('Corrector ortográfico', 'Subraya las palabras mal escritas y sugiere correcciones con clic derecho. También puedes agregar palabras a tu diccionario.', langBox, spellMsg),
      section('Datos y privacidad', 'Nada se sube a la nube: tu cuenta, tus proyectos y tu biblia viven solo en esta computadora.',
        h('div', { class: 'field' }, h('label', {}, 'Carpeta de datos'), h('code', { class: 'path' }, info.dataDir || '—')),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn', type: 'button', onclick: () => G.call('shell:openData').catch((e) => G.toast(e.message, { kind: 'err' })) }, G.icon('folder', 16), 'Abrir carpeta de datos')),
        h('p', { class: 'hint' }, 'Para una copia de seguridad, copia esa carpeta completa a un disco externo.')),
      section('Acerca de', null, h('div', { class: 'row gap-16' }, G.logo(48), h('div', { class: 'col' }, h('div', { class: 'strong' }, 'Grafema ' + (info.version || '1.2.0')), h('div', { class: 'muted' }, 'by Petricorp · Escritorio para escritores')))),
      h('div', { style: { height: '32px' } }));
    return { destroy() { document.removeEventListener('g:config', syncNow); } };
  };

})();
