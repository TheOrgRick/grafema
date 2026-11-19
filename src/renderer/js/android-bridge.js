/* Grafema — puente para Android (Capacitor). En Windows no hace nada: ahí existe window.grafema (preload de Electron).
   Las llamadas van al mismo núcleo que usa Windows, que corre dentro de la app (nodejs-mobile). */
(function () {
  'use strict';
  const Cap = window.Capacitor;
  if (window.grafema || !Cap) return;
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const native = (typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform()) || /Android/i.test(ua) || !!Cap.Plugins;
  if (!native) return;
  const G = (window.G = window.G || {});
  G.isAndroid = true; // se marca antes que nada para que el diseño de teléfono se aplique incluso si algo falla después
  document.documentElement.classList.add('android');

  // Los plugins se piden por nombre: primero en Capacitor.Plugins y, si no está, con registerPlugin.
  const plugin = (name) => {
    try { if (Cap.Plugins && Cap.Plugins[name]) return Cap.Plugins[name]; } catch (_) { /* noop */ }
    try { if (typeof Cap.registerPlugin === 'function') return Cap.registerPlugin(name); } catch (_) { /* noop */ }
    return null;
  };
  const P = { get Filesystem() { return plugin('Filesystem'); }, get Share() { return plugin('Share'); } };
  const Node = plugin('CapacitorNodeJS');
  const fail = (code, message) => ({ ok: false, code, message });
  const diag = () => 'Capacitor: ' + (Cap ? 'sí' : 'no') + ' · plataforma: ' + ((typeof Cap.getPlatform === 'function' && Cap.getPlatform()) || '?') +
    ' · plugin de Node: ' + (Node ? 'sí' : 'no') + (Node ? ' (send: ' + (typeof Node.send) + ', addListener: ' + (typeof Node.addListener) + ')' : '');

  const pending = new Map();
  let seq = 0;
  let engineError = null;
  const ready = new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    try {
      if (!Node || typeof Node.addListener !== 'function' || typeof Node.send !== 'function') throw new Error('El plugin de Node no está disponible. ' + diag());
      const on = (name, fn) => { const r = Node.addListener(name, fn); if (r && typeof r.catch === 'function') r.catch((e) => { engineError = e; }); };
      on('grafema-ready', (ev) => { const d = (ev && ev.args && ev.args[0]) || ev || {}; if (d && d.error) engineError = new Error(d.error); go(); });
      on('grafema-reply', (ev) => {
        const d = (ev && ev.args && ev.args[0]) || ev || {};
        const w = pending.get(d.id);
        if (w) { pending.delete(d.id); w(d.result); }
      });
      Promise.resolve(typeof Node.whenReady === 'function' ? Node.whenReady() : null).then(go, go);
      setTimeout(go, 6000); // si el aviso de «listo» llegó antes de que escucháramos, seguimos de todos modos
    } catch (e) { engineError = e; go(); }
  });

  const toCore = async (channel, payload) => {
    await ready;
    if (engineError) return fail('ENGINE', 'El motor de Grafema no pudo iniciar: ' + ((engineError && engineError.message) || engineError));
    return new Promise((resolve) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); resolve(fail('ENGINE_TIMEOUT', 'El motor de Grafema no respondió. ' + diag())); }, 30000);
      pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      try {
        const r = Node.send({ eventName: 'grafema', args: [{ id, channel, payload }] });
        if (r && typeof r.catch === 'function') r.catch((e) => { clearTimeout(timer); pending.delete(id); resolve(fail('ENGINE', 'No se pudo hablar con el motor de Grafema: ' + ((e && e.message) || e))); });
      } catch (e) { clearTimeout(timer); pending.delete(id); resolve(fail('ENGINE', 'No se pudo hablar con el motor de Grafema: ' + ((e && e.message) || e))); }
    });
  };
  function pickFile() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '*/*'; inp.style.display = 'none';
      inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); resolve(f || null); });
      inp.addEventListener('cancel', () => { inp.remove(); resolve(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function readBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(new Error('No se pudo leer el archivo.'));
      fr.readAsDataURL(file);
    });
  }

  // Importar: el selector de archivos de Android entrega el .grafema; el núcleo lo valida y lo importa.
  async function importFile() {
    const f = await pickFile();
    if (!f) return { ok: true, canceled: true };
    if (!/\.grafema$/i.test(f.name)) return fail('FILE_INVALID', 'Elige un archivo de proyecto de Grafema (.grafema).');
    try { return await toCore('project:importData', { base64: await readBase64(f) }); } catch (e) { return fail('FILE_READ', e.message); }
  }
  // Exportar: el núcleo arma el .grafema, se escribe en caché y se abre el menú «Compartir» de Android
  // (guardar en Descargas, Drive, WhatsApp, correo…).
  async function exportFile(d) {
    const r = await toCore('project:exportData', d);
    if (!r.ok) return r;
    if (!P.Filesystem || !P.Share) return fail('NO_SHARE', 'Este dispositivo no permite compartir archivos desde la aplicación.');
    try {
      const w = await P.Filesystem.writeFile({ path: r.fileName, data: r.base64, directory: 'CACHE' });
      await P.Share.share({ title: r.fileName, dialogTitle: 'Guardar o enviar el proyecto', url: w.uri });
      return { ok: true, path: r.fileName, bytes: r.bytes };
    } catch (e) {
      if (/cancel/i.test(String(e && e.message))) return { ok: true, canceled: true };
      return fail('SHARE', 'No se pudo guardar el archivo: ' + ((e && e.message) || e));
    }
  }

  const LOCAL = {
    'project:importFile': () => importFile(),
    'project:exportFile': (d) => exportFile(d),
    'app:flushed': () => ({ ok: true }),
    'app:pendingFile': () => ({ ok: true, result: null }),
    'window:setSize': () => fail('NOT_SUPPORTED', 'Esta opción es solo de la versión de Windows.'),
    'spell:info': () => ({ ok: true, languages: [], available: [] }),
    'spell:setLanguages': () => ({ ok: true, languages: [] }),
    'shell:openData': () => fail('NOT_SUPPORTED', 'Tus proyectos se guardan dentro de la aplicación.'),
    'shell:showExport': () => ({ ok: true }),
    'chapter:importDocx': () => fail('NOT_SUPPORTED', 'Importar .docx llegará en una próxima versión de Android. Por ahora usa el archivo .grafema.'),
    'chapter:exportDocx': () => fail('NOT_SUPPORTED', 'Exportar .docx llegará en una próxima versión de Android. Por ahora usa el archivo .grafema.'),
    'export:pdf': () => fail('NOT_SUPPORTED', 'El PDF llegará en una próxima versión de Android. Por ahora usa el archivo .grafema.'),
    'export:docx': () => fail('NOT_SUPPORTED', 'Exportar .docx llegará en una próxima versión de Android. Por ahora usa el archivo .grafema.'),
  };

  window.grafema = {
    platform: 'android',
    invoke: async (channel, payload) => (LOCAL[channel] ? LOCAL[channel](payload) : toCore(channel, payload)),
    on: () => () => {},
  };
})();
