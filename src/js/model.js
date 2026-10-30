/*
 * High Level Calc — data model: defaults, migration and the sample job.
 * UMD: window.HLModel or require().
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HLModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATA_VERSION = 1;
  const TAB_COLORS = ['#2f6f5e', '#3b5b92', '#8a5a2b', '#7a3e6d', '#9a3b32', '#4f6b2a', '#2b6f86', '#5d5a52'];
  const VAT_RATES = { EGP: 14, SAR: 15, AED: 5, BHD: 10, OMR: 5, JOD: 16, MAD: 20, TND: 19, DZD: 19, LBP: 11, TRY: 20, GBP: 20, EUR: 20 };

  let counter = 0;
  function newId(prefix) {
    counter = (counter + 1) % 1e6;
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
  }

  function defaultSettings(currency) {
    const rate = VAT_RATES[currency];
    return {
      vat: { enabled: rate != null, rate: rate != null ? rate : 0, pricesIncludeVat: false, paidToAuthority: 0 },
      tax: { mode: 'none', flatRate: 22.5, brackets: [{ upTo: 375000, rate: 0 }, { upTo: '', rate: 9 }] },
      zakat: { mode: 'none', rate: 2.5, nisab: 0, manualBase: 0 },
      reserves: { legalPct: 0, otherPct: 0 },
      partners: { method: 'manual', interestOnCapitalRate: 0 },
      autoDepreciation: true,
      autoLoanInterest: true,
      allocateShared: false
    };
  }

  function newJob(fields) {
    const f = fields || {};
    const currency = f.currency || 'EGP';
    const now = new Date().toISOString();
    return {
      id: newId('job'),
      name: f.name || '',
      color: f.color || TAB_COLORS[0],
      open: true,
      createdAt: now,
      updatedAt: now,
      client: { name: f.clientName || '', phone: '', email: '', address: '', taxId: '' },
      currency,
      period: f.period || { from: '', to: '' },
      settings: defaultSettings(currency),
      sections: [],
      transactions: [],
      partners: [],
      assets: [],
      loans: [],
      position: { openingCash: 0, inventory: 0, otherCurrentAssets: 0, otherCurrentLiabilities: 0, cashOverride: '' },
      breakEven: { fixedCosts: '', price: '', variableCost: '', expectedUnits: '', targetProfit: '' },
      calc: {},
      notes: ''
    };
  }

  function newData() {
    return {
      app: 'high-level-calc',
      version: DATA_VERSION,
      settings: { lang: 'ar', theme: 'system', digits: 'latn', defaultCurrency: 'EGP' },
      activeId: null,
      jobs: []
    };
  }

  function isPlainObject(x) { return x && typeof x === 'object' && !Array.isArray(x); }

  // Fill anything missing from `defaults` without touching what is there.
  function fill(target, defaults) {
    for (const k of Object.keys(defaults)) {
      if (target[k] === undefined) target[k] = JSON.parse(JSON.stringify(defaults[k]));
      else if (isPlainObject(defaults[k]) && isPlainObject(target[k])) fill(target[k], defaults[k]);
    }
    return target;
  }

  function migrateJob(job) {
    const base = newJob({ currency: job.currency });
    delete base.id;
    fill(job, base);
    if (!job.id) job.id = newId('job');
    for (const key of ['sections', 'transactions', 'partners', 'assets', 'loans']) {
      if (!Array.isArray(job[key])) job[key] = [];
      for (const item of job[key]) if (!item.id) item.id = newId(key.slice(0, 2));
    }
    return job;
  }

  function migrateData(data) {
    if (!isPlainObject(data) || !Array.isArray(data.jobs)) return null;
    fill(data, newData());
    data.jobs.forEach(migrateJob);
    if (!data.jobs.some(j => j.id === data.activeId)) data.activeId = (data.jobs.find(j => j.open) || {}).id || null;
    data.version = DATA_VERSION;
    return data;
  }

  // ----------------------------------------------------------------- sample

  function sampleJob(lang, year) {
    const ar = lang === 'ar';
    const y = year || new Date().getFullYear();
    const d = (m, day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const L = (en, arText) => (ar ? arText : en);
    const job = newJob({
      name: L('Sample — Al Noor Villas', 'مثال — فلل النور'),
      clientName: L('Al Noor Real Estate', 'شركة النور العقارية'),
      currency: 'EGP',
      color: TAB_COLORS[1],
      period: { from: d(1, 1), to: d(12, 31) }
    });
    job.client.phone = '+20 100 000 0000';
    job.settings.tax.mode = 'flat';
    job.settings.tax.flatRate = 22.5;
    job.settings.reserves.legalPct = 5;
    job.settings.vat.paidToAuthority = 60000;
    job.position.openingCash = 150000;
    job.position.inventory = 85000;

    const villaA = { id: newId('se'), name: L('Villa A', 'فيلا أ') };
    const villaB = { id: newId('se'), name: L('Villa B', 'فيلا ب') };
    job.sections = [villaA, villaB];

    const client = L('Al Noor Real Estate', 'شركة النور العقارية');
    const steel = L('Delta Steel', 'الدلتا للحديد');
    const cement = L('Nile Cement', 'أسمنت النيل');
    const sub = L('Hassan Electrical', 'حسن للكهرباء');
    const tx = (kind, date, sec, category, description, party, amount, extra) => Object.assign({
      id: newId('tx'), kind, date, sectionId: sec ? sec.id : '', category, description, party,
      qty: '', unitPrice: '', amount, vat: true, vatRate: '', status: 'paid', paid: '', ref: '', notes: ''
    }, extra || {});

    job.transactions = [
      tx('revenue', d(1, 20), villaA, L('Contract work', 'أعمال مقاولات'), L('Down payment — Villa A', 'دفعة مقدمة — فيلا أ'), client, 450000, { ref: 'INV-001' }),
      tx('revenue', d(1, 22), villaB, L('Contract work', 'أعمال مقاولات'), L('Down payment — Villa B', 'دفعة مقدمة — فيلا ب'), client, 380000, { ref: 'INV-002' }),
      tx('cogs', d(2, 3), villaA, L('Materials', 'خامات'), L('Rebar 12 tons', 'حديد تسليح 12 طن'), steel, 0, { qty: 12, unitPrice: 38000 }),
      tx('cogs', d(2, 5), villaB, L('Materials', 'خامات'), L('Rebar 9 tons', 'حديد تسليح 9 طن'), steel, 0, { qty: 9, unitPrice: 38000, status: 'partial', paid: 200000 }),
      tx('cogs', d(2, 8), villaA, L('Materials', 'خامات'), L('Cement 400 bags', 'أسمنت 400 شيكارة'), cement, 0, { qty: 400, unitPrice: 210 }),
      tx('cogs', d(2, 9), villaB, L('Materials', 'خامات'), L('Cement 300 bags', 'أسمنت 300 شيكارة'), cement, 0, { qty: 300, unitPrice: 210 }),
      tx('cogs', d(3, 15), villaA, L('Direct labor', 'عمالة مباشرة'), L('Masonry crew — March', 'عمالة مباني — مارس'), '', 95000, { vat: false }),
      tx('cogs', d(3, 16), villaB, L('Direct labor', 'عمالة مباشرة'), L('Masonry crew — March', 'عمالة مباني — مارس'), '', 82000, { vat: false }),
      tx('revenue', d(4, 10), villaA, L('Contract work', 'أعمال مقاولات'), L('Progress invoice 1 — Villa A', 'مستخلص 1 — فيلا أ'), client, 520000, { ref: 'INV-003' }),
      tx('revenue', d(5, 12), villaB, L('Contract work', 'أعمال مقاولات'), L('Progress invoice 1 — Villa B', 'مستخلص 1 — فيلا ب'), client, 410000, { ref: 'INV-004', status: 'partial', paid: 300000 }),
      tx('cogs', d(5, 20), villaA, L('Subcontractors', 'مقاولو باطن'), L('Electrical works', 'أعمال كهرباء'), sub, 140000),
      tx('cogs', d(6, 2), villaB, L('Subcontractors', 'مقاولو باطن'), L('Electrical works', 'أعمال كهرباء'), sub, 120000, { status: 'unpaid' }),
      tx('returns', d(6, 18), villaA, L('Discounts allowed', 'خصم مسموح به'), L('Delay discount agreed with client', 'خصم تأخير متفق عليه مع العميل'), client, 20000),
      tx('revenue', d(8, 25), villaA, L('Contract work', 'أعمال مقاولات'), L('Final invoice — Villa A', 'المستخلص الختامي — فيلا أ'), client, 380000, { ref: 'INV-005', status: 'unpaid' }),
      tx('revenue', d(9, 14), villaB, L('Contract work', 'أعمال مقاولات'), L('Progress invoice 2 — Villa B', 'مستخلص 2 — فيلا ب'), client, 300000, { ref: 'INV-006' }),
      tx('cogs', d(9, 1), villaB, L('Materials', 'خامات'), L('Finishing materials', 'خامات تشطيب'), '', 165000),
      tx('opex', d(1, 31), null, L('Rent', 'إيجار'), L('Site office rent — Q1', 'إيجار مكتب الموقع — الربع الأول'), '', 36000, { vat: false }),
      tx('opex', d(4, 30), null, L('Rent', 'إيجار'), L('Site office rent — Q2', 'إيجار مكتب الموقع — الربع الثاني'), '', 36000, { vat: false }),
      tx('opex', d(7, 31), null, L('Rent', 'إيجار'), L('Site office rent — Q3', 'إيجار مكتب الموقع — الربع الثالث'), '', 36000, { vat: false }),
      tx('opex', d(6, 30), null, L('Salaries & wages', 'رواتب وأجور'), L('Engineer and accountant — H1', 'مهندس ومحاسب — النصف الأول'), '', 168000, { vat: false }),
      tx('opex', d(9, 30), null, L('Salaries & wages', 'رواتب وأجور'), L('Engineer and accountant — Q3', 'مهندس ومحاسب — الربع الثالث'), '', 84000, { vat: false }),
      tx('opex', d(3, 1), null, L('Transport & fuel', 'انتقالات ووقود'), L('Fuel and transport', 'وقود وانتقالات'), '', 27500),
      tx('opex', d(5, 5), null, L('Fees & licenses', 'رسوم وتراخيص'), L('Building permits', 'تراخيص البناء'), '', 18000, { vat: false }),
      tx('otherIncome', d(7, 10), null, L('Miscellaneous', 'متنوعة'), L('Sale of scrap steel', 'بيع حديد خردة'), '', 12500),
      tx('otherExpense', d(8, 2), null, L('Fines & penalties', 'غرامات'), L('Late permit fine', 'غرامة تأخير ترخيص'), '', 5000, { vat: false })
    ];

    job.partners = [
      { id: newId('pa'), name: L('Ahmed Kamal', 'أحمد كمال'), capital: 300000, joinDate: '', sharePct: 50, shares: 50, salary: 60000, bonusPct: 10, drawings: 90000, notes: '' },
      { id: newId('pa'), name: L('Sara Mahmoud', 'سارة محمود'), capital: 180000, joinDate: '', sharePct: 30, shares: 30, salary: 0, bonusPct: 0, drawings: 40000, notes: '' },
      { id: newId('pa'), name: L('Omar Farouk', 'عمر فاروق'), capital: 120000, joinDate: d(4, 1), sharePct: 20, shares: 20, salary: 0, bonusPct: 0, drawings: 0, notes: '' }
    ];

    job.assets = [
      { id: newId('as'), name: L('Concrete mixer', 'خلاطة خرسانة'), sectionId: '', cost: 180000, salvage: 20000, lifeYears: 5, method: 'sl', startDate: d(1, 15), notes: '' },
      { id: newId('as'), name: L('Pickup truck', 'سيارة نقل ربع'), sectionId: '', cost: 650000, salvage: 150000, lifeYears: 5, method: 'ddb', startDate: d(2, 1), notes: '' }
    ];

    job.loans = [
      { id: newId('lo'), name: L('Bank equipment loan', 'قرض معدات من البنك'), principal: 400000, annualRate: 18, months: 24, type: 'annuity', startDate: d(2, 1), notes: '' }
    ];

    job.breakEven = { fixedCosts: 450000, price: 1250000, variableCost: 780000, expectedUnits: 2, targetProfit: 300000 };
    job.notes = L('Two villas built under one contract for the same client.', 'فيلتان تُبنيان بعقد واحد لنفس العميل.');
    return job;
  }

  return { DATA_VERSION, TAB_COLORS, VAT_RATES, newId, newJob, newData, defaultSettings, migrateJob, migrateData, sampleJob, fill };
});
