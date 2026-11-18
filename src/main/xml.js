'use strict';
// Analizador XML mínimo y seguro (no expande entidades personalizadas).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''; } catch (_) { return ''; }
    }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}

function esc(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function findTagEnd(xml, from) {
  let q = null;
  for (let i = from; i < xml.length; i++) {
    const c = xml[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parse(xml) {
  xml = String(xml).replace(/^\uFEFF/, '');
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) { top().children.push(decode(xml.slice(i))); break; }
    if (lt > i) top().children.push(decode(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      top().children.push(xml.slice(lt + 9, e < 0 ? n : e)); i = e < 0 ? n : e + 3; continue;
    }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (xml.startsWith('<!', lt)) { const e = xml.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }
    const gt = findTagEnd(xml, lt + 1);
    if (gt < 0) break;
    let tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      let k = stack.length - 1;
      while (k > 0 && stack[k].name !== name) k--;
      if (k > 0) stack.length = k;
      continue;
    }
    const selfClose = tag.endsWith('/');
    if (selfClose) tag = tag.slice(0, -1);
    const nm = tag.match(/^[^\s/>]+/);
    if (!nm) continue;
    const node = { name: nm[0], attrs: {}, children: [] };
    ATTR_RE.lastIndex = 0;
    let m;
    const rest = tag.slice(nm[0].length);
    while ((m = ATTR_RE.exec(rest))) node.attrs[m[1]] = decode(m[2] !== undefined ? m[2] : m[3]);
    top().children.push(node);
    if (!selfClose) {
      if (stack.length > 400) throw new Error('XML_TOO_DEEP');
      stack.push(node);
    }
  }
  return root;
}

const isEl = (c) => c && typeof c === 'object';
function kids(node, name) { return node ? node.children.filter((c) => isEl(c) && (!name || c.name === name)) : []; }
function kid(node, name) { return kids(node, name)[0] || null; }
function attr(node, name) { return node && node.attrs[name] !== undefined ? node.attrs[name] : undefined; }
function text(node) {
  if (!node) return '';
  let s = '';
  for (const c of node.children) s += isEl(c) ? text(c) : c;
  return s;
}
function find(node, name, out = []) {
  if (!node) return out;
  for (const c of node.children) if (isEl(c)) { if (c.name === name) out.push(c); find(c, name, out); }
  return out;
}

module.exports = { parse, esc, decode, kids, kid, attr, text, find, isEl };
