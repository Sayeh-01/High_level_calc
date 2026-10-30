'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/js/calc.js');

const close = (actual, expected, eps = 1e-6, msg) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${msg || ''} expected ${expected}, got ${actual}`);

function baseJob(extra) {
  return Object.assign({
    period: { from: '2026-01-01', to: '2026-12-31' },
    settings: {
      vat: { enabled: true, rate: 14, pricesIncludeVat: false, paidToAuthority: 0 },
      tax: { mode: 'flat', flatRate: 22.5, brackets: [] },
      zakat: { mode: 'none', rate: 2.5, nisab: 0 },
      reserves: { legalPct: 5, otherPct: 0 },
      partners: { method: 'manual', interestOnCapitalRate: 0 },
      autoDepreciation: true,
      autoLoanInterest: true
    },
    sections: [],
    transactions: [],
    partners: [],
    assets: [],
    loans: [],
    position: {}
  }, extra);
}

const sampleTx = [
  { kind: 'revenue', date: '2026-02-10', amount: 10000, vat: true, status: 'paid' },
  { kind: 'revenue', date: '2026-03-05', amount: 5000, vat: false, status: 'unpaid' },
  { kind: 'returns', date: '2026-03-20', amount: 1000, vat: true, status: 'paid' },
  { kind: 'cogs', date: '2026-02-01', amount: 4000, vat: true, status: 'partial', paid: 2000 },
  { kind: 'opex', date: '2026-04-01', amount: 2000, vat: false, status: 'paid' },
  { kind: 'otherIncome', date: '2026-05-01', amount: 500, status: 'paid' },
  { kind: 'otherExpense', date: '2026-06-01', amount: 300, status: 'paid' },
  { kind: 'revenue', date: '2025-12-31', amount: 99999, status: 'paid' } // outside the period
];

test('profit and loss statement', () => {
  const r = C.compute(baseJob({ transactions: sampleTx }));
  const pl = r.pl;
  assert.equal(pl.revenue, 15000);
  assert.equal(pl.returns, 1000);
  assert.equal(pl.netRevenue, 14000);
  assert.equal(pl.grossProfit, 10000);
  assert.equal(pl.ebitda, 8000);
  assert.equal(pl.operatingProfit, 8000);
  assert.equal(pl.pbt, 8200);
  close(pl.incomeTax, 1845);
  close(pl.netProfit, 6355);
  close(pl.netMargin, 6355 / 14000);
});

test('VAT return, receivables and payables', () => {
  const r = C.compute(baseJob({ transactions: sampleTx }));
  close(r.vat.output, 1400);
  close(r.vat.outputReturns, 140);
  close(r.vat.input, 560);
  close(r.vat.net, 700);
  close(r.totals.receivables, 5000);
  close(r.totals.payables, 2560);
});

test('prices that already include VAT are split back to net', () => {
  const job = baseJob({ transactions: [{ kind: 'revenue', amount: 1140, vat: true }] });
  job.settings.vat.pricesIncludeVat = true;
  const v = C.txValues(job.transactions[0], job);
  close(v.net, 1000);
  close(v.vat, 140);
  // per-line rate overrides the job rate
  const v5 = C.txValues({ kind: 'revenue', amount: 105, vat: true, vatRate: 5 }, job);
  close(v5.net, 100);
});

test('quantity x unit price drives the amount', () => {
  const v = C.txValues({ kind: 'revenue', qty: 3, unitPrice: 250, amount: 1 }, baseJob());
  assert.equal(v.net, 750);
});

test('net profit is shared after reserves (manual percentages)', () => {
  const job = baseJob({
    transactions: sampleTx,
    partners: [
      { id: 'a', name: 'A', capital: 60000, sharePct: 60, drawings: 1000 },
      { id: 'b', name: 'B', capital: 40000, sharePct: 40 }
    ]
  });
  const d = C.compute(job).distribution;
  close(d.legalReserve, 317.75);
  close(d.distributable, 6037.25);
  close(d.rows[0].residual, 3622.35);
  close(d.rows[1].residual, 2414.9);
  close(d.rows[0].due, 2622.35);
  close(d.rows[0].closingCapital, 62622.35);
  close(d.unallocated, 0);
  assert.equal(d.warnings.length, 0);
});

test('share methods: capital, shares, time-weighted capital', () => {
  const partners = [
    { name: 'A', capital: 100000, shares: 30 },
    { name: 'B', capital: 100000, shares: 70, joinDate: '2026-07-02' }
  ];
  const job = baseJob({ partners });
  job.settings.reserves.legalPct = 0;
  job.settings.tax.mode = 'none';
  job.transactions = [{ kind: 'revenue', date: '2026-03-01', amount: 54800 }];

  job.settings.partners.method = 'capital';
  let d = C.compute(job).distribution;
  close(d.rows[0].ratio, 0.5);

  job.settings.partners.method = 'shares';
  d = C.compute(job).distribution;
  close(d.rows[1].residual, 54800 * 0.7);
  close(d.profitPerShare, 548);

  job.settings.partners.method = 'weighted';
  d = C.compute(job).distribution;
  assert.equal(d.rows[0].days, 365);
  assert.equal(d.rows[1].days, 183);
  close(d.rows[0].residual, 54800 * 365 / 548);
});

test('salaries, interest on capital and management share come first', () => {
  const job = baseJob({
    transactions: [{ kind: 'revenue', date: '2026-01-10', amount: 100000 }],
    partners: [
      { name: 'Manager', capital: 50000, sharePct: 50, salary: 12000, bonusPct: 10 },
      { name: 'Investor', capital: 50000, sharePct: 50 }
    ]
  });
  job.settings.tax.mode = 'none';
  job.settings.reserves.legalPct = 0;
  job.settings.partners.interestOnCapitalRate = 10;
  const d = C.compute(job).distribution;
  close(d.interest, 10000);
  close(d.bonuses, 10000);
  close(d.distributable, 100000 - 12000 - 10000 - 10000);
  close(d.rows[0].total, 12000 + 5000 + 10000 + 34000);
  close(d.rows[1].total, 5000 + 34000);
  close(d.allocatedTotal, 100000);
});

test('manual shares not summing to 100 warn and show the remainder', () => {
  const job = baseJob({
    transactions: [{ kind: 'revenue', date: '2026-01-10', amount: 1000 }],
    partners: [{ name: 'A', sharePct: 30 }, { name: 'B', sharePct: 50 }]
  });
  job.settings.tax.mode = 'none';
  job.settings.reserves.legalPct = 0;
  const d = C.compute(job).distribution;
  assert.equal(d.warnings[0].key, 'warnSharesNot100');
  close(d.unallocated, 200);
});

test('losses are shared and no reserve is taken', () => {
  const job = baseJob({
    transactions: [{ kind: 'opex', date: '2026-01-10', amount: 1000 }],
    partners: [{ name: 'A', sharePct: 50 }, { name: 'B', sharePct: 50 }]
  });
  const d = C.compute(job).distribution;
  assert.equal(d.reserves, 0);
  close(d.rows[0].residual, -500);
});

test('depreciation methods match the textbook (and Excel SLN/VDB/SYD)', () => {
  const sl = C.assetSchedule({ cost: 12000, salvage: 2000, lifeYears: 5, method: 'sl', startDate: '2026-01-01' });
  assert.deepEqual(sl.rows.map(r => C.round(r.dep)), [2000, 2000, 2000, 2000, 2000]);
  const ddb = C.assetSchedule({ cost: 10000, salvage: 1000, lifeYears: 5, method: 'ddb', startDate: '2026-01-01' });
  assert.deepEqual(ddb.rows.map(r => C.round(r.dep)), [4000, 2400, 1440, 864, 296]);
  const syd = C.assetSchedule({ cost: 15000, salvage: 0, lifeYears: 5, method: 'syd', startDate: '2026-01-01' });
  assert.deepEqual(syd.rows.map(r => C.round(r.dep)), [5000, 4000, 3000, 2000, 1000]);
});

test('depreciation is prorated to the period and flows into the P&L', () => {
  const job = baseJob({ assets: [{ name: 'Van', cost: 12000, salvage: 2000, lifeYears: 5, method: 'sl', startDate: '2026-07-01' }] });
  job.settings.tax.mode = 'none';
  const r = C.compute(job);
  // 2026-07-01..2026-12-31 is 184 of the 365 days in the first asset year
  close(r.pl.depreciation, 2000 * 184 / 365, 1e-6);
  close(r.assets[0].nbv, 12000 - 2000 * 184 / 365, 1e-6);
  close(r.pl.netProfit, -2000 * 184 / 365, 1e-6);
});

test('loan amortization', () => {
  const s = C.loanSchedule({ principal: 100000, annualRate: 12, months: 12, type: 'annuity', startDate: '2026-01-15' });
  close(s.payment, 8884.878867, 1e-5);
  close(s.totalInterest, 6618.546, 1e-2);
  close(s.rows[11].balance, 0, 1e-8);
  const eq = C.loanSchedule({ principal: 1200, annualRate: 12, months: 12, type: 'equal' });
  close(eq.rows[0].payment, 112);
  const zero = C.loanSchedule({ principal: 1200, annualRate: 0, months: 12 });
  close(zero.payment, 100);
});

test('loan interest inside the period becomes a finance cost', () => {
  const job = baseJob({ loans: [{ name: 'Bank', principal: 100000, annualRate: 12, months: 12, type: 'annuity', startDate: '2026-01-15' }] });
  job.settings.tax.mode = 'none';
  const r = C.compute(job);
  const s = r.loans[0].schedule;
  const first11 = s.rows.slice(0, 11).reduce((a, x) => a + x.interest, 0);
  close(r.pl.financeCosts, first11);
  close(r.loans[0].stats.balance, s.rows[11].principal, 1e-6);
  close(r.position.loanCurrent, s.rows[11].principal, 1e-6);
  close(r.position.loanNonCurrent, 0, 1e-6);
  assert.equal(r.loans[0].stats.received, true);
  close(r.cash.loansIn, 100000);
});

test('progressive income tax brackets', () => {
  const uae = [{ upTo: 375000, rate: 0 }, { upTo: '', rate: 9 }];
  close(C.progressiveTax(1000000, uae), 56250);
  close(C.progressiveTax(300000, uae), 0);
  const steps = [{ upTo: 10000, rate: 0 }, { upTo: 20000, rate: 10 }, { upTo: '', rate: 20 }];
  close(C.progressiveTax(25000, steps), 1000 + 1000);
  assert.equal(C.progressiveTax(-5, steps), 0);
});

test('zakat on profit and on net assets with nisab', () => {
  const job = baseJob({ transactions: [{ kind: 'revenue', date: '2026-03-01', amount: 40000, status: 'unpaid' }] });
  job.settings.tax.mode = 'none';
  job.settings.zakat = { mode: 'profit', rate: 2.5, nisab: 0 };
  let r = C.compute(job);
  close(r.zakat.amount, 1000);
  close(r.pl.netProfit, 39000);

  job.settings.zakat = { mode: 'netAssets', rate: 2.5, nisab: 0 };
  job.position = { openingCash: 10000, inventory: 5000 };
  r = C.compute(job);
  // cash 10000 + receivable 40000 + inventory 5000
  close(r.zakat.base, 55000);
  close(r.zakat.amount, 1375);

  job.settings.zakat.nisab = 100000;
  r = C.compute(job);
  assert.equal(r.zakat.belowNisab, true);
  assert.equal(r.zakat.amount, 0);
});

test('sections keep their own results and can absorb shared costs', () => {
  const job = baseJob({
    sections: [{ id: 's1', name: 'Villa A' }, { id: 's2', name: 'Villa B' }],
    transactions: [
      { kind: 'revenue', sectionId: 's1', date: '2026-01-05', amount: 30000 },
      { kind: 'cogs', sectionId: 's1', date: '2026-01-06', amount: 10000 },
      { kind: 'revenue', sectionId: 's2', date: '2026-01-07', amount: 10000 },
      { kind: 'cogs', sectionId: 's2', date: '2026-01-08', amount: 12000 },
      { kind: 'opex', date: '2026-01-09', amount: 4000 }
    ]
  });
  job.settings.tax.mode = 'none';
  let r = C.compute(job);
  const [a, b] = r.sections.list;
  assert.equal(a.profit, 20000);
  assert.equal(b.profit, -2000);
  assert.equal(r.sections.unassigned.profit, -4000);
  assert.equal(r.sections.hasUnassigned, true);
  job.settings.allocateShared = true;
  r = C.compute(job);
  close(r.sections.list[0].profitAfterAllocation, 20000 - 3000);
  close(r.sections.list[1].profitAfterAllocation, -2000 - 1000);
});

test('cash flow and financial position', () => {
  const job = baseJob({
    transactions: sampleTx,
    partners: [{ name: 'A', capital: 50000, sharePct: 100, drawings: 3000 }],
    assets: [{ name: 'PC', cost: 6000, lifeYears: 3, method: 'sl', startDate: '2026-01-01' }],
    position: { openingCash: 1000, inventory: 2000 }
  });
  job.settings.tax.mode = 'none';
  job.settings.vat.paidToAuthority = 200;
  const r = C.compute(job);
  // collections: 11400 + 500, refunds 1140, payments 2000 + 2000 + 300
  close(r.cash.operating, 11900 - 1140 - 4300 - 200);
  close(r.cash.closing, 1000 + 6260 - 6000 + 50000 - 3000);
  close(r.position.fixedAssets, 4000);
  close(r.position.vatPayable, 500);
  assert.ok(r.ratios.currentRatio > 0);
});

test('effective period falls back to the data when no dates are set', () => {
  const job = baseJob({ period: { from: '', to: '' }, transactions: [{ kind: 'revenue', date: '2024-05-01', amount: 1 }] });
  const p = C.effectivePeriod(job, '2026-10-30');
  assert.equal(p.fromISO, '2024-05-01');
  assert.equal(p.toISO, '2026-10-30');
  assert.equal(p.explicit, false);
});

test('monthly series buckets', () => {
  const r = C.compute(baseJob({ transactions: sampleTx }));
  assert.equal(r.monthly.granularity, 'month');
  assert.equal(r.monthly.buckets.length, 12);
  assert.equal(r.monthly.buckets[1].income, 10000); // February
  assert.equal(r.monthly.buckets[1].expenses, 4000);
  assert.equal(r.monthly.buckets[2].income, 4000); // March: 5000 - 1000 returns
});

test('break-even', () => {
  const be = C.breakEven({ fixedCosts: 10000, price: 50, variableCost: 30, expectedUnits: 800, targetProfit: 2000 });
  assert.equal(be.units, 500);
  assert.equal(be.revenue, 25000);
  assert.equal(be.targetUnits, 600);
  assert.equal(be.expectedProfit, 6000);
  close(be.marginOfSafety, 300 / 800);
  close(be.operatingLeverage, 16000 / 6000);
  assert.equal(C.breakEven({ fixedCosts: 1, price: 10, variableCost: 12 }).valid, false);
});

test('investment appraisal: NPV, IRR, payback', () => {
  const inv = C.calculators.investment(10, 1000, '300, 400, 500');
  close(inv.npv, -21.0368, 1e-3);
  close(inv.irr, 0.088963, 1e-5);
  close(inv.payback, 2.6);
  close(C.calculators.investment(10, 1000, '١٠٠ ١٠٠').irr, -0.6298438, 1e-6); // Arabic digits parse
  assert.equal(C.calculators.investment(10, 0, '100 100').irr, null); // no sign change, no IRR
});

test('calculators', () => {
  const K = C.calculators;
  assert.equal(K.percentOf(15, 200), 30);
  assert.equal(K.whatPercent(50, 200), 25);
  assert.equal(K.percentChange(80, 100), 25);
  close(K.vatExtract(115, 15).vat, 15);
  close(K.priceFromMargin(75, 25), 100);
  close(K.marginMarkup(75, 100).markup, 100 / 3);
  close(K.futureValue(1000, 12, 1, 12, 0).fv, 1126.825, 1e-3);
  close(K.roi(1000, 2000, 2).cagr, 41.42136, 1e-4);
  assert.deepEqual(C.parseList('١٢٫٥، 3; 4'), [12.5, 3, 4]);
});
