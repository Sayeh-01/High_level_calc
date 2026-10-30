/* High Level Calc — partners & shares, assets, loans, VAT / tax / zakat. */
(function () {
  'use strict';
  const I = window.HLI18n, C = window.HLCalc, U = window.HLUI, V = window.HLViews, H = V.H;
  const t = I.t;
  const esc = U.esc;

  // -------------------------------------------------------------- partners

  function waterfall(D) {
    const loss = D.distributable < 0;
    return H.statement([
      { label: t('d_netProfit'), value: D.netProfit, type: 'sub' },
      D.legalReserve ? { label: t('d_legalReserve'), value: -D.legalReserve } : null,
      D.otherReserve ? { label: t('d_otherReserve'), value: -D.otherReserve } : null,
      D.salaries ? { label: t('d_salaries'), value: -D.salaries } : null,
      D.interest ? { label: t('d_interest'), value: -D.interest } : null,
      D.bonuses ? { label: t('d_bonuses'), value: -D.bonuses } : null,
      { label: t(loss ? 'd_lossToShare' : 'd_distributable'), value: D.distributable, type: 'grand' },
      Math.abs(D.unallocated) > 0.005 ? { label: t('unallocatedProfit'), value: D.unallocated, cls: 'warn-line' } : null,
      D.profitPerShare != null && D.method === 'shares' ? { label: t('profitPerShare'), value: D.profitPerShare } : null
    ]);
  }

  function partnerResults(D) {
    const has = k => D.rows.some(x => Math.abs(x[k]) > 1e-9);
    const cols = [
      ['r_ratio', x => U.pct(x.ratio, 2), true],
      ['r_salary', x => U.amt(x.salary), has('salary')],
      ['r_interest', x => U.amt(x.interest), has('interest')],
      ['r_bonus', x => U.amt(x.bonus), has('bonus')],
      ['r_residual', x => U.amt(x.residual), has('salary') || has('interest') || has('bonus')],
      ['r_total', x => `<b>${U.amt(x.total)}</b>`, true],
      ['r_drawings', x => U.amt(-x.drawings), has('drawings')],
      ['r_due', x => (x.due < 0 ? `${U.amt(-x.due)} <small class="status status-unpaid">${esc(t('r_owes'))}</small>` : U.amt(x.due)), true],
      ['r_closing', x => U.amt(x.closingCapital), true]
    ].filter(c => c[2]);
    const sumOf = f => D.rows.reduce((a, x) => a + f(x), 0);
    const totals = {
      r_ratio: U.pct(D.ratioTotal, 2), r_salary: U.amt(D.salaries), r_interest: U.amt(D.interest), r_bonus: U.amt(D.bonuses),
      r_residual: U.amt(sumOf(x => x.residual)), r_total: `<b>${U.amt(D.allocatedTotal)}</b>`, r_drawings: U.amt(-D.drawingsTotal),
      r_due: U.amt(sumOf(x => x.due)), r_closing: U.amt(sumOf(x => x.closingCapital))
    };
    return `<div class="table-wrap"><table class="grid-table results"><thead><tr><th>${esc(t('p_name'))}</th>${cols.map(c => `<th class="n">${esc(t(c[0]))}</th>`).join('')}</tr></thead>
      <tbody>${D.rows.map(x => `<tr><th scope="row">${esc(x.partner.name)}</th>${cols.map(c => `<td class="n">${c[1](x)}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr class="row-total"><th scope="row">${esc(t('total'))}</th>${cols.map(c => `<td class="n">${totals[c[0]]}</td>`).join('')}</tr></tfoot></table></div>`;
  }

  V.register('partners', {
    render(ctx) {
      const { job, R } = ctx;
      const s = job.settings;
      const D = R.distribution;
      const method = s.partners.method;
      const settings = `<div class="form-row">
        ${H.field('settings.partners.method', method, { type: 'select', label: t('shareMethod'), options: ['manual', 'capital', 'shares', 'weighted'].map(m => ({ value: m, label: t('method_' + m) })) })}
        ${H.field('settings.reserves.legalPct', s.reserves.legalPct, { label: t('legalReserve'), suffix: '%' })}
        ${H.field('settings.reserves.otherPct', s.reserves.otherPct, { label: t('otherReserve'), suffix: '%' })}
        ${H.field('settings.partners.interestOnCapitalRate', s.partners.interestOnCapitalRate, { label: t('interestOnCapital'), suffix: '%' })}
      </div>`;
      const add = H.button(t('addPartner'), 'addPartner', { primary: true, icon: 'plus' });
      let list;
      if (!job.partners.length) list = H.empty(t('partnersEmpty'), add);
      else {
        const showPct = method === 'manual';
        const showShares = method === 'shares' || job.partners.some(p => C.num(p.shares));
        list = `<div class="toolbar">${add}</div><div class="table-wrap"><table class="grid-table"><thead><tr>
          <th>${esc(t('p_name'))}</th><th class="n">${esc(t('p_capital'))}</th><th>${esc(t('p_joinDate'))}</th>
          ${showPct ? `<th class="n">${esc(t('p_sharePct'))}</th>` : ''}${showShares ? `<th class="n">${esc(t('p_shares'))}</th>` : ''}
          <th class="n">${esc(t('p_salary'))}</th><th class="n">${esc(t('p_bonusPct'))}</th><th class="n">${esc(t('p_drawings'))}</th><th><span class="sr">${esc(t('actions'))}</span></th></tr></thead><tbody>
          ${job.partners.map(p => `<tr data-act="editPartner" data-id="${esc(p.id)}"><th scope="row">${esc(p.name)}</th><td class="n">${U.amt(C.num(p.capital))}</td><td>${esc(I.fmtDate(p.joinDate))}</td>
            ${showPct ? `<td class="n">${U.n(C.num(p.sharePct), 2)}%</td>` : ''}${showShares ? `<td class="n">${U.n(C.num(p.shares), 0)}</td>` : ''}
            <td class="n">${U.amt(C.num(p.salary))}</td><td class="n">${C.num(p.bonusPct) ? U.n(C.num(p.bonusPct), 2) + '%' : U.amt(0)}</td><td class="n">${U.amt(C.num(p.drawings))}</td>
            <td class="actions">${H.rowActions('Partner', p.id)}</td></tr>`).join('')}
          </tbody><tfoot><tr class="row-total"><th scope="row">${esc(t('total'))}</th><td class="n">${U.amt(D.capitalTotal)}</td><td></td>
            ${showPct ? `<td class="n">${U.n(job.partners.reduce((a, p) => a + C.num(p.sharePct), 0), 2)}%</td>` : ''}${showShares ? `<td class="n">${U.n(D.totalShares, 0)}</td>` : ''}
            <td class="n">${U.amt(D.salaries)}</td><td></td><td class="n">${U.amt(D.drawingsTotal)}</td><td></td></tr></tfoot></table></div>`;
      }
      const warnings = D.warnings.map(w => H.note(t(w.key, { total: I.fmtNum(w.total, 2) }), 'warn')).join('');
      const results = job.partners.length ? `<div class="dist-waterfall">${waterfall(D)}</div>${partnerResults(D)}${warnings}` : waterfall(D);
      return H.intro(t('partnersIntro'))
        + H.sheet(t('d_title'), results, { cls: 'sheet-accent' })
        + H.sheet(t('nav_partners'), settings + list);
    }
  });

  // ---------------------------------------------------------------- assets

  function scheduleTable(a) {
    return `<table class="grid-table compact schedule"><caption>${esc(t('scheduleTitle', { name: a.asset.name }))}</caption><thead><tr><th>${esc(t('s_year'))}</th><th>${esc(t('s_starts'))}</th><th class="n">${esc(t('s_dep'))}</th><th class="n">${esc(t('s_acc'))}</th><th class="n">${esc(t('s_bv'))}</th></tr></thead><tbody>
      ${a.schedule.rows.map(r => `<tr><td>${U.n(r.year, 0)}</td><td>${esc(I.fmtDate(r.startISO))}</td><td class="n">${U.amt(r.dep)}</td><td class="n">${U.amt(r.accumulated)}</td><td class="n">${U.amt(r.bookValue)}</td></tr>`).join('')}
      </tbody></table>`;
  }

  V.register('assets', {
    render(ctx) {
      const { job, R, ui } = ctx;
      const add = H.button(t('addAsset'), 'addAsset', { primary: true, icon: 'plus' });
      if (!job.assets.length) return H.intro(t('assetsIntro')) + H.sheet('', H.empty(t('assetsEmpty'), add));
      const hasSections = job.sections.length > 0;
      const rows = R.assets.map(a => {
        const open = ui.expanded['asset:' + a.asset.id];
        return `<tr><th scope="row">${esc(a.asset.name)}</th>${hasSections ? `<td>${esc(H.sectionName(job, a.asset.sectionId))}</td>` : ''}
          <td class="n">${U.amt(a.schedule.cost)}</td><td class="n">${U.amt(a.schedule.salvage)}</td><td class="n">${U.n(a.schedule.life, 0)}</td><td>${esc(t('method_' + a.schedule.method))}</td><td>${esc(I.fmtDate(a.asset.startDate))}</td>
          <td class="n strong">${U.amt(a.periodDep)}</td><td class="n">${U.amt(a.accumulated)}</td><td class="n">${U.amt(a.nbv)}</td>
          <td class="actions"><button type="button" class="btn btn-quiet btn-sm" data-act="toggle" data-key="asset:${esc(a.asset.id)}" aria-expanded="${!!open}">${esc(t(open ? 'hideSchedule' : 'showSchedule'))}</button>${H.rowActions('Asset', a.asset.id)}</td></tr>
          ${open ? `<tr class="detail"><td colspan="${hasSections ? 11 : 10}">${scheduleTable(a)}</td></tr>` : ''}`;
      }).join('');
      const table = `<div class="toolbar">${add}</div><div class="table-wrap"><table class="grid-table"><thead><tr><th>${esc(t('a_name'))}</th>${hasSections ? `<th>${esc(t('a_section'))}</th>` : ''}
        <th class="n">${esc(t('a_cost'))}</th><th class="n">${esc(t('a_salvage'))}</th><th class="n">${esc(t('a_life'))}</th><th>${esc(t('a_method'))}</th><th>${esc(t('a_start'))}</th>
        <th class="n">${esc(t('a_periodDep'))}</th><th class="n">${esc(t('a_accumulated'))}</th><th class="n">${esc(t('a_bookValue'))}</th><th><span class="sr">${esc(t('actions'))}</span></th></tr></thead>
        <tbody>${rows}</tbody><tfoot><tr class="row-total"><th scope="row">${esc(t('total'))}</th>${hasSections ? '<td></td>' : ''}<td class="n">${U.amt(R.assets.reduce((s, a) => s + a.schedule.cost, 0))}</td><td colspan="4"></td>
        <td class="n">${U.amt(R.pl.depreciation)}</td><td class="n">${U.amt(R.assets.reduce((s, a) => s + a.accumulated, 0))}</td><td class="n">${U.amt(R.position.fixedAssets)}</td><td></td></tr></tfoot></table></div>`;
      const off = job.settings.autoDepreciation === false ? H.note(t('autoDepreciation') + ': ' + t('no'), 'warn') : '';
      return H.intro(t('assetsIntro')) + H.sheet(t('nav_assets'), table + off);
    }
  });

  // ----------------------------------------------------------------- loans

  function amortTable(l) {
    return `<table class="grid-table compact schedule"><caption>${esc(t('amortTitle', { name: l.loan.name }))}</caption><thead><tr><th>${esc(t('am_no'))}</th><th>${esc(t('am_due'))}</th><th class="n">${esc(t('am_payment'))}</th><th class="n">${esc(t('am_interest'))}</th><th class="n">${esc(t('am_principal'))}</th><th class="n">${esc(t('am_balance'))}</th></tr></thead><tbody>
      ${l.schedule.rows.map(r => `<tr><td>${U.n(r.no, 0)}</td><td>${esc(I.fmtDate(r.dueISO))}</td><td class="n">${U.amt(r.payment)}</td><td class="n">${U.amt(r.interest)}</td><td class="n">${U.amt(r.principal)}</td><td class="n">${U.amt(r.balance)}</td></tr>`).join('')}
      </tbody><tfoot><tr class="row-total"><th colspan="2">${esc(t('total'))}</th><td class="n">${U.amt(l.schedule.totalPaid)}</td><td class="n">${U.amt(l.schedule.totalInterest)}</td><td class="n">${U.amt(l.schedule.principal)}</td><td></td></tr></tfoot></table>`;
  }

  V.register('loans', {
    render(ctx) {
      const { job, R, ui } = ctx;
      const add = H.button(t('addLoan'), 'addLoan', { primary: true, icon: 'plus' });
      if (!job.loans.length) return H.intro(t('loansIntro')) + H.sheet('', H.empty(t('loansEmpty'), add));
      const rows = R.loans.map(l => {
        const open = ui.expanded['loan:' + l.loan.id];
        return `<tr><th scope="row">${esc(l.loan.name)}</th><td class="n">${U.amt(l.schedule.principal)}</td><td class="n">${U.n(C.num(l.loan.annualRate), 2)}%</td><td class="n">${U.n(l.schedule.months, 0)}</td>
          <td>${esc(t('loan_' + l.schedule.type))}</td><td>${esc(I.fmtDate(l.loan.startDate))}</td>
          <td class="n strong">${U.amt(l.schedule.payment)}</td><td class="n">${U.amt(l.schedule.totalInterest)}</td><td class="n">${U.amt(l.stats.interest)}</td><td class="n">${U.amt(l.stats.balance)}</td>
          <td class="actions"><button type="button" class="btn btn-quiet btn-sm" data-act="toggle" data-key="loan:${esc(l.loan.id)}" aria-expanded="${!!open}">${esc(t(open ? 'hideSchedule' : 'showSchedule'))}</button>${H.rowActions('Loan', l.loan.id)}</td></tr>
          ${open ? `<tr class="detail"><td colspan="11">${amortTable(l)}</td></tr>` : ''}`;
      }).join('');
      const table = `<div class="toolbar">${add}</div><div class="table-wrap"><table class="grid-table"><thead><tr><th>${esc(t('l_name'))}</th><th class="n">${esc(t('l_principal'))}</th><th class="n">${esc(t('l_rate'))}</th><th class="n">${esc(t('l_months'))}</th><th>${esc(t('l_type'))}</th><th>${esc(t('l_start'))}</th>
        <th class="n">${esc(t('l_payment'))}</th><th class="n">${esc(t('l_totalInterest'))}</th><th class="n">${esc(t('l_periodInterest'))}</th><th class="n">${esc(t('l_balance'))}</th><th><span class="sr">${esc(t('actions'))}</span></th></tr></thead>
        <tbody>${rows}</tbody><tfoot><tr class="row-total"><th scope="row">${esc(t('total'))}</th><td class="n">${U.amt(R.loans.reduce((s, l) => s + l.schedule.principal, 0))}</td><td colspan="5"></td><td class="n">${U.amt(R.loans.reduce((s, l) => s + l.schedule.totalInterest, 0))}</td>
        <td class="n">${U.amt(R.pl.financeCosts)}</td><td class="n">${U.amt(R.loans.reduce((s, l) => s + l.stats.balance, 0))}</td><td></td></tr></tfoot></table></div>`;
      const off = job.settings.autoLoanInterest === false ? H.note(t('autoLoanInterest') + ': ' + t('no'), 'warn') : '';
      return H.intro(t('loansIntro')) + H.sheet(t('nav_loans'), table + off);
    }
  });

  // ------------------------------------------------------------------- tax

  const PRESETS = {
    eg: { mode: 'flat', flatRate: 22.5 },
    sa: { mode: 'flat', flatRate: 20 },
    ae: { mode: 'brackets', brackets: [{ upTo: 375000, rate: 0 }, { upTo: '', rate: 9 }] },
    none: { mode: 'none' }
  };

  V.register('tax', {
    render(ctx) {
      const { job, R } = ctx;
      const s = job.settings;
      const vat = R.vat;
      const vatSettings = `<div class="form-row">
        ${H.field('settings.vat.enabled', s.vat.enabled, { type: 'check', label: t('vatEnabled') })}
        ${s.vat.enabled ? H.field('settings.vat.rate', s.vat.rate, { label: t('vatRate'), suffix: '%' }) : ''}
        ${s.vat.enabled ? H.field('settings.vat.pricesIncludeVat', s.vat.pricesIncludeVat, { type: 'check', label: t('vatInclusive') }) : ''}
        ${s.vat.enabled ? H.field('settings.vat.paidToAuthority', s.vat.paidToAuthority, { label: t('vatPaidToAuthority') }) : ''}
      </div>`;
      const vatStmt = s.vat.enabled ? H.statement([
        { label: t('vatSalesBase'), value: vat.salesBase, cls: 'muted-line' },
        { label: t('vatOutput'), value: vat.output },
        vat.outputReturns ? { label: t('vatOutputReturns'), value: -vat.outputReturns } : null,
        { label: t('vatInput'), value: -vat.input },
        { label: t('vatNet'), value: vat.net, type: 'sub' },
        vat.paid ? { label: t('vatPaid'), value: -vat.paid } : null,
        { label: t(vat.balance >= 0 ? 'vatBalanceDue' : 'vatBalanceRefund'), value: Math.abs(vat.balance), type: 'grand' }
      ]) : '';

      const tax = s.tax;
      const presetBtns = `<div class="preset-row"><span class="label">${esc(t('taxPresets'))}</span>${Object.keys(PRESETS).map(k => `<button type="button" class="btn btn-sm btn-quiet" data-act="taxPreset" data-preset="${k}">${esc(t('preset_' + k))}</button>`).join('')}</div>`;
      let taxInputs = H.field('settings.tax.mode', tax.mode, { type: 'select', label: t('taxMode'), options: ['none', 'flat', 'brackets'].map(m => ({ value: m, label: t('tax_' + m) })) });
      if (tax.mode === 'flat') taxInputs += H.field('settings.tax.flatRate', tax.flatRate, { label: t('taxFlatRate'), suffix: '%' });
      let brackets = '';
      if (tax.mode === 'brackets') {
        brackets = `<table class="grid-table compact brackets"><caption>${esc(t('taxBrackets'))}</caption><thead><tr><th>${esc(t('xl_lower'))}</th><th>${esc(t('bracketUpTo'))}</th><th>${esc(t('bracketRate'))}</th><th></th></tr></thead><tbody>
          ${(tax.brackets || []).map((b, i) => {
            const lower = i === 0 ? 0 : C.num(tax.brackets[i - 1].upTo);
            return `<tr><td class="n">${U.amt(lower, { dashZero: false })}</td>
              <td><input type="text" inputmode="decimal" class="num-input" data-bind="settings.tax.brackets.${i}.upTo" data-type="number" value="${esc(U.inputNum(b.upTo))}" placeholder="${esc(t('bracketRest'))}" aria-label="${esc(t('bracketUpTo'))}"></td>
              <td><span class="with-suffix"><input type="text" inputmode="decimal" class="num-input" data-bind="settings.tax.brackets.${i}.rate" data-type="number" value="${esc(U.inputNum(b.rate))}" aria-label="${esc(t('bracketRate'))}"><span class="suffix">%</span></span></td>
              <td><button type="button" class="icon-btn danger" data-act="delBracket" data-i="${i}" aria-label="${esc(t('del'))}" title="${esc(t('del'))}">${U.icon('trash')}</button></td></tr>`;
          }).join('')}</tbody></table>
          <p>${H.button(t('addBracket'), 'addBracket', { icon: 'plus', sm: true })}</p>${H.note(t('xl_unbounded'))}`;
      }
      const taxOut = H.statement([
        { label: t('pl_pbt'), value: R.pl.pbt },
        { label: t('taxAmount'), value: R.pl.incomeTax, type: 'grand' },
        { label: t('effectiveRate'), html: U.pct(R.pl.effectiveTaxRate) }
      ]);

      const z = s.zakat;
      let zakatInputs = H.field('settings.zakat.mode', z.mode, { type: 'select', label: t('zakatMode'), options: ['none', 'profit', 'netAssets', 'manual'].map(m => ({ value: m, label: t('zakat_' + m) })) });
      if (z.mode !== 'none') {
        zakatInputs += H.field('settings.zakat.rate', z.rate, { label: t('zakatRate'), suffix: '%' })
          + `<div class="preset-row"><button type="button" class="btn btn-sm btn-quiet" data-act="zakatRate" data-rate="2.5">${esc(t('zakatRateHijri'))}</button><button type="button" class="btn btn-sm btn-quiet" data-act="zakatRate" data-rate="2.5775">${esc(t('zakatRateGregorian'))}</button></div>`
          + H.field('settings.zakat.nisab', z.nisab, { label: t('zakatNisab') });
        if (z.mode === 'manual') zakatInputs += H.field('settings.zakat.manualBase', z.manualBase, { label: t('zakatManualBase') });
      }
      const zk = R.zakat;
      const zakatOut = z.mode === 'none' ? '' : H.statement([
        { label: t('zakatBase'), value: zk.base },
        { label: t('zakatAmount'), value: zk.amount, type: 'grand' }
      ]) + (zk.belowNisab ? H.note(t('zakatBelowNisab')) : '') + (z.mode === 'netAssets' ? H.note(t('zakatNetAssetsHelp')) : '');

      return H.sheet(t('vatTitle'), `<div class="cols cols-even"><div class="col">${vatSettings}</div><div class="col">${vatStmt}</div></div>`)
        + H.sheet(t('taxTitle'), `<div class="cols cols-even"><div class="col"><div class="form-row">${taxInputs}</div>${presetBtns}${brackets}</div><div class="col">${taxOut}</div></div>`)
        + H.sheet(t('zakatTitle'), `<div class="cols cols-even"><div class="col"><div class="form-row">${zakatInputs}</div></div><div class="col">${zakatOut}</div></div>`)
        + H.note(t('taxDisclaimer'));
    },
    actions: {
      taxPreset(ctx, el) {
        const p = JSON.parse(JSON.stringify(PRESETS[el.dataset.preset]));
        ctx.commit(j => Object.assign(j.settings.tax, p));
      },
      addBracket(ctx) {
        ctx.commit(j => {
          const b = j.settings.tax.brackets || (j.settings.tax.brackets = []);
          const last = b[b.length - 1];
          if (last && C.isBlank(last.upTo)) {
            const prev = b.length > 1 ? C.num(b[b.length - 2].upTo) : 0;
            last.upTo = prev ? prev * 2 : 100000;
          }
          b.push({ upTo: '', rate: last ? C.num(last.rate) : 0 });
        });
      },
      delBracket(ctx, el) {
        ctx.commit(j => { j.settings.tax.brackets.splice(+el.dataset.i, 1); });
      },
      zakatRate(ctx, el) {
        ctx.commit(j => { j.settings.zakat.rate = parseFloat(el.dataset.rate); });
      }
    }
  });
})();
