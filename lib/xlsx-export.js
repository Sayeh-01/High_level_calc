'use strict';
/*
 * Builds an Excel workbook for one job. Figures the user typed are written as
 * blue inputs; totals are live formulas (black, or green when they pull from
 * another sheet) so the workbook keeps recalculating if someone edits it.
 * Every formula also carries the value High Level Calc computed, so viewers
 * that do not recalculate still show the right numbers.
 */
const ExcelJS = require('exceljs');
const C = require('../src/js/calc.js');
const I = require('../src/js/i18n.js');

const FONT = 'Arial';
const BLUE = 'FF0000FF';
const GREEN = 'FF008000';
const BLACK = 'FF000000';
const GREY = 'FF666666';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3ECE6' } };
const INPUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
const NUM = '#,##0.00;(#,##0.00);"-"';
const PCT = '0.0%;(0.0%);"-"';
const DATE = 'yyyy-mm-dd';

const q = name => "'" + String(name).replace(/'/g, "''") + "'";
const colLetter = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const asDate = iso => { const d = C.toDay(iso); return d == null ? null : new Date(d * 86400000); };
const safeSheetName = s => String(s).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

function style(cell, opts) {
  cell.font = { name: FONT, size: 10, color: { argb: opts.color || BLACK }, bold: !!opts.bold, italic: !!opts.italic };
  if (opts.fmt) cell.numFmt = opts.fmt;
  if (opts.fill) cell.fill = opts.fill;
  if (opts.wrap) cell.alignment = { wrapText: true, vertical: 'top' };
}

function put(ws, ref, value, opts) {
  const cell = ws.getCell(ref);
  cell.value = value;
  style(cell, opts || {});
  return cell;
}

function formula(ws, ref, f, result, opts) {
  return put(ws, ref, { formula: f, result: result == null || !isFinite(result) ? 0 : result }, opts);
}

function header(ws, row, labels, startCol) {
  labels.forEach((label, i) => {
    const cell = ws.getCell(row, (startCol || 1) + i);
    cell.value = label;
    style(cell, { bold: true, fill: HEADER_FILL, wrap: true });
  });
}

function title(ws, text, sub) {
  put(ws, 'A1', text, { bold: true });
  ws.getCell('A1').font = { name: FONT, size: 13, bold: true };
  if (sub) put(ws, 'A2', sub, { color: GREY, italic: true });
}

async function buildWorkbook(job, opts) {
  opts = opts || {};
  const lang = opts.lang === 'en' ? 'en' : 'ar';
  I.setLang(lang);
  I.setDigits('latn');
  const t = I.t;
  const R = C.compute(job, { today: opts.today });
  const cur = job.currency || 'USD';
  const yes = t('yes');
  const no = t('no');
  const rtl = lang === 'ar';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'High Level Calc';
  wb.created = new Date();
  const view = extra => [Object.assign({ rightToLeft: rtl }, extra || {})];

  const names = {
    S: safeSheetName(t('xl_settings')), T: safeSheetName(t('xl_transactions')), P: safeSheetName(t('xl_pl')),
    PA: safeSheetName(t('xl_partners')), SE: safeSheetName(t('xl_sections')), A: safeSheetName(t('xl_assets')),
    L: safeSheetName(t('xl_loans')), V: safeSheetName(t('xl_vat')), CA: safeSheetName(t('xl_cash'))
  };
  // Order of tabs in the workbook: summary first.
  const wsP = wb.addWorksheet(names.P, { views: view() });
  const wsPA = wb.addWorksheet(names.PA, { views: view() });
  const wsSE = wb.addWorksheet(names.SE, { views: view() });
  const wsT = wb.addWorksheet(names.T, { views: view({ state: 'frozen', ySplit: 1 }) });
  const wsA = wb.addWorksheet(names.A, { views: view() });
  const wsL = wb.addWorksheet(names.L, { views: view() });
  const wsV = wb.addWorksheet(names.V, { views: view() });
  const wsCA = wb.addWorksheet(names.CA, { views: view() });
  const wsS = wb.addWorksheet(names.S, { views: view() });
  const S = q(names.S), T = q(names.T), P = q(names.P), PA = q(names.PA), A = q(names.A), L = q(names.L);
  const s = job.settings || {};

  // ------------------------------------------------------------ Settings
  title(wsS, t('xl_settings') + ' — ' + (job.name || ''), t('xl_legend'));
  const settingsRows = [
    ['reportPeriod', asDate(R.period.fromISO), DATE],
    ['xl_days', null],
    ['vatRate', C.num(s.vat && s.vat.rate) / 100, PCT],
    ['taxMode', t('tax_' + ((s.tax && s.tax.mode) || 'none'))],
    ['taxFlatRate', C.num(s.tax && s.tax.flatRate) / 100, PCT],
    ['zakatMode', t('zakat_' + R.zakat.mode)],
    ['zakatRate', R.zakat.rate / 100, '0.000%'],
    ['zakatNisab', R.zakat.nisab, NUM],
    ['zakatBase', R.zakat.mode === 'profit' || R.zakat.mode === 'none' ? 0 : R.zakat.base, NUM],
    ['legalReserve', C.num(s.reserves && s.reserves.legalPct) / 100, PCT],
    ['otherReserve', C.num(s.reserves && s.reserves.otherPct) / 100, PCT],
    ['interestOnCapital', C.num(s.partners && s.partners.interestOnCapitalRate) / 100, PCT],
    ['shareMethod', t('method_' + R.distribution.method)],
    ['vatPaidToAuthority', R.vat.paid, NUM]
  ];
  const sref = {};
  settingsRows.forEach((r, i) => {
    const row = 4 + i;
    put(wsS, 'A' + row, t(r[0]), { bold: false });
    sref[r[0]] = S + '!$B$' + row;
    if (r[0] === 'xl_days') {
      formula(wsS, 'B' + row, 'C4-B4+1', R.period.days, { fmt: '0' });
    } else {
      put(wsS, 'B' + row, r[1], { color: BLUE, fmt: r[2] });
    }
  });
  put(wsS, 'C4', asDate(R.period.toISO), { color: BLUE, fmt: DATE });
  sref.from = S + '!$B$4';
  sref.to = S + '!$C$4';
  if (R.zakat.mode === 'netAssets') put(wsS, 'C12', t('xl_appValues'), { color: GREY, italic: true });

  const brRow = 4 + settingsRows.length + 2;
  put(wsS, 'A' + (brRow - 1), t('taxBrackets'), { bold: true });
  header(wsS, brRow, [t('xl_lower'), t('xl_upper'), t('bracketRate'), t('xl_rateStep')]);
  const brackets = (s.tax && s.tax.brackets) || [];
  const brFirst = brRow + 1;
  brackets.forEach((b, i) => {
    const r = brFirst + i;
    if (i === 0) put(wsS, 'A' + r, 0, { color: BLUE, fmt: NUM });
    else formula(wsS, 'A' + r, 'B' + (r - 1), C.num(brackets[i - 1].upTo), { fmt: NUM });
    put(wsS, 'B' + r, C.isBlank(b.upTo) ? null : C.num(b.upTo), { color: BLUE, fmt: NUM });
    put(wsS, 'C' + r, C.num(b.rate) / 100, { color: BLUE, fmt: PCT });
    if (i === 0) formula(wsS, 'D' + r, 'C' + r, C.num(b.rate) / 100, { fmt: PCT });
    else formula(wsS, 'D' + r, 'C' + r + '-C' + (r - 1), (C.num(b.rate) - C.num(brackets[i - 1].rate)) / 100, { fmt: PCT });
  });
  const brLast = brFirst + Math.max(brackets.length, 1) - 1;
  put(wsS, 'A' + (brLast + 2), t('xl_unbounded'), { color: GREY, italic: true });
  wsS.getColumn(1).width = 42; wsS.getColumn(2).width = 18; wsS.getColumn(3).width = 18; wsS.getColumn(4).width = 14;

  // -------------------------------------------------------- Transactions
  const sectionName = id => {
    const sec = (job.sections || []).find(x => x.id === id);
    return sec ? sec.name : t('unassigned');
  };
  header(wsT, 1, [t('date'), t('colType'), t('colSection'), t('colCategory'), t('colDescription'), t('colParty'),
    t('f_qty'), t('f_unitPrice'), t('colNet') + ' (' + cur + ')', t('f_vatRate'), t('colVat'), t('colGross'), t('colPaid'), t('colBalance'), t('xl_inPeriod'), t('xl_code')]);
  R.rows.forEach((r, i) => {
    const row = 2 + i;
    const tx = r.tx;
    put(wsT, 'A' + row, asDate(tx.date), { color: BLUE, fmt: DATE });
    put(wsT, 'B' + row, t('kind_' + (C.KINDS[tx.kind] ? tx.kind : 'opex')), { color: BLUE });
    put(wsT, 'C' + row, sectionName(tx.sectionId), { color: BLUE });
    put(wsT, 'D' + row, tx.category || '', { color: BLUE });
    put(wsT, 'E' + row, tx.description || '', { color: BLUE });
    put(wsT, 'F' + row, tx.party || '', { color: BLUE });
    put(wsT, 'G' + row, C.num(tx.qty) || null, { color: BLUE, fmt: '#,##0.###' });
    put(wsT, 'H' + row, C.num(tx.unitPrice) || null, { color: BLUE, fmt: NUM });
    put(wsT, 'I' + row, r.v.net, { color: BLUE, fmt: NUM });
    put(wsT, 'J' + row, r.v.rate / 100, { color: BLUE, fmt: PCT });
    formula(wsT, 'K' + row, `I${row}*J${row}`, r.v.vat, { fmt: NUM });
    formula(wsT, 'L' + row, `I${row}+K${row}`, r.v.gross, { fmt: NUM });
    if ((tx.status || 'paid') === 'paid') formula(wsT, 'M' + row, `L${row}`, r.v.paid, { fmt: NUM });
    else put(wsT, 'M' + row, r.v.paid, { color: BLUE, fmt: NUM });
    formula(wsT, 'N' + row, `L${row}-M${row}`, r.v.balance, { fmt: NUM });
    put(wsT, 'O' + row, r.inPeriod ? yes : no, { color: BLUE });
    put(wsT, 'P' + row, C.KINDS[tx.kind] ? tx.kind : 'opex', { color: GREY });
  });
  const tLast = Math.max(2, 1 + R.rows.length);
  wsT.autoFilter = { from: 'A1', to: 'P' + tLast };
  [12, 22, 18, 18, 30, 22, 9, 12, 14, 9, 12, 14, 14, 14, 10, 12].forEach((w, i) => { wsT.getColumn(i + 1).width = w; });
  const tcol = c => `${T}!$${c}$2:$${c}$${tLast}`;
  const sumifs = (col, code, extra) => `SUMIFS(${tcol(col)},${tcol('P')},"${code}",${tcol('O')},"${yes}"${extra || ''})`;

  // ---------------------------------------------------------------- Assets
  title(wsA, t('nav_assets'), t('xl_appValues'));
  header(wsA, 3, [t('a_name'), t('a_section'), t('a_cost'), t('a_salvage'), t('a_life'), t('a_method'), t('a_start'), t('a_periodDep'), t('a_accumulated'), t('a_bookValue')]);
  const aFirst = 4;
  R.assets.forEach((a, i) => {
    const row = aFirst + i;
    put(wsA, 'A' + row, a.asset.name || '', { color: BLUE });
    put(wsA, 'B' + row, sectionName(a.asset.sectionId), { color: BLUE });
    put(wsA, 'C' + row, a.schedule.cost, { color: BLUE, fmt: NUM });
    put(wsA, 'D' + row, a.schedule.salvage, { color: BLUE, fmt: NUM });
    put(wsA, 'E' + row, a.schedule.life, { color: BLUE, fmt: '0' });
    put(wsA, 'F' + row, t('method_' + a.schedule.method), { color: BLUE });
    put(wsA, 'G' + row, asDate(a.asset.startDate), { color: BLUE, fmt: DATE });
    put(wsA, 'H' + row, a.periodDep, { color: GREY, fmt: NUM });
    put(wsA, 'I' + row, a.accumulated, { color: GREY, fmt: NUM });
    formula(wsA, 'J' + row, `IF(G${row}>${sref.to},0,C${row}-I${row})`, a.nbv, { fmt: NUM });
  });
  const aTotal = aFirst + R.assets.length;
  put(wsA, 'A' + aTotal, t('total'), { bold: true });
  ['C', 'H', 'I', 'J'].forEach(c => {
    const vals = { C: C.sum(R.assets, a => a.schedule.cost), H: R.pl.depreciation, I: C.sum(R.assets, a => a.accumulated), J: R.position.fixedAssets };
    formula(wsA, c + aTotal, R.assets.length ? `SUM(${c}${aFirst}:${c}${aTotal - 1})` : '0', vals[c], { fmt: NUM, bold: true });
  });
  let ar = aTotal + 3;
  R.assets.forEach((a, i) => {
    const src = aFirst + i;
    put(wsA, 'A' + ar, t('scheduleTitle', { name: a.asset.name || '' }), { bold: true });
    header(wsA, ar + 1, [t('s_year'), t('s_starts'), t('s_dep'), t('s_acc'), t('s_bv')]);
    const first = ar + 2;
    a.schedule.rows.forEach((y, k) => {
      const row = first + k;
      put(wsA, 'A' + row, y.year, { fmt: '0' });
      put(wsA, 'B' + row, asDate(y.startISO), { fmt: DATE, color: GREY });
      const m = a.schedule.method;
      const f = m === 'none' ? '0'
        : m === 'syd' ? `SYD($C$${src},$D$${src},$E$${src},A${row})`
        : m === 'ddb' ? `VDB($C$${src},$D$${src},$E$${src},A${row}-1,A${row})`
        : `SLN($C$${src},$D$${src},$E$${src})`;
      formula(wsA, 'C' + row, f, y.dep, { fmt: NUM });
      formula(wsA, 'D' + row, `SUM(C$${first}:C${row})`, y.accumulated, { fmt: NUM });
      formula(wsA, 'E' + row, `$C$${src}-D${row}`, y.bookValue, { fmt: NUM });
    });
    ar = first + a.schedule.rows.length + 2;
  });
  [28, 18, 14, 14, 12, 24, 13, 16, 16, 16].forEach((w, i) => { wsA.getColumn(i + 1).width = w; });

  // ----------------------------------------------------------------- Loans
  title(wsL, t('nav_loans'), t('xl_appValues'));
  header(wsL, 3, [t('l_name'), t('l_principal'), t('l_rate'), t('l_months'), t('l_type'), t('l_start'), t('l_payment'), t('l_totalInterest'), t('l_periodInterest'), t('l_balance')]);
  const lFirst = 4;
  const lTotal = lFirst + R.loans.length;
  let lr = lTotal + 3;
  R.loans.forEach((l, i) => {
    const row = lFirst + i;
    const sch = l.schedule;
    put(wsL, 'A' + row, l.loan.name || '', { color: BLUE });
    put(wsL, 'B' + row, sch.principal, { color: BLUE, fmt: NUM });
    put(wsL, 'C' + row, C.num(l.loan.annualRate) / 100, { color: BLUE, fmt: '0.00%' });
    put(wsL, 'D' + row, sch.months, { color: BLUE, fmt: '0' });
    put(wsL, 'E' + row, t('loan_' + sch.type), { color: BLUE });
    put(wsL, 'F' + row, asDate(l.loan.startDate), { color: BLUE, fmt: DATE });
    const payF = sch.type === 'annuity' ? `IF(C${row}=0,B${row}/D${row},PMT(C${row}/12,D${row},-B${row}))`
      : sch.type === 'equal' ? `B${row}/D${row}+B${row}*C${row}/12` : `B${row}*C${row}/12`;
    formula(wsL, 'G' + row, payF, sch.rows.length ? sch.rows[0].payment : 0, { fmt: NUM });
    put(wsL, 'I' + row, l.stats.interest, { color: GREY, fmt: NUM });
    put(wsL, 'J' + row, l.stats.balance, { color: GREY, fmt: NUM });

    put(wsL, 'A' + lr, t('amortTitle', { name: l.loan.name || '' }), { bold: true });
    header(wsL, lr + 1, [t('am_no'), t('am_due'), t('xl_opening'), t('am_interest'), t('am_principal'), t('am_payment'), t('xl_closing')]);
    const first = lr + 2;
    sch.rows.forEach((x, k) => {
      const rr = first + k;
      const open = k === 0 ? sch.principal : sch.rows[k - 1].balance;
      put(wsL, 'A' + rr, x.no, { fmt: '0' });
      put(wsL, 'B' + rr, asDate(x.dueISO), { fmt: DATE, color: GREY });
      formula(wsL, 'C' + rr, k === 0 ? `$B$${row}` : `G${rr - 1}`, open, { fmt: NUM });
      formula(wsL, 'D' + rr, `C${rr}*$C$${row}/12`, x.interest, { fmt: NUM });
      const pf = sch.type === 'annuity' ? `IF(A${rr}=$D$${row},C${rr},$G$${row}-D${rr})`
        : sch.type === 'equal' ? `IF(A${rr}=$D$${row},C${rr},$B$${row}/$D$${row})`
        : `IF(A${rr}=$D$${row},C${rr},0)`;
      formula(wsL, 'E' + rr, pf, x.principal, { fmt: NUM });
      formula(wsL, 'F' + rr, `D${rr}+E${rr}`, x.payment, { fmt: NUM });
      formula(wsL, 'G' + rr, `C${rr}-E${rr}`, x.balance, { fmt: NUM });
    });
    const last = first + sch.rows.length - 1;
    formula(wsL, 'H' + row, `SUM(D${first}:D${last})`, sch.totalInterest, { fmt: NUM });
    lr = last + 3;
  });
  put(wsL, 'A' + lTotal, t('total'), { bold: true });
  formula(wsL, 'B' + lTotal, R.loans.length ? `SUM(B${lFirst}:B${lTotal - 1})` : '0', C.sum(R.loans, l => l.schedule.principal), { fmt: NUM, bold: true });
  formula(wsL, 'I' + lTotal, R.loans.length ? `SUM(I${lFirst}:I${lTotal - 1})` : '0', R.pl.financeCosts, { fmt: NUM, bold: true });
  formula(wsL, 'J' + lTotal, R.loans.length ? `SUM(J${lFirst}:J${lTotal - 1})` : '0', C.sum(R.loans, l => l.stats.balance), { fmt: NUM, bold: true });
  [28, 16, 12, 10, 24, 13, 16, 16, 16, 18].forEach((w, i) => { wsL.getColumn(i + 1).width = w; });

  // ---------------------------------------------------------- Profit & loss
  const pl = R.pl;
  title(wsP, t('pl_title') + ' — ' + (job.name || ''), t('reportPeriod') + ': ' + R.period.fromISO + ' / ' + R.period.toISO + '   ' + t('reportCurrency') + ': ' + cur);
  header(wsP, 3, ['', t('amount') + ' (' + cur + ')', t('pl_ofRevenue')]);
  const plRows = {};
  let pr = 4;
  const plLine = (key, f, value, o) => {
    plRows[key] = pr;
    put(wsP, 'A' + pr, t(key), { bold: o && o.bold });
    formula(wsP, 'B' + pr, f, value, { fmt: NUM, bold: o && o.bold, color: o && o.link ? GREEN : BLACK });
    formula(wsP, 'C' + pr, `IF($B$6=0,0,B${pr}/$B$6)`, pl.netRevenue ? value / pl.netRevenue : 0, { fmt: PCT, color: GREY });
    pr++;
  };
  const B = k => 'B' + plRows[k];
  plLine('pl_revenue', sumifs('I', 'revenue'), pl.revenue, { link: true });
  plLine('pl_returns', sumifs('I', 'returns'), pl.returns, { link: true });
  plLine('pl_netRevenue', `${B('pl_revenue')}-${B('pl_returns')}`, pl.netRevenue, { bold: true });
  plLine('pl_cogs', sumifs('I', 'cogs'), pl.cogs, { link: true });
  plLine('pl_grossProfit', `${B('pl_netRevenue')}-${B('pl_cogs')}`, pl.grossProfit, { bold: true });
  plLine('pl_opex', sumifs('I', 'opex'), pl.opex, { link: true });
  plLine('pl_ebitda', `${B('pl_grossProfit')}-${B('pl_opex')}`, pl.ebitda, { bold: true });
  plLine('pl_depreciation', `${A}!H${aTotal}`, pl.depreciation, { link: true });
  plLine('pl_operatingProfit', `${B('pl_ebitda')}-${B('pl_depreciation')}`, pl.operatingProfit, { bold: true });
  plLine('pl_otherIncome', sumifs('I', 'otherIncome'), pl.otherIncome, { link: true });
  plLine('pl_otherExpense', sumifs('I', 'otherExpense'), pl.otherExpense, { link: true });
  plLine('pl_financeCosts', `${L}!I${lTotal}`, pl.financeCosts, { link: true });
  plLine('pl_pbt', `${B('pl_operatingProfit')}+${B('pl_otherIncome')}-${B('pl_otherExpense')}-${B('pl_financeCosts')}`, pl.pbt, { bold: true });
  const pbt = B('pl_pbt');
  const taxMode = (s.tax && s.tax.mode) || 'none';
  const brA = `${S}!$A$${brFirst}:$A$${brLast}`;
  const brD = `${S}!$D$${brFirst}:$D$${brLast}`;
  const taxF = taxMode === 'flat' ? `MAX(0,${pbt})*${sref.taxFlatRate}`
    : taxMode === 'brackets' && brackets.length ? `SUMPRODUCT((${pbt}>${brA})*(${pbt}-${brA})*${brD})` : '0';
  plLine('pl_incomeTax', taxF, pl.incomeTax, { link: taxMode !== 'none' });
  const taxB = B('pl_incomeTax');
  const zakatF = R.zakat.mode === 'profit' ? `IF(MAX(0,${pbt}-${taxB})<${sref.zakatNisab},0,MAX(0,${pbt}-${taxB})*${sref.zakatRate})`
    : R.zakat.mode === 'none' ? '0' : `IF(${sref.zakatBase}<${sref.zakatNisab},0,${sref.zakatBase}*${sref.zakatRate})`;
  plLine('pl_zakat', zakatF, pl.zakat, { link: R.zakat.mode !== 'none' });
  plLine(pl.netProfit < 0 ? 'pl_netLoss' : 'pl_netProfit', `${pbt}-${taxB}-${B('pl_zakat')}`, pl.netProfit, { bold: true });
  plRows.net = pr - 1;
  wsP.getColumn(1).width = 52; wsP.getColumn(2).width = 20; wsP.getColumn(3).width = 14;

  // --------------------------------------------------------------- Partners
  const D = R.distribution;
  title(wsPA, t('d_title'), t('partnersIntro'));
  const n = D.rows.length;
  const pFirst = 14;
  const pLast = pFirst + Math.max(n, 1) - 1;
  const pcol = c => `${c}${pFirst}:${c}${pLast}`;
  const wf = [
    ['d_netProfit', `${P}!B${plRows.net}`, D.netProfit, GREEN],
    ['d_legalReserve', `IF(B3>0,B3*${sref.legalReserve},0)`, D.legalReserve, GREEN],
    ['d_otherReserve', `IF(B3>0,B3*${sref.otherReserve},0)`, D.otherReserve, GREEN],
    ['xl_afterReserves', 'B3-B4-B5', D.afterReserves],
    ['d_salaries', `SUM(${pcol('G')})`, D.salaries],
    ['d_interest', `SUM(${pcol('L')})`, D.interest],
    ['d_bonuses', `SUM(${pcol('M')})`, D.bonuses],
    ['d_distributable', 'B6-B7-B8-B9', D.distributable],
    ['unallocatedProfit', `B10-SUM(${pcol('N')})`, D.unallocated],
    ['profitPerShare', `IF(SUM(${pcol('F')})=0,0,B10/SUM(${pcol('F')}))`, D.profitPerShare || 0]
  ];
  wf.forEach((w, i) => {
    const row = 3 + i;
    put(wsPA, 'A' + row, t(w[0]), { bold: w[0] === 'd_distributable' });
    formula(wsPA, 'B' + row, w[1], w[2], { fmt: NUM, color: w[3] || BLACK, bold: w[0] === 'd_distributable' });
  });
  header(wsPA, pFirst - 1, [t('p_name'), t('p_capital'), t('p_joinDate'), t('xl_days'), t('p_sharePct'), t('p_shares'), t('p_salary'), t('p_bonusPct'), t('p_drawings'),
    t('xl_basis'), t('r_ratio'), t('r_interest'), t('r_bonus'), t('r_residual'), t('r_total'), t('r_due'), t('r_closing')]);
  const method = D.method;
  D.rows.forEach((x, i) => {
    const row = pFirst + i;
    put(wsPA, 'A' + row, x.partner.name || '', { color: BLUE });
    put(wsPA, 'B' + row, x.capital, { color: BLUE, fmt: NUM });
    put(wsPA, 'C' + row, asDate(x.partner.joinDate), { color: BLUE, fmt: DATE });
    formula(wsPA, 'D' + row, `MAX(0,${sref.to}-MAX(${sref.from},C${row})+1)`, x.days, { fmt: '0', color: GREEN });
    put(wsPA, 'E' + row, C.num(x.partner.sharePct) / 100, { color: BLUE, fmt: PCT });
    put(wsPA, 'F' + row, x.shares, { color: BLUE, fmt: '#,##0.##' });
    put(wsPA, 'G' + row, x.salary, { color: BLUE, fmt: NUM });
    put(wsPA, 'H' + row, C.num(x.partner.bonusPct) / 100, { color: BLUE, fmt: PCT });
    put(wsPA, 'I' + row, x.drawings, { color: BLUE, fmt: NUM });
    const basisF = method === 'capital' ? `B${row}` : method === 'shares' ? `F${row}` : method === 'weighted' ? `B${row}*D${row}` : `E${row}`;
    formula(wsPA, 'J' + row, basisF, method === 'manual' ? x.basis / 100 : x.basis, { fmt: method === 'manual' ? PCT : NUM });
    formula(wsPA, 'K' + row, method === 'manual' ? `J${row}` : `IF(SUM(${pcol('J')})=0,0,J${row}/SUM(${pcol('J')}))`, x.ratio, { fmt: '0.00%' });
    formula(wsPA, 'L' + row, `B${row}*${sref.interestOnCapital}*D${row}/365`, x.interest, { fmt: NUM, color: GREEN });
    formula(wsPA, 'M' + row, `IF($B$6>0,$B$6*H${row},0)`, x.bonus, { fmt: NUM });
    formula(wsPA, 'N' + row, `$B$10*K${row}`, x.residual, { fmt: NUM });
    formula(wsPA, 'O' + row, `G${row}+L${row}+M${row}+N${row}`, x.total, { fmt: NUM, bold: true });
    formula(wsPA, 'P' + row, `O${row}-I${row}`, x.due, { fmt: NUM });
    formula(wsPA, 'Q' + row, `B${row}+O${row}-I${row}`, x.closingCapital, { fmt: NUM });
  });
  const pTot = pLast + 1;
  put(wsPA, 'A' + pTot, t('total'), { bold: true });
  ['B', 'G', 'I', 'L', 'M', 'N', 'O', 'P', 'Q'].forEach(c => {
    const vals = { B: D.capitalTotal, G: D.salaries, I: D.drawingsTotal, L: D.interest, M: D.bonuses, N: C.sum(D.rows, x => x.residual), O: D.allocatedTotal, P: C.sum(D.rows, x => x.due), Q: C.sum(D.rows, x => x.closingCapital) };
    formula(wsPA, c + pTot, `SUM(${pcol(c)})`, vals[c], { fmt: NUM, bold: true });
  });
  wsPA.getColumn(1).width = 34;
  for (let c = 2; c <= 17; c++) wsPA.getColumn(c).width = 14;

  // --------------------------------------------------------------- Sections
  title(wsSE, t('sectionsSummary'), t('sectionsNote'));
  const SR = R.sections;
  const secHead = [t('colSection'), t('col_netRevenue'), t('col_cogs'), t('col_grossProfit'), t('col_opex'), t('kind_otherIncome'), t('kind_otherExpense'), t('col_depreciation'), t('col_profit'), t('col_margin'), t('col_revShare')];
  if (SR.allocate) secHead.push(t('col_allocated'), t('col_profitAfter'));
  header(wsSE, 3, secHead);
  const secList = SR.list.concat(SR.hasUnassigned ? [SR.unassigned] : []);
  const sFirst = 4;
  const sLastNamed = sFirst + SR.list.length - 1;
  const unRow = SR.hasUnassigned ? sFirst + SR.list.length : null;
  secList.forEach((x, i) => {
    const row = sFirst + i;
    const nm = x.unassigned ? t('unassigned') : x.name;
    put(wsSE, 'A' + row, nm, { bold: !!x.unassigned });
    const by = code => sumifs('I', code, `,${tcol('C')},$A${row}`);
    formula(wsSE, 'B' + row, `${by('revenue')}-${by('returns')}`, x.netRevenue, { fmt: NUM, color: GREEN });
    formula(wsSE, 'C' + row, by('cogs'), x.cogs, { fmt: NUM, color: GREEN });
    formula(wsSE, 'D' + row, `B${row}-C${row}`, x.grossProfit, { fmt: NUM });
    formula(wsSE, 'E' + row, by('opex'), x.opex, { fmt: NUM, color: GREEN });
    formula(wsSE, 'F' + row, by('otherIncome'), x.otherIncome, { fmt: NUM, color: GREEN });
    formula(wsSE, 'G' + row, by('otherExpense'), x.otherExpense, { fmt: NUM, color: GREEN });
    put(wsSE, 'H' + row, x.depreciation, { fmt: NUM, color: GREY });
    formula(wsSE, 'I' + row, `D${row}-E${row}+F${row}-G${row}-H${row}`, x.profit, { fmt: NUM, bold: true });
    formula(wsSE, 'J' + row, `IF(B${row}=0,0,I${row}/B${row})`, x.margin || 0, { fmt: PCT });
    if (!x.unassigned) {
      formula(wsSE, 'K' + row, `IF(SUM($B$${sFirst}:$B$${sLastNamed})=0,0,B${row}/SUM($B$${sFirst}:$B$${sLastNamed}))`, x.revenueShare || 0, { fmt: PCT });
      if (SR.allocate) {
        formula(wsSE, 'L' + row, unRow ? `-$I$${unRow}*K${row}` : '0', x.allocatedShared, { fmt: NUM });
        formula(wsSE, 'M' + row, `I${row}-L${row}`, x.profitAfterAllocation, { fmt: NUM, bold: true });
      }
    }
  });
  wsSE.getColumn(1).width = 30;
  for (let c = 2; c <= 13; c++) wsSE.getColumn(c).width = 15;

  // -------------------------------------------------------------------- VAT
  const V = R.vat;
  title(wsV, t('vatTitle'), t('taxDisclaimer'));
  const incomeVat = `${sumifs('K', 'revenue')}+${sumifs('K', 'otherIncome')}`;
  const vatLines = [
    ['vatOutput', incomeVat, V.output, GREEN],
    ['vatOutputReturns', sumifs('K', 'returns'), V.outputReturns, GREEN],
    ['vatInput', `${sumifs('K', 'cogs')}+${sumifs('K', 'opex')}+${sumifs('K', 'otherExpense')}`, V.input, GREEN],
    ['vatNet', 'B3-B4-B5', V.net],
    ['vatPaid', sref.vatPaidToAuthority, V.paid, GREEN],
    [V.balance >= 0 ? 'vatBalanceDue' : 'vatBalanceRefund', 'B6-B7', V.balance]
  ];
  vatLines.forEach((v, i) => {
    put(wsV, 'A' + (3 + i), t(v[0]), { bold: i === 3 || i === 5 });
    formula(wsV, 'B' + (3 + i), v[1], v[2], { fmt: NUM, color: v[3] || BLACK, bold: i === 3 || i === 5 });
  });
  wsV.getColumn(1).width = 44; wsV.getColumn(2).width = 18;

  // ------------------------------------------------------ Cash and position
  const K = R.cash;
  title(wsCA, t('cashTitle'), t('xl_appValues'));
  const paidSum = codes => codes.map(c => sumifs('M', c)).join('+');
  const cashLines = [
    ['cash_opening', null, K.opening],
    ['cash_collections', paidSum(['revenue', 'otherIncome']), K.collections, GREEN],
    ['cash_refunds', paidSum(['returns']), K.refunds, GREEN],
    ['cash_payments', paidSum(['cogs', 'opex', 'otherExpense']), K.payments, GREEN],
    ['cash_vatPaid', sref.vatPaidToAuthority, K.vatPaid, GREEN],
    ['cash_operating', 'B5-B6-B7-B8', K.operating],
    ['cash_assetPurchases', null, K.assetPurchases],
    ['cash_capitalIn', null, K.capitalIn],
    ['cash_loansIn', null, K.loansIn],
    ['cash_loanPayments', null, K.loanPayments],
    ['cash_drawings', `${PA}!I${pTot}`, K.drawings, GREEN],
    ['cash_financing', 'B11+B12-B13-B14', K.financing],
    ['cash_closing', 'B4+B9-B10+B15', K.closing]
  ];
  cashLines.forEach((c, i) => {
    const row = 4 + i;
    const strong = ['cash_operating', 'cash_financing', 'cash_closing'].includes(c[0]);
    put(wsCA, 'A' + row, t(c[0]), { bold: strong, color: c[1] == null ? GREY : BLACK });
    if (c[1] == null) put(wsCA, 'B' + row, c[2], { fmt: NUM, color: c[0] === 'cash_opening' ? BLUE : BLACK });
    else formula(wsCA, 'B' + row, c[1], c[2], { fmt: NUM, bold: strong, color: c[3] || BLACK });
  });
  const posStart = 4 + cashLines.length + 2;
  put(wsCA, 'A' + posStart, t('positionTitle'), { bold: true });
  const PO = R.position;
  const posLines = ['cash', 'receivables', 'inventory', 'otherCurrentAssets', 'vatCredit', 'currentAssets', 'fixedAssets', 'totalAssets',
    'payables', 'vatPayable', 'taxPayable', 'zakatPayable', 'otherCurrentLiabilities', 'loanCurrent', 'currentLiabilities', 'loanNonCurrent', 'totalLiabilities', 'equity'];
  posLines.forEach((k, i) => {
    const row = posStart + 1 + i;
    const strong = ['currentAssets', 'totalAssets', 'currentLiabilities', 'totalLiabilities', 'equity'].includes(k);
    put(wsCA, 'A' + row, t('pos_' + k), { bold: strong, color: GREY });
    put(wsCA, 'B' + row, PO[k], { fmt: NUM, bold: strong });
  });
  wsCA.getColumn(1).width = 44; wsCA.getColumn(2).width = 18;

  // Fonts everywhere default to Arial.
  wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => {
    if (!cell.font || cell.font.name !== FONT) cell.font = Object.assign({}, cell.font || {}, { name: FONT });
  })));
  return { workbook: wb, result: R };
}

async function writeWorkbook(job, filePath, opts) {
  const { workbook } = await buildWorkbook(job, opts);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { buildWorkbook, writeWorkbook, colLetter };
