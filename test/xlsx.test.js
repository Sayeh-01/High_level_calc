'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkbook } = require('../lib/xlsx-export.js');
const M = require('../src/js/model.js');
const C = require('../src/js/calc.js');

for (const lang of ['en', 'ar']) {
  test(`Excel export (${lang}) carries formulas and the app's results`, async () => {
    const job = M.sampleJob(lang, 2026);
    const { workbook, result } = await buildWorkbook(job, { lang, today: '2026-10-30' });
    assert.equal(workbook.worksheets.length, 9);
    const pl = workbook.worksheets[0];
    assert.equal(pl.views[0].rightToLeft, lang === 'ar');
    let net = null;
    pl.eachRow(row => {
      const label = row.getCell(1).value;
      if (label === (lang === 'ar' ? 'صافي الربح' : 'Net profit')) net = row.getCell(2).value;
    });
    assert.ok(net && net.formula, 'net profit is a formula');
    assert.ok(Math.abs(net.result - result.pl.netProfit) < 1e-6);
    assert.ok(Math.abs(result.pl.netProfit - C.compute(job, { today: '2026-10-30' }).pl.netProfit) < 1e-9);
    let fonts = new Set();
    workbook.eachSheet(ws => ws.eachRow(r => r.eachCell(c => fonts.add(c.font && c.font.name))));
    assert.deepEqual([...fonts], ['Arial']);
  });
}
