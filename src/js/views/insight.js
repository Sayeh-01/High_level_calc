/* High Level Calc — analysis, calculators, report, job settings, home. */
(function () {
  'use strict';
  const I = window.HLI18n, C = window.HLCalc, M = window.HLModel, U = window.HLUI, V = window.HLViews, H = V.H;
  const t = I.t;
  const esc = U.esc;

  const times = x => (x == null || !isFinite(x) ? U.pct(null) : `<span class="num">${esc(t('times', { x: I.fmtNum(x, 2) }))}</span>`);
  const days = x => (x == null || !isFinite(x) ? U.pct(null) : `<span class="num">${esc(t('days', { x: I.fmtNum(x, 0) }))}</span>`);

  function ratioList(R) {
    const r = R.ratios;
    const items = [
      ['grossMargin', U.pct(r.grossMargin)], ['operatingMargin', U.pct(r.operatingMargin)], ['ebitdaMargin', U.pct(r.ebitdaMargin)], ['netMargin', U.pct(r.netMargin)],
      ['costRatio', U.n(r.costRatio, 2)], ['opexRatio', U.pct(r.opexRatio)],
      ['returnOnCapital', U.pct(r.returnOnCapital)], ['roe', U.pct(r.roe)], ['roa', U.pct(r.roa)],
      ['currentRatio', times(r.currentRatio)], ['quickRatio', times(r.quickRatio)], ['debtToEquity', times(r.debtToEquity)],
      ['workingCapital', U.money(r.workingCapital)], ['collectionRate', U.pct(r.collectionRate)],
      ['receivableDays', days(r.receivableDays)], ['payableDays', days(r.payableDays)], ['interestCover', times(r.interestCover)]
    ];
    return `<dl class="ratios">${items.map(([k, v]) => {
      const help = I.dicts.en['ratioHelp_' + k] ? `<small>${esc(t('ratioHelp_' + k))}</small>` : '';
      return `<div><dt>${esc(t('ratio_' + k))}${help}</dt><dd>${v}</dd></div>`;
    }).join('')}</dl>`;
  }

  function positionLines(P) {
    return [
      { label: t('pos_cash'), value: P.cash },
      { label: t('pos_receivables'), value: P.receivables },
      P.inventory ? { label: t('pos_inventory'), value: P.inventory } : null,
      P.otherCurrentAssets ? { label: t('pos_otherCurrentAssets'), value: P.otherCurrentAssets } : null,
      P.vatCredit ? { label: t('pos_vatCredit'), value: P.vatCredit } : null,
      { label: t('pos_currentAssets'), value: P.currentAssets, type: 'sub' },
      { label: t('pos_fixedAssets'), value: P.fixedAssets },
      { label: t('pos_totalAssets'), value: P.totalAssets, type: 'total' },
      { label: t('pos_payables'), value: P.payables },
      P.vatPayable ? { label: t('pos_vatPayable'), value: P.vatPayable } : null,
      P.taxPayable ? { label: t('pos_taxPayable'), value: P.taxPayable } : null,
      P.zakatPayable ? { label: t('pos_zakatPayable'), value: P.zakatPayable } : null,
      P.otherCurrentLiabilities ? { label: t('pos_otherCurrentLiabilities'), value: P.otherCurrentLiabilities } : null,
      P.loanCurrent ? { label: t('pos_loanCurrent'), value: P.loanCurrent } : null,
      { label: t('pos_currentLiabilities'), value: P.currentLiabilities, type: 'sub' },
      P.loanNonCurrent ? { label: t('pos_loanNonCurrent'), value: P.loanNonCurrent } : null,
      { label: t('pos_totalLiabilities'), value: P.totalLiabilities, type: 'total' },
      { label: t('pos_equity'), value: P.equity, type: 'grand' }
    ];
  }

  function cashLines(K) {
    return [
      { label: t('cash_opening'), value: K.opening },
      { label: t('cash_collections'), value: K.collections },
      K.refunds ? { label: t('cash_refunds'), value: -K.refunds } : null,
      { label: t('cash_payments'), value: -K.payments },
      K.vatPaid ? { label: t('cash_vatPaid'), value: -K.vatPaid } : null,
      { label: t('cash_operating'), value: K.operating, type: 'sub' },
      K.assetPurchases ? { label: t('cash_assetPurchases'), value: -K.assetPurchases } : null,
      K.assetPurchases ? { label: t('cash_investing'), value: K.investing, type: 'sub' } : null,
      K.capitalIn ? { label: t('cash_capitalIn'), value: K.capitalIn } : null,
      K.loansIn ? { label: t('cash_loansIn'), value: K.loansIn } : null,
      K.loanPayments ? { label: t('cash_loanPayments'), value: -K.loanPayments } : null,
      K.drawings ? { label: t('cash_drawings'), value: -K.drawings } : null,
      { label: t('cash_financing'), value: K.financing, type: 'sub' },
      { label: t('cash_netChange'), value: K.netChange },
      { label: t('cash_closing'), value: K.closing, type: 'grand' }
    ];
  }

  function partiesTable(R) {
    if (!R.parties.length) return H.empty(t('partiesEmpty'));
    return `<div class="table-wrap"><table class="grid-table"><thead><tr><th>${esc(t('party_name'))}</th><th class="n">${esc(t('party_sales'))}</th><th class="n">${esc(t('party_purchases'))}</th><th class="n">${esc(t('party_receivable'))}</th><th class="n">${esc(t('party_payable'))}</th></tr></thead><tbody>
      ${R.parties.map(p => `<tr><th scope="row">${esc(p.name)}</th><td class="n">${U.amt(p.sales)}</td><td class="n">${U.amt(p.purchases)}</td><td class="n strong">${U.amt(p.receivable)}</td><td class="n strong">${U.amt(p.payable)}</td></tr>`).join('')}
      </tbody><tfoot><tr class="row-total"><th scope="row">${esc(t('total'))}</th><td class="n">${U.amt(R.parties.reduce((a, p) => a + p.sales, 0))}</td><td class="n">${U.amt(R.parties.reduce((a, p) => a + p.purchases, 0))}</td><td class="n">${U.amt(R.totals.receivables)}</td><td class="n">${U.amt(R.totals.payables)}</td></tr></tfoot></table></div>`;
  }

  // -------------------------------------------------------------- analysis

  V.register('analysis', {
    render(ctx) {
      const { job, R } = ctx;
      const P = R.position;
      const inputs = `<div class="form-row">
        ${H.field('position.openingCash', job.position.openingCash, { label: t('pos_openingCash') })}
        ${H.field('position.inventory', job.position.inventory, { label: t('pos_inventory') })}
        ${H.field('position.otherCurrentAssets', job.position.otherCurrentAssets, { label: t('pos_otherCurrentAssets') })}
        ${H.field('position.otherCurrentLiabilities', job.position.otherCurrentLiabilities, { label: t('pos_otherCurrentLiabilities') })}
        ${H.field('position.cashOverride', job.position.cashOverride, { label: t('pos_cashOverride'), help: t('pos_cashOverrideHelp') })}
      </div>`;
      const be = R.breakEven.ledger;
      const beLedger = be.revenue == null
        ? (R.pl.netRevenue ? H.note(t('be_impossible'), 'warn') : '')
        : H.statement([
          { label: t('be_fixed'), value: be.fixedCosts },
          { label: t('be_variableRatio'), html: U.pct(be.variableRatio) },
          { label: t('be_contributionRatio'), html: U.pct(be.contributionRatio) },
          { label: t('be_revenue'), value: be.revenue, type: 'grand' },
          { label: t('be_mos'), html: U.pct(be.marginOfSafety) }
        ]);
      const b = job.breakEven;
      const m = R.breakEven.manual;
      const beInputs = `<div class="form-row">
        ${H.field('breakEven.fixedCosts', b.fixedCosts, { label: t('be_fixed'), live: true })}
        ${H.field('breakEven.price', b.price, { label: t('be_price'), live: true })}
        ${H.field('breakEven.variableCost', b.variableCost, { label: t('be_vc'), live: true })}
        ${H.field('breakEven.expectedUnits', b.expectedUnits, { label: t('be_units'), live: true })}
        ${H.field('breakEven.targetProfit', b.targetProfit, { label: t('be_target'), live: true })}
      </div>`;
      const beOut = !C.num(b.price) ? '' : !m.valid ? H.note(t('be_invalid'), 'warn') : H.kv([
        [t('be_cm'), U.money(m.contributionMargin)],
        [t('be_contributionRatio'), U.pct(m.contributionRatio)],
        [t('be_beUnits'), U.n(m.units, 2), 'strong'],
        [t('be_beRevenue'), U.money(m.revenue), 'strong'],
        C.num(b.targetProfit) ? [t('be_targetUnits'), U.n(m.targetUnits, 2)] : null,
        C.num(b.targetProfit) ? [t('be_targetRevenue'), U.money(m.targetRevenue)] : null,
        m.expectedProfit != null ? [t('be_expectedProfit'), U.money(m.expectedProfit)] : null,
        m.marginOfSafetyUnits != null ? [t('be_mosUnits'), U.n(m.marginOfSafetyUnits, 2)] : null,
        m.marginOfSafety != null ? [t('be_mos'), U.pct(m.marginOfSafety)] : null,
        m.operatingLeverage != null ? [t('be_dol'), times(m.operatingLeverage)] : null
      ]);
      return H.sheet(t('ratiosTitle'), ratioList(R))
        + `<div class="cols cols-even"><div class="col">${H.sheet(t('positionTitle'), H.statement(positionLines(P)) + `<details class="inputs"${C.num(job.position.openingCash) || C.num(job.position.inventory) ? '' : ' open'}><summary>${esc(t('pos_inputs'))}</summary>${inputs}</details>`)}</div>
           <div class="col">${H.sheet(t('cashTitle'), H.statement(cashLines(R.cash)))}</div></div>`
        + H.sheet(t('breakEvenTitle'), `<div class="cols cols-even"><div class="col"><h3>${esc(t('be_fromLedger'))}</h3><p class="fine">${esc(t('be_fromLedgerHelp'))}</p>${beLedger}</div><div class="col"><h3>${esc(t('be_manual'))}</h3>${beInputs}${beOut}</div></div>`)
        + H.sheet(t('partiesTitle'), partiesTable(R));
    }
  });

  // ------------------------------------------------------------ calculators

  function calcCard(title, inputs, outputs) {
    return `<section class="sheet calc"><header class="sheet-head"><h2>${esc(title)}</h2></header><div class="sheet-body"><div class="calc-in">${inputs}</div><div class="calc-out">${outputs}</div></div></section>`;
  }

  V.register('calculators', {
    render(ctx) {
      const job = ctx.job;
      const c = job.calc || (job.calc = {});
      const K = C.calculators;
      const v = (group, key, fallback) => { const g = c[group] || {}; return g[key] === undefined ? fallback : g[key]; };
      const f = (group, key, label, fallback, suffix) => H.field(`calc.${group}.${key}`, v(group, key, fallback), { label, live: true, suffix });
      const vatRate = C.num(job.settings.vat.rate) || 14;
      const cards = [];

      cards.push(calcCard(t('c_percent'),
        f('pct', 'p', t('c_pct'), 15, '%') + f('pct', 'x', t('c_number'), 1000) + f('pct', 'a', t('c_a'), 250) + f('pct', 'b', t('c_b'), 1000),
        H.out(t('c_pctOf'), U.n(K.percentOf(v('pct', 'p', 15), v('pct', 'x', 1000)), 2))
        + H.out(t('c_whatPct'), U.pct(C.div(K.whatPercent(v('pct', 'a', 250), v('pct', 'b', 1000)), 100), 2))
        + H.out(t('c_change'), U.pct(C.div(K.percentChange(v('pct', 'a', 250), v('pct', 'b', 1000)), 100), 2))));

      const vNet = K.vatAdd(v('vat', 'net', 1000), v('vat', 'rate', vatRate));
      const vGross = K.vatExtract(v('vat', 'gross', 1140), v('vat', 'rate', vatRate));
      cards.push(calcCard(t('c_vat'),
        f('vat', 'rate', t('c_rate'), vatRate, '%') + f('vat', 'net', t('c_net'), 1000) + f('vat', 'gross', t('c_gross'), 1140),
        H.out(t('c_vatOnNet'), U.money(vNet.vat)) + H.out(t('c_grossFromNet'), U.money(vNet.gross))
        + H.out(t('c_vatInGross'), U.money(vGross.vat)) + H.out(t('c_netFromGross'), U.money(vGross.net))));

      const mm = K.marginMarkup(v('price', 'cost', 750), v('price', 'price', 1000));
      const disc = K.discount(v('price', 'price', 1000), v('price', 'discount', 10));
      cards.push(calcCard(t('c_pricing'),
        f('price', 'cost', t('c_cost'), 750) + f('price', 'price', t('c_price'), 1000) + f('price', 'markup', t('c_markup'), 30, '%') + f('price', 'margin', t('c_margin'), 25, '%') + f('price', 'discount', t('c_discountPct'), 10, '%'),
        H.out(t('c_profit'), U.money(mm.profit)) + H.out(t('c_margin'), U.pct(C.div(mm.margin, 100))) + H.out(t('c_markup'), U.pct(C.div(mm.markup, 100)))
        + H.out(t('c_priceAtMarkup'), U.money(K.priceFromMarkup(v('price', 'cost', 750), v('price', 'markup', 30))))
        + H.out(t('c_priceAtMargin'), U.money(K.priceFromMargin(v('price', 'cost', 750), v('price', 'margin', 25))))
        + H.out(t('c_afterDiscount'), U.money(disc.final) + ` <small>(${U.money(disc.discount)})</small>`)));

      const loan = K.loan(v('loan', 'p', 500000), v('loan', 'r', 18), v('loan', 'n', 36));
      cards.push(calcCard(t('c_loan'),
        f('loan', 'p', t('c_principal'), 500000) + f('loan', 'r', t('c_annualRate'), 18, '%') + f('loan', 'n', t('c_months'), 36),
        H.out(t('c_payment'), U.money(loan.payment), 'big') + H.out(t('c_totalInterest'), U.money(loan.totalInterest)) + H.out(t('c_totalPaid'), U.money(loan.totalPaid))));

      const si = K.simpleInterest(v('simple', 'p', 100000), v('simple', 'r', 10), v('simple', 'y', 2));
      cards.push(calcCard(t('c_simple'),
        f('simple', 'p', t('c_principal'), 100000) + f('simple', 'r', t('c_annualRate'), 10, '%') + f('simple', 'y', t('c_years'), 2),
        H.out(t('c_interest'), U.money(si.interest)) + H.out(t('c_totalAmount'), U.money(si.total))));

      const fv = K.futureValue(v('fv', 'pv', 10000), v('fv', 'r', 12), v('fv', 'y', 5), v('fv', 'k', 12), v('fv', 'c', 500));
      cards.push(calcCard(t('c_compound'),
        f('fv', 'pv', t('c_pv'), 10000) + f('fv', 'r', t('c_annualRate'), 12, '%') + f('fv', 'y', t('c_years'), 5) + f('fv', 'k', t('c_perYear'), 12) + f('fv', 'c', t('c_contribution'), 500),
        H.out(t('c_fv'), U.money(fv.fv), 'big') + H.out(t('c_invested'), U.money(fv.invested)) + H.out(t('c_gain'), U.money(fv.gain))));

      const inv = K.investment(v('inv', 'r', 12), v('inv', 'i', 100000), v('inv', 'flows', '30000, 35000, 40000, 45000'));
      const yrs = x => (x == null ? `<span class="muted">${esc(t('c_never'))}</span>` : `<span class="num">${esc(t('c_years_x', { x: I.fmtNum(x, 2) }))}</span>`);
      cards.push(calcCard(t('c_investment'),
        f('inv', 'r', t('c_discountRate'), 12, '%') + f('inv', 'i', t('c_initial'), 100000)
        + `<label class="field"><span class="label">${esc(t('c_flows'))}</span><input type="text" data-bind="calc.inv.flows" data-live value="${esc(v('inv', 'flows', '30000, 35000, 40000, 45000'))}"><small class="help">${esc(t('c_flowsHelp'))}</small></label>`,
        H.out(t('c_npv'), U.money(inv.npv), 'big') + H.out(t('c_irr'), U.pct(inv.irr, 2)) + H.out(t('c_payback'), yrs(inv.payback)) + H.out(t('c_dpayback'), yrs(inv.discountedPayback)) + H.out(t('c_pi'), U.n(inv.profitabilityIndex, 2))));

      const roi = K.roi(v('roi', 'c', 50000), v('roi', 'v', 65000), v('roi', 'y', 2));
      cards.push(calcCard(t('c_roi'),
        f('roi', 'c', t('c_amountInvested'), 50000) + f('roi', 'v', t('c_finalValue'), 65000) + f('roi', 'y', t('c_years'), 2),
        H.out(t('c_gain'), U.money(roi.gain)) + H.out(t('c_roiPct'), U.pct(C.div(roi.roi, 100))) + H.out(t('c_cagr'), U.pct(C.div(roi.cagr, 100)))));

      cards.push(calcCard(t('c_currency'),
        f('fx', 'a', t('amount'), 1000) + f('fx', 'r', t('c_rateEx'), 50),
        H.out(t('c_result'), U.n(K.convert(v('fx', 'a', 1000), v('fx', 'r', 50)), 4), 'big')));

      return H.intro(t('calcIntro')) + `<div class="calc-grid">${cards.join('')}</div>`;
    }
  });

  // ---------------------------------------------------------------- report

  V.register('report', {
    render(ctx) {
      const { job, R } = ctx;
      const D = R.distribution;
      const P = V.charts;
      const today = new Date().toISOString().slice(0, 10);
      const head = `<header class="report-head">
        <div><h1>${esc(t('reportTitle'))}</h1><p class="report-job">${esc(job.name)}</p></div>
        <dl class="report-meta">
          ${job.client.name ? `<div><dt>${esc(t('reportFor'))}</dt><dd>${esc(job.client.name)}${job.client.taxId ? ` <small>${esc(t('c_taxId'))} ${esc(job.client.taxId)}</small>` : ''}</dd></div>` : ''}
          <div><dt>${esc(t('reportPeriod'))}</dt><dd>${esc(t('period_from_to', { from: I.fmtDate(R.period.fromISO, 'long'), to: I.fmtDate(R.period.toISO, 'long') }))}</dd></div>
          <div><dt>${esc(t('reportCurrency'))}</dt><dd>${esc(job.currency)} — ${esc(I.currencyName(job.currency))}</dd></div>
          <div><dt>${esc(t('reportGenerated'))}</dt><dd>${esc(I.fmtDate(today, 'long'))}</dd></div>
        </dl></header>`;
      const block = (title, body) => `<section class="report-block"><h2>${esc(title)}</h2>${body}</section>`;
      const partnerRows = D.rows.length ? `<table class="grid-table compact"><thead><tr><th>${esc(t('p_name'))}</th><th class="n">${esc(t('p_capital'))}</th><th class="n">${esc(t('r_ratio'))}</th><th class="n">${esc(t('r_total'))}</th><th class="n">${esc(t('r_drawings'))}</th><th class="n">${esc(t('r_due'))}</th><th class="n">${esc(t('r_closing'))}</th></tr></thead><tbody>
        ${D.rows.map(x => `<tr><th scope="row">${esc(x.partner.name)}</th><td class="n">${U.amt(x.capital)}</td><td class="n">${U.pct(x.ratio, 2)}</td><td class="n">${U.amt(x.total)}</td><td class="n">${U.amt(x.drawings)}</td><td class="n">${U.amt(x.due)}</td><td class="n">${U.amt(x.closingCapital)}</td></tr>`).join('')}
        </tbody></table>` : '';
      const dist = H.statement([
        { label: t('d_netProfit'), value: D.netProfit },
        D.legalReserve ? { label: t('d_legalReserve'), value: -D.legalReserve } : null,
        D.otherReserve ? { label: t('d_otherReserve'), value: -D.otherReserve } : null,
        D.salaries ? { label: t('d_salaries'), value: -D.salaries } : null,
        D.interest ? { label: t('d_interest'), value: -D.interest } : null,
        D.bonuses ? { label: t('d_bonuses'), value: -D.bonuses } : null,
        { label: t('d_distributable'), value: D.distributable, type: 'grand' }
      ]);
      const secs = job.sections.length ? block(t('sectionsSummary'), `<table class="grid-table compact"><thead><tr><th>${esc(t('colSection'))}</th><th class="n">${esc(t('col_netRevenue'))}</th><th class="n">${esc(t('col_profit'))}</th><th class="n">${esc(t('col_margin'))}</th></tr></thead><tbody>
        ${R.sections.list.concat(R.sections.hasUnassigned ? [R.sections.unassigned] : []).map(s => `<tr><th scope="row">${esc(s.unassigned ? t('unassigned') : s.name)}</th><td class="n">${U.amt(s.netRevenue)}</td><td class="n">${U.amt(s.profit)}</td><td class="n">${U.pct(s.margin)}</td></tr>`).join('')}</tbody></table>`) : '';
      const vat = job.settings.vat.enabled ? block(t('vatTitle'), H.statement([
        { label: t('vatOutput'), value: R.vat.output - R.vat.outputReturns },
        { label: t('vatInput'), value: -R.vat.input },
        { label: t('vatNet'), value: R.vat.net, type: 'sub' },
        R.vat.paid ? { label: t('vatPaid'), value: -R.vat.paid } : null,
        { label: t(R.vat.balance >= 0 ? 'vatBalanceDue' : 'vatBalanceRefund'), value: Math.abs(R.vat.balance), type: 'grand' }
      ])) : '';
      const r = R.ratios;
      const keyRatios = H.kv([
        [t('ratio_grossMargin'), U.pct(r.grossMargin)], [t('ratio_netMargin'), U.pct(r.netMargin)], [t('ratio_returnOnCapital'), U.pct(r.returnOnCapital)],
        [t('ratio_currentRatio'), times(r.currentRatio)], [t('ratio_workingCapital'), U.money(r.workingCapital)], [t('ratio_collectionRate'), U.pct(r.collectionRate)]
      ]);
      const toolbar = `<div class="toolbar no-print">
        ${H.button(t('print'), 'print', { icon: 'print', primary: true })}${H.button(t('exportPdf'), 'exportPdf', { icon: 'pdf' })}${H.button(t('exportExcel'), 'exportExcel', { icon: 'sheet' })}
        <span class="fine">${esc(t('reportPrintHint'))}</span></div>`;
      return toolbar + `<article class="report">${head}
        ${block(t('pl_title'), H.statement(P.plLines(R, { full: false }), { pct: true, amountLabel: job.currency }))}
        ${block(t('d_title'), dist + partnerRows)}
        ${secs}
        <div class="report-two">${block(t('positionTitle'), H.statement(positionLines(R.position)))}${block(t('cashTitle'), H.statement(cashLines(R.cash)))}</div>
        ${vat}
        ${block(t('ratiosTitle'), keyRatios)}
        <p class="fine">${esc(t('taxDisclaimer'))}</p>
      </article>`;
    }
  });

  // -------------------------------------------------------------- settings

  V.register('settings', {
    render(ctx) {
      const job = ctx.job;
      const s = job.settings;
      const details = `<div class="form-row">
        ${H.field('name', job.name, { type: 'text', label: t('jobName') })}
        ${H.field('client.name', job.client.name, { type: 'text', label: t('clientName') })}
        ${H.field('client.phone', job.client.phone, { type: 'text', label: t('c_phone') })}
        ${H.field('client.email', job.client.email, { type: 'text', label: t('c_email') })}
        ${H.field('client.address', job.client.address, { type: 'text', label: t('c_address') })}
        ${H.field('client.taxId', job.client.taxId, { type: 'text', label: t('c_taxId') })}
      </div>
      <div class="form-row">
        ${H.field('currency', job.currency, { type: 'select', label: t('currency'), options: I.CURRENCIES.map(c => ({ value: c, label: `${c} — ${I.currencyName(c)}` })) })}
        <div class="field"><span class="label">${esc(t('color'))}</span><div class="swatches">${M.TAB_COLORS.map(c => `<button type="button" class="swatch-btn${job.color === c ? ' on' : ''}" style="--sw:${c}" data-act="setColor" data-color="${c}" aria-pressed="${job.color === c}" aria-label="${c}"></button>`).join('')}</div></div>
      </div>
      ${H.field('notes', job.notes, { type: 'textarea', label: t('jobNotes'), cls: 'wide' })}`;
      const y = new Date().getFullYear();
      const period = `<div class="form-row">
        ${H.field('period.from', job.period.from, { type: 'date', label: t('from') })}
        ${H.field('period.to', job.period.to, { type: 'date', label: t('to') })}
      </div>
      <div class="preset-row">
        <button type="button" class="btn btn-sm btn-quiet" data-act="setPeriod" data-from="${y}-01-01" data-to="${y}-12-31">${esc(t('periodThisYear'))}</button>
        <button type="button" class="btn btn-sm btn-quiet" data-act="setPeriod" data-from="${y - 1}-01-01" data-to="${y - 1}-12-31">${esc(t('periodLastYear'))}</button>
        <button type="button" class="btn btn-sm btn-quiet" data-act="setPeriod" data-from="" data-to="">${esc(t('periodAll'))}</button>
      </div>${H.note(t('periodHelp'))}`;
      const auto = `<div class="form-row">
        ${H.field('settings.autoDepreciation', s.autoDepreciation !== false, { type: 'check', label: t('autoDepreciation') })}
        ${H.field('settings.autoLoanInterest', s.autoLoanInterest !== false, { type: 'check', label: t('autoLoanInterest') })}
      </div>`;
      const danger = `<p class="fine">${esc(t('deleteJobHelp'))}</p><button type="button" class="btn btn-danger" data-act="deleteJob" data-job="${esc(job.id)}">${U.icon('trash')}<span>${esc(t('deleteJob'))}</span></button>`;
      return H.sheet(t('jobDetails'), details) + H.sheet(t('jobPeriod'), period) + H.sheet(t('calcOptions'), auto)
        + H.sheet(t('dangerZone'), danger, { cls: 'sheet-danger' });
    },
    actions: {
      setColor(ctx, el) { ctx.commit(j => { j.color = el.dataset.color; }); },
      setPeriod(ctx, el) { ctx.commit(j => { j.period.from = el.dataset.from; j.period.to = el.dataset.to; }); }
    }
  });

  // ------------------------------------------------------------------ home

  V.register('home', {
    render(ctx) {
      const d = ctx.data;
      const q = (ctx.ui.homeQuery || '').trim().toLowerCase();
      const jobs = d.jobs.filter(j => !q || (j.name + ' ' + j.client.name).toLowerCase().includes(q));
      const actions = H.button(t('createJob'), 'newJob', { primary: true, icon: 'plus' }) + H.button(t('openSample'), 'sample', {});
      let body;
      if (!d.jobs.length) body = H.empty(t('homeEmpty'), actions);
      else if (!jobs.length) body = H.empty(t('noMatches', { q: ctx.ui.homeQuery }));
      else {
        body = `<div class="table-wrap"><table class="grid-table jobs"><thead><tr><th>${esc(t('name'))}</th><th>${esc(t('colClient'))}</th><th>${esc(t('colCurrency'))}</th><th class="n">${esc(t('colNetProfit'))}</th><th>${esc(t('colUpdated'))}</th><th>${esc(t('colTab'))}</th><th><span class="sr">${esc(t('actions'))}</span></th></tr></thead><tbody>
          ${jobs.map(j => {
            const R = C.compute(j);
            U.setCurrency(j.currency);
            const np = U.amt(R.pl.netProfit);
            return `<tr data-act="openJob" data-job="${esc(j.id)}"><th scope="row"><i class="dot" style="background:${esc(j.color)}"></i>${esc(j.name || t('newJob'))}</th><td>${esc(j.client.name)}</td><td>${esc(j.currency)}</td>
              <td class="n">${np}</td><td>${esc(I.fmtDate((j.updatedAt || '').slice(0, 10)))}</td><td><span class="status ${j.open ? 'status-paid' : ''}">${esc(t(j.open ? 'tabOpen' : 'tabClosed'))}</span></td>
              <td class="actions"><span class="row-actions">
                <button type="button" class="icon-btn" data-act="duplicateJob" data-job="${esc(j.id)}" title="${esc(t('duplicate'))}" aria-label="${esc(t('duplicate'))}">${U.icon('copy')}</button>
                <button type="button" class="icon-btn danger" data-act="deleteJob" data-job="${esc(j.id)}" title="${esc(t('del'))}" aria-label="${esc(t('del'))}">${U.icon('trash')}</button></span></td></tr>`;
          }).join('')}</tbody></table></div>`;
      }
      return `<div class="home">
        <header class="home-head"><div><h1>${esc(t('homeTitle'))}</h1><p class="intro">${esc(t('homeIntro'))}</p></div>
        ${d.jobs.length ? `<div class="home-tools"><input type="search" class="search" id="home-search" data-ui="homeQuery" placeholder="${esc(t('searchJobs'))}" value="${esc(ctx.ui.homeQuery)}" aria-label="${esc(t('searchJobs'))}">${actions}</div>` : ''}</header>
        ${H.sheet('', body)}</div>`;
    }
  });
})();
