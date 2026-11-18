'use strict';
// Dibuja un mapa de ideas como SVG vectorial (para el PDF). Misma lógica que la vista del mapa:
// nodos de perfil (con el color de su tipo) y notas, conexiones manuales y las que salen de las
// relaciones de la biblia (líneas punteadas).
const esc = require('../shared/docmodel').esc;

const NW = 176, NH = 56, PAD = 44;
const FONT = "'Segoe UI',Arial,sans-serif";
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const color = (c, def) => (typeof c === 'string' && COLOR_RE.test(c) ? c : def);
const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// Parte un título en hasta dos líneas de ~22 caracteres, cortando en espacios cuando se puede.
function wrapTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const max = 22;
  if (t.length <= max) return [t];
  let cut = t.lastIndexOf(' ', max);
  if (cut < 8) cut = max;
  const a = t.slice(0, cut).trim();
  const b = t.slice(cut).trim();
  return [a, clipText(b, max)];
}

// Punto donde el segmento centro→destino sale del rectángulo del nodo.
function edgePoint(n, tx, ty) {
  const cx = n.x + NW / 2, cy = n.y + NH / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? (NW / 2) / Math.abs(dx) : Infinity;
  const sy = dy ? (NH / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

function mapToSvg(map, bible) {
  const profiles = new Map(((bible && bible.profiles) || []).map((p) => [p.id, p]));
  const types = new Map(((bible && bible.types) || []).map((t) => [t.id, t]));
  const raw = map && typeof map === 'object' ? map : {};
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
    .filter((n) => n && n.id && Number.isFinite(n.x) && Number.isFinite(n.y))
    .filter((n) => n.kind !== 'profile' || profiles.has(n.profileId));
  if (!nodes.length) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const info = (n) => {
    const p = n.kind === 'profile' ? profiles.get(n.profileId) : null;
    const t = p ? types.get(p.typeId) : null;
    return {
      title: p ? (String(p.name || '').trim() || 'Sin nombre') : (String(n.title || '').trim() || 'Nota sin título'),
      sub: p ? (t ? t.name : '') : 'Nota',
      color: p ? color(t && t.color, '#FFD712') : color(n.color, '#FFD712'),
      typeId: t ? t.id : null,
    };
  };

  // Conexiones: manuales + las que salen de campos de relación de la biblia.
  const edges = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e) => e && byId.has(e.from) && byId.has(e.to) && e.from !== e.to)
    .map((e) => ({ from: e.from, to: e.to, label: String(e.label || '').slice(0, 60), auto: false }));
  const onMap = new Map(nodes.filter((n) => n.kind === 'profile').map((n) => [n.profileId, n]));
  const seen = new Set();
  for (const n of onMap.values()) {
    const p = profiles.get(n.profileId), t = types.get(p.typeId);
    if (!t) continue;
    for (const f of t.fields || []) {
      if (f.kind !== 'relation') continue;
      for (const id of Array.isArray(p.values && p.values[f.id]) ? p.values[f.id] : []) {
        const o = onMap.get(id);
        if (!o || o === n) continue;
        const key = [n.id, o.id].sort().join('|') + '|' + f.label;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: n.id, to: o.id, label: String(f.label || ''), auto: true });
      }
    }
  }

  const minX = Math.min(...nodes.map((n) => n.x)) - PAD, minY = Math.min(...nodes.map((n) => n.y)) - PAD;
  const maxX = Math.max(...nodes.map((n) => n.x + NW)) + PAD, maxY = Math.max(...nodes.map((n) => n.y + NH)) + PAD;
  const W = Math.max(200, Math.round(maxX - minX)), H = Math.max(120, Math.round(maxY - minY));

  let g = '';
  const labels = [];
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    const [x1, y1] = edgePoint(a, b.x + NW / 2, b.y + NH / 2);
    const [x2, y2] = edgePoint(b, a.x + NW / 2, a.y + NH / 2);
    g += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${e.auto ? '#9A9A9A' : '#555'}" stroke-width="1.6"${e.auto ? ' stroke-dasharray="6 4"' : ''}/>`;
    // Punta de flecha en el extremo "hacia".
    const ang = Math.atan2(y2 - y1, x2 - x1), L = 9, sp = 0.45;
    const ax = x2 - L * Math.cos(ang - sp), ay = y2 - L * Math.sin(ang - sp), bx = x2 - L * Math.cos(ang + sp), by = y2 - L * Math.sin(ang + sp);
    g += `<path d="M${x2.toFixed(1)} ${y2.toFixed(1)} L${ax.toFixed(1)} ${ay.toFixed(1)} L${bx.toFixed(1)} ${by.toFixed(1)} Z" fill="${e.auto ? '#9A9A9A' : '#555'}"/>`;
    if (e.label) labels.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, text: clipText(e.label, 28) });
  }

  for (const n of nodes) {
    const i = info(n);
    const lines = wrapTitle(i.title);
    const cy = lines.length === 2 ? n.y + 20 : n.y + 26;
    g += `<g><title>${esc(i.title)}</title>` +
      `<rect x="${n.x}" y="${n.y}" width="${NW}" height="${NH}" rx="10" fill="#fff" stroke="${i.color}" stroke-width="2"/>` +
      `<rect x="${n.x}" y="${n.y}" width="8" height="${NH}" rx="4" fill="${i.color}"/>` +
      lines.map((l, k) => `<text x="${n.x + 18}" y="${cy + k * 15}" font-size="13" font-weight="600" fill="#111" font-family="${FONT}">${esc(l)}</text>`).join('') +
      (i.sub ? `<text x="${n.x + 18}" y="${n.y + NH - 9}" font-size="10.5" fill="#666" font-family="${FONT}">${esc(clipText(i.sub, 26))}</text>` : '') +
      '</g>';
  }
  // Etiquetas al final para que queden sobre las líneas.
  for (const l of labels) {
    const w = Math.round(l.text.length * 6.1 + 12);
    g += `<rect x="${(l.x - w / 2).toFixed(1)}" y="${(l.y - 9).toFixed(1)}" width="${w}" height="17" rx="5" fill="#fff" stroke="#CFCFCF"/>` +
      `<text x="${l.x.toFixed(1)}" y="${(l.y + 3.5).toFixed(1)}" font-size="10.5" text-anchor="middle" fill="#333" font-family="${FONT}">${esc(l.text)}</text>`;
  }

  const legend = [];
  const seenT = new Set();
  for (const n of nodes) { const i = info(n); const key = i.typeId || (n.kind === 'note' ? 'note' : null); if (key && !seenT.has(key)) { seenT.add(key); legend.push({ name: i.sub || 'Nota', color: i.color }); } }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${Math.round(minX)} ${Math.round(minY)} ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img">${g}</svg>`;
  return { svg, legend, nodes: nodes.length, edges: edges.length, width: W, height: H };
}

module.exports = { mapToSvg, NW, NH };
