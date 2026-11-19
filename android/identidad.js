'use strict';
// Pone el logo de Grafema en el APK: ícono de la app (normal, redondo, adaptable y monocromo de Android 13),
// pantalla de arranque oscura con el logo y color de fondo. Lee el dibujo de build/logo.svg, así que es el
// MISMO logo que usa Windows. No necesita ninguna librería: dibuja y escribe los PNG por su cuenta.
// Uso:  node android/identidad.js [carpeta-res]
//       (por defecto android/android/app/src/main/res, la que crea «npx cap add android»)
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const FONDO = [10, 10, 10]; // #0A0A0A, el mismo fondo del ícono de Windows (build/icon.png)
const BLANCO = [255, 255, 255];

// ---------- logo.svg -> lista de rectángulos ----------
function leerLogo(svgPath) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
  if (!vb) throw new Error('logo.svg no tiene viewBox');
  const [, , vw, vh] = vb.trim().split(/\s+/).map(Number);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rects = [];
  const num = (tag, k) => { const m = tag.match(new RegExp('\\s' + k + '="([^"]+)"')); return m ? Number(m[1]) : 0; };
  const re = /<g\b[^>]*fill="(#[0-9a-fA-F]{6})"[^>]*>([\s\S]*?)<\/g>|<rect\b[^>]*\/?>/g;
  let m;
  while ((m = re.exec(svg))) {
    if (m[1]) {
      for (const r of m[2].matchAll(/<rect\b[^>]*\/?>/g)) rects.push({ x: num(r[0], 'x'), y: num(r[0], 'y'), w: num(r[0], 'width'), h: num(r[0], 'height'), c: hex(m[1]) });
    } else {
      const f = (m[0].match(/fill="(#[0-9a-fA-F]{6})"/) || [])[1];
      if (f) rects.push({ x: num(m[0], 'x'), y: num(m[0], 'y'), w: num(m[0], 'width'), h: num(m[0], 'height'), c: hex(f) });
    }
  }
  if (!rects.length) throw new Error('logo.svg no tiene rectángulos');
  return { vw, vh, rects };
}

// ---------- dibujo ----------
// Lienzo RGBA con alfa sin premultiplicar; cada rectángulo se mezcla por el área exacta que cubre en cada píxel.
function lienzo(w, h, fondo) {
  const a = new Float64Array(w * h * 4);
  if (fondo) for (let i = 0; i < w * h; i++) { a[i * 4] = fondo[0]; a[i * 4 + 1] = fondo[1]; a[i * 4 + 2] = fondo[2]; a[i * 4 + 3] = 1; }
  return { w, h, a };
}
function mezclar(L, i, c, cov) {
  const a = L.a, da = a[i + 3], oa = cov + da * (1 - cov);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) a[i + k] = (c[k] * cov + a[i + k] * da * (1 - cov)) / oa;
  a[i + 3] = oa;
}
// frac = ancho del logo / ancho del lienzo (el logo siempre queda centrado). mono = todo en blanco.
function dibujarLogo(L, logo, frac, mono) {
  const s = (L.w * frac) / logo.vw;
  const ox = (L.w - logo.vw * s) / 2, oy = (L.h - logo.vh * s) / 2;
  for (const r of logo.rects) {
    // Es pixel art: los bordes se ajustan a píxeles enteros para que no queden costuras entre cuadros vecinos.
    const x0 = Math.round(ox + r.x * s), x1 = Math.max(x0 + 1, Math.round(ox + (r.x + r.w) * s));
    const y0 = Math.round(oy + r.y * s), y1 = Math.max(y0 + 1, Math.round(oy + (r.y + r.h) * s));
    for (let py = Math.max(0, Math.floor(y0)); py < Math.min(L.h, Math.ceil(y1)); py++) {
      const cy = Math.min(py + 1, y1) - Math.max(py, y0);
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(L.w, Math.ceil(x1)); px++) {
        const cx = Math.min(px + 1, x1) - Math.max(px, x0);
        if (cx > 0 && cy > 0) mezclar(L, (py * L.w + px) * 4, mono ? BLANCO : r.c, cx * cy);
      }
    }
  }
}
// Recorta el lienzo con una forma ('redondeado' = esquinas como el ícono de Windows, 'circulo').
function recortar(L, forma) {
  const n = 4, w = L.w, R = forma === 'circulo' ? w / 2 : w * 0.22, c = w / 2;
  const dentro = (x, y) => {
    if (forma === 'circulo') return (x - c) * (x - c) + (y - c) * (y - c) <= R * R;
    const dx = Math.max(Math.abs(x - c) - (c - R), 0), dy = Math.max(Math.abs(y - c) - (c - R), 0);
    return dx * dx + dy * dy <= R * R;
  };
  for (let py = 0; py < L.h; py++) for (let px = 0; px < w; px++) {
    let k = 0;
    for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) if (dentro(px + (sx + 0.5) / n, py + (sy + 0.5) / n)) k++;
    L.a[(py * w + px) * 4 + 3] *= k / (n * n);
  }
}

