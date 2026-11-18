'use strict';
/* Grafema — plantillas de inicio de proyecto.
 * Cada plantilla define capítulos con texto guía (en cursiva gris: se borra al escribir), el formato
 * de página y la tipografía base. Módulo compartido: lo usan el núcleo (crear proyecto) y la interfaz (galería).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GrafemaTemplates = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const GUIDE = '#8A8A8A';
  const p = (text, extra) => Object.assign({ t: 'p', runs: text ? [{ text }] : [] }, extra || {});
  const h2 = (text) => ({ t: 'h2', runs: [{ text }] });
  // Texto guía: cursiva gris. Se reemplaza escribiendo encima.
  const guide = (text) => ({ t: 'p', runs: [{ text: 'Guía: ' + text, i: true, color: GUIDE }] });

  const TEMPLATES = [
    {
      id: 'blank', name: 'En blanco', genre: '',
      description: 'Un capítulo vacío para empezar desde cero.',
      chapters: [{ title: 'Capítulo 1', blocks: [] }],
    },
    {
      id: 'novela', name: 'Novela en tres actos', genre: 'Novela',
      description: 'Prólogo, tres actos y epílogo, con una guía breve de qué suele ocurrir en cada parte.',
      chapters: [
        { title: 'Prólogo', blocks: [guide('una escena corta que anticipe el tono, el mundo o el conflicto. No tiene que resolver nada.')] },
        { title: 'Acto I — Planteamiento', blocks: [
          guide('presenta al protagonista en su vida normal, lo que desea y lo que le falta.'),
          guide('termina con el suceso que lo obliga a actuar (el primer punto de giro).'),
        ] },
        { title: 'Acto II — Confrontación', blocks: [
          guide('los obstáculos suben de nivel; el protagonista aprende, pierde y cambia de plan.'),
          guide('a la mitad, un descubrimiento o revés que cambia lo que está en juego.'),
          guide('cierra con el punto más bajo: todo parece perdido.'),
        ] },
        { title: 'Acto III — Resolución', blocks: [guide('el enfrentamiento final y sus consecuencias; el protagonista actúa con lo que aprendió.')] },
        { title: 'Epílogo', blocks: [guide('cómo queda el mundo después; una imagen que cierre el círculo.')] },
      ],
    },
    {
      id: 'suspenso', name: 'Novela de suspenso', genre: 'Suspenso',
      description: 'Estructura de misterio: el hecho, las pistas, el giro y la verdad. Pensada para llevar pistas y sospechosos en la biblia.',
      chapters: [
        { title: 'Prólogo — El hecho', blocks: [guide('el crimen, la desaparición o la amenaza, visto desde fuera o con información incompleta.')] },
        { title: 'Parte 1 — La llamada', blocks: [
          guide('quién investiga y por qué le importa. Presenta a los sospechosos con una pregunta pendiente cada uno.'),
          guide('termina con una pista que contradice la versión oficial.'),
        ] },
        { title: 'Parte 2 — Las pistas', blocks: [
          guide('alterna pistas verdaderas y falsas. Anota cada una en la biblia (tipo Pista) y enlázala en el mapa.'),
          guide('sube el costo para quien investiga: amenazas, tiempo, relaciones.'),
        ] },
        { title: 'Parte 3 — El giro', blocks: [guide('lo que parecía cierto era falso. Replantea quién es el culpable o qué ocurrió realmente.')] },
        { title: 'Parte 4 — La verdad', blocks: [guide('el enfrentamiento y la revelación. Cierra las pistas abiertas; verifica que ninguna quede suelta.')] },
        { title: 'Epílogo', blocks: [guide('consecuencias para los personajes y una última inquietud si quieres dejar la puerta abierta.')] },
      ],
    },
    {
      id: 'cuento', name: 'Cuento o relato corto', genre: 'Cuento',
      description: 'Un solo texto en formato de media carta, con las tres partes clásicas.',
      page: { size: 'media' },
      chapters: [{ title: 'Cuento', blocks: [
        h2('Inicio'), guide('situación inicial y personaje; un detalle que enganche en las primeras líneas.'),
        h2('Nudo'), guide('el conflicto que rompe el equilibrio y escala.'),
        h2('Desenlace'), guide('el momento decisivo y su efecto; en un cuento breve, mejor sugerir que explicar.'),
      ] }],
    },
    {
      id: 'guion', name: 'Guion (cine o serie)', genre: 'Guion',
      description: 'Courier 12 pt a espacio sencillo y encabezados de escena. Una escena de ejemplo para ver el formato.',
      defaults: { font: 'Courier New', size: 12, lh: 1 },
      chapters: [{ title: 'Acto 1', blocks: [
        { t: 'p', runs: [{ text: 'INT. CAFETERÍA — DÍA', b: true }] },
        p('Describe la acción en presente y en pocas líneas: lo que se ve y se oye.'),
        { t: 'p', align: 'center', runs: [{ text: 'PERSONAJE' }] },
        { t: 'p', align: 'center', runs: [{ text: 'Su diálogo va aquí, centrado bajo el nombre.' }] },
        guide('cambia de escena con un nuevo encabezado: INT./EXT. LUGAR — MOMENTO DEL DÍA.'),
      ] }],
    },
  ];

  const byId = (id) => TEMPLATES.find((t) => t.id === id) || null;
  // Metadatos para la galería (sin el contenido).
  const list = () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, genre: t.genre, chapters: t.chapters.map((c) => c.title), page: t.page && t.page.size || null, font: t.defaults && t.defaults.font || null }));

  return { TEMPLATES, byId, list };
}));
