'use strict';
// Puente seguro: la interfaz solo puede invocar los canales de esta lista.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = [
  'app:info', 'app:flushed', 'config:get', 'config:set', 'fonts:list', 'shell:openData', 'shell:showExport',
  'author:set',
  'project:list', 'project:create', 'project:load', 'project:update', 'project:delete',
  'project:exportFile', 'project:importFile', 'project:exportData', 'project:importData',
  'chapter:create', 'chapter:read', 'chapter:write', 'chapter:rename', 'chapter:delete', 'chapter:reorder', 'chapter:importDocx', 'chapter:exportDocx',
  'bible:read', 'bible:write', 'map:read', 'map:write', 'maps:list', 'maps:create', 'maps:rename', 'maps:duplicate', 'maps:delete',
  'export:preview', 'export:sources', 'export:pdf', 'export:docx',
  'window:setSize', 'spell:info', 'spell:setLanguages', 'app:pendingFile',
];
const EVENTS = ['app:request-flush', 'spell:status', 'project:opened-file'];

contextBridge.exposeInMainWorld('grafema', {
  platform: process.platform,
  invoke: (channel, payload) => (INVOKE.includes(channel)
    ? ipcRenderer.invoke(channel, payload)
    : Promise.resolve({ ok: false, code: 'FORBIDDEN', message: 'Operación no permitida.' })),
  on: (event, cb) => {
    if (!EVENTS.includes(event) || typeof cb !== 'function') return () => {};
    const h = (_e, data) => cb(data);
    ipcRenderer.on(event, h);
    return () => ipcRenderer.removeListener(event, h);
  },
});
