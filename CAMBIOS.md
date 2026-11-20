# Grafema 1.2 — archivo de proyecto `.grafema`

- Nuevo formato **`.grafema`**: un ZIP con `manifest.json`, `project.json`, `bible.json`, `maps/*.json` y `chapters/*.docx`. Contiene el proyecto completo y no guarda rutas del sistema (portable entre Windows y Android).
- **Exportar** (menú del proyecto en Inicio) e **Importar** (botón en Inicio). Importar siempre crea un proyecto nuevo; si ya existe el mismo, se llama «… (importado)».
- **Asociación de archivos** en Windows: doble clic en un `.grafema` lo importa y lo abre (con Grafema ya abierto o cerrado).
- Canales `project:exportData` / `project:importData` (base64, sin diálogos) para la versión de Android.
- Protecciones: lista blanca de nombres dentro del archivo (sin rutas fuera del proyecto), límites contra «zip bombs», importación atómica (si falla, no queda nada a medias) y avisos si falta algún capítulo.
- `zip.js`: `readZip` acepta límites (`maxEntry`, `maxTotal`, `maxCount`).
- Pruebas nuevas en `tests/proyecto-archivo.test.js` (10).

- **Android (preparación del APK):** carpeta `android/` con proyecto Capacitor + nodejs-mobile, `android/preparar.js`, guía `android/LEEME_ANDROID.txt`, puente `js/android-bridge.js` y diseño de teléfono `css/android.css` (barra inferior, botones de 44 px, barra de herramientas deslizable). Pruebas en `tests/android.test.js` con el plugin simulado.
- **Android (APK que funciona):** (1) el plugin de Node se instalaba desde npm (`capacitor-nodejs` 0.0.1, de Capacitor 3, con otro nombre de plugin), por lo que el motor no arrancaba en el teléfono; ahora se instala la v1.0.0-beta.9 (Capacitor 7) desde GitHub. (2) Puente y núcleo más robustos: detectan la plataforma, esperan al motor sin demoras, caducan a los 30 s y muestran en pantalla la causa si algo falla (antes quedaba en blanco). (3) **Logo de Grafema** en el APK: `android/identidad.js` genera ícono normal, redondo, adaptable y monocromo (Android 13), pantalla de arranque oscura y fondo `#0A0A0A` desde `build/logo.svg`. (4) El flujo de GitHub Actions también compila en cada Pull Request. (5) En Android solo se exporta el proyecto como **.grafema**: se quitan PDF y .docx de la interfaz del teléfono y `pdf-lib` ya no viaja en el APK (Windows no cambia). (6) 3 pruebas nuevas (logo, plugin y exportación).
- Pendiente en Android: modo de texto continuo en el editor (la página se ve como papel a escala), PDF, .docx, abrir un .grafema desde otra app y probar el APK real.

---

# Grafema 1.1 — lista de cambios

**Grafema by Petricorp** · pasa de 1.0.0 a 1.1.0 · sigue siendo Electron + JavaScript.

## Qué es nuevo

### Del documento de proyecto (secciones 3.1 y 3.2)
| Cambio | Detalle |
|---|---|
| **PDF ampliado** | Además del manuscrito, el PDF puede incluir la **biblia del proyecto** (por tipo de perfil, con imágenes y relaciones), los **mapas mentales** y un **índice**. Cada sección es opcional y se puede exportar solo biblia o solo mapas. |
| **Mapas en el PDF** | Cada mapa se dibuja en vectorial en su **propia página horizontal**. El PDF final une las páginas verticales y las horizontales y numera de corrido. |
| **Varios mapas mentales** | Un proyecto puede tener hasta 60 mapas. Pestañas arriba del mapa para cambiar; crear, renombrar, duplicar y eliminar. Se recuerda el último mapa abierto. |
| **Migración automática** | El mapa único de la versión 1.0 pasa a ser «Mapa 1». El archivo original se conserva como `map.json.migrado`. |

