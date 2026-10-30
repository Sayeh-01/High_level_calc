/* High Level Calc — small UI toolkit: escaping, forms in dialogs, toasts. */
(function () {
  'use strict';
  const I = window.HLI18n;
  const t = I.t;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function attrs(obj) {
    return Object.keys(obj || {}).filter(k => obj[k] != null && obj[k] !== false)
      .map(k => (obj[k] === true ? k : `${k}="${esc(obj[k])}"`)).join(' ');
  }

  // ---------------------------------------------------------------- numbers

  let currency = 'USD';
  function setCurrency(c) { currency = c || 'USD'; }

  // Table amount: negatives in parentheses, red ink, no currency symbol.
  function amt(x, opts) {
    const o = opts || {};
    if (x == null || !isFinite(x)) return `<span class="num muted">${t('notAvailable')}</span>`;
    const d = I.currencyDigits(currency);
    const tiny = Math.abs(x) < 0.5 * Math.pow(10, -d);
    if (tiny && o.dashZero !== false) return '<span class="num muted">–</span>';
    const s = I.fmtAmount(Math.abs(x), currency);
    return x < 0 && !tiny ? `<span class="num neg">(${s})</span>` : `<span class="num">${s}</span>`;
  }

  function money(x) {
    if (x == null || !isFinite(x)) return `<span class="num muted">${t('notAvailable')}</span>`;
    return `<span class="num${x < 0 ? ' neg' : ''}">${esc(I.fmtMoney(x, currency))}</span>`;
  }

  function moneyText(x) { return I.fmtMoney(x, currency); }

  function pct(x, d) {
    if (x == null || !isFinite(x)) return `<span class="num muted">${t('notAvailable')}</span>`;
    return `<span class="num${x < 0 ? ' neg' : ''}">${esc(I.fmtPct(x, d))}</span>`;
  }

  function n(x, d) {
    if (x == null || !isFinite(x)) return `<span class="num muted">${t('notAvailable')}</span>`;
    return `<span class="num${x < 0 ? ' neg' : ''}">${esc(I.fmtNum(x, d))}</span>`;
  }

  // Value for an <input> showing a stored number.
  function inputNum(v) {
    if (v == null || v === '') return '';
    const x = Number(v);
    return isFinite(x) ? String(x) : String(v);
  }

  // ------------------------------------------------------------------ icons

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.6l1.7 1.3-1.9 3.3-2-.8a7.5 7.5 0 0 1-2 1.2l-.3 2.1h-3.8l-.3-2.1a7.5 7.5 0 0 1-2-1.2l-2 .8-1.9-3.3 1.7-1.3a7.6 7.6 0 0 1 0-3.2L2.9 9.1l1.9-3.3 2 .8a7.5 7.5 0 0 1 2-1.2l.3-2.1h3.8l.3 2.1a7.5 7.5 0 0 1 2 1.2l2-.8 1.9 3.3-1.7 1.3a7.6 7.6 0 0 1 0 3.2z"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1"/><path d="M7 14h10v7H7z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    alert: '<path d="M12 3l9 17H3z"/><path d="M12 10v4M12 17v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    check: '<path d="M5 12l4 4 10-10"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-7"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'
  };
  function icon(name, cls) {
    return `<svg class="icon ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  }

  // ----------------------------------------------------------------- toasts

  function toast(message, opts) {
    const o = opts || {};
    const host = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (o.kind ? ' toast-' + o.kind : '');
    el.setAttribute('role', o.kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span>${esc(message)}</span>` + (o.action ? `<button type="button" class="btn btn-quiet btn-sm">${esc(o.action.label)}</button>` : '');
    if (o.action) el.querySelector('button').addEventListener('click', () => { o.action.run(); remove(); });
    host.appendChild(el);
    const timer = setTimeout(remove, o.duration || (o.action ? 8000 : 3500));
    function remove() { clearTimeout(timer); el.classList.add('leaving'); setTimeout(() => el.remove(), 200); }
    return remove;
  }

  // ---------------------------------------------------------------- dialogs

  let openDialogs = 0;
  function dialog(opts) {
    const host = document.getElementById('dialogs');
    const wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = `<div class="dialog ${opts.wide ? 'dialog-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <header class="dialog-head"><h2 id="dlg-title">${esc(opts.title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="${esc(t('close'))}">${icon('x')}</button></header>
      <div class="dialog-body">${opts.body || ''}</div>
      <footer class="dialog-foot">${opts.foot || ''}</footer></div>`;
    host.appendChild(wrap);
    openDialogs++;
    const previous = document.activeElement;
    const close = () => {
      if (!wrap.isConnected) return;
      wrap.remove();
      openDialogs--;
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.isConnected) previous.focus();
      if (opts.onClose) opts.onClose();
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      if (e.key === 'Tab') trapFocus(e, wrap);
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    const first = wrap.querySelector('[autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-foot .btn-primary');
    if (first) setTimeout(() => first.focus(), 0);
    return { el: wrap, close };
  }

  function trapFocus(e, root) {
    const items = Array.from(root.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function confirmDialog(message, opts) {
    const o = opts || {};
    return new Promise(resolve => {
      let answered = false;
      const d = dialog({
        title: o.title || message,
        body: o.title ? `<p>${esc(message)}</p>` : '',
        foot: `<button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
               <button type="button" class="btn ${o.danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(o.okLabel || t('apply'))}</button>`,
        onClose: () => { if (!answered) resolve(false); }
      });
      d.el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; d.close(); resolve(true); });
    });
  }

  // ------------------------------------------------------------------ forms
  //
  // fields: [{ key, label, type, options, required, help, placeholder, list,
  //            half, show(values), min, step }]

  function fieldHtml(f, value, uid) {
    const id = `f-${uid}-${f.key}`;
    const help = f.help ? `<small class="help" id="${id}-help">${esc(f.help)}</small>` : '';
    const common = { id, name: f.key, 'data-field': f.key, 'aria-describedby': f.help ? id + '-help' : null, required: !!f.required, placeholder: f.placeholder || null };
    let control;
    if (f.type === 'select') {
      control = `<select ${attrs(common)}>${f.options.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(value == null ? '' : value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'checkbox') {
      return `<label class="check ${f.half ? 'half' : 'full'}" data-wrap="${f.key}"><input type="checkbox" ${attrs(common)}${value ? ' checked' : ''}><span>${esc(f.label)}</span>${help}</label>`;
    } else if (f.type === 'textarea') {
      control = `<textarea rows="2" ${attrs(common)}>${esc(value)}</textarea>`;
    } else if (f.type === 'number') {
      control = `<input type="text" inputmode="decimal" autocomplete="off" class="num-input" ${attrs(common)} value="${esc(inputNum(value))}">`;
    } else if (f.type === 'date') {
      control = `<input type="date" ${attrs(common)} value="${esc(value || '')}">`;
    } else if (f.type === 'radio') {
      return `<fieldset class="radio-row ${f.half ? 'half' : 'full'}" data-wrap="${f.key}"><legend>${esc(f.label)}</legend>${f.options.map(o =>
        `<label class="radio${o.swatch ? ' swatch-radio' : ''}"><input type="radio" name="${esc(f.key)}" data-field="${esc(f.key)}" value="${esc(o.value)}"${String(o.value) === String(value) ? ' checked' : ''}${o.swatch ? ` aria-label="${esc(o.swatch)}"` : ''}><span>${o.swatch ? `<i class="swatch" style="background:${esc(o.swatch)}"></i>` : ''}${esc(o.label)}</span></label>`).join('')}</fieldset>`;
    } else {
      const listId = f.list ? id + '-list' : null;
      control = `<input type="text" autocomplete="off" ${attrs(Object.assign({ list: listId }, common))} value="${esc(value || '')}">`;
      if (f.list) control += `<datalist id="${listId}">${f.list.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>`;
    }
    return `<label class="field ${f.half ? 'half' : 'full'}" data-wrap="${f.key}" for="${id}"><span class="label">${esc(f.label)}${f.required ? '' : ''}</span>${control}${help}<small class="error" hidden></small></label>`;
  }

  let formUid = 0;
  function readForm(root, fields) {
    const out = {};
    let firstError = null;
    for (const f of fields) {
      const wrap = root.querySelector(`[data-wrap="${f.key}"]`);
      if (!wrap) continue;
      const hidden = wrap.hidden;
      let v;
      if (f.type === 'checkbox') v = wrap.querySelector('input').checked;
      else if (f.type === 'radio') { const c = wrap.querySelector('input:checked'); v = c ? c.value : ''; }
      else v = wrap.querySelector('[data-field]').value;
      const err = wrap.querySelector('.error');
      let message = '';
      if (f.type === 'number') {
        const p = I.parseNumber(v);
        if (p === null) v = '';
        else if (Number.isNaN(p)) message = t('invalidNumber');
        else v = p;
      } else if (typeof v === 'string' && f.type !== 'textarea') v = v.trim();
      if (!hidden && f.required && (v === '' || v == null)) message = t('required');
      if (err) { err.hidden = !message; err.textContent = message; }
      const input = wrap.querySelector('[data-field]');
      if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (message && !firstError && !hidden) firstError = input;
      out[f.key] = v;
    }
    return { values: out, firstError };
  }

  function applyVisibility(root, fields, values) {
    for (const f of fields) {
      if (!f.show) continue;
      const wrap = root.querySelector(`[data-wrap="${f.key}"]`);
      if (wrap) wrap.hidden = !f.show(values);
    }
  }

  // Opens a dialog with a form; resolves via onSubmit(values) → true to close.
  function openForm(opts) {
    const uid = ++formUid;
    const values = Object.assign({}, opts.values || {});
    const body = `<form class="form-grid" novalidate>${opts.fields.map(f => fieldHtml(f, values[f.key], uid)).join('')}${opts.preview ? '<div class="form-preview full" data-preview></div>' : ''}<button type="submit" hidden></button></form>`;
    const foot = `${opts.extraButtons || ''}<span class="grow"></span><button type="button" class="btn" data-close>${esc(t('cancel'))}</button>
      <button type="button" class="btn btn-primary" data-submit>${esc(opts.submitLabel || t('save'))}</button>`;
    const d = dialog({ title: opts.title, body, foot, wide: opts.wide });
    const form = d.el.querySelector('form');
    const refresh = () => {
      const { values: v } = readForm(form, opts.fields);
      applyVisibility(form, opts.fields, v);
      form.querySelectorAll('.error').forEach(e => { if (!e.dataset.sticky) { e.hidden = true; } });
      if (opts.preview) form.querySelector('[data-preview]').innerHTML = opts.preview(v) || '';
      if (opts.onInput) opts.onInput(v, form);
    };
    applyVisibility(form, opts.fields, values);
    if (opts.preview) form.querySelector('[data-preview]').innerHTML = opts.preview(values) || '';
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    const submit = e => {
      if (e) e.preventDefault();
      const { values: v, firstError } = readForm(form, opts.fields);
      if (firstError) { firstError.focus(); return; }
      const keep = opts.onSubmit(v);
      if (keep !== false) d.close();
    };
    form.addEventListener('submit', submit);
    d.el.querySelector('[data-submit]').addEventListener('click', submit);
    d.el.querySelectorAll('[data-extra]').forEach(b => b.addEventListener('click', () => {
      const { values: v } = readForm(form, opts.fields);
      if (opts.onExtra && opts.onExtra(b.dataset.extra, v) !== false) d.close();
    }));
    return d;
  }

  window.HLUI = { esc, attrs, amt, money, moneyText, pct, n, inputNum, icon, toast, dialog, confirmDialog, openForm, setCurrency, fieldHtml, readForm, get dialogsOpen() { return openDialogs; } };
})();
