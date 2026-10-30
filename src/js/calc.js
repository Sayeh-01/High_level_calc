/*
 * High Level Calc — calculation engine.
 *
 * Pure functions only: no DOM, no storage. Loaded as a plain <script> in the
 * renderer (exposed as window.HLCalc) and with require() in Node (Electron
 * main process for the Excel export, and the unit tests).
 *
 * Dates are ISO strings (YYYY-MM-DD) and are handled as UTC day numbers so
 * results never shift with the computer's time zone.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HLCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;

  // ---------------------------------------------------------------- helpers

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null || v === '') return 0;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }

  function isBlank(v) {
    return v == null || v === '';
  }

  function sum(list, fn) {
    let s = 0;
    for (const x of list) s += fn ? num(fn(x)) : num(x);
    return s;
  }

  function div(a, b) {
    return b ? a / b : null;
  }

  function round(x, digits) {
    const f = Math.pow(10, digits == null ? 2 : digits);
    return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
  }

  function toDay(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) return null;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
  }

  function fromDay(d) {
    return new Date(d * DAY_MS).toISOString().slice(0, 10);
  }

  function addMonths(day, n) {
    const d = new Date(day * DAY_MS);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + n;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Math.round(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)) / DAY_MS);
  }

  function todayDay(today) {
    if (today) return toDay(today);
    const n = new Date();
    return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY_MS);
  }

  // Days shared by the half-open ranges [a1, a2) and [b1, b2).
  function overlap(a1, a2, b1, b2) {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  }

  // ------------------------------------------------------- transaction kinds

  // group: income | contra | cost. vat: which side of the VAT return it hits.
  const KINDS = {
    revenue: { group: 'income', vat: 'output' },
    returns: { group: 'contra', vat: 'output' },
    cogs: { group: 'cost', vat: 'input' },
    opex: { group: 'cost', vat: 'input' },
    otherIncome: { group: 'income', vat: 'output' },
    otherExpense: { group: 'cost', vat: 'input' }
  };
  const KIND_KEYS = Object.keys(KINDS);

  function kindOf(tx) {
    return KINDS[tx.kind] ? tx.kind : 'opex';
  }

  // Amount, VAT and payment position of one transaction.
  function txValues(tx, job) {
    const vatSettings = (job.settings && job.settings.vat) || {};
    const qty = num(tx.qty);
    const price = num(tx.unitPrice);
    const amount = qty && price ? qty * price : num(tx.amount);
    const vatOn = !!(vatSettings.enabled && tx.vat);
    const rate = vatOn ? (isBlank(tx.vatRate) ? num(vatSettings.rate) : num(tx.vatRate)) / 100 : 0;
    let net, vat;
    if (vatSettings.pricesIncludeVat && vatOn) {
      net = amount / (1 + rate);
      vat = amount - net;
    } else {
      net = amount;
      vat = amount * rate;
    }
    const gross = net + vat;
    const status = tx.status || 'paid';
    const paid = status === 'paid' ? gross : status === 'partial' ? Math.min(num(tx.paid), gross) : 0;
    return { amount, net, vat, rate: rate * 100, gross, paid, balance: gross - paid };
  }

  function emptyAgg() {
    const a = {};
    for (const k of KIND_KEYS) a[k] = 0;
    return a;
  }

  function aggregate(rows) {
    const a = emptyAgg();
    for (const r of rows) a[kindOf(r.tx)] += r.v.net;
    return a;
  }

  // ----------------------------------------------------------------- period

  function effectivePeriod(job, today) {
    const p = job.period || {};
    let from = toDay(p.from);
    let to = toDay(p.to);
    const explicit = from != null && to != null;
    if (!explicit) {
      const dates = [];
      for (const t of job.transactions || []) { const d = toDay(t.date); if (d != null) dates.push(d); }
      for (const a of job.assets || []) { const d = toDay(a.startDate); if (d != null) dates.push(d); }
      for (const l of job.loans || []) { const d = toDay(l.startDate); if (d != null) dates.push(d); }
      for (const pr of job.partners || []) { const d = toDay(pr.joinDate); if (d != null) dates.push(d); }
      const t0 = todayDay(today);
      if (from == null) {
        from = dates.length ? Math.min.apply(null, dates) : Math.round(Date.UTC(new Date(t0 * DAY_MS).getUTCFullYear(), 0, 1) / DAY_MS);
      }
      if (to == null) to = Math.max(t0, dates.length ? Math.max.apply(null, dates) : t0);
    }
    if (from > to) { const x = from; from = to; to = x; }
    return { from, to, fromISO: fromDay(from), toISO: fromDay(to), days: to - from + 1, explicit };
  }

  function inPeriod(dateStr, period) {
    const d = toDay(dateStr);
    if (d == null) return true; // undated entries always count
    return d >= period.from && d <= period.to;
  }

  // ------------------------------------------------------------ depreciation

  function assetSchedule(asset, fallbackStart) {
    const cost = Math.max(0, num(asset.cost));
    const salvage = Math.min(Math.max(0, num(asset.salvage)), cost);
    const life = Math.max(1, Math.round(num(asset.lifeYears) || 1));
    const method = asset.method || 'sl';
    const start = toDay(asset.startDate) != null ? toDay(asset.startDate) : fallbackStart;
    const base = cost - salvage;
    const rows = [];
    let bv = cost;
    let acc = 0;
    for (let y = 1; y <= life; y++) {
      let dep;
      if (method === 'none') dep = 0;
      else if (method === 'syd') dep = base * (life - y + 1) / (life * (life + 1) / 2);
      else if (method === 'ddb') {
        // Double-declining balance, switching to straight-line on the
        // remaining value once that gives more (same rule as Excel's VDB).
        const ddb = bv * 2 / life;
        const sl = (bv - salvage) / (life - y + 1);
        dep = Math.min(Math.max(ddb, sl), bv - salvage);
      } else dep = base / life;
      dep = Math.max(0, dep);
      acc += dep;
      bv -= dep;
      const ys = start == null ? null : addMonths(start, 12 * (y - 1));
      const ye = start == null ? null : addMonths(start, 12 * y);
      rows.push({ year: y, start: ys, end: ye, startISO: ys == null ? '' : fromDay(ys), dep, accumulated: acc, bookValue: bv });
    }
    return { cost, salvage, life, method, start, rows };
  }

  // Depreciation charged between day a and day b (both inclusive).
  function depreciationBetween(schedule, a, b) {
    let total = 0;
    for (const r of schedule.rows) {
      if (r.start == null) continue;
      const len = r.end - r.start;
      if (len <= 0) continue;
      total += r.dep * overlap(r.start, r.end, a, b + 1) / len;
    }
    return total;
  }

  function accumulatedAt(schedule, d) {
    if (schedule.start == null || d < schedule.start) return 0;
    return depreciationBetween(schedule, schedule.start, d);
  }

  // ------------------------------------------------------------------ loans

  function loanSchedule(loan) {
    const P = Math.max(0, num(loan.principal));
    const r = num(loan.annualRate) / 100 / 12;
    const n = Math.max(1, Math.round(num(loan.months) || 1));
    const type = loan.type || 'annuity';
    const start = toDay(loan.startDate);
    const payment = type === 'annuity' ? pmt(r, n, P) : null;
    const rows = [];
    let bal = P;
    for (let i = 1; i <= n; i++) {
      const interest = bal * r;
      let principal;
      if (type === 'equal') principal = P / n;
      else if (type === 'bullet') principal = i === n ? bal : 0;
      else principal = payment - interest;
      if (i === n) principal = bal; // absorb rounding in the final installment
      bal = Math.max(0, bal - principal);
      const due = start == null ? null : addMonths(start, i);
      rows.push({ no: i, due, dueISO: due == null ? '' : fromDay(due), payment: principal + interest, interest, principal, balance: bal });
    }
    return {
      principal: P, monthlyRate: r, months: n, type, start, rows,
      payment: payment != null ? payment : rows.length ? rows[0].payment : 0,
      totalInterest: sum(rows, x => x.interest),
      totalPaid: sum(rows, x => x.payment)
    };
  }

  function loanPeriodStats(s, period) {
    const out = { interest: 0, principal: 0, payments: 0, balance: 0, currentPortion: 0, received: false };
    if (s.start == null) {
      // Undated loan: treat as running from the start of the period.
      out.balance = s.principal;
      return out;
    }
    out.received = s.start >= period.from && s.start <= period.to;
    let paidPrincipal = 0;
    for (const r of s.rows) {
      if (r.due >= period.from && r.due <= period.to) {
        out.interest += r.interest;
        out.principal += r.principal;
        out.payments += r.payment;
      }
      if (r.due <= period.to) paidPrincipal += r.principal;
      else if (r.due <= period.to + 365) out.currentPortion += r.principal;
    }
    out.balance = s.start > period.to ? 0 : Math.max(0, s.principal - paidPrincipal);
    return out;
  }

  // ------------------------------------------------------------------- tax

  function progressiveTax(income, brackets) {
    if (income <= 0) return 0;
    let prev = 0;
    let tax = 0;
    for (const b of brackets || []) {
      const cap = isBlank(b.upTo) ? Infinity : num(b.upTo);
      if (cap <= prev) continue;
      if (income > prev) tax += (Math.min(income, cap) - prev) * num(b.rate) / 100;
      prev = cap;
      if (income <= cap) break;
    }
    return tax;
  }

  function incomeTax(pbt, taxSettings) {
    const t = taxSettings || {};
    if (t.mode === 'flat') return Math.max(0, pbt) * num(t.flatRate) / 100;
    if (t.mode === 'brackets') return progressiveTax(pbt, t.brackets);
    return 0;
  }

  // --------------------------------------------------------- the whole job

  function compute(job, opts) {
    opts = opts || {};
    const s = job.settings || {};
    const period = effectivePeriod(job, opts.today);
    const yearFraction = period.days / 365;

    // Transactions
    const rows = (job.transactions || []).map(tx => ({ tx, v: txValues(tx, job), inPeriod: inPeriod(tx.date, period) }));
    const cur = rows.filter(r => r.inPeriod);
    const agg = aggregate(cur);

    // Assets
    const assets = (job.assets || []).map(asset => {
      const sch = assetSchedule(asset, period.from);
      const periodDep = s.autoDepreciation === false ? 0 : depreciationBetween(sch, period.from, period.to);
      const acc = accumulatedAt(sch, period.to);
      const owned = sch.start == null || sch.start <= period.to;
      return {
        asset, schedule: sch, periodDep, accumulated: acc,
        nbv: owned ? sch.cost - acc : 0,
        purchasedInPeriod: sch.start == null ? true : sch.start >= period.from && sch.start <= period.to
      };
    });
    const depreciation = sum(assets, a => a.periodDep);

    // Loans
    const loans = (job.loans || []).map(loan => {
      const sch = loanSchedule(loan);
      return { loan, schedule: sch, stats: loanPeriodStats(sch, period) };
    });
    const financeCosts = s.autoLoanInterest === false ? 0 : sum(loans, l => l.stats.interest);

    // Profit and loss
    const pl = {};
    pl.revenue = agg.revenue;
    pl.returns = agg.returns;
    pl.netRevenue = agg.revenue - agg.returns;
    pl.cogs = agg.cogs;
    pl.grossProfit = pl.netRevenue - pl.cogs;
    pl.opex = agg.opex;
    pl.ebitda = pl.grossProfit - pl.opex;
    pl.depreciation = depreciation;
    pl.operatingProfit = pl.ebitda - depreciation;
    pl.otherIncome = agg.otherIncome;
    pl.otherExpense = agg.otherExpense;
    pl.financeCosts = financeCosts;
    pl.pbt = pl.operatingProfit + pl.otherIncome - pl.otherExpense - financeCosts;
    pl.incomeTax = incomeTax(pl.pbt, s.tax);
    pl.totalCosts = pl.cogs + pl.opex + depreciation + pl.otherExpense + financeCosts;
    pl.totalIncome = pl.netRevenue + pl.otherIncome;

    // VAT return
    const vat = { output: 0, outputReturns: 0, input: 0, salesBase: 0, purchasesBase: 0 };
    for (const r of cur) {
      const k = KINDS[kindOf(r.tx)];
      if (k.group === 'income') { vat.output += r.v.vat; if (r.v.vat) vat.salesBase += r.v.net; }
      else if (k.group === 'contra') { vat.outputReturns += r.v.vat; if (r.v.vat) vat.salesBase -= r.v.net; }
      else { vat.input += r.v.vat; if (r.v.vat) vat.purchasesBase += r.v.net; }
    }
    vat.netOutput = vat.output - vat.outputReturns;
    vat.net = vat.netOutput - vat.input;
    vat.paid = num(s.vat && s.vat.paidToAuthority);
    vat.balance = vat.net - vat.paid;

    // Receivables / payables (outstanding at period end)
    const totals = { receivables: 0, payables: 0, collections: 0, refunds: 0, payments: 0, incomeGross: 0, costGross: 0 };
    for (const r of cur) {
      const g = KINDS[kindOf(r.tx)].group;
      if (g === 'income') { totals.receivables += r.v.balance; totals.collections += r.v.paid; totals.incomeGross += r.v.gross; }
      else if (g === 'contra') { totals.payables += r.v.balance; totals.refunds += r.v.paid; }
      else { totals.payables += r.v.balance; totals.payments += r.v.paid; totals.costGross += r.v.gross; }
    }

    // Partners' capital movements during the period
    const partners = job.partners || [];
    const capitalIn = sum(partners.filter(p => inPeriod(p.joinDate, period)), p => p.capital);
    const drawingsTotal = sum(partners, p => p.drawings);

    // Cash flow (direct method, estimated)
    const cash = {};
    cash.opening = num(job.position && job.position.openingCash);
    cash.collections = totals.collections;
    cash.refunds = totals.refunds;
    cash.payments = totals.payments;
    cash.vatPaid = vat.paid;
    cash.operating = cash.collections - cash.refunds - cash.payments - cash.vatPaid;
    cash.assetPurchases = sum(assets.filter(a => a.purchasedInPeriod), a => a.schedule.cost);
    cash.investing = -cash.assetPurchases;
    cash.capitalIn = capitalIn;
    cash.loansIn = sum(loans.filter(l => l.stats.received), l => l.schedule.principal);
    cash.loanPayments = sum(loans, l => l.stats.payments);
    cash.drawings = drawingsTotal;
    cash.financing = cash.capitalIn + cash.loansIn - cash.loanPayments - cash.drawings;
    cash.netChange = cash.operating + cash.investing + cash.financing;
    cash.closing = cash.opening + cash.netChange;

    // Financial position at period end (before profit appropriation)
    const pos = job.position || {};
    const position = {};
    position.cash = isBlank(pos.cashOverride) ? cash.closing : num(pos.cashOverride);
    position.receivables = totals.receivables;
    position.inventory = num(pos.inventory);
    position.otherCurrentAssets = num(pos.otherCurrentAssets);
    position.vatCredit = vat.balance < 0 ? -vat.balance : 0;
    position.currentAssets = position.cash + position.receivables + position.inventory + position.otherCurrentAssets + position.vatCredit;
    position.fixedAssets = sum(assets, a => a.nbv);
    position.totalAssets = position.currentAssets + position.fixedAssets;
    position.payables = totals.payables;
    position.vatPayable = vat.balance > 0 ? vat.balance : 0;
    position.otherCurrentLiabilities = num(pos.otherCurrentLiabilities);
    position.loanCurrent = sum(loans, l => Math.min(l.stats.currentPortion, l.stats.balance));
    position.loanNonCurrent = sum(loans, l => l.stats.balance) - position.loanCurrent;

    // Zakat
    const z = s.zakat || {};
    const zakat = { mode: z.mode || 'none', rate: num(z.rate), nisab: num(z.nisab), base: 0, amount: 0, belowNisab: false };
    if (zakat.mode === 'profit') zakat.base = Math.max(0, pl.pbt - pl.incomeTax);
    else if (zakat.mode === 'netAssets') {
      zakat.base = Math.max(0, position.cash + position.receivables + position.inventory + position.otherCurrentAssets
        - position.payables - position.vatPayable - position.otherCurrentLiabilities - position.loanCurrent);
    } else if (zakat.mode === 'manual') zakat.base = Math.max(0, num(z.manualBase));
    if (zakat.mode !== 'none') {
      zakat.belowNisab = zakat.base < zakat.nisab;
      zakat.amount = zakat.belowNisab ? 0 : zakat.base * zakat.rate / 100;
    }
    pl.zakat = zakat.amount;
    pl.netProfit = pl.pbt - pl.incomeTax - pl.zakat;
    pl.grossMargin = div(pl.grossProfit, pl.netRevenue);
    pl.ebitdaMargin = div(pl.ebitda, pl.netRevenue);
    pl.operatingMargin = div(pl.operatingProfit, pl.netRevenue);
    pl.netMargin = div(pl.netProfit, pl.netRevenue);
    pl.effectiveTaxRate = div(pl.incomeTax, pl.pbt > 0 ? pl.pbt : 0);

    position.taxPayable = pl.incomeTax;
    position.zakatPayable = pl.zakat;
    position.currentLiabilities = position.payables + position.vatPayable + position.taxPayable + position.zakatPayable
      + position.otherCurrentLiabilities + position.loanCurrent;
    position.totalLiabilities = position.currentLiabilities + position.loanNonCurrent;
    position.equity = position.totalAssets - position.totalLiabilities;
    position.workingCapital = position.currentAssets - position.currentLiabilities;

    const tax = { mode: (s.tax && s.tax.mode) || 'none', base: Math.max(0, pl.pbt), amount: pl.incomeTax, effectiveRate: pl.effectiveTaxRate };

    const distribution = distribute(job, pl.netProfit, period);
    const sections = sectionResults(job, cur, assets);

    const capitalTotal = sum(partners, p => p.capital);
    const ratios = {
      grossMargin: pl.grossMargin,
      ebitdaMargin: pl.ebitdaMargin,
      operatingMargin: pl.operatingMargin,
      netMargin: pl.netMargin,
      costRatio: div(pl.totalCosts, pl.totalIncome),
      opexRatio: div(pl.opex, pl.netRevenue),
      returnOnCapital: div(pl.netProfit, capitalTotal),
      roe: div(pl.netProfit, position.equity > 0 ? position.equity : 0),
      roa: div(pl.netProfit, position.totalAssets),
      currentRatio: div(position.currentAssets, position.currentLiabilities),
      quickRatio: div(position.currentAssets - position.inventory, position.currentLiabilities),
      debtToEquity: div(position.totalLiabilities, position.equity > 0 ? position.equity : 0),
      workingCapital: position.workingCapital,
      collectionRate: div(totals.collections, totals.incomeGross),
      receivableDays: div(totals.receivables * period.days, totals.incomeGross),
      payableDays: div(totals.payables * period.days, totals.costGross),
      interestCover: div(pl.operatingProfit, financeCosts)
    };

    // Break-even taken straight from the ledger: cost of sales is treated as
    // variable, everything else as fixed.
    const fixed = pl.opex + depreciation + financeCosts + pl.otherExpense;
    const vcRatio = div(pl.cogs, pl.netRevenue);
    const ledgerBE = { fixedCosts: fixed, variableRatio: vcRatio, contributionRatio: vcRatio == null ? null : 1 - vcRatio, revenue: null, marginOfSafety: null };
    if (vcRatio != null && vcRatio < 1) {
      ledgerBE.revenue = fixed / (1 - vcRatio);
      ledgerBE.marginOfSafety = div(pl.netRevenue - ledgerBE.revenue, pl.netRevenue);
    }

    return {
      period, yearFraction, rows, current: cur, kinds: agg, pl, vat, tax, zakat, totals,
      assets, loans, cash, position, distribution, sections, ratios,
      breakEven: { ledger: ledgerBE, manual: breakEven(job.breakEven || {}) },
      monthly: monthlySeries(cur, period, opts.maxBuckets),
      categories: categoryBreakdown(cur),
      parties: partyBalances(cur),
      capitalTotal
    };
  }

  // ------------------------------------------- partners and profit sharing

  function distribute(job, netProfit, period) {
    const s = (job.settings && job.settings.partners) || {};
    const r = (job.settings && job.settings.reserves) || {};
    const method = s.method || 'manual';
    const partners = job.partners || [];
    const out = { method, netProfit, warnings: [] };

    out.legalReserve = netProfit > 0 ? netProfit * num(r.legalPct) / 100 : 0;
    out.otherReserve = netProfit > 0 ? netProfit * num(r.otherPct) / 100 : 0;
    out.reserves = out.legalReserve + out.otherReserve;
    out.afterReserves = netProfit - out.reserves;

    const rate = num(s.interestOnCapitalRate) / 100;
    const rows = partners.map(p => {
      const join = toDay(p.joinDate);
      const startP = join == null ? period.from : Math.max(period.from, join);
      const days = join != null && join > period.to ? 0 : Math.max(0, period.to - startP + 1);
      return {
        partner: p,
        capital: num(p.capital),
        shares: num(p.shares),
        days,
        weighted: num(p.capital) * days,
        salary: num(p.salary),
        interest: num(p.capital) * rate * days / 365,
        bonus: out.afterReserves > 0 ? out.afterReserves * num(p.bonusPct) / 100 : 0,
        drawings: num(p.drawings)
      };
    });
    out.salaries = sum(rows, x => x.salary);
    out.interest = sum(rows, x => x.interest);
    out.bonuses = sum(rows, x => x.bonus);
    out.distributable = out.afterReserves - out.salaries - out.interest - out.bonuses;

    let basisTotal = 0;
    for (const x of rows) {
      if (method === 'capital') x.basis = x.capital;
      else if (method === 'shares') x.basis = x.shares;
      else if (method === 'weighted') x.basis = x.weighted;
      else x.basis = num(x.partner.sharePct);
    }
    basisTotal = sum(rows, x => x.basis);
    for (const x of rows) {
      if (method === 'manual') x.ratio = x.basis / 100;
      else x.ratio = basisTotal ? x.basis / basisTotal : 0;
      x.residual = out.distributable * x.ratio;
      x.total = x.salary + x.interest + x.bonus + x.residual;
      x.due = x.total - x.drawings;
      x.closingCapital = x.capital + x.total - x.drawings;
    }
    out.ratioTotal = sum(rows, x => x.ratio);
    out.unallocated = out.distributable * (1 - out.ratioTotal);
    if (!rows.length) out.unallocated = out.distributable;
    if (method === 'manual' && rows.length && Math.abs(basisTotal - 100) > 1e-6) out.warnings.push({ key: 'warnSharesNot100', total: basisTotal });
    if (method !== 'manual' && rows.length && !basisTotal) out.warnings.push({ key: 'warnNoBasis' });
    const bonusPct = sum(partners, p => p.bonusPct);
    if (bonusPct > 100) out.warnings.push({ key: 'warnBonusOver100', total: bonusPct });
    out.totalShares = sum(rows, x => x.shares);
    out.profitPerShare = out.totalShares ? out.distributable / out.totalShares : null;
    out.rows = rows;
    out.capitalTotal = sum(rows, x => x.capital);
    out.drawingsTotal = sum(rows, x => x.drawings);
    out.allocatedTotal = sum(rows, x => x.total);
    return out;
  }

  // ------------------------------------------------------- sections / parts

  function sectionResults(job, cur, assets) {
    const allocate = !!(job.settings && job.settings.allocateShared);
    const list = (job.sections || []).map(sec => ({ id: sec.id, name: sec.name, color: sec.color }));
    const known = new Set(list.map(x => x.id));
    const unassigned = { id: '', name: '', unassigned: true };
    const all = list.concat([unassigned]);
    const byId = new Map(all.map(x => [x.id, x]));
    for (const x of all) { Object.assign(x, emptyAgg()); x.depreciation = 0; x.count = 0; }
    for (const r of cur) {
      const id = known.has(r.tx.sectionId) ? r.tx.sectionId : '';
      const x = byId.get(id);
      x[kindOf(r.tx)] += r.v.net;
      x.count++;
    }
    for (const a of assets) {
      const id = known.has(a.asset.sectionId) ? a.asset.sectionId : '';
      byId.get(id).depreciation += a.periodDep;
    }
    for (const x of all) {
      x.netRevenue = x.revenue - x.returns;
      x.directCosts = x.cogs;
      x.grossProfit = x.netRevenue - x.cogs;
      x.costs = x.cogs + x.opex + x.otherExpense + x.depreciation;
      x.profit = x.netRevenue + x.otherIncome - x.costs;
      x.margin = div(x.profit, x.netRevenue);
    }
    const totalRevenue = sum(list, x => x.netRevenue);
    const shared = unassigned.costs - unassigned.netRevenue - unassigned.otherIncome;
    for (const x of list) {
      x.revenueShare = div(x.netRevenue, totalRevenue);
      x.allocatedShared = allocate && x.revenueShare != null ? shared * x.revenueShare : 0;
      x.profitAfterAllocation = x.profit - x.allocatedShared;
    }
    const hasUnassigned = unassigned.count > 0 || unassigned.depreciation > 0;
    return { list, unassigned, hasUnassigned, sharedNet: shared, allocate, totalRevenue };
  }

  // --------------------------------------------------- breakdowns & series

  function categoryBreakdown(cur) {
    const income = new Map();
    const expense = new Map();
    for (const r of cur) {
      const g = KINDS[kindOf(r.tx)].group;
      const name = (r.tx.category || '').trim();
      if (g === 'cost') expense.set(name, (expense.get(name) || 0) + r.v.net);
      else income.set(name, (income.get(name) || 0) + (g === 'contra' ? -r.v.net : r.v.net));
    }
    const toList = m => Array.from(m, ([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    return { income: toList(income), expense: toList(expense) };
  }

  function partyBalances(cur) {
    const m = new Map();
    for (const r of cur) {
      const name = (r.tx.party || '').trim();
      if (!name) continue;
      const x = m.get(name) || { name, sales: 0, purchases: 0, receivable: 0, payable: 0 };
      const g = KINDS[kindOf(r.tx)].group;
      if (g === 'income') { x.sales += r.v.gross; x.receivable += r.v.balance; }
      else if (g === 'contra') { x.sales -= r.v.gross; x.payable += r.v.balance; }
      else { x.purchases += r.v.gross; x.payable += r.v.balance; }
      m.set(name, x);
    }
    return Array.from(m.values()).sort((a, b) => (b.receivable + b.payable) - (a.receivable + a.payable) || a.name.localeCompare(b.name));
  }

  function monthlySeries(cur, period, maxBuckets) {
    const start = new Date(period.from * DAY_MS);
    const end = new Date(period.to * DAY_MS);
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
    const limit = maxBuckets || 24;
    const step = months <= limit ? 1 : months <= limit * 3 ? 3 : 12;
    const granularity = step === 1 ? 'month' : step === 3 ? 'quarter' : 'year';
    let y0 = start.getUTCFullYear();
    let m0 = start.getUTCMonth();
    if (step === 3) m0 -= m0 % 3;
    if (step === 12) m0 = 0;
    const buckets = [];
    const keyOf = (y, m) => y * 12 + m;
    const firstKey = keyOf(y0, m0);
    for (let k = firstKey; k <= keyOf(end.getUTCFullYear(), end.getUTCMonth()); k += step) {
      buckets.push({ year: Math.floor(k / 12), month: k % 12, income: 0, expenses: 0, result: 0 });
    }
    let undated = 0;
    for (const r of cur) {
      const d = toDay(r.tx.date);
      if (d == null) { undated++; continue; }
      const dt = new Date(d * DAY_MS);
      const idx = Math.floor((keyOf(dt.getUTCFullYear(), dt.getUTCMonth()) - firstKey) / step);
      const b = buckets[idx];
      if (!b) continue;
      const g = KINDS[kindOf(r.tx)].group;
      if (g === 'income') b.income += r.v.net;
      else if (g === 'contra') b.income -= r.v.net;
      else b.expenses += r.v.net;
    }
    for (const b of buckets) b.result = b.income - b.expenses;
    return { granularity, buckets, undated };
  }

  // ----------------------------------------------------------- break-even

  function breakEven(input) {
    const fc = num(input.fixedCosts);
    const price = num(input.price);
    const vc = num(input.variableCost);
    const units = num(input.expectedUnits);
    const target = num(input.targetProfit);
    const cm = price - vc;
    const out = { contributionMargin: cm, contributionRatio: div(cm, price), units: null, revenue: null, targetUnits: null, targetRevenue: null, expectedProfit: null, marginOfSafetyUnits: null, marginOfSafety: null, operatingLeverage: null, valid: cm > 0 };
    if (cm > 0) {
      out.units = fc / cm;
      out.revenue = out.units * price;
      out.targetUnits = (fc + target) / cm;
      out.targetRevenue = out.targetUnits * price;
      if (units) {
        out.expectedProfit = units * cm - fc;
        out.marginOfSafetyUnits = units - out.units;
        out.marginOfSafety = div(out.marginOfSafetyUnits, units);
        out.operatingLeverage = div(units * cm, out.expectedProfit);
      }
    }
    return out;
  }

  // ---------------------------------------------------- finance functions

  function pmt(rate, n, pv) {
    if (n <= 0) return 0;
    if (!rate) return pv / n;
    return pv * rate / (1 - Math.pow(1 + rate, -n));
  }

  function futureValue(pv, annualRate, years, perYear, contribution) {
    const k = Math.max(1, Math.round(perYear || 1));
    const r = annualRate / 100 / k;
    const n = Math.round(years * k);
    const growth = Math.pow(1 + r, n);
    const fvPv = pv * growth;
    const fvC = r ? contribution * (growth - 1) / r : contribution * n;
    const fv = fvPv + fvC;
    const invested = pv + contribution * n;
    return { fv, invested, gain: fv - invested, periods: n };
  }

  function npv(rate, flows) {
    let v = 0;
    for (let t = 0; t < flows.length; t++) v += flows[t] / Math.pow(1 + rate, t);
    return v;
  }

  function irr(flows) {
    const hasPos = flows.some(x => x > 0);
    const hasNeg = flows.some(x => x < 0);
    if (!hasPos || !hasNeg) return null;
    let r = 0.1;
    for (let i = 0; i < 100; i++) {
      let f = 0, df = 0;
      for (let t = 0; t < flows.length; t++) {
        f += flows[t] / Math.pow(1 + r, t);
        df -= t * flows[t] / Math.pow(1 + r, t + 1);
      }
      if (Math.abs(f) < 1e-9) return r;
      if (!df) break;
      const next = r - f / df;
      if (!isFinite(next) || next <= -0.9999) break;
      if (Math.abs(next - r) < 1e-12) return next;
      r = next;
    }
    // Fall back to bisection over a wide bracket.
    let lo = -0.9999, hi = 10;
    let flo = npv(lo, flows), fhi = npv(hi, flows);
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2;
      const fm = npv(mid, flows);
      if (Math.abs(fm) < 1e-9) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  function payback(flows, rate) {
    let cum = 0;
    for (let t = 0; t < flows.length; t++) {
      const f = rate ? flows[t] / Math.pow(1 + rate, t) : flows[t];
      const prev = cum;
      cum += f;
      if (t > 0 && prev < 0 && cum >= 0) return t - 1 + (-prev / f);
      if (t === 0 && cum >= 0) return 0;
    }
    return null;
  }

  function parseList(text) {
    return String(text || '')
      .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/٫/g, '.')
      .split(/[\s;،,|]+/)
      .filter(Boolean)
      .map(x => parseFloat(x))
      .filter(x => isFinite(x));
  }

  const calculators = {
    percentOf: (pct, base) => num(base) * num(pct) / 100,
    whatPercent: (part, base) => div(num(part) * 100, num(base)),
    percentChange: (from, to) => div((num(to) - num(from)) * 100, Math.abs(num(from))),
    vatAdd: (net, rate) => { const v = num(net) * num(rate) / 100; return { net: num(net), vat: v, gross: num(net) + v }; },
    vatExtract: (gross, rate) => { const n = num(gross) / (1 + num(rate) / 100); return { net: n, vat: num(gross) - n, gross: num(gross) }; },
    priceFromMarkup: (cost, markupPct) => num(cost) * (1 + num(markupPct) / 100),
    priceFromMargin: (cost, marginPct) => num(marginPct) >= 100 ? null : num(cost) / (1 - num(marginPct) / 100),
    marginMarkup: (cost, price) => ({ profit: num(price) - num(cost), margin: div((num(price) - num(cost)) * 100, num(price)), markup: div((num(price) - num(cost)) * 100, num(cost)) }),
    discount: (price, pct) => ({ discount: num(price) * num(pct) / 100, final: num(price) * (1 - num(pct) / 100) }),
    loan: (principal, annualRate, months) => {
      const s = loanSchedule({ principal, annualRate, months, type: 'annuity' });
      return { payment: s.payment, totalInterest: s.totalInterest, totalPaid: s.totalPaid };
    },
    simpleInterest: (principal, annualRate, years) => { const i = num(principal) * num(annualRate) / 100 * num(years); return { interest: i, total: num(principal) + i }; },
    futureValue: (pv, rate, years, perYear, contribution) => futureValue(num(pv), num(rate), num(years), num(perYear), num(contribution)),
    investment: (rate, initial, flowsText) => {
      const flows = [-Math.abs(num(initial))].concat(parseList(flowsText));
      const r = num(rate) / 100;
      const presentInflows = npv(r, [0].concat(flows.slice(1)));
      return {
        flows,
        npv: npv(r, flows),
        irr: irr(flows),
        payback: payback(flows, 0),
        discountedPayback: payback(flows, r),
        profitabilityIndex: div(presentInflows, Math.abs(flows[0]))
      };
    },
    roi: (cost, value, years) => {
      const c = num(cost), v = num(value), y = num(years);
      return { gain: v - c, roi: div((v - c) * 100, c), cagr: c > 0 && v > 0 && y > 0 ? (Math.pow(v / c, 1 / y) - 1) * 100 : null };
    },
    convert: (amount, rate) => num(amount) * num(rate)
  };

  return {
    KINDS, KIND_KEYS, num, sum, div, round, isBlank,
    toDay, fromDay, addMonths, todayDay,
    txValues, effectivePeriod, inPeriod,
    assetSchedule, depreciationBetween, accumulatedAt,
    loanSchedule, loanPeriodStats,
    progressiveTax, incomeTax,
    compute, distribute, breakEven,
    pmt, npv, irr, payback, futureValue, parseList,
    calculators
  };
});
