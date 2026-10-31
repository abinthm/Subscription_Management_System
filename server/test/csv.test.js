import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCsv } from '../src/lib/csv.js';

function render(rows) {
  let body = '';
  const res = { set() {}, send(b) { body = b; } };
  sendCsv(res, 'x', [['Name', 'name'], ['Amount', 'amount']], rows);
  return body.replace('﻿', '').trim().split('\r\n');
}

test('quotes separators and neutralises spreadsheet formulas', () => {
  const [header, a, b, c] = render([
    { name: 'Acme, "Ltd"', amount: 10.5 },
    { name: '=HYPERLINK("x")', amount: -3 },
    { name: null, amount: 0 },
  ]);
  assert.equal(header, 'Name,Amount');
  assert.equal(a, '"Acme, ""Ltd""",10.5');
  assert.equal(b, `"'=HYPERLINK(""x"")",-3`);
  assert.equal(c, ',0');
});
