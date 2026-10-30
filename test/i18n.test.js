'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/js/i18n.js');

test('English and Arabic have the same keys', () => {
  const en = Object.keys(I.dicts.en).sort();
  const ar = Object.keys(I.dicts.ar).sort();
  assert.deepEqual(en.filter(k => !ar.includes(k)), [], 'missing in Arabic');
  assert.deepEqual(ar.filter(k => !en.includes(k)), [], 'missing in English');
  assert.deepEqual(Object.keys(I.categories.en).sort(), Object.keys(I.categories.ar).sort());
});

test('placeholders survive translation', () => {
  for (const k of Object.keys(I.dicts.en)) {
    const vars = s => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(vars(I.dicts.ar[k]), vars(I.dicts.en[k]), k);
  }
});

test('numbers typed with Arabic digits and separators are understood', () => {
  assert.equal(I.parseNumber('١٢٬٣٤٥٫٥'), 12345.5);
  assert.equal(I.parseNumber('1,250.75'), 1250.75);
  assert.equal(I.parseNumber('۱۲'), 12);
  assert.equal(I.parseNumber(''), null);
  assert.ok(Number.isNaN(I.parseNumber('abc')));
  assert.equal(I.parseNumber('−5'), -5);
});

test('formatting follows language and digit settings', () => {
  I.setLang('en'); I.setDigits('latn');
  assert.equal(I.fmtNum(1234.5), '1,234.50');
  assert.equal(I.fmtPct(0.255), '25.5%');
  assert.equal(I.fmtNum(-0.001), '0.00');
  I.setLang('ar'); I.setDigits('arab');
  assert.match(I.fmtNum(12), /١٢/);
  I.setDigits('latn');
  assert.match(I.fmtNum(12), /12/);
  assert.equal(I.t('entries', { n: 3 }), '3 حركة');
});
