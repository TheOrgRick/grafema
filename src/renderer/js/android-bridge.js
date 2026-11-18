/* Grafema — puente para Android (Capacitor). En Windows no hace nada: ahí existe window.grafema (preload de Electron).
   Las llamadas van al mismo núcleo que usa Windows, que corre dentro de la app (nodejs-mobile). */
(function () {
  'use strict';
  if (window.grafema || !window.Capacitor || !window.Capacitor.Plugins) return;
  const P = window.Capacitor.Plugins;
  const Node = P.CapacitorNodeJS;
  if (!Node) return;
  const G = (window.G = window.G || {});
  G.isAndroid = true;
  document.documentElement.classList.add('android');

  const pending = new Map();
  let seq = 0;
  const ready = new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    Node.addListener('grafema-ready', go);
    Node.addListener('grafema-reply', (ev) => {
      const d = (ev && ev.args && ev.args[0]) || ev || {};
      const w = pending.get(d.id);
      if (w) { pending.delete(d.id); w(d.result); }
    });
    Promise.resolve(Node.whenReady ? Node.whenReady() : null).then(go, go);
  });

  const toCore = async (channel, payload) => {
    await ready;
    return new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      Node.send({ eventName: 'grafema', args: [{ id, channel, payload }] });
    });
  };
  const fail = (code, message) => ({ ok: false, code, message });

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