### Funciones tomadas de WordCraft (reimplementadas en JavaScript; no se usó código ni marca de WordCraft)
| Función | Atajo | Notas |
|---|---|---|
| **Esquema (navegación por encabezados)** | pestaña *Esquema* | Lista Título 1/2/3 con palabras por sección, filtro, salto a la sección y sección actual resaltada. |
| **Notas al pie** | `Ctrl+Alt+F` | Numeración automática. Son notas al pie **reales** en el .docx y van **al final de cada capítulo** en el PDF. |
| **Comentarios en el margen** | `Ctrl+Alt+M` | Tarjetas junto al texto, resolver/reabrir, eliminar. El estado «resuelto» se conserva en el .docx. |
| **Control de cambios** | `Ctrl+Mayús+T` | Marca lo escrito y lo borrado; aceptar/rechazar uno por uno o todos. Se guarda en el .docx y Word lo reconoce. |
| **Modo enfoque** | `Ctrl+Mayús+F` | Oculta el panel, atenúa los demás párrafos y mantiene la línea al centro. `Esc` para salir. |
| **Modo lectura** | `Ctrl+Mayús+L` | Solo lectura, columna cómoda, tamaño de letra ajustable, progreso y cambio de capítulo. |
| **Buscar y reemplazar avanzado** | `Ctrl+F` | Expresiones regulares (con `$1`, `$&`, `$<nombre>`) y «palabra completa». Respeta el control de cambios. |
| **Plantillas de inicio** | *Nuevo proyecto* | En blanco, Novela en tres actos, Novela de suspenso, Cuento, Guion (Courier 12). Traen capítulos y texto guía. |

### Animaciones (pedido nuevo)
* Transiciones suaves al cambiar de sección, en tarjetas, menús, avisos, paneles y nodos nuevos del mapa; solo `opacity`/`transform` para que sean baratas.
* **Interruptor en Ajustes › Apariencia › Animaciones** que las apaga por completo (solo siguen girando los indicadores de carga). Se recuerda entre sesiones y también se respeta la preferencia de Windows «Efectos de animación».

## Correcciones y mejoras de diseño hechas durante las pruebas
* Los diálogos altos (como el de nuevo proyecto con plantillas) **ya no se salen de la ventana**: el cuerpo se desplaza y los botones siempre se ven.
* Las tarjetas de comentarios se realinean al cambiar el zoom y no se solapan.
* El conteo de palabras ignora el texto marcado como eliminado y las marcas de nota.
* Insertar una nota al pie a media línea no parte el párrafo (se descubrió y corrigió con las pruebas).

## Verificación
* **67 pruebas del núcleo** (43 existentes + 24 nuevas) y **6 suites en Chromium real** (bienvenida, editor, biblia, mapa, tamaños y 13 comprobaciones nuevas): todas correctas, sin errores de consola.
* El .docx con notas, comentarios y cambios **pasa la validación de esquemas de Office** y abre bien en LibreOffice.
* Sin desbordes de diseño a 1024×640 con el panel de revisión abierto.

## Límites conocidos (conviene saberlos)
* **El instalador .exe no se generó aquí**: requiere Windows y descargar Electron. Se compila en tu equipo con `CONSTRUIR_EXE.bat` (ver LEEME.txt).
* Las pruebas corrieron en Chromium, no dentro de Electron/Windows: lo propio de Electron (impresión a PDF real, efecto Mica) y los **acentos con teclas muertas mientras el control de cambios está activo** conviene probarlos en tu PC con teclado en español.
* Control de cambios: no registra cambios de formato ni saltos de párrafo; con él activo, `Retroceso` no une párrafos y no se pueden arrastrar textos. Un `Ctrl+Z` puede necesitar dos pulsaciones tras escribir.
* PDF: las notas van al final del capítulo (no al pie de página); el índice no lleva números de página; los comentarios no se imprimen.
* Buscar con expresiones regulares: una expresión patológica puede tardar en terminar.

## Sin cambiar todavía (necesita tu decisión)
* **Logo nuevo** (sección 3.4): falta saber si se conserva el nombre y qué estilo buscas.
* Modo oscuro de la paleta propuesta e imagen de referencia de estilo.
