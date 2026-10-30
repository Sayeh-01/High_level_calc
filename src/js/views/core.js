/* High Level Calc — view registry, shared building blocks and entity forms. */
(function () {
  'use strict';
  const I = window.HLI18n, C = window.HLCalc, M = window.HLModel, U = window.HLUI;
  const t = I.t;
  const esc = U.esc;

  const registry = {};
  const fallback = { render: () => '' };

  // ----------------------------------------------------------- primitives

  const H = {
    sheet(title, body, opts) {
      const o = opts || {};
      const head = title || o.actions ? `<header class="sheet-head">${title ? `<h2>${esc(title)}</h2>` : ''}${o.sub ? `<p class="sheet-sub">${esc(o.sub)}</p>` : ''}${o.actions ? `<div class="sheet-actions">${o.actions}</div>` : ''}</header>` : '';
      return `<section class="sheet ${o.cls || ''}"${o.id ? ` id="${esc(o.id)}"` : ''}>${head}<div class="sheet-body">${body}</div></section>`;
    },

    intro(text) { return `<p class="intro">${esc(text)}</p>`; },

    note(text, kind) {
      return `<p class="note${kind ? ' note-' + kind : ''}">${U.icon(kind === 'warn' ? 'alert' : 'info')}<span>${esc(text)}</span></p>`;
    },

    empty(text, actions) {
      return `<div class="empty"><p>${esc(text)}</p>${actions ? `<div class="empty-actions">${actions}</div>` : ''}</div>`;
    },

    // Accounting statement. line types: line | sub | total | grand | head
    statement(lines, opts) {
      const o = opts || {};
      const rows = lines.filter(Boolean).map(l => {
        const type = l.type || 'line';
        if (type === 'head') return `<tr class="st-head"><th colspan="${o.pct ? 3 : 2}" scope="rowgroup">${esc(l.label)}</th></tr>`;
        const pctCell = o.pct ? `<td class="pct">${l.pct === undefined ? '' : U.pct(l.pct)}</td>` : '';
        const value = l.html != null ? l.html : U.amt(l.value, { dashZero: l.dashZero });
        return `<tr class="st-${type}${l.cls ? ' ' + l.cls : ''}"><th scope="row">${esc(l.label)}${l.hint ? `<small>${esc(l.hint)}</small>` : ''}</th><td>${value}</td>${pctCell}</tr>`;
      }).join('');
      const head = o.pct ? `<thead><tr><th></th><th>${esc(o.amountLabel || t('amount'))}</th><th>${esc(t('pl_ofRevenue'))}</th></tr></thead>` : '';
      return `<table class="stmt${o.pct ? ' with-pct' : ''}">${head}<tbody>${rows}</tbody></table>`;
    },

    kv(items) {
      return `<dl class="kv">${items.filter(Boolean).map(([k, v, cls]) => `<div class="${cls || ''}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    },

    // Input bound to a path inside the job (data-bind). Saved as you type,
    // recalculated when you leave the field or press Enter.
    field(path, value, o) {
      o = o || {};
      const id = 'b-' + path.replace(/[^\w-]/g, '-');
      const help = o.help ? `<small class="help">${esc(o.help)}</small>` : '';
      const live = o.live ? ' data-live' : '';
      let control;
      if (o.type === 'select') {
        control = `<select id="${id}" data-bind="${esc(path)}" data-type="${o.numeric ? 'number' : 'text'}">${o.options.map(opt => `<option value="${esc(opt.value)}"${String(opt.value) === String(value) ? ' selected' : ''}>${esc(opt.label)}</option>`).join('')}</select>`;
      } else if (o.type === 'check') {
        return `<label class="check${o.cls ? ' ' + o.cls : ''}"><input type="checkbox" id="${id}" data-bind="${esc(path)}" data-type="bool"${value ? ' checked' : ''}><span>${esc(o.label)}</span>${help}</label>`;
      } else if (o.type === 'date') {
        control = `<input type="date" id="${id}" data-bind="${esc(path)}" value="${esc(value || '')}">`;
      } else if (o.type === 'text') {
        control = `<input type="text" id="${id}" data-bind="${esc(path)}" value="${esc(value || '')}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${live}>`;
      } else if (o.type === 'textarea') {
        control = `<textarea id="${id}" rows="3" data-bind="${esc(path)}">${esc(value || '')}</textarea>`;
      } else {
        control = `<input type="text" inputmode="decimal" autocomplete="off" class="num-input" id="${id}" data-bind="${esc(path)}" data-type="number" value="${esc(U.inputNum(value))}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${live}>`;
      }
      if (o.suffix) control = `<span class="with-suffix">${control}<span class="suffix">${esc(o.suffix)}</span></span>`;
      return `<label class="field${o.cls ? ' ' + o.cls : ''}" for="${id}"><span class="label">${esc(o.label)}</span>${control}${help}</label>`;
    },

    out(label, html, cls) {
      return `<div class="out${cls ? ' ' + cls : ''}"><span class="label">${esc(label)}</span><output>${html}</output></div>`;
    },

    rowActions(type, id) {
      return `<span class="row-actions">
        <button type="button" class="icon-btn" data-act="edit${type}" data-id="${esc(id)}" title="${esc(t('edit'))}" aria-label="${esc(t('edit'))}">${U.icon('edit')}</button>
        <button type="button" class="icon-btn" data-act="dup${type}" data-id="${esc(id)}" title="${esc(t('duplicate'))}" aria-label="${esc(t('duplicate'))}">${U.icon('copy')}</button>
        <button type="button" class="icon-btn danger" data-act="del${type}" data-id="${esc(id)}" title="${esc(t('del'))}" aria-label="${esc(t('del'))}">${U.icon('trash')}</button></span>`;
    },

    button(label, act, o) {
      o = o || {};
      const data = Object.keys(o.data || {}).map(k => ` data-${k}="${esc(o.data[k])}"`).join('');
      return `<button type="button" class="btn${o.primary ? ' btn-primary' : ''}${o.sm ? ' btn-sm' : ''}" data-act="${act}"${data}>${o.icon ? U.icon(o.icon) : ''}<span>${esc(label)}</span></button>`;
    },

    // Horizontal bars for one series (categories, sections).
    bars(items, o) {
      o = o || {};
      const max = Math.max.apply(null, items.map(x => Math.abs(x.value)).concat([0]));
      if (!max) return '';
      return `<ul class="hbars">${items.map(x => {
        const w = Math.max(1, Math.round(Math.abs(x.value) / max * 100));
        return `<li><span class="hb-label">${esc(x.label)}</span><span class="hb-track"><i class="hb-bar${x.value < 0 ? ' neg' : ''}" style="width:${w}%"></i></span><span class="hb-value">${U.amt(x.value)}${x.share != null ? ` <small>${U.pct(x.share)}</small>` : ''}</span></li>`;
      }).join('')}</ul>`;
    },

    sectionName(job, id) {
      const s = job.sections.find(x => x.id === id);
      return s ? s.name : '';
    }
  };

  // ---------------------------------------------------------- entity forms

  const kindOptions = () => C.KIND_KEYS.map(k => ({ value: k, label: t('kind_' + k) }));

  function usedValues(job, key) {
    const set = new Set();
    for (const x of job.transactions) { const v = (x[key] || '').trim(); if (v) set.add(v); }
    return Array.from(set);
  }

  function categoryList(job) {
    const lang = I.getLang();
    const all = new Set();
    for (const k of C.KIND_KEYS) for (const c of I.categories[lang][k]) all.add(c);
    for (const c of usedValues(job, 'category')) all.add(c);
    return Array.from(all);
  }

  function txFields(ctx) {
    const job = ctx.job;
    const vat = job.settings.vat;
    const sections = [{ value: '', label: t('none') }].concat(job.sections.map(s => ({ value: s.id, label: s.name })));
    return [
      { key: 'kind', label: t('f_kind'), type: 'select', options: kindOptions(), half: true },
      { key: 'date', label: t('f_date'), type: 'date', half: true },
      { key: 'description', label: t('f_description'), placeholder: '' },
      { key: 'category', label: t('f_category'), list: categoryList(job), half: true },
      { key: 'sectionId', label: t('f_section'), type: 'select', options: sections, half: true, show: () => job.sections.length > 0 },
      { key: 'party', label: t('f_party'), list: usedValues(job, 'party'), half: true },
      { key: 'ref', label: t('f_ref'), half: true },
      { key: 'qty', label: t('f_qty'), type: 'number', half: true },
      { key: 'unitPrice', label: t('f_unitPrice'), type: 'number', half: true },
      { key: 'amount', label: t('f_amount'), type: 'number', half: true, help: vat.enabled ? t(vat.pricesIncludeVat ? 'f_amountHelpGross' : 'f_amountHelpNet') : '', show: v => !(C.num(v.qty) && C.num(v.unitPrice)) },
      { key: 'vat', label: t('f_vat'), type: 'checkbox', half: true, show: () => !!vat.enabled },
      { key: 'vatRate', label: t('f_vatRate'), type: 'number', half: true, placeholder: t('f_vatRatePh', { r: I.fmtNum(C.num(vat.rate), 2).replace(/[.,٫]00$/, '') }), show: v => !!vat.enabled && v.vat },
      { key: 'status', label: t('f_status'), type: 'select', half: true, options: ['paid', 'partial', 'unpaid'].map(s => ({ value: s, label: t('status_' + s) })) },
      { key: 'paid', label: t('f_paid'), type: 'number', half: true, show: v => v.status === 'partial' },
      { key: 'notes', label: t('f_notes'), type: 'textarea' }
    ];
  }

  function txPreview(ctx) {
    return v => {
      const vals = C.txValues(v, ctx.job);
      const parts = [[t('previewNet'), vals.net]];
      if (ctx.job.settings.vat.enabled) parts.push([t('previewVat'), vals.vat]);
      parts.push([t('previewGross'), vals.gross]);
      if (v.status !== 'paid') parts.push([t('colBalance'), vals.balance]);
      return parts.map(([k, x]) => `<span><small>${esc(k)}</small>${U.money(x)}</span>`).join('');
    };
  }

  function openTx(ctx, existing, preset) {
    const job = ctx.job;
    const today = new Date().toISOString().slice(0, 10);
    const values = existing ? Object.assign({}, existing) : Object.assign({
      kind: 'revenue', date: today, sectionId: '', category: '', description: '', party: '', ref: '',
      qty: '', unitPrice: '', amount: '', vat: !!job.settings.vat.enabled, vatRate: '', status: 'paid', paid: '', notes: ''
    }, preset || {});
    U.openForm({
      title: existing ? t('editEntry') : t('addEntry'),
      fields: txFields(ctx),
      values,
      preview: txPreview(ctx),
      submitLabel: existing ? t('save') : t('add'),
      onSubmit(v) {
        if (C.num(v.qty) && C.num(v.unitPrice)) v.amount = C.num(v.qty) * C.num(v.unitPrice);
        ctx.commit(j => {
          if (existing) Object.assign(j.transactions.find(x => x.id === existing.id) || {}, v);
          else j.transactions.push(Object.assign({ id: M.newId('tx') }, v));
        });
      }
    });
  }

  function partnerFields(ctx) {
    const method = ctx.job.settings.partners.method;
    return [
      { key: 'name', label: t('p_name'), required: true },
      { key: 'capital', label: t('p_capital'), type: 'number', half: true },
      { key: 'joinDate', label: t('p_joinDate'), type: 'date', half: true, help: t('p_joinHelp') },
      { key: 'sharePct', label: t('p_sharePct'), type: 'number', half: true, show: () => method === 'manual' },
      { key: 'shares', label: t('p_shares'), type: 'number', half: true, show: () => method === 'shares' || method === 'manual' },
      { key: 'salary', label: t('p_salary'), type: 'number', half: true, help: t('p_salaryHelp') },
      { key: 'bonusPct', label: t('p_bonusPct'), type: 'number', half: true, help: t('p_bonusHelp') },
      { key: 'drawings', label: t('p_drawings'), type: 'number', half: true },
      { key: 'notes', label: t('f_notes'), type: 'textarea' }
    ];
  }

  function assetFields(ctx) {
    const sections = [{ value: '', label: t('none') }].concat(ctx.job.sections.map(s => ({ value: s.id, label: s.name })));
    return [
      { key: 'name', label: t('a_name'), required: true },
      { key: 'cost', label: t('a_cost'), type: 'number', half: true, required: true },
      { key: 'salvage', label: t('a_salvage'), type: 'number', half: true },
      { key: 'lifeYears', label: t('a_life'), type: 'number', half: true, required: true },
      { key: 'method', label: t('a_method'), type: 'select', half: true, options: ['sl', 'ddb', 'syd', 'none'].map(m => ({ value: m, label: t('method_' + m) })) },
      { key: 'startDate', label: t('a_start'), type: 'date', half: true },
      { key: 'sectionId', label: t('a_section'), type: 'select', half: true, options: sections, show: () => ctx.job.sections.length > 0 },
      { key: 'notes', label: t('f_notes'), type: 'textarea' }
    ];
  }

  function loanFields() {
    return [
      { key: 'name', label: t('l_name'), required: true },
      { key: 'principal', label: t('l_principal'), type: 'number', half: true, required: true },
      { key: 'annualRate', label: t('l_rate'), type: 'number', half: true },
      { key: 'months', label: t('l_months'), type: 'number', half: true, required: true },
      { key: 'startDate', label: t('l_start'), type: 'date', half: true },
      { key: 'type', label: t('l_type'), type: 'select', options: ['annuity', 'equal', 'bullet'].map(m => ({ value: m, label: t('loan_' + m) })) },
      { key: 'notes', label: t('f_notes'), type: 'textarea' }
    ];
  }

  function sectionFields() {
    return [{ key: 'name', label: t('sectionName'), placeholder: t('sectionNamePh'), required: true }];
  }

  const ENTITIES = {
    Tx: { list: 'transactions', title: ['addEntry', 'editEntry'], label: x => x.description || x.category || t('kind_' + x.kind) },
    Partner: { list: 'partners', title: ['addPartner', 'editPartner'], fields: partnerFields, defaults: { name: '', capital: '', joinDate: '', sharePct: '', shares: '', salary: '', bonusPct: '', drawings: '', notes: '' }, label: x => x.name },
    Asset: { list: 'assets', title: ['addAsset', 'editAsset'], fields: assetFields, defaults: { name: '', cost: '', salvage: '', lifeYears: 5, method: 'sl', startDate: new Date().toISOString().slice(0, 10), sectionId: '', notes: '' }, label: x => x.name },
    Loan: { list: 'loans', title: ['addLoan', 'editLoan'], fields: loanFields, defaults: { name: '', principal: '', annualRate: '', months: 12, startDate: new Date().toISOString().slice(0, 10), type: 'annuity', notes: '' }, label: x => x.name },
    Section: { list: 'sections', title: ['addSection', 'editSection'], fields: sectionFields, defaults: { name: '' }, label: x => x.name }
  };

  function openEntity(ctx, type, existing) {
    const E = ENTITIES[type];
    if (type === 'Tx') return openTx(ctx, existing);
    U.openForm({
      title: t(E.title[existing ? 1 : 0]),
      fields: E.fields(ctx),
      values: existing ? Object.assign({}, existing) : Object.assign({}, E.defaults),
      submitLabel: existing ? t('save') : t('add'),
      onSubmit(v) {
        ctx.commit(j => {
          if (existing) Object.assign(j[E.list].find(x => x.id === existing.id) || {}, v);
          else j[E.list].push(Object.assign({ id: M.newId(type.slice(0, 2).toLowerCase()) }, v));
        });
      }
    });
  }

  async function deleteEntity(ctx, type, id) {
    const E = ENTITIES[type];
    const item = ctx.job[E.list].find(x => x.id === id);
    if (!item) return;
    const name = E.label(item) || '';
    if (type === 'Section') {
      const ok = await U.confirmDialog(t('confirmDelete', { name }), { danger: true, okLabel: t('del'), title: t('confirmDelete', { name }) });
      if (!ok) return;
    }
    ctx.commit(j => {
      j[E.list] = j[E.list].filter(x => x.id !== id);
      if (type === 'Section') {
        for (const x of j.transactions) if (x.sectionId === id) x.sectionId = '';
        for (const x of j.assets) if (x.sectionId === id) x.sectionId = '';
      }
    }, { snapshot: true });
    ctx.undoToast(t('deleted', { name }));
  }

  function duplicateEntity(ctx, type, id) {
    const E = ENTITIES[type];
    const item = ctx.job[E.list].find(x => x.id === id);
    if (!item) return;
    ctx.commit(j => {
      const copy = Object.assign({}, JSON.parse(JSON.stringify(item)), { id: M.newId(type.slice(0, 2).toLowerCase()) });
      j[E.list].splice(j[E.list].indexOf(item) + 1, 0, copy);
    });
    U.toast(t('duplicated'));
  }

  const shared = {
    nav: null, // handled by the app shell
    goto(ctx, el) { ctx.go(el.dataset.view); },
    addIncome(ctx) { openTx(ctx, null, { kind: 'revenue' }); },
    addExpense(ctx) { openTx(ctx, null, { kind: 'opex' }); },
    toggle(ctx, el) { const k = el.dataset.key; ctx.ui.expanded[k] = !ctx.ui.expanded[k]; ctx.render(); },
    toggleChartTable(ctx) { ctx.ui.chartAsTable = !ctx.ui.chartAsTable; ctx.render(); }
  };
  delete shared.nav;
  for (const type of Object.keys(ENTITIES)) {
    shared['add' + type] = ctx => openEntity(ctx, type, null);
    shared['edit' + type] = (ctx, el) => openEntity(ctx, type, ctx.job[ENTITIES[type].list].find(x => x.id === el.dataset.id));
    shared['dup' + type] = (ctx, el) => duplicateEntity(ctx, type, el.dataset.id);
    shared['del' + type] = (ctx, el) => deleteEntity(ctx, type, el.dataset.id);
  }

  window.HLViews = {
    register(name, view) { registry[name] = view; },
    get(name) { return registry[name] || fallback; },
    shared, H, openTx
  };
})();