// ---------- PNG ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(tipo, datos) {
  const t = Buffer.from(tipo, 'ascii'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(datos.length); crc.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([len, t, datos, crc]);
}
function aPng(L) {
  const raw = Buffer.alloc((L.w * 4 + 1) * L.h);
  for (let y = 0; y < L.h; y++) {
    raw[y * (L.w * 4 + 1)] = 0;
    for (let x = 0; x < L.w; x++) for (let k = 0; k < 4; k++) {
      const v = L.a[(y * L.w + x) * 4 + k];
      raw[y * (L.w * 4 + 1) + 1 + x * 4 + k] = Math.max(0, Math.min(255, Math.round(k === 3 ? v * 255 : v)));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(L.w, 0); ihdr.writeUInt32BE(L.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const medidasPng = (f) => { const d = fs.readFileSync(f); return d.length > 24 && d.toString('ascii', 12, 16) === 'IHDR' ? { w: d.readUInt32BE(16), h: d.readUInt32BE(20) } : null; };

// ---------- aplicar al proyecto Android ----------
function aplicar(res, logo) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const escribir = (rel, buf) => { const f = path.join(res, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };
  const hecho = [];
  for (const [d, k] of Object.entries(dens)) {
    const px = Math.round(48 * k), cap = Math.round(108 * k);
    // Íconos de siempre (Android 7 y anteriores, y lanzadores sin adaptables): cuadrado redondeado y círculo.
    for (const [nombre, forma] of [['ic_launcher', 'redondeado'], ['ic_launcher_round', 'circulo']]) {
      const L = lienzo(px, px, FONDO); dibujarLogo(L, logo, 0.62); recortar(L, forma); escribir(`mipmap-${d}/${nombre}.png`, aPng(L));
    }
    // Adaptable (Android 8+): el sistema pone el fondo y recorta; el logo queda dentro de la zona segura (66 de 108 dp).
    const F = lienzo(cap, cap, null); dibujarLogo(F, logo, 0.42); escribir(`mipmap-${d}/ic_launcher_foreground.png`, aPng(F));
    // Monocromo (Android 13+, «íconos con tema»): el sistema lo tiñe con los colores del teléfono.
    const M = lienzo(cap, cap, null); dibujarLogo(M, logo, 0.42, true); escribir(`mipmap-${d}/ic_launcher_monochrome.png`, aPng(M));
    hecho.push(d);
  }
  const hex = '#' + FONDO.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  escribir('values/ic_launcher_background.xml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`));
  const adaptable = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n`;
  escribir('mipmap-anydpi-v26/ic_launcher.xml', Buffer.from(adaptable));
  escribir('mipmap-anydpi-v26/ic_launcher_round.xml', Buffer.from(adaptable));

  // Pantalla de arranque: se reemplaza cada splash.png que crea Capacitor, con su mismo tamaño.
  let splash = 0;
  for (const dir of fs.readdirSync(res).filter((n) => /^drawable/.test(n))) {
    const f = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(f)) continue;
    const m = medidasPng(f); if (!m) continue;
    const L = lienzo(m.w, m.h, FONDO);
    dibujarLogo(L, logo, (Math.min(m.w, m.h) * 0.34) / m.w);
    fs.writeFileSync(f, aPng(L)); splash++;
  }
  // Android 12+ pinta su propia pantalla de arranque: que sea oscura y no blanca.
  const estilos = path.join(res, 'values/styles.xml');
  if (fs.existsSync(estilos)) {
    let s = fs.readFileSync(estilos, 'utf8');
    if (/AppTheme\.NoActionBarLaunch/.test(s) && !/windowSplashScreenBackground/.test(s)) {
      s = s.replace(/(<style\s+name="AppTheme\.NoActionBarLaunch"[^>]*>)/, '$1\n        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>');
      fs.writeFileSync(estilos, s);
    }
  }
  return { densidades: hecho.length, splash };
}

module.exports = { leerLogo, aplicar, aPng, lienzo, dibujarLogo };

if (require.main === module) {
  const res = path.resolve(process.argv[2] || path.join(__dirname, 'android/app/src/main/res'));
  if (!fs.existsSync(res)) {
    console.log('Aún no existe el proyecto Android (' + path.relative(process.cwd(), res) + '): ejecuta primero "npx cap add android". Se omite el logo.');
    process.exit(0);
  }
  const r = aplicar(res, leerLogo(path.join(__dirname, '..', 'build', 'logo.svg')));
  console.log('Logo de Grafema aplicado: íconos en ' + r.densidades + ' densidades, ' + r.splash + ' pantallas de arranque.');
}
