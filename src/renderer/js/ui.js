/* Grafema — componentes de interfaz reutilizables. */
(function () {
  'use strict';
  const G = window.G;
  const h = G.h;

  // ---------- Avisos ----------
  G.toast = function toast(msg, opts) {
    opts = opts || {};
    const kind = opts.kind || 'info';
    let host = G.$('.toasts', G.root);
    if (!host) host = G.root.appendChild(h('div', { class: 'toasts' }));
    if (G.$$('.toast-msg', host).some((m) => m.textContent === String(msg))) return { dismiss() {} }; // evita avisos repetidos
    let timer;
    const el = h('div', { class: 'toast ' + kind, role: kind === 'err' ? 'alert' : 'status' },
      G.icon(kind === 'err' ? 'warn' : kind === 'ok' ? 'check' : 'info', 18),
      h('div', { class: 'toast-msg' }, msg),
      opts.action ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { opts.action.fn(); dismiss(); } }, opts.action.label) : null,
      h('button', { class: 'ibtn sm', type: 'button', 'aria-label': 'Cerrar aviso', onclick: () => dismiss() }, G.icon('close', 14)));
    function dismiss() { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 160); }
    host.appendChild(el);
    while (host.children.length > 4) host.firstChild.remove();
    timer = setTimeout(dismiss, opts.ms || (kind === 'err' ? 8000 : 4200));
    return { dismiss };
  };

  // ---------- Modal ----------
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  G.modal = function modal(opts) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      let done = false;
      const buttons = {};
      const api = { buttons, close: (v) => close(v), setBusy(b) { Object.values(buttons).forEach((x) => { x.disabled = !!b; }); } };
      function close(v) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        scrim.remove();
        if (prev && prev.focus && document.contains(prev)) prev.focus();
        resolve(v);
      }
      const dismissible = opts.dismissible !== false;
      const title = h('h2', { class: 'dlg-title', id: 'dlg-t-' + G.uid() }, opts.title || '');
      const body = h('div', { class: 'dlg-body' }, typeof opts.body === 'function' ? opts.body(api) : opts.body);
      const foot = (opts.actions || []).length
        ? h('div', { class: 'dlg-foot' }, opts.actions.map((a) => {
          const b = h('button', {
            class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), type: 'button', disabled: !!a.disabled,
            onclick: async () => {
              if (a.onClick) { const r = await a.onClick(api); if (r === false) return; }
              if (!a.keepOpen) close(a.value);
            },
          }, a.label);
          if (a.id) buttons[a.id] = b;
          return b;
        }))
        : null;
      const dlg = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id, style: { width: (opts.width || 520) + 'px' } },
        h('div', { class: 'dlg-head' }, title, dismissible ? h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close(undefined) }, G.icon('close', 16)) : null),
        body, foot);
      const scrim = h('div', { class: 'scrim', onmousedown: (e) => { if (e.target === scrim && dismissible) close(undefined); } }, dlg);
      function onKey(e) {
        if (!scrim.isConnected) return;
        if (e.key === 'Escape' && dismissible) { e.stopPropagation(); e.preventDefault(); close(undefined); return; }
        if (e.key === 'Tab') {
          const f = G.$$(FOCUSABLE, dlg).filter((x) => x.offsetParent !== null);
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          else if (!dlg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      G.root.appendChild(scrim);
      setTimeout(() => {
        const first = G.$('[data-autofocus]', dlg) || G.$('input:not([type=hidden]),textarea,select', dlg) || G.$('.dlg-foot .btn.primary', dlg) || G.$(FOCUSABLE, dlg);
        if (first) { first.focus(); if (first.select && first.tagName === 'INPUT' && first.type === 'text' && opts.selectOnOpen) first.select(); }
      }, 0);
    });
  };

  G.confirm = async function confirm(o) {
    const r = await G.modal({
      title: o.title || '¿Continuar?', width: o.width || 440,
      body: h('p', { class: 'dlg-text' }, o.message || ''),
      actions: [{ label: o.cancelLabel || 'Cancelar', value: false }, { label: o.confirmLabel || 'Aceptar', primary: !o.danger, danger: !!o.danger, value: true }],
    });
    return r === true;
  };

  G.prompt = function prompt(o) {
    const input = h('input', { class: 'input', type: 'text', value: o.value || '', placeholder: o.placeholder || '', maxlength: o.maxlength || 120, id: 'pr-' + G.uid(), 'data-autofocus': '' });
    const err = h('div', { class: 'err', role: 'alert' });
    return G.modal({
      title: o.title, width: o.width || 440, selectOnOpen: true,
      body: (api) => {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); api.buttons.ok.click(); } });
        return h('div', { class: 'field' }, o.label ? h('label', { for: input.id }, o.label) : null, input, err);
      },
      actions: [
        { label: 'Cancelar', value: null },
        {
          id: 'ok', label: o.confirmLabel || 'Aceptar', primary: true, keepOpen: true,
          onClick: (api) => {
            const v = input.value.trim();
            const msg = o.validate ? o.validate(v) : (v ? '' : 'Escribe un valor.');
            if (msg) { err.textContent = msg; input.focus(); return false; }
            api.close(v);
            return false;
          },
        },
      ],
    });
  };

  // ---------- Popover y menú ----------
  G.popover = function popover(anchor, content, opts) {
    opts = opts || {};
    const pop = h('div', { class: 'pop ' + (opts.class || ''), role: opts.role || 'dialog', tabindex: '-1' }, content);
    G.root.appendChild(pop);
    function place() {
      const rr = G.root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      pop.style.maxHeight = Math.max(160, rr.height - 24) + 'px';
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = opts.align === 'right' ? ar.right - rr.left - pw : ar.left - rr.left;
      left = G.clamp(left, 8, Math.max(8, rr.width - pw - 8));
      let top = ar.bottom - rr.top + 4;
      if (top + ph > rr.height - 8) {
        const above = ar.top - rr.top - ph - 4;
        top = above >= 8 ? above : Math.max(8, rr.height - ph - 8);
      }
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    }
    place();
    let closed = false;
    const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); if (anchor.focus && opts.restoreFocus !== false) anchor.focus(); } };
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      pop.remove();
      if (anchor._pop === handle) anchor._pop = null;
      if (opts.onClose) opts.onClose();
    }
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    const handle = { close, place, el: pop };
    anchor._pop = handle;
    return handle;
  };
  G.togglePopover = function togglePopover(anchor, build, opts) {
    if (anchor._pop) { anchor._pop.close(); return null; }
    let handle;
    const content = build(() => handle && handle.close());
    handle = G.popover(anchor, content, opts);
    return handle;
  };

  G.menu = function menu(anchor, items, opts) {
    return G.togglePopover(anchor, (close) => {
      const list = h('div', { class: 'menu', role: 'menu' }, items.map((it) => {
        if (it.separator) return h('div', { class: 'menu-sep', role: 'separator' });
        return h('button', {
          class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', disabled: !!it.disabled,
          onclick: () => { close(); if (it.onClick) it.onClick(); },
        }, it.icon ? G.icon(it.icon, 16) : h('span', { class: 'ico-sp' }), h('span', { class: 'grow' }, it.label), it.hint ? h('span', { class: 'dim' }, it.hint) : null);
      }));
      list.addEventListener('keydown', (e) => {
        const btns = G.$$('.menu-item:not([disabled])', list);
        const i = btns.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
      });
      setTimeout(() => { const f = G.$('.menu-item:not([disabled])', list); if (f) f.focus(); }, 0);
      return list;
    }, Object.assign({ role: 'menu', class: 'menu-pop' }, opts));
  };

  // ---------- Formularios ----------
  G.field = function field(label, control, o) {
    o = o || {};
    if (!control.id) control.id = 'f-' + G.uid();
    const hint = o.hint ? h('div', { class: 'hint', id: control.id + '-h' }, o.hint) : null;
    const err = h('div', { class: 'err', role: 'alert', id: control.id + '-e' });
    const parts = [hint ? control.id + '-h' : null, control.id + '-e'].filter(Boolean).join(' ');
    control.setAttribute('aria-describedby', parts);
    const el = h('div', { class: 'field' + (o.class ? ' ' + o.class : '') }, label ? h('label', { for: control.id }, label) : null, o.wrap || control, hint, err);
    return {
      el, control,
      setError(msg) { err.textContent = msg || ''; el.classList.toggle('invalid', !!msg); if (msg) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid'); },
    };
  };
  G.seg = function seg(options, value, onChange, label) {
    const el = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || null });
    const btns = options.map((o) => h('button', {
      type: 'button', role: 'radio', class: 'seg-btn', 'data-v': o.value, 'aria-checked': 'false',
      onclick: () => { set(o.value); if (onChange) onChange(o.value); },
    }, o.icon ? G.icon(o.icon, 16) : null, o.label));
    btns.forEach((b) => el.appendChild(b));
    function set(v) { btns.forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; }); el.value = v; }
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = btns.findIndex((b) => b.classList.contains('on'));
      const n = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      n.click(); n.focus();
    });
    set(value); el.set = set;
    return el;
  };
  G.switch = function sw(o) {
    const input = h('input', { type: 'checkbox', class: 'sw-in', role: 'switch', checked: !!o.checked, id: 'sw-' + G.uid() });
    input.addEventListener('change', () => o.onChange && o.onChange(input.checked));
    return { input, el: h('label', { class: 'sw', for: input.id }, input, h('span', { class: 'sw-track' }, h('span', { class: 'sw-dot' })), o.label ? h('span', { class: 'sw-label' }, o.label) : null) };
  };
  G.withBusy = async function withBusy(btn, fn) {
    btn.disabled = true; btn.classList.add('busy');
    try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); }
  };
  G.copy = async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* respaldo */ }
    const ta = h('textarea', { style: { position: 'fixed', left: '-9999px' } });
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    ta.remove();
    return ok;
  };

  // ---------- Guardado automático ----------
  const savers = new Set();
  G.saver = function saver(fn, delay, onState) {
    let timer = null, dirty = false, running = null, dead = false;
    const api = {
      touch() { if (dead) return; dirty = true; clearTimeout(timer); timer = setTimeout(api.flush, delay || 1500); if (onState) onState('dirty'); },
      async flush() {
        clearTimeout(timer); timer = null;
        if (running) { try { await running; } catch (_) { /* se reintenta abajo */ } }
        if (!dirty) return true;
        dirty = false;
        if (onState) onState('saving');
        running = Promise.resolve().then(fn);
        try {
          await running;
          if (onState) onState(dirty ? 'dirty' : 'saved');
          return true;
        } catch (e) {
          dirty = true;
          if (onState) onState('error', e);
          if (!dead) timer = setTimeout(api.flush, 5000);
          return false;
        } finally { running = null; }
      },
      get dirty() { return dirty; },
      destroy() { dead = true; clearTimeout(timer); savers.delete(api); },
    };
    savers.add(api);
    return api;
  };
  G.flushAll = async function flushAll() {
    const r = await Promise.all([...savers].map((s) => s.flush()));
    return r.every(Boolean);
  };
})();
