'use strict';
// Arma la carpeta  android/www  que Capacitor empaqueta en el APK:
//   www/                  -> interfaz (src/renderer + src/shared)
//   www/nodejs/           -> núcleo de Grafema que corre dentro de la app (nodejs-mobile)
// Uso:  node android/preparar.js
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const www = path.join(__dirname, 'www');
const cp = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (f) => !/\.(map|bak)$/.test(f) });

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

// Interfaz: index.html pide ../shared/..., en el APK shared queda junto a index.html.
cp(path.join(root, 'src/renderer'), www);
cp(path.join(root, 'src/shared'), path.join(www, 'shared'));
const idx = path.join(www, 'index.html');
fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/\.\.\/shared\//g, 'shared/'));

// Núcleo (sin nada de Electron): mismas carpetas que en el proyecto para que sus require() funcionen igual.
const node = path.join(www, 'nodejs');
fs.mkdirSync(path.join(node, 'src/main'), { recursive: true });
for (const f of ['app-core', 'store', 'errors', 'docx', 'xml', 'zip', 'exporter', 'maprender', 'projectfile']) {
  cp(path.join(root, 'src/main', f + '.js'), path.join(node, 'src/main', f + '.js'));
}
cp(path.join(root, 'src/shared'), path.join(node, 'src/shared'));
cp(path.join(__dirname, 'nodejs/main.js'), path.join(node, 'main.js'));
const pdfLib = path.join(root, 'node_modules/pdf-lib');
if (fs.existsSync(pdfLib)) cp(pdfLib, path.join(node, 'node_modules/pdf-lib'));
else console.warn('Aviso: falta node_modules/pdf-lib (ejecuta "npm install" en la carpeta principal). El PDF no estará disponible.');
fs.writeFileSync(path.join(node, 'package.json'), JSON.stringify({ name: 'grafema-nucleo', version: '1.2.0', main: 'main.js', private: true }, null, 2));
console.log('Listo: ' + path.relative(process.cwd(), www));
