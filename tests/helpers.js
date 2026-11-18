'use strict';
const assert = require('assert');
let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
async function run(title) {
  console.log('\n▶ ' + title);
  for (const t of queue) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e)); }
  }
  queue.length = 0;
  return { passed, failed };
}
function totals() { return { passed, failed }; }
module.exports = { test, run, assert, totals };
