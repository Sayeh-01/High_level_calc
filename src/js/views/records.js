/* High Level Calc — overview, income & expenses ledger, sections. */
(function () {
  'use strict';
  const I = window.HLI18n, C = window.HLCalc, U = window.HLUI, V = window.HLViews, H = V.H;
  const t = I.t;
  const esc = U.esc;

  // ------------------------------------------------------------- the chart

  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  }

  function bucketLabel(b, granularity) {
    const iso = `${b.year}-${String(b.month + 1).padStart(2, '0')}-01`;
    if (granularity === 'year') return I.fmtDate(iso, 'year');
    if (granularity === 'quarter') return I.fmtDate(iso, 'monthYear');
    return I.fmtDate(iso, 'month');
  }

  // Path for a column with a 4px rounded data end and a square baseline.
  function barPath(x, w, y0, y1) {
    const up = y1 < y0;
    const h = Math.abs(y0 - y1);
    if (h < 0.5) return '';
    const r = Math.min(4, h, w / 2);
    if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  function monthlyChart(R) {
    const m = R.monthly;
    const b = m.buckets;
    const W = 680, Hh = 250, padL = 52, padR = 8, padT = 14, padB = 28;
    const vals = b.flatMap(x => [x.income, x.expenses]);
    let max = Math.max.apply(null, vals.concat([0]));
    let min = Math.min.apply(null, vals.concat([0]));
    if (max === min) max = min + 1;
    const step = niceStep(max - min, 4);
    const top = Math.ceil(max / step) * step;
    const bottom = Math.floor(min / step) * step;
    const y = v => padT + (top - v) / (top - bottom) * (Hh - padT - padB);
    const band = (W - padL - padR) / b.length;
    const barW = Math.max(3, Math.min(24, (band - 10) / 2));
    const every = Math.ceil(b.length / 12);
    let grid = '';
    for (let v = bottom; v <= top + step / 2; v += step) {
      const yy = y(v).toFixed(1);
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="${Math.abs(v) < step / 1e6 ? 'axis' : 'grid'}"/>`;
      grid += `<text x="${padL - 8}" y="${yy}" class="tick" text-anchor="end" dominant-baseline="middle">${esc(I.fmtCompactNum(v))}</text>`;
    }
    let bars = '';
    let labels = '';
    let hits = '';
    const y0 = y(0);
    b.forEach((x, i) => {
      const gx = padL + i * band + (band - (barW * 2 + 2)) / 2;
      bars += `<path class="s-income" d="${barPath(gx, barW, y0, y(x.income))}"/>`;
      bars += `<path class="s-expenses" d="${barPath(gx + barW + 2, barW, y0, y(x.expenses))}"/>`;
      if (i % every === 0) labels += `<text x="${(padL + i * band + band / 2).toFixed(1)}" y="${Hh - 8}" class="tick" text-anchor="middle">${esc(bucketLabel(x, m.granularity))}</text>`;
      hits += `<rect class="hit" x="${(padL + i * band).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${Hh - padT - padB}" data-i="${i}"/>`;
    });
    const legend = `<div class="legend"><span><i class="key s-income"></i>${esc(t('seriesIncome'))}</span><span><i class="key s-expenses"></i>${esc(t('seriesExpenses'))}</span></div>`;
    const svg = `<svg class="chart-svg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(t('chartTitle', { g: t('g_' + m.granularity) }))}">${grid}${bars}${labels}${hits}</svg>`;
    return `${legend}<div class="chart" dir="ltr" data-chart>${svg}</div>${m.undated ? `<p class="fine">${esc(t('chartUndated', { n: I.fmtNum(m.undated, 0) }))}</p>` : ''}`;
  }

  function monthlyTable(R) {
    const m = R.monthly;
    return `<div class="table-wrap"><table class="grid-table"><thead><tr><th>${esc(t('date'))}</th><th class="n">${esc(t('seriesIncome'))}</th><th class="n">${esc(t('seriesExpenses'))}</th><th class="n">${esc(t('seriesResult'))}</th></tr></thead><tbody>
      ${m.buckets.map(b => `<tr><td>${esc(bucketLabel(b, m.granularity === 'month' ? 'quarter' : m.granularity))}</td><td class="n">${U.amt(b.income)}</td><td class="n">${U.amt(b.expenses)}</td><td class="n">${U.amt(b.result)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function mountChart(root, ctx) {
    const chart = root.querySelector('[data-chart]');
    const tip = document.getElementById('tooltip');
    if (!chart || !ctx.R) return;
    const m = ctx.R.monthly;
    chart.addEventListener('mousemove', e => {
      const hit = e.target.closest('.hit');
      if (!hit) { tip.hidden = true; return; }
      const b = m.buckets[+hit.dataset.i];
      chart.querySelectorAll('.hit.on').forEach(x => x.classList.remove('on'));
      hit.classList.add('on');
      tip.innerHTML = `<b>${esc(bucketLabel(b, m.granularity === 'month' ? 'quarter' : m.granularity))}</b>
        <span><i class="key s-income"></i>${esc(t('seriesIncome'))}<em>${U.amt(b.income)}</em></span>
        <span><i class="key s-expenses"></i>${esc(t('seriesExpenses'))}<em>${U.amt(b.expenses)}</em></span>
        <span class="tip-total">${esc(t('seriesResult'))}<em>${U.amt(b.result)}</em></span>`;
      tip.hidden = false;
      const pad = 14;
      const r = tip.getBoundingClientRect();
      let x = e.clientX + pad;
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
      let yy = e.clientY + pad;
      if (yy + r.height > window.innerHeight - 8) yy = e.clientY - r.height - pad;
      tip.style.left = x + 'px';
      tip.style.top = yy + 'px';
    });
    chart.addEventListener('mouseleave', () => { tip.hidden = true; chart.querySelectorAll('.hit.on').forEach(x => x.classList.remove('on')); });
  }

  // ------------------------------------------------------------- statements

  function plLines(R, opts) {
    const pl = R.pl;
    const nr = pl.netRevenue || null;
    const p = v => (nr ? v / nr : null);
    const o = opts || {};
    const lines = [
      { label: t('pl_revenue'), value: pl.revenue, pct: p(pl.revenue) },
      pl.returns ? { label: t('pl_returns'), value: -pl.returns, pct: p(-pl.returns) } : null,
      { label: t('pl_netRevenue'), value: pl.netRevenue, type: 'sub', pct: p(pl.netRevenue) },
      { label: t('pl_cogs'), value: -pl.cogs, pct: p(-pl.cogs) },
      { label: t('pl_grossProfit'), value: pl.grossProfit, type: 'sub', pct: p(pl.grossProfit) },
      { label: t('pl_opex'), value: -pl.opex, pct: p(-pl.opex) },
      (pl.depreciation || o.full) ? { label: t('pl_ebitda'), value: pl.ebitda, type: 'sub', pct: p(pl.ebitda) } : null,
      (pl.depreciation || o.full) ? { label: t('pl_depreciation'), value: -pl.depreciation, pct: p(-pl.depreciation) } : null,
      { label: t('pl_operatingProfit'), value: pl.operatingProfit, type: 'sub', pct: p(pl.operatingProfit) },
      (pl.otherIncome || o.full) ? { label: t('pl_otherIncome'), value: pl.otherIncome, pct: p(pl.otherIncome) } : null,
      (pl.otherExpense || o.full) ? { label: t('pl_otherExpense'), value: -pl.otherExpense, pct: p(-pl.otherExpense) } : null,
      (pl.financeCosts || o.full) ? { label: t('pl_financeCosts'), value: -pl.financeCosts, pct: p(-pl.financeCosts) } : null,
      { label: t('pl_pbt'), value: pl.pbt, type: 'sub', pct: p(pl.pbt) },
      (pl.incomeTax || o.full) ? { label: t('pl_incomeTax'), value: -pl.incomeTax, pct: p(-pl.incomeTax) } : null,
      (pl.zakat || o.full) ? { label: t('pl_zakat'), value: -pl.zakat, pct: p(-pl.zakat) } : null,
      { label: t(pl.netProfit < 0 ? 'pl_netLoss' : 'pl_netProfit'), value: pl.netProfit, type: 'grand', pct: p(pl.netProfit) }
    ];
    return lines;
  }

  function sharesTable(ctx) {
    const D = ctx.R.distribution;
    if (!D.rows.length) return H.empty(t('noPartnersYet'), H.button(t('addPartner'), 'addPartner', { icon: 'plus', sm: true }));
    const max = Math.max.apply(null, D.rows.map(x => Math.abs(x.total)).concat([0])) || 1;
    return `<table class="grid-table compact"><thead><tr><th>${esc(t('p_name'))}</th><th class="n">${esc(t('r_ratio'))}</th><th class="n">${esc(t('r_total'))}</th><th class="n">${esc(t('r_due'))}</th></tr></thead><tbody>
      ${D.rows.map(x => `<tr><td><span class="share-name">${esc(x.partner.name)}</span><span class="share-bar"><i style="width:${Math.max(1, Math.round(Math.abs(x.total) / max * 100))}%"${x.total < 0 ? ' class="neg"' : ''}></i></span></td>
        <td class="n">${U.pct(x.ratio)}</td><td class="n">${U.amt(x.total)}</td><td class="n">${U.amt(x.due)}</td></tr>`).join('')}
      </tbody></table>
      ${D.warnings.map(w => H.note(t(w.key, { total: I.fmtNum(w.total, 2) }), 'warn')).join('')}
      <p class="sheet-link">${H.button(t('nav_partners'), 'goto', { data: { view: 'partners' }, sm: true })}</p>`;
  }

  function categoryBars(list, total) {
    const top = list.filter(x => Math.abs(x.amount) > 1e-9).slice(0, 6);
    const rest = list.slice(6).reduce((a, x) => a + x.amount, 0);
    const items = top.map(x => ({ label: x.name || t('uncategorized'), value: x.amount, share: total ? x.amount / total : null }));
    if (Math.abs(rest) > 1e-9) items.push({ label: '…', value: rest, share: total ? rest / total : null });
    return H.bars(items);
  }

  // --------------------------------------------------------------- overview

  V.register('overview', {
    render(ctx) {
      const { job, R } = ctx;
      const pl = R.pl;
      const nothing = !job.transactions.length && !job.assets.length && !job.loans.length;
      if (nothing) {
        return H.sheet('', H.empty(t('overviewEmpty'), H.button(t('addIncome'), 'addIncome', { primary: true, icon: 'plus' }) + H.button(t('addExpense'), 'addExpense', { icon: 'plus' }) + H.button(t('nav_settings'), 'goto', { data: { view: 'settings' } })), { cls: 'sheet-empty' });
      }
      const loss = pl.netProfit < 0;
      const vatLabel = R.vat.balance >= 0 ? t('kpiVatDue') : t('kpiVatRefund');
      const figures = `<div class="figures" role="list">
        <div class="figure" role="listitem"><span class="label">${esc(t('kpiNetRevenue'))}</span><span class="value">${U.money(pl.netRevenue)}</span></div>
        <div class="figure" role="listitem"><span class="label">${esc(t('kpiTotalCosts'))}</span><span class="value">${U.money(pl.totalCosts)}</span></div>
        <div class="figure figure-main${loss ? ' is-loss' : ''}" role="listitem"><span class="label">${esc(t(loss ? 'kpiNetLoss' : 'kpiNetProfit'))}</span><span class="value">${U.money(pl.netProfit)}</span></div>
        <div class="figure" role="listitem"><span class="label">${esc(t('kpiNetMargin'))}</span><span class="value">${U.pct(pl.netMargin)}</span></div>
      </div>
      <div class="figures figures-minor" role="list">
        <div class="figure" role="listitem"><span class="label">${esc(t('kpiGrossProfit'))}</span><span class="value">${U.money(pl.grossProfit)}</span></div>
        ${job.settings.vat.enabled ? `<div class="figure" role="listitem"><span class="label">${esc(vatLabel)}</span><span class="value">${U.money(Math.abs(R.vat.balance))}</span></div>` : ''}
        <div class="figure" role="listitem"><span class="label">${esc(t('kpiReceivables'))}</span><span class="value">${U.money(R.totals.receivables)}</span></div>
        <div class="figure" role="listitem"><span class="label">${esc(t('kpiPayables'))}</span><span class="value">${U.money(R.totals.payables)}</span></div>
        <div class="figure" role="listitem"><span class="label">${esc(t('kpiCash'))}</span><span class="value">${U.money(R.position.cash)}</span></div>
      </div>`;
      const chartTitle = t('chartTitle', { g: t('g_' + R.monthly.granularity) });
      const chart = H.sheet(chartTitle, ctx.ui.chartAsTable ? monthlyTable(R) : monthlyChart(R), {
        actions: `<button type="button" class="btn btn-quiet btn-sm" data-act="toggleChartTable">${U.icon(ctx.ui.chartAsTable ? 'chart' : 'table')}<span>${esc(t(ctx.ui.chartAsTable ? 'showChart' : 'showTable'))}</span></button>`
      });
      const statement = H.sheet(t('pl_title'), H.statement(plLines(R), { pct: true, amountLabel: job.currency }));
      const shares = H.sheet(t('sharesSummary'), sharesTable(ctx));
      const costTotal = R.categories.expense.reduce((a, x) => a + x.amount, 0);
      const spend = R.categories.expense.length ? H.sheet(t('topExpenses'), categoryBars(R.categories.expense, costTotal)) : '';
      const incTotal = R.categories.income.reduce((a, x) => a + x.amount, 0);
      const earn = R.categories.income.length > 1 ? H.sheet(t('topIncome'), categoryBars(R.categories.income, incTotal)) : '';
      const secs = job.sections.length ? H.sheet(t('sectionsSummary'), H.bars(R.sections.list.map(s => ({ label: s.name, value: s.profit, share: s.margin })))
        + `<p class="sheet-link">${H.button(t('nav_sections'), 'goto', { data: { view: 'sections' }, sm: true })}</p>`) : '';
      return `${figures}<div class="cols cols-overview"><div class="col">${chart}${statement}</div><div class="col">${shares}${secs}${spend}${earn}</div></div>`;
    },
    mount: mountChart
  });

  // ----------------------------------------------------------------- ledger

  const LIMIT = 300;

  function filtersFor(ctx) {
    const f = ctx.ui.filters[ctx.job.id] || (ctx.ui.filters[ctx.job.id] = { kind: '', section: '', status: '', q: '', onlyPeriod: false });
    return f;
  }

  function matches(r, f) {
    const tx = r.tx;
    if (f.kind) {
      const g = C.KINDS[tx.kind] ? C.KINDS[tx.kind].group : 'cost';
      if (f.kind === 'in' ? g === 'cost' : f.kind === 'out' ? g !== 'cost' : tx.kind !== f.kind) return false;
    }
    if (f.section && (f.section === '-' ? !!tx.sectionId : tx.sectionId !== f.section)) return false;
    if (f.status && (tx.status || 'paid') !== f.status) return false;
    if (f.onlyPeriod && !r.inPeriod) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      const hay = [tx.description, tx.category, tx.party, tx.ref, tx.notes].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  V.register('ledger', {
    render(ctx) {
      const { job, R, ui } = ctx;
      const f = filtersFor(ctx);
      const vatOn = job.settings.vat.enabled;
      const hasSections = job.sections.length > 0;
      const id = job.id;
      const sel = (key, options) => `<select data-ui="filters.${id}.${key}" aria-label="${esc(t(key === 'kind' ? 'filterKind' : key === 'section' ? 'filterSection' : 'filterStatus'))}">${options.map(([v, l]) => `<option value="${esc(v)}"${f[key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      const toolbar = `<div class="toolbar">
        ${H.button(t('addIncome'), 'addIncome', { primary: true, icon: 'plus' })}
        ${H.button(t('addExpense'), 'addExpense', { icon: 'plus' })}
        <span class="grow"></span>
        <input type="search" class="search" data-ui="filters.${id}.q" id="ledger-search" placeholder="${esc(t('search'))}" value="${esc(f.q)}" aria-label="${esc(t('search'))}">
        ${sel('kind', [['', t('filterKind') + ': ' + t('all')], ['in', t('seriesIncome')], ['out', t('seriesExpenses')]].concat(C.KIND_KEYS.map(k => [k, t('kind_' + k)])))}
        ${hasSections ? sel('section', [['', t('filterSection') + ': ' + t('all')], ['-', t('unassigned')]].concat(job.sections.map(s => [s.id, s.name]))) : ''}
        ${sel('status', [['', t('filterStatus') + ': ' + t('all')], ['paid', t('status_paid')], ['partial', t('status_partial')], ['unpaid', t('status_unpaid')]])}
        <label class="check inline"><input type="checkbox" data-ui="filters.${id}.onlyPeriod"${f.onlyPeriod ? ' checked' : ''}><span>${esc(t('onlyPeriod'))}</span></label>
      </div>`;
      if (!job.transactions.length) return H.sheet('', toolbar + H.empty(t('ledgerEmpty')));

      const rows = R.rows.filter(r => matches(r, f)).sort((a, b) => (b.tx.date || '').localeCompare(a.tx.date || ''));
      let inc = 0, exp = 0, open = 0;
      for (const r of rows) {
        const g = C.KINDS[r.tx.kind] ? C.KINDS[r.tx.kind].group : 'cost';
        if (!r.inPeriod) continue;
        if (g === 'income') inc += r.v.net; else if (g === 'contra') inc -= r.v.net; else exp += r.v.net;
        open += g === 'cost' ? -r.v.balance : r.v.balance;
      }
      const limit = ui.ledgerLimit[id] || LIMIT;
      const shown = rows.slice(0, limit);
      const body = shown.map(r => {
        const tx = r.tx;
        const g = C.KINDS[tx.kind] ? C.KINDS[tx.kind].group : 'cost';
        const sign = g === 'cost' || g === 'contra' ? -1 : 1;
        const st = tx.status || 'paid';
        const meta = [tx.category, tx.party, tx.ref].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
        return `<tr class="${r.inPeriod ? '' : 'out-of-period'}" data-act="editTx" data-id="${esc(tx.id)}">
          <td class="date">${esc(I.fmtDate(tx.date))}${r.inPeriod ? '' : `<small class="tag">${esc(t('outsidePeriod'))}</small>`}</td>
          <td><span class="kind kind-${g}">${esc(t('kindShort_' + (C.KINDS[tx.kind] ? tx.kind : 'opex')))}</span></td>
          <td class="desc"><span class="desc-main">${esc(tx.description || t('kind_' + tx.kind))}</span>${meta ? `<span class="desc-meta">${meta}</span>` : ''}</td>
          ${hasSections ? `<td>${esc(H.sectionName(job, tx.sectionId))}</td>` : ''}
          <td class="n">${U.amt(sign * r.v.net)}</td>
          ${vatOn ? `<td class="n">${U.amt(sign * r.v.vat)}</td>` : ''}
          <td class="n">${U.amt(sign * r.v.gross)}</td>
          <td class="n">${st === 'paid' ? `<span class="status status-paid">${esc(t('status_paid'))}</span>` : `${U.amt(r.v.balance)}<small class="status status-${st}">${esc(t('status_' + st))}</small>`}</td>
          <td class="actions">${H.rowActions('Tx', tx.id)}</td></tr>`;
      }).join('');
      const summary = `<div class="ledger-summary">
        <span>${esc(t('seriesIncome'))} <b>${U.amt(inc)}</b></span>
        <span>${esc(t('seriesExpenses'))} <b>${U.amt(-exp)}</b></span>
        <span>${esc(t('seriesResult'))} <b>${U.amt(inc - exp)}</b></span>
        <span class="muted">${esc(t('entries', { n: I.fmtNum(rows.length, 0) }))}</span>
      </div>`;
      const table = rows.length ? `<div class="table-wrap"><table class="grid-table ledger"><thead><tr>
          <th>${esc(t('date'))}</th><th>${esc(t('colType'))}</th><th>${esc(t('colDescription'))}</th>
          ${hasSections ? `<th>${esc(t('colSection'))}</th>` : ''}
          <th class="n">${esc(t('colNet'))}</th>${vatOn ? `<th class="n">${esc(t('colVat'))}</th>` : ''}<th class="n">${esc(t('colGross'))}</th><th class="n">${esc(t('colBalance'))}</th><th><span class="sr">${esc(t('actions'))}</span></th>
        </tr></thead><tbody>${body}</tbody></table></div>
        ${rows.length > limit ? `<p class="center"><button type="button" class="btn" data-act="ledgerMore">${esc(t('showMore', { n: I.fmtNum(Math.min(LIMIT, rows.length - limit), 0) }))}</button></p>` : ''}`
        : H.empty(t('ledgerNoMatch'));
      return H.sheet('', toolbar + summary + table, { cls: 'sheet-ledger' });
    },
    actions: {
      ledgerMore(ctx) { ctx.ui.ledgerLimit[ctx.job.id] = (ctx.ui.ledgerLimit[ctx.job.id] || LIMIT) + LIMIT; ctx.render(); },
      editTx(ctx, el, e) {
        if (e.target.closest('.row-actions') && el.tagName === 'TR') return;
        const tx = ctx.job.transactions.find(x => x.id === el.dataset.id);
        if (tx) V.openTx(ctx, tx);
      }
    }
  });

  // --------------------------------------------------------------- sections

  V.register('sections', {
    render(ctx) {
      const { job, R } = ctx;
      const SR = R.sections;
      const add = H.button(t('addSection'), 'addSection', { primary: true, icon: 'plus' });
      if (!job.sections.length) return H.intro(t('sectionsIntro')) + H.sheet('', H.empty(t('sectionsEmpty'), add));
      const alloc = SR.allocate;
      const list = SR.list.concat(SR.hasUnassigned ? [SR.unassigned] : []);
      const row = x => `<tr class="${x.unassigned ? 'row-shared' : ''}">
        <th scope="row">${esc(x.unassigned ? t('unassigned') : x.name)}</th>
        <td class="n">${U.amt(x.netRevenue)}</td><td class="n">${U.amt(-x.cogs)}</td><td class="n strong">${U.amt(x.grossProfit)}</td>
        <td class="n">${U.amt(-x.opex)}</td><td class="n">${U.amt(x.otherIncome - x.otherExpense)}</td><td class="n">${U.amt(-x.depreciation)}</td>
        <td class="n strong">${U.amt(x.profit)}</td><td class="n">${U.pct(x.margin)}</td>
        <td class="n">${x.unassigned ? '' : U.pct(x.revenueShare)}</td>
        ${alloc ? `<td class="n">${x.unassigned ? '' : U.amt(-x.allocatedShared)}</td><td class="n strong">${x.unassigned ? '' : U.amt(x.profitAfterAllocation)}</td>` : ''}
        <td class="actions">${x.unassigned ? '' : `<span class="row-actions"><button type="button" class="icon-btn" data-act="editSection" data-id="${esc(x.id)}" aria-label="${esc(t('edit'))}" title="${esc(t('edit'))}">${U.icon('edit')}</button><button type="button" class="icon-btn danger" data-act="delSection" data-id="${esc(x.id)}" aria-label="${esc(t('del'))}" title="${esc(t('del'))}">${U.icon('trash')}</button></span>`}</td></tr>`;
      const sum = k => list.reduce((a, x) => a + x[k], 0);
      const foot = `<tr class="row-total"><th scope="row">${esc(t('total'))}</th><td class="n">${U.amt(sum('netRevenue'))}</td><td class="n">${U.amt(-sum('cogs'))}</td><td class="n">${U.amt(sum('grossProfit'))}</td><td class="n">${U.amt(-sum('opex'))}</td><td class="n">${U.amt(sum('otherIncome') - sum('otherExpense'))}</td><td class="n">${U.amt(-sum('depreciation'))}</td><td class="n">${U.amt(sum('profit'))}</td><td class="n">${U.pct(C.div(sum('profit'), sum('netRevenue')))}</td><td></td>${alloc ? '<td></td><td></td>' : ''}<td></td></tr>`;
      const table = `<div class="table-wrap"><table class="grid-table sections-table"><thead><tr>
        <th>${esc(t('colSection'))}</th><th class="n">${esc(t('col_netRevenue'))}</th><th class="n">${esc(t('col_cogs'))}</th><th class="n">${esc(t('col_grossProfit'))}</th><th class="n">${esc(t('col_opex'))}</th><th class="n">${esc(t('col_other'))}</th><th class="n">${esc(t('col_depreciation'))}</th><th class="n">${esc(t('col_profit'))}</th><th class="n">${esc(t('col_margin'))}</th><th class="n">${esc(t('col_revShare'))}</th>
        ${alloc ? `<th class="n">${esc(t('col_allocated'))}</th><th class="n">${esc(t('col_profitAfter'))}</th>` : ''}<th><span class="sr">${esc(t('actions'))}</span></th></tr></thead>
        <tbody>${list.map(row).join('')}</tbody><tfoot>${foot}</tfoot></table></div>`;
      const opts = H.field('settings.allocateShared', job.settings.allocateShared, { type: 'check', label: t('allocateShared') });
      const bars = H.bars(SR.list.map(s => ({ label: s.name, value: alloc ? s.profitAfterAllocation : s.profit, share: s.margin })));
      return H.intro(t('sectionsIntro')) + H.sheet(t('sectionsSummary'), `<div class="toolbar">${add}<span class="grow"></span>${opts}</div>${table}${H.note(t('sectionsNote'))}`) + (bars ? H.sheet(t('col_profit'), bars) : '');
    }
  });

  V.charts = { monthlyChart, plLines, bucketLabel };
})();
