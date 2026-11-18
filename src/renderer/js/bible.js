/* Grafema — Biblia del proyecto: perfiles de personajes, objetos, ciudades, lugares, sistemas, etc. */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;
  const TYPE_COLORS = ['#FFD712', '#5BD68A', '#6CB6FF', '#FF8A65', '#C792EA', '#F06292', '#4DD0E1', '#B3B3B3', '#D4B40F', '#A1887F'];
  const KINDS = [['short', 'Texto corto'], ['long', 'Texto largo'], ['number', 'Número'], ['date', 'Fecha o época (libre)'], ['list', 'Lista de opciones'], ['tags', 'Etiquetas'], ['image', 'Imagen'], ['check', 'Casilla (sí / no)'], ['relation', 'Relación con otros perfiles']];
  G.TYPE_COLORS = TYPE_COLORS;

  const F = (label, kind, extra) => Object.assign({ label, kind }, extra || {});
  const TEMPLATES = [
    ['Personaje', 0, 'user', [F('Nombre completo', 'short'), F('Alias o apodo', 'short'), F('Edad', 'number'), F('Rol en la historia', 'list', { options: ['Protagonista', 'Antagonista', 'Aliado', 'Mentor', 'Interés romántico', 'Secundario', 'Otro'] }), F('Ocupación', 'short'), F('Apariencia', 'long'), F('Personalidad', 'long'), F('Motivación o deseo', 'long'), F('Miedos y defectos', 'long'), F('Secreto', 'long'), F('Historia previa', 'long'), F('Arco del personaje', 'long'), F('Relaciones', 'relation'), F('Etiquetas', 'tags'), F('Imagen de referencia', 'image'), F('Notas', 'long')]],
    ['Objeto', 8, 'cube', [F('Tipo de objeto', 'short'), F('Descripción', 'long'), F('Origen e historia', 'long'), F('Propietario actual', 'relation'), F('Ubicación actual', 'relation'), F('Propiedades o poderes', 'long'), F('Importancia en la trama', 'long'), F('Imagen', 'image'), F('Notas', 'long')]],
    ['Ciudad', 2, 'pin', [F('País o región', 'short'), F('Población', 'number'), F('Clima', 'short'), F('Gobierno', 'short'), F('Economía', 'long'), F('Cultura y costumbres', 'long'), F('Historia', 'long'), F('Lugares importantes', 'relation'), F('Habitantes notables', 'relation'), F('Conflictos y amenazas', 'long'), F('Imagen', 'image'), F('Notas', 'long')]],
    ['Lugar', 1, 'flag', [F('Ubicación (ciudad o región)', 'relation'), F('Tipo de lugar', 'list', { options: ['Interior', 'Exterior', 'Edificio', 'Naturaleza', 'Vehículo', 'Otro'] }), F('Descripción sensorial', 'long'), F('Atmósfera', 'short'), F('Importancia en la trama', 'long'), F('Quién lo frecuenta', 'relation'), F('Imagen', 'image'), F('Notas', 'long')]],
    ['Sistema', 4, 'key', [F('Categoría', 'list', { options: ['Magia', 'Tecnología', 'Política', 'Religión', 'Economía', 'Sociedad', 'Otro'] }), F('Cómo funciona', 'long'), F('Reglas', 'long'), F('Límites y costos', 'long'), F('Quién lo usa', 'relation'), F('Origen', 'long'), F('Consecuencias en la trama', 'long'), F('Notas', 'long')]],
    ['Facción', 3, 'shield', [F('Tipo', 'short'), F('Objetivo', 'long'), F('Líder', 'relation'), F('Miembros', 'relation'), F('Aliados y enemigos', 'relation'), F('Recursos', 'long'), F('Historia', 'long'), F('Notas', 'long')]],
    ['Evento', 5, 'clock', [F('Fecha o época', 'date'), F('Lugar', 'relation'), F('Participantes', 'relation'), F('Qué ocurre', 'long'), F('Consecuencias', 'long'), F('Capítulo relacionado', 'short'), F('Notas', 'long')]],
    ['Pista', 9, 'search', [F('Descripción', 'long'), F('Dónde se encuentra', 'relation'), F('Quién la encuentra', 'relation'), F('Qué sugiere', 'long'), F('¿Es una pista falsa?', 'check'), F('Se revela en el capítulo', 'short'), F('Notas', 'long')]],
    ['Sospechoso', 6, 'user', [F('Relación con la víctima', 'short'), F('Móvil', 'long'), F('Medios', 'long'), F('Oportunidad', 'long'), F('Coartada', 'relation'), F('Secretos', 'long'), F('¿Es el culpable?', 'check'), F('Notas', 'long')]],
    ['Coartada', 7, 'note', [F('Sospechoso', 'relation'), F('Descripción', 'long'), F('Testigos', 'relation'), F('Puntos débiles', 'long'), F('¿Verificada?', 'check'), F('Notas', 'long')]],
    ['En blanco', 7, 'tag', [F('Descripción', 'long'), F('Notas', 'long')]],
  ];
  G.bibleDefaults = function bibleDefaults() {
    return { version: 1, types: TEMPLATES.map(([name, c, icon, fields]) => ({ id: G.uid(), name, color: TYPE_COLORS[c], icon, fields: fields.map((f) => Object.assign({ id: G.uid() }, f)) })), profiles: [] };
  };

  function normalize(d) {
    d.types = (d.types || []).filter((t) => t && t.id).map((t) => Object.assign({ name: 'Tipo', color: TYPE_COLORS[0], icon: 'tag' }, t, { fields: (t.fields || []).filter((f) => f && f.id) }));
    const ids = new Set(d.types.map((t) => t.id));
    d.profiles = (d.profiles || []).filter((p) => p && p.id && ids.has(p.typeId)).map((p) => Object.assign({ name: '', values: {}, created: new Date().toISOString(), updated: new Date().toISOString() }, p, { values: p.values && typeof p.values === 'object' ? p.values : {} }));
    return d;
  }

  G.views.bible = async function bibleView(container, params) {
    const pid = G.state.project.id;
    let data = (await G.call('bible:read', { projectId: pid })).data;
    let seeded = false;
    if (!data) { data = G.bibleDefaults(); seeded = true; }
    data = normalize(data);
    let sel = { typeId: 'all', profileId: params && params.select && data.profiles.some((p) => p.id === params.select) ? params.select : null }, query = '';
    if (sel.profileId) sel.typeId = data.profiles.find((p) => p.id === sel.profileId).typeId;

    const stateEl = h('span', { class: 'dim', 'aria-live': 'polite' });
    const saver = G.saver(async () => { await G.call('bible:write', { projectId: pid, data }); }, 700, (s, e) => { stateEl.textContent = s === 'saving' ? 'Guardando…' : s === 'dirty' ? 'Cambios sin guardar' : s === 'error' ? 'Error al guardar: ' + G.errMsg(e) : 'Guardado'; stateEl.style.color = s === 'error' ? 'var(--danger)' : ''; });
    if (seeded) { saver.touch(); }
    const typeById = (id) => data.types.find((t) => t.id === id);
    const profById = (id) => data.profiles.find((p) => p.id === id);
    const nameOf = (p) => p.name.trim() || 'Sin nombre';
    const now = () => new Date().toISOString();

    const colTypes = h('aside', { class: 'bb-types', 'aria-label': 'Tipos de perfil' });
    const colList = h('section', { class: 'bb-list', 'aria-label': 'Perfiles' });
    const colEdit = h('section', { class: 'bb-edit scroll', 'aria-label': 'Ficha del perfil' });
    container.className = 'bb';
    container.append(colTypes, colList, colEdit);

    // ------------------------------------------------------------ tipos
    function renderTypes() {
      G.clear(colTypes);
      colTypes.append(
        h('div', { class: 'bb-head' }, h('h2', { class: 'strong' }, 'Tipos de perfil')),
        h('div', { class: 'bb-types-list scroll' },
          h('button', { class: 'bb-type' + (sel.typeId === 'all' ? ' active' : ''), type: 'button', onclick: () => { sel.typeId = 'all'; renderAll(); } }, G.icon('grid', 16), h('span', { class: 'grow ellip' }, 'Todos'), h('span', { class: 'dim' }, String(data.profiles.length))),
          data.types.map((t) => h('button', { class: 'bb-type' + (sel.typeId === t.id ? ' active' : ''), type: 'button', onclick: () => { sel.typeId = t.id; renderAll(); } },
            h('span', { class: 'tdot', style: { background: t.color } }), h('span', { class: 'grow ellip' }, t.name), h('span', { class: 'dim' }, String(data.profiles.filter((p) => p.typeId === t.id).length))))),
        h('div', { class: 'bb-foot' }, h('button', { class: 'btn sm block', type: 'button', onclick: () => editTemplate(null) }, G.icon('plus', 14), 'Nuevo tipo de perfil'), h('div', { style: { marginTop: '8px' } }, stateEl)));
    }

    // ------------------------------------------------------------ lista
    const searchIn = h('input', { class: 'input sm', type: 'search', placeholder: 'Buscar en la biblia…', 'aria-label': 'Buscar perfiles' });
    searchIn.addEventListener('input', () => { query = searchIn.value.trim().toLowerCase(); renderListItems(); });
    const listBox = h('div', { class: 'bb-items scroll', role: 'list' });
    const listTitle = h('h2', { class: 'strong grow ellip' });
    const newBtn = h('button', { class: 'btn sm primary', type: 'button', onclick: () => newProfile() }, G.icon('plus', 14), 'Nuevo');
    const tmplBtn = h('button', { class: 'ibtn sm', type: 'button', title: 'Editar la plantilla de este tipo', 'aria-label': 'Editar la plantilla de este tipo', onclick: () => editTemplate(typeById(sel.typeId)) }, G.icon('sliders', 16));
    const typeFilter = h('select', { class: 'select sm bb-typesel', 'aria-label': 'Filtrar por tipo' });
    typeFilter.addEventListener('change', () => { sel.typeId = typeFilter.value; renderAll(); });
    colList.append(h('div', { class: 'bb-head' }, listTitle, typeFilter, tmplBtn, newBtn), h('div', { class: 'bb-search' }, searchIn), listBox);
    function haystack(p) {
      let s = p.name.toLowerCase();
      for (const v of Object.values(p.values)) { if (typeof v === 'string') s += ' ' + v.toLowerCase(); else if (Array.isArray(v)) s += ' ' + v.filter((x) => typeof x === 'string').join(' ').toLowerCase(); }
      return s;
    }
    function avatar(p, t) {
      const img = firstImage(p, t);
      return img ? h('img', { class: 'av', src: img, alt: '' }) : h('span', { class: 'av ini', style: { background: t.color } }, nameOf(p).charAt(0).toUpperCase());
    }
    function firstImage(p, t) { const f = t.fields.find((x) => x.kind === 'image' && p.values[x.id]); return f ? p.values[f.id] : null; }
    function summary(p, t) { const f = t.fields.find((x) => (x.kind === 'short' || x.kind === 'list') && p.values[x.id]); return f ? p.values[f.id] : (t.name); }
    function renderListItems() {
      G.clear(listBox);
      const t = sel.typeId === 'all' ? null : typeById(sel.typeId);
      const items = data.profiles.filter((p) => (!t || p.typeId === t.id) && (!query || haystack(p).includes(query))).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'es', { sensitivity: 'base' }));
      if (!items.length) {
        listBox.appendChild(h('div', { class: 'empty' }, h('div', { class: 'strong' }, query ? 'Sin resultados' : t ? `Aún no hay ${t.name.toLowerCase()}s` : 'La biblia está vacía'),
          h('p', {}, query ? 'Prueba con otra palabra.' : 'Crea el primer perfil para empezar a ordenar tu historia.'), query ? null : h('button', { class: 'btn sm primary', type: 'button', onclick: () => newProfile() }, G.icon('plus', 14), 'Crear perfil')));
        return;
      }
      for (const p of items) {
        const pt = typeById(p.typeId);
        listBox.appendChild(h('button', { class: 'bb-item' + (sel.profileId === p.id ? ' active' : ''), type: 'button', role: 'listitem', 'data-id': p.id, onclick: () => { sel.profileId = p.id; renderList(); renderEditor(); } },
          avatar(p, pt), h('div', { class: 'col grow', style: { minWidth: 0 } }, h('span', { class: 'strong ellip' }, nameOf(p)), h('span', { class: 'dim ellip' }, (sel.typeId === 'all' ? pt.name + ' · ' : '') + String(summary(p, pt)).slice(0, 60)))));
      }
    }
    function renderList() {
      const t = sel.typeId === 'all' ? null : typeById(sel.typeId);
      listTitle.textContent = t ? t.name : 'Perfiles';
      G.clear(typeFilter); typeFilter.append(h('option', { value: 'all' }, 'Todos'), data.types.map((x) => h('option', { value: x.id }, x.name))); typeFilter.value = sel.typeId;
      tmplBtn.hidden = !t;
      newBtn.lastChild.textContent = t ? 'Nuevo ' + t.name.toLowerCase() : 'Nuevo perfil';
      renderListItems();
    }

    // ------------------------------------------------------------ acciones
    function newProfile() {
      const make = (t) => {
        const p = { id: G.uid(), typeId: t.id, name: '', values: {}, created: now(), updated: now() };
        data.profiles.push(p); sel.typeId = sel.typeId === 'all' ? 'all' : t.id; sel.profileId = p.id; saver.touch(); renderAll();
        const n = G.$('.bb-name', colEdit); if (n) n.focus();
      };
      if (sel.typeId !== 'all') return make(typeById(sel.typeId));
      G.menu(newBtn, data.types.map((t) => ({ label: t.name, onClick: () => make(t) })), { align: 'right' });
    }
    function touch(p) { p.updated = now(); saver.touch(); }
    const refreshList = G.debounce(() => { renderTypes(); renderListItems(); }, 120);
    async function deleteProfile(p) {
      if (!(await G.confirm({ title: 'Eliminar «' + nameOf(p) + '»', message: 'Se eliminará este perfil y sus vínculos con otros perfiles. También desaparecerá del mapa de ideas.', confirmLabel: 'Eliminar perfil', danger: true }))) return;
      data.profiles = data.profiles.filter((x) => x.id !== p.id);
      for (const o of data.profiles) { const ot = typeById(o.typeId); for (const f of ot.fields) if (f.kind === 'relation' && Array.isArray(o.values[f.id])) o.values[f.id] = o.values[f.id].filter((id) => id !== p.id); }
      sel.profileId = null; saver.touch(); renderAll();
    }
    function duplicateProfile(p) {
      const c = JSON.parse(JSON.stringify(p)); c.id = G.uid(); c.name = nameOf(p) + ' (copia)'; c.created = c.updated = now();
      data.profiles.push(c); sel.profileId = c.id; saver.touch(); renderAll();
    }

    // ------------------------------------------------------------ ficha
    function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 520) + 'px'; }
    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        if (!file || !/^image\//.test(file.type)) return reject(new Error('Elige un archivo de imagen (PNG, JPG, WebP…).'));
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        fr.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error('La imagen está dañada o no es compatible.'));
          img.onload = () => {
            const k = Math.min(1, 560 / Math.max(img.width, img.height));
            const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL('image/jpeg', 0.85));
          };
          img.src = fr.result;
        };
        fr.readAsDataURL(file);
      });
    }
    function linkPicker(btn, p, f) {
      G.togglePopover(btn, (close) => {
        const cur = new Set(p.values[f.id] || []);
        const search = h('input', { class: 'input sm', type: 'search', placeholder: 'Buscar perfil…', 'aria-label': 'Buscar perfil para vincular' });
        const list = h('div', { class: 'pick-list' });
        const fill = () => {
          const q = search.value.trim().toLowerCase(); G.clear(list);
          const items = data.profiles.filter((x) => x.id !== p.id && !cur.has(x.id) && (!f.target || x.typeId === f.target) && (!q || nameOf(x).toLowerCase().includes(q))).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'es'));
          if (!items.length) list.appendChild(h('div', { class: 'dim', style: { padding: '8px' } }, q ? 'Sin resultados.' : 'No hay más perfiles para vincular. Crea otros perfiles primero.'));
          items.slice(0, 200).forEach((x) => { const xt = typeById(x.typeId); list.appendChild(h('button', { class: 'menu-item', type: 'button', onclick: () => { p.values[f.id] = [...(p.values[f.id] || []), x.id]; touch(p); close(); renderEditor(); } }, h('span', { class: 'tdot', style: { background: xt.color } }), h('span', { class: 'grow ellip' }, nameOf(x)), h('span', { class: 'dim' }, xt.name))); });
        };
        search.addEventListener('input', fill); fill(); setTimeout(() => search.focus(), 0);
        return h('div', { class: 'col gap-4', style: { width: '280px' } }, search, list);
      }, { restoreFocus: false });
    }
    function fieldControl(p, f) {
      const v = p.values[f.id];
      const set = (val) => { p.values[f.id] = val; touch(p); refreshList(); };
      switch (f.kind) {
        case 'long': { const ta = h('textarea', { class: 'textarea', rows: 3, spellcheck: 'true', lang: 'es' }, typeof v === 'string' ? v : ''); ta.addEventListener('input', () => { set(ta.value); autosize(ta); }); requestAnimationFrame(() => autosize(ta)); return ta; }
        case 'number': { const i = h('input', { class: 'input', type: 'number', value: v == null ? '' : String(v), step: 'any' }); i.addEventListener('input', () => set(i.value === '' ? '' : Number(i.value))); return i; }
        case 'date': { const i = h('input', { class: 'input', type: 'text', maxlength: 120, placeholder: 'Ej.: 12 de marzo de 1987, Año 340 de la Era…', value: typeof v === 'string' ? v : '' }); i.addEventListener('input', () => set(i.value)); return i; }
        case 'list': { const s = h('select', { class: 'select' }, h('option', { value: '' }, '—'), (f.options || []).map((o) => h('option', { value: o, selected: v === o }, o))); if (v && !(f.options || []).includes(v)) s.appendChild(h('option', { value: v, selected: true }, v)); s.addEventListener('change', () => set(s.value)); return s; }
        case 'check': { const sw = G.switch({ checked: !!v, label: v ? 'Sí' : 'No', onChange: (c) => { set(c); lbl.textContent = c ? 'Sí' : 'No'; } }); const lbl = G.$('.sw-label', sw.el); sw.input.id = 'ck-' + f.id; return sw.el; }
        case 'tags': {
          const tags = Array.isArray(v) ? v.slice() : [];
          const wrap = h('div', { class: 'tags' });
          const input = h('input', { class: 'tag-in', type: 'text', placeholder: tags.length ? '' : 'Escribe y pulsa Enter', maxlength: 40, 'aria-label': f.label });
          const draw = () => { G.clear(wrap); tags.forEach((t, i) => wrap.appendChild(h('span', { class: 'chip' }, t, h('button', { type: 'button', 'aria-label': 'Quitar ' + t, onclick: () => { tags.splice(i, 1); set(tags.slice()); draw(); } }, G.icon('close', 12))))); wrap.appendChild(input); };
          const add = () => { const t = input.value.replace(/,/g, '').trim(); if (t && !tags.includes(t) && tags.length < 40) { tags.push(t); set(tags.slice()); } input.value = ''; draw(); input.focus(); };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); set(tags.slice()); draw(); input.focus(); } });
          input.addEventListener('blur', () => { if (input.value.trim()) add(); });
          draw(); return wrap;
        }
        case 'image': {
          const box = h('div', { class: 'img-field' });
          const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'Elegir imagen para ' + f.label });
          const draw = () => {
            G.clear(box);
            const cur = p.values[f.id];
            box.append(cur ? h('img', { class: 'img-prev', src: cur, alt: f.label }) : h('div', { class: 'img-prev none' }, G.icon('image', 28)), h('div', { class: 'col gap-4' },
              h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, cur ? 'Cambiar imagen' : 'Elegir imagen'), cur ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { set(''); draw(); } }, 'Quitar') : h('span', { class: 'dim' }, 'Se guarda dentro del proyecto.')), file);
          };
          file.addEventListener('change', async () => { try { const url = await fileToDataUrl(file.files[0]); set(url); draw(); } catch (e) { G.toast(e.message, { kind: 'err' }); } file.value = ''; });
          draw(); return box;
        }
        case 'relation': {
          const ids = (Array.isArray(v) ? v : []).filter((id) => profById(id));
          const addBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => linkPicker(addBtn, p, f) }, G.icon('link', 14), 'Vincular perfil');
          return h('div', { class: 'tags' }, ids.map((id) => { const x = profById(id), xt = typeById(x.typeId); return h('span', { class: 'chip link-chip' }, h('span', { class: 'dot', style: { background: xt.color } }), h('button', { type: 'button', class: 'chip-name', title: 'Abrir ' + nameOf(x), onclick: () => { sel.typeId = sel.typeId === 'all' ? 'all' : x.typeId; sel.profileId = x.id; renderAll(); } }, nameOf(x)), h('button', { type: 'button', 'aria-label': 'Quitar vínculo con ' + nameOf(x), onclick: () => { p.values[f.id] = ids.filter((i) => i !== id); touch(p); renderEditor(); } }, G.icon('close', 12))); }), addBtn);
        }
        default: { const i = h('input', { class: 'input', type: 'text', maxlength: 300, spellcheck: 'true', lang: 'es', value: typeof v === 'string' ? v : '' }); i.addEventListener('input', () => set(i.value)); return i; }
      }
    }
    function renderEditor() {
      G.clear(colEdit);
      const p = sel.profileId && profById(sel.profileId);
      if (!p) {
        colEdit.appendChild(h('div', { class: 'empty', style: { height: '100%' } }, (() => { const d = h('div', { style: { width: '150px', height: '150px' }, 'aria-hidden': 'true' }); d.innerHTML = G.art.cubeMini(150); return d; })(),
          h('div', { class: 't-sub' }, 'Tu biblia de la historia'), h('p', { style: { maxWidth: '380px' } }, 'Elige un perfil de la lista o crea uno nuevo. Cada tipo tiene campos que puedes cambiar con el botón de ajustes de la lista.')));
        return;
      }
      const t = typeById(p.typeId);
      const name = h('input', { class: 'bb-name', type: 'text', maxlength: 100, placeholder: 'Nombre del perfil', 'aria-label': 'Nombre del perfil', value: p.name, spellcheck: 'true' });
      name.addEventListener('input', () => { p.name = name.value; touch(p); refreshList(); });
      const typeSel = h('select', { class: 'select sm', 'aria-label': 'Tipo de perfil', style: { width: 'auto', minWidth: '140px' } }, data.types.map((x) => h('option', { value: x.id, selected: x.id === p.typeId }, x.name)));
      typeSel.addEventListener('change', async () => {
        if (!(await G.confirm({ title: 'Cambiar el tipo de perfil', message: 'Los campos con el mismo nombre se conservan; los demás quedan guardados pero ocultos hasta que vuelvas al tipo anterior.', confirmLabel: 'Cambiar tipo' }))) { typeSel.value = p.typeId; return; }
        const nt = typeById(typeSel.value);
        for (const nf of nt.fields) { if (p.values[nf.id] === undefined) { const of = t.fields.find((x) => x.label === nf.label && x.kind === nf.kind); if (of && p.values[of.id] !== undefined) p.values[nf.id] = p.values[of.id]; } }
        p.typeId = nt.id; touch(p); renderAll();
      });
      const mapBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => G.go('map', { focus: p.id }) }, G.icon('network', 14), 'Ver en el mapa');
      const more = h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Más acciones', onclick: () => G.menu(more, [{ label: 'Duplicar perfil', icon: 'copy', onClick: () => duplicateProfile(p) }, { separator: true }, { label: 'Eliminar perfil', icon: 'trash', danger: true, onClick: () => deleteProfile(p) }], { align: 'right' }) }, G.icon('more', 18));
      colEdit.appendChild(h('div', { class: 'bb-card' },
        h('div', { class: 'bb-ehead' }, avatar(p, t), h('div', { class: 'col grow gap-4', style: { minWidth: 0 } }, name, h('div', { class: 'row wrap' }, h('span', { class: 'tdot', style: { background: t.color } }), typeSel)), mapBtn, more),
        h('div', { class: 'bb-fields' }, t.fields.map((f) => {
          const ctl = fieldControl(p, f);
          const id = 'bf-' + f.id;
          const focusable = ctl.matches && ctl.matches('input,select,textarea') ? ctl : null;
          if (focusable) focusable.id = id;
          return h('div', { class: 'bb-field' + (['long', 'tags', 'relation', 'image'].includes(f.kind) ? ' wide' : '') }, h('label', { class: 'lbl', for: focusable ? id : null }, f.label), ctl);
        })),
        (() => {
          const back = data.profiles.filter((o) => o.id !== p.id && typeById(o.typeId).fields.some((f) => f.kind === 'relation' && (o.values[f.id] || []).includes(p.id)));
          if (!back.length) return null;
          return h('div', { class: 'bb-back' }, h('div', { class: 'lbl' }, 'Vinculado desde'), h('div', { class: 'tags' }, back.map((o) => h('span', { class: 'chip link-chip' }, h('span', { class: 'dot', style: { background: typeById(o.typeId).color } }), h('button', { type: 'button', class: 'chip-name', onclick: () => { sel.typeId = sel.typeId === 'all' ? 'all' : o.typeId; sel.profileId = o.id; renderAll(); } }, nameOf(o))))));
        })(),
        h('div', { class: 'dim', style: { padding: '8px 0 24px' } }, 'Creado ' + G.fmtDate(p.created) + ' · editado ' + G.fmtDate(p.updated))));
    }

    // ------------------------------------------------------------ editor de plantilla
    async function editTemplate(existing) {
      const t = existing ? JSON.parse(JSON.stringify(existing)) : { id: G.uid(), name: '', color: TYPE_COLORS[data.types.length % TYPE_COLORS.length], icon: 'tag', fields: [{ id: G.uid(), label: 'Descripción', kind: 'long' }, { id: G.uid(), label: 'Notas', kind: 'long' }] };
      const name = h('input', { class: 'input', type: 'text', maxlength: 40, value: t.name, placeholder: 'Por ejemplo: Criatura, Arma, Capítulo…', 'data-autofocus': '' });
      const fName = G.field('Nombre del tipo', name);
      const colors = h('div', { class: 'swatches', style: { gridTemplateColumns: 'repeat(10, 1fr)' } });
      const drawColors = () => { G.clear(colors); TYPE_COLORS.forEach((c) => colors.appendChild(h('button', { class: 'swatch' + (t.color === c ? ' sel' : ''), type: 'button', style: { background: c }, 'aria-label': 'Color ' + c, 'aria-pressed': String(t.color === c), onclick: () => { t.color = c; drawColors(); } }))); };
      drawColors();
      const fieldsBox = h('div', { class: 'tpl-fields' });
      const drawFields = () => {
        G.clear(fieldsBox);
        t.fields.forEach((f, i) => {
          const lab = h('input', { class: 'input sm', type: 'text', maxlength: 60, value: f.label, placeholder: 'Nombre del campo', 'aria-label': 'Nombre del campo ' + (i + 1) });
          lab.addEventListener('input', () => { f.label = lab.value; });
          const kind = h('select', { class: 'select sm', 'aria-label': 'Tipo del campo ' + (i + 1) }, KINDS.map(([k, n]) => h('option', { value: k, selected: f.kind === k }, n)));
          kind.addEventListener('change', () => { f.kind = kind.value; drawFields(); });
          const extra = f.kind === 'list' ? h('textarea', { class: 'textarea sm', rows: 2, placeholder: 'Una opción por línea', 'aria-label': 'Opciones del campo ' + (i + 1) }, (f.options || []).join('\n')) : f.kind === 'relation' ? h('select', { class: 'select sm', 'aria-label': 'Tipo de perfil a vincular' }, h('option', { value: '' }, 'Vincular con cualquier tipo'), data.types.filter((x) => x.id !== t.id).map((x) => h('option', { value: x.id, selected: f.target === x.id }, 'Solo ' + x.name))) : null;
          if (extra && f.kind === 'list') extra.addEventListener('input', () => { f.options = extra.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50); });
          if (extra && f.kind === 'relation') extra.addEventListener('change', () => { f.target = extra.value; });
          fieldsBox.appendChild(h('div', { class: 'tpl-row' }, h('div', { class: 'tpl-main' }, lab, kind,
            h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Subir campo', disabled: i === 0, onclick: () => { [t.fields[i - 1], t.fields[i]] = [t.fields[i], t.fields[i - 1]]; drawFields(); } }, G.icon('chevU', 14)),
            h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Bajar campo', disabled: i === t.fields.length - 1, onclick: () => { [t.fields[i + 1], t.fields[i]] = [t.fields[i], t.fields[i + 1]]; drawFields(); } }, G.icon('chevD', 14)),
            h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Quitar campo ' + f.label, onclick: () => { t.fields.splice(i, 1); drawFields(); } }, G.icon('trash', 14))), extra));
        });
        if (!t.fields.length) fieldsBox.appendChild(h('div', { class: 'dim', style: { padding: '8px' } }, 'Este tipo no tiene campos. Agrega al menos uno.'));
      };
      drawFields();
      const res = await G.modal({
        title: existing ? 'Plantilla: ' + existing.name : 'Nuevo tipo de perfil', width: 640,
        body: h('div', { class: 'col gap-16' }, fName.el, h('div', { class: 'field' }, h('label', {}, 'Color en el mapa de ideas'), colors),
          h('div', { class: 'field' }, h('label', {}, 'Campos de la ficha'), fieldsBox, h('button', { class: 'btn sm', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => { t.fields.push({ id: G.uid(), label: '', kind: 'short' }); drawFields(); const ins = G.$$('.tpl-row input', fieldsBox).pop(); if (ins) ins.focus(); } }, G.icon('plus', 14), 'Agregar campo'))),
        actions: [
          ...(existing ? [{ label: 'Eliminar tipo', danger: true, value: 'delete' }] : []),
          { label: 'Cancelar', value: null },
          { label: 'Guardar', primary: true, keepOpen: true, onClick: (api) => {
            fName.setError('');
            if (!name.value.trim()) { fName.setError('Escribe un nombre para el tipo.'); name.focus(); return false; }
            if (data.types.some((x) => x.id !== t.id && x.name.toLowerCase() === name.value.trim().toLowerCase())) { fName.setError('Ya existe un tipo con ese nombre.'); name.focus(); return false; }
            t.name = name.value.trim();
            t.fields = t.fields.filter((f) => f.label.trim()).map((f) => Object.assign(f, { label: f.label.trim() }));
            if (!t.fields.length) { G.toast('Agrega al menos un campo con nombre.', { kind: 'err' }); return false; }
            api.close('save'); return false;
          } },
        ],
      });
      if (res === 'delete') {
        const n = data.profiles.filter((p) => p.typeId === existing.id).length;
        if (!(await G.confirm({ title: 'Eliminar el tipo «' + existing.name + '»', message: n ? `Se eliminarán también sus ${n} perfil(es). Esta acción no se puede deshacer.` : 'Este tipo no tiene perfiles.', confirmLabel: 'Eliminar tipo', danger: true }))) return;
        data.profiles = data.profiles.filter((p) => p.typeId !== existing.id);
        data.types = data.types.filter((x) => x.id !== existing.id);
        if (sel.typeId === existing.id) sel.typeId = 'all';
        if (sel.profileId && !profById(sel.profileId)) sel.profileId = null;
        saver.touch(); renderAll(); return;
      }
      if (res !== 'save') return;
      if (existing) {
        const removed = existing.fields.filter((f) => !t.fields.some((x) => x.id === f.id));
        const withData = removed.filter((f) => data.profiles.some((p) => p.typeId === existing.id && p.values[f.id] !== undefined && p.values[f.id] !== '' && !(Array.isArray(p.values[f.id]) && !p.values[f.id].length)));
        if (withData.length && !(await G.confirm({ title: 'Quitar campos con datos', message: `Los campos «${withData.map((f) => f.label).join('», «')}» tienen información en algunos perfiles. Si los quitas, esa información se perderá.`, confirmLabel: 'Quitar y guardar', danger: true }))) return;
        Object.assign(typeById(existing.id), t);
      } else { data.types.push(t); sel.typeId = t.id; }
      saver.touch(); renderAll();
    }

    function renderAll() { renderTypes(); renderList(); renderEditor(); }
    renderAll();
    return { destroy() { saver.destroy(); refreshList.cancel(); } };
  };
})();
