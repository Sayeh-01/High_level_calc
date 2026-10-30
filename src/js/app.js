/* High Level Calc — application shell: tabs, navigation, bindings, commands. */
(function () {
  'use strict';
  const I = window.HLI18n, C = window.HLCalc, M = window.HLModel, U = window.HLUI, S = window.HLStore, V = window.HLViews;
  const t = I.t;
  const esc = U.esc;
  const api = S.api;

  const NAV = [
    ['overview', 'chart'], ['ledger', 'sheet'], ['sections', 'grid'], null,
    ['partners', 'folder'], ['assets', 'table'], ['loans', 'table'], ['tax', 'table'], null,
    ['analysis', 'chart'], ['calculators', 'grid'], ['report', 'print'], null,
    ['settings', 'gear']
  ];

  const ui = { home: false, views: {}, filters: {}, expanded: {}, chartAsTable: false, homeQuery: '', renaming: null, ledgerLimit: {} };
  let pointerDown = false;
  let pendingRender = false;
  let renderQueued = false;
  let liveTimer = null;
  let rendering = false;

  const data = () => S.data;

  function activeJob() {
    if (ui.home) return null;
    const d = data();
    return d.jobs.find(j => j.id === d.activeId && j.open) || null;
  }

  // ------------------------------------------------------------- settings

  function applySettings() {
    const s = data().settings;
    I.setLang(s.lang);
    I.setDigits(s.digits);
    const html = document.documentElement;
    html.lang = s.lang;
    html.dir = I.dir();
    if (s.theme === 'light' || s.theme === 'dark') html.dataset.theme = s.theme;
    else delete html.dataset.theme;
    document.title = t('appName');
    api.setLanguage(s.lang);
  }

  // ----------------------------------------------------------- path utils

  function walk(obj, path, create) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      let next;
      if (Array.isArray(cur)) next = /^\d+$/.test(p) ? cur[+p] : cur.find(x => x && x.id === p);
      else next = cur[p];
      if (next == null) {
        if (!create) return null;
        next = {};
        cur[p] = next;
      }
      cur = next;
    }
    return { parent: cur, key: parts[parts.length - 1] };
  }

  function setPath(obj, path, value) {
    const w = walk(obj, path, true);
    if (w) w.parent[w.key] = value;
  }

  function readBound(el) {
    const type = el.dataset.type || (el.type === 'checkbox' ? 'bool' : 'text');
    if (type === 'bool') return el.checked;
    if (type === 'number') {
      const p = I.parseNumber(el.value);
      if (p === null) return '';
      if (Number.isNaN(p)) return undefined;
      return p;
    }
    return el.value;
  }

  // -------------------------------------------------------------- rendering

  function scheduleRender() {
    if (pointerDown) { pendingRender = true; return; }
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(render, 0);
  }

  function focusKey(el) {
    if (!el || el === document.body) return null;
    if (el.dataset.bind) return ['data-bind', el.dataset.bind];
    if (el.dataset.appBind) return ['data-app-bind', el.dataset.appBind];
    if (el.dataset.focus) return ['data-focus', el.dataset.focus];
    if (el.id) return ['id', el.id];
    return null;
  }

  function render() {
    renderQueued = false;
    const root = document.getElementById('app');
    const active = document.activeElement;
    const fk = root.contains(active) ? focusKey(active) : null;
    let sel = null;
    try { if (fk && active.selectionStart != null) sel = [active.selectionStart, active.selectionEnd]; } catch (e) { sel = null; }
    const scrollEl = document.getElementById('view-scroll');
    const scroll = scrollEl ? { view: scrollEl.dataset.view, job: scrollEl.dataset.job, top: scrollEl.scrollTop } : null;
    const tabsEl = root.querySelector('.tabs-scroll');
    const tabsScroll = tabsEl ? tabsEl.scrollLeft : 0;

    applySettings();
    const job = activeJob();
    if (job) U.setCurrency(job.currency);
    rendering = true;
    let ctx = null;
    let html = topbar(job);
    if (job) {
      ctx = makeCtx(job, C.compute(job));
      html += jobView(ctx);
    } else {
      ctx = makeCtx(null, null);
      html += `<main class="workspace home-wrap"><div class="view" id="view-scroll" data-view="home">${V.get('home').render(ctx)}</div></main>`;
    }
    root.innerHTML = html;
    rendering = false;

    const newScroll = document.getElementById('view-scroll');
    if (scroll && newScroll && scroll.view === newScroll.dataset.view && scroll.job === newScroll.dataset.job) newScroll.scrollTop = scroll.top;
    const newTabs = root.querySelector('.tabs-scroll');
    if (newTabs) newTabs.scrollLeft = tabsScroll;
    if (fk) {
      const el = root.querySelector(`[${fk[0]}="${CSS.escape(fk[1])}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } }
      }
    }
    const renameInput = root.querySelector('.tab-rename');
    if (renameInput) { renameInput.focus(); renameInput.select(); }
    const view = V.get(job ? currentView(job) : 'home');
    if (view.mount) view.mount(root, ctx);
    updateSaveState();
  }

  function currentView(job) {
    return ui.views[job.id] || 'overview';
  }

  function makeCtx(job, R) {
    return {
      job, R, ui, data: data(), t, I, C, M, U, esc,
      commit(mutator, opts) {
        if (opts && opts.snapshot) S.snapshot();
        if (mutator) mutator(job);
        S.touch(job);
        scheduleRender();
      },
      render: scheduleRender,
      undoToast(message) {
        U.toast(message, { action: { label: t('undo'), run: () => { if (S.undo()) { scheduleRender(); U.toast(t('restored')); } } } });
      },
      go(view) { if (job) { ui.views[job.id] = view; resetScroll(); scheduleRender(); } },
      commands
    };
  }

  function resetScroll() {
    const el = document.getElementById('view-scroll');
    if (el) el.dataset.view = '';
  }

  function updateSaveState() {
    const el = document.getElementById('save-state');
    if (!el) return;
    const st = S.status;
    el.dataset.state = st;
    el.textContent = st === 'error' ? t('saveFailed') : st === 'saved' ? t('saved') : '…';
    el.title = st === 'error' ? t('saveFailed') : '';
  }

  // ------------------------------------------------------------ top bar

  function topbar(job) {
    const d = data();
    const open = d.jobs.filter(j => j.open);
    const tabs = open.map(j => {
      const active = job && j.id === job.id;
      const name = j.name || t('newJob');
      const label = ui.renaming === j.id
        ? `<input class="tab-rename" data-rename="${esc(j.id)}" value="${esc(j.name)}" aria-label="${esc(t('jobName'))}">`
        : `<span class="tab-name" title="${esc(name + ' — ' + t('renameHint'))}">${esc(name)}</span>`;
      return `<div class="tab${active ? ' active' : ''}" role="tab" aria-selected="${active}" draggable="${ui.renaming === j.id ? 'false' : 'true'}" data-act="openTab" data-job="${esc(j.id)}" style="--tab:${esc(j.color)}" tabindex="0">
        <i class="tab-dot" aria-hidden="true"></i>${label}
        <button type="button" class="tab-close" data-act="closeTab" data-job="${esc(j.id)}" title="${esc(t('closeTab'))}" aria-label="${esc(t('closeTab'))}">${U.icon('x')}</button></div>`;
    }).join('');
    const theme = d.settings.theme;
    return `<header class="topbar">
      <div class="brand" aria-label="${esc(t('appName'))}">
        <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="5" width="26" height="22" rx="3"/><path d="M3 12h26M12 12v15M20 12v15"/><path class="logo-ink" d="M7 20.5h2.5M15 17.5h2.5M15 22.5h2.5M23 20h2.5"/></svg>
        <span class="brand-name">${esc(t('appName'))}</span>
      </div>
      <nav class="tabs" role="tablist" aria-label="${esc(t('allJobs'))}">
        <button type="button" class="tab tab-home${job ? '' : ' active'}" data-act="home" title="${esc(t('allJobs'))}" aria-label="${esc(t('allJobs'))}">${U.icon('grid')}</button>
        <div class="tabs-scroll">${tabs}</div>
        <button type="button" class="tab-new" data-act="newJob" title="${esc(t('newJob'))}">${U.icon('plus')}<span>${esc(t('newJob'))}</span></button>
      </nav>
      <div class="top-actions">
        <span class="save-state" id="save-state" aria-live="polite"></span>
        <button type="button" class="btn btn-quiet btn-sm lang-btn" data-act="toggleLang" lang="${d.settings.lang === 'ar' ? 'en' : 'ar'}">${U.icon('globe')}<span>${esc(t('switchLang'))}</span></button>
        <button type="button" class="icon-btn" data-act="cycleTheme" title="${esc(t('theme') + ': ' + t(theme === 'dark' ? 'themeDark' : theme === 'light' ? 'themeLight' : 'themeSystem'))}" aria-label="${esc(t('theme'))}">${U.icon(theme === 'dark' ? 'moon' : 'sun')}</button>
        <button type="button" class="icon-btn" data-act="appSettings" title="${esc(t('appSettings'))}" aria-label="${esc(t('appSettings'))}">${U.icon('gear')}</button>
      </div>
    </header>`;
  }

  function periodText(job, R) {
    const p = R.period;
    const range = t('period_from_to', { from: I.fmtDate(p.fromISO, 'long'), to: I.fmtDate(p.toISO, 'long') });
    return p.explicit ? range : `${t('allDates')} (${range})`;
  }

  function jobView(ctx) {
    const job = ctx.job;
    const view = currentView(job);
    const R = ctx.R;
    const rail = NAV.map(item => {
      if (!item) return '<hr>';
      const [key] = item;
      let badge = '';
      if (key === 'ledger' && job.transactions.length) badge = I.fmtNum(job.transactions.length, 0);
      if (key === 'partners' && job.partners.length) badge = I.fmtNum(job.partners.length, 0);
      if (key === 'sections' && job.sections.length) badge = I.fmtNum(job.sections.length, 0);
      if (key === 'assets' && job.assets.length) badge = I.fmtNum(job.assets.length, 0);
      if (key === 'loans' && job.loans.length) badge = I.fmtNum(job.loans.length, 0);
      return `<button type="button" class="rail-item${view === key ? ' active' : ''}" data-act="nav" data-view="${key}" aria-current="${view === key ? 'page' : 'false'}"><span>${esc(t('nav_' + key))}</span>${badge ? `<b class="badge">${badge}</b>` : ''}</button>`;
    }).join('');
    const np = R.pl.netProfit;
    return `<main class="workspace">
      <section class="job" style="--tab:${esc(job.color)}">
        <header class="job-head">
          <div class="job-title">
            <h1>${esc(job.name || t('newJob'))}</h1>
            <div class="job-meta">
              ${job.client.name ? `<span class="chip">${esc(job.client.name)}</span>` : ''}
              <span class="chip" title="${esc(I.currencyName(job.currency))}">${esc(job.currency)}</span>
              <button type="button" class="chip chip-btn" data-act="nav" data-view="settings">${esc(periodText(job, R))}</button>
            </div>
          </div>
          <div class="job-figure${np < 0 ? ' is-loss' : ''}">
            <span class="job-figure-label">${esc(t(np < 0 ? 'kpiNetLoss' : 'kpiNetProfit'))}</span>
            <span class="job-figure-value">${U.money(Math.abs(np) < 1e-9 ? 0 : np)}</span>
          </div>
          <div class="job-actions">
            <button type="button" class="btn btn-sm" data-act="exportExcel">${U.icon('sheet')}<span>${esc(t('exportExcel'))}</span></button>
            <button type="button" class="btn btn-sm" data-act="exportPdf">${U.icon('pdf')}<span>${esc(t('exportPdf'))}</span></button>
            <button type="button" class="icon-btn" data-act="print" title="${esc(t('print'))}" aria-label="${esc(t('print'))}">${U.icon('print')}</button>
          </div>
        </header>
        <div class="job-body">
          <nav class="rail" aria-label="${esc(job.name)}">${rail}</nav>
          <div class="view" id="view-scroll" data-view="${view}" data-job="${esc(job.id)}">${V.get(view).render(ctx)}</div>
        </div>
      </section>
    </main>`;
  }

  // -------------------------------------------------------------- commands

  function job() { return activeJob(); }

  function openJob(id) {
    const j = S.job(id);
    if (!j) return;
    j.open = true;
    data().activeId = id;
    ui.home = false;
    S.scheduleSave();
    scheduleRender();
  }

  function closeTab(id) {
    const d = data();
    const open = d.jobs.filter(j => j.open);
    const idx = open.findIndex(j => j.id === id);
    if (idx < 0) return;
    open[idx].open = false;
    if (d.activeId === id) {
      const next = open[idx + 1] || open[idx - 1];
      d.activeId = next ? next.id : null;
      if (!next) ui.home = true;
    }
    S.scheduleSave();
    scheduleRender();
  }

  function cycleTabs(step) {
    const d = data();
    const open = d.jobs.filter(j => j.open);
    if (!open.length) return;
    const idx = ui.home ? -1 : open.findIndex(j => j.id === d.activeId);
    const next = open[(idx + step + open.length) % open.length];
    openJob(next.id);
  }

  function periodPreset(kind, from, to) {
    const y = new Date().getFullYear();
    if (kind === 'thisYear') return { from: `${y}-01-01`, to: `${y}-12-31` };
    if (kind === 'lastYear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    if (kind === 'custom') return { from: from || '', to: to || '' };
    return { from: '', to: '' };
  }

  function newJobForm() {
    const d = data();
    const used = new Set(d.jobs.filter(j => j.open).map(j => j.color));
    const color = M.TAB_COLORS.find(c => !used.has(c)) || M.TAB_COLORS[d.jobs.length % M.TAB_COLORS.length];
    U.openForm({
      title: t('newJob'),
      submitLabel: t('create'),
      values: { name: '', clientName: '', currency: d.settings.defaultCurrency || 'EGP', color, period: 'thisYear', from: '', to: '' },
      fields: [
        { key: 'name', label: t('jobName'), placeholder: t('jobNamePh'), required: true },
        { key: 'clientName', label: t('clientName'), half: true },
        { key: 'currency', label: t('currency'), type: 'select', half: true, options: I.CURRENCIES.map(c => ({ value: c, label: `${c} — ${I.currencyName(c)}` })) },
        { key: 'period', label: t('jobPeriod'), type: 'radio', options: ['thisYear', 'lastYear', 'all', 'custom'].map(k => ({ value: k, label: t(k === 'all' ? 'periodAll' : 'period' + k[0].toUpperCase() + k.slice(1)) })) },
        { key: 'from', label: t('from'), type: 'date', half: true, show: v => v.period === 'custom' },
        { key: 'to', label: t('to'), type: 'date', half: true, show: v => v.period === 'custom' },
        { key: 'color', label: t('color'), type: 'radio', options: M.TAB_COLORS.map((c, i) => ({ value: c, label: '', swatch: c })) }
      ],
      onSubmit(v) {
        const j = M.newJob({ name: v.name, clientName: v.clientName, currency: v.currency, color: v.color, period: periodPreset(v.period, v.from, v.to) });
        d.jobs.push(j);
        d.activeId = j.id;
        ui.home = false;
        ui.views[j.id] = 'overview';
        S.touch(j);
        scheduleRender();
      }
    });
  }

  function addSample() {
    const d = data();
    const j = M.sampleJob(d.settings.lang);
    d.jobs.push(j);
    openJob(j.id);
  }

  function duplicateJob(id) {
    const src = S.job(id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = M.newId('job');
    copy.name = `${src.name} ${t('copySuffix')}`;
    copy.createdAt = copy.updatedAt = new Date().toISOString();
    copy.open = true;
    data().jobs.splice(data().jobs.indexOf(src) + 1, 0, copy);
    S.touch(copy);
    U.toast(t('duplicated'));
    scheduleRender();
  }

  async function deleteJob(id) {
    const j = S.job(id);
    if (!j) return;
    const ok = await U.confirmDialog(t('confirmDelete', { name: j.name }), { danger: true, okLabel: t('del') });
    if (!ok) return;
    S.snapshot();
    const d = data();
    if (d.activeId === id) closeTab(id);
    d.jobs = d.jobs.filter(x => x.id !== id);
    S.scheduleSave();
    scheduleRender();
    U.toast(t('deleted', { name: j.name }), { action: { label: t('undo'), run: () => { if (S.undo()) { scheduleRender(); U.toast(t('restored')); } } } });
  }

  // Calls into the desktop side; a thrown error becomes { ok: false }.
  async function call(fn) {
    try { return await fn(); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
  }

  async function exportExcel() {
    const j = job();
    if (!j) return;
    const res = await call(() => api.exportXlsx({ job: JSON.parse(JSON.stringify(j)), lang: data().settings.lang, fileName: j.name }));
    if (res && res.ok) U.toast(t('excelDone'));
    else if (res && !res.canceled) U.toast(t('exportFailed', { msg: res.error || '' }), { kind: 'error' });
  }

  function showReport() {
    const j = job();
    if (!j) return false;
    ui.views[j.id] = 'report';
    render();
    return true;
  }

  const nextPaint = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function exportPdf() {
    if (!showReport()) return;
    await document.fonts.ready;
    await nextPaint();
    const j = job();
    const res = await call(() => api.exportPdf({ fileName: `${j.name} — ${t('reportTitle')}` }));
    if (res && res.ok) U.toast(t('pdfDone'));
    else if (res && !res.canceled) U.toast(t('exportFailed', { msg: res.error || '' }), { kind: 'error' });
  }

  async function printReport() {
    if (!showReport()) return;
    await document.fonts.ready;
    await nextPaint();
    window.print();
  }

  async function backup() {
    await S.flush();
    const res = await call(() => api.saveBackup(JSON.stringify(data(), null, 1)));
    if (res && res.ok) U.toast(t('backupDone'));
    else if (res && !res.canceled) U.toast(t('exportFailed', { msg: res.error || '' }), { kind: 'error' });
  }

  async function restore() {
    const res = await call(() => api.openBackup());
    if (res && !res.ok && !res.canceled) U.toast(t('exportFailed', { msg: res.error || '' }), { kind: 'error' });
    if (!res || !res.ok) return;
    let parsed = null;
    try { parsed = M.migrateData(JSON.parse(res.text)); } catch (e) { parsed = null; }
    if (!parsed) { U.toast(t('restoreBad'), { kind: 'error' }); return; }
    if (!(await U.confirmDialog(t('restoreConfirm'), { okLabel: t('restore') }))) return;
    S.replace(parsed);
    ui.home = !parsed.activeId;
    scheduleRender();
    U.toast(t('restoreDone'), { action: { label: t('undo'), run: () => { if (S.undo()) { scheduleRender(); U.toast(t('restored')); } } } });
  }

  function toggleLang() {
    const s = data().settings;
    s.lang = s.lang === 'ar' ? 'en' : 'ar';
    S.scheduleSave();
    render();
  }

  function cycleTheme() {
    const s = data().settings;
    s.theme = s.theme === 'system' ? 'dark' : s.theme === 'dark' ? 'light' : 'system';
    S.scheduleSave();
    render();
  }

  async function appSettings() {
    const s = data().settings;
    const where = await api.dataPath();
    const radio = (key, opts) => `<div class="radio-row">${opts.map(([v, label, langAttr]) =>
      `<label class="radio"><input type="radio" name="app-${key}" data-app-bind="${key}" value="${v}"${s[key] === v ? ' checked' : ''}><span${langAttr ? ` lang="${langAttr}"` : ''}>${esc(label)}</span></label>`).join('')}</div>`;
    const body = `<div class="settings-list">
      <div class="setting"><span class="label">${esc(t('language'))}</span>${radio('lang', [['ar', 'العربية', 'ar'], ['en', 'English', 'en']])}</div>
      <div class="setting"><span class="label">${esc(t('theme'))}</span>${radio('theme', [['system', t('themeSystem')], ['light', t('themeLight')], ['dark', t('themeDark')]])}</div>
      <div class="setting"><span class="label">${esc(t('digits'))}</span>${radio('digits', [['latn', t('digitsLatn')], ['arab', t('digitsArab')]])}</div>
      <label class="setting"><span class="label">${esc(t('defaultCurrency'))}</span>
        <select data-app-bind="defaultCurrency">${I.CURRENCIES.map(c => `<option value="${c}"${s.defaultCurrency === c ? ' selected' : ''}>${c} — ${esc(I.currencyName(c))}</option>`).join('')}</select></label>
      <div class="setting"><span class="label">${esc(t('dataFile'))}</span><code class="path" dir="ltr">${esc(where)}</code>
        ${api.isDesktop ? `<button type="button" class="btn btn-sm" data-app-act="folder">${esc(t('openDataFolder'))}</button>` : `<small class="help">${esc(t('browserMode'))}</small>`}</div>
    </div>`;
    const foot = `<button type="button" class="btn" data-app-act="backup">${U.icon('download')}<span>${esc(t('backup'))}</span></button>
      <button type="button" class="btn" data-app-act="restore">${U.icon('upload')}<span>${esc(t('restore'))}</span></button>
      <span class="grow"></span><button type="button" class="btn btn-primary" data-close>${esc(t('close'))}</button>`;
    const d = U.dialog({ title: t('appSettings'), body, foot });
    d.el.addEventListener('change', e => {
      const el = e.target;
      if (!el.dataset.appBind) return;
      const langChanged = el.dataset.appBind === 'lang' && s.lang !== el.value;
      s[el.dataset.appBind] = el.value;
      S.scheduleSave();
      render();
      if (langChanged) { d.close(); appSettings(); }
    });
    d.el.addEventListener('click', e => {
      const b = e.target.closest('[data-app-act]');
      if (!b) return;
      const act = b.dataset.appAct;
      if (act === 'folder') api.showDataFolder();
      if (act === 'backup') backup();
      if (act === 'restore') { d.close(); restore(); }
    });
  }

  const commands = {
    newJob: newJobForm,
    allJobs: () => { ui.home = true; scheduleRender(); },
    closeTab: () => { const j = job(); if (j) closeTab(j.id); },
    nextTab: () => cycleTabs(1),
    prevTab: () => cycleTabs(-1),
    exportExcel, exportPdf, print: printReport, backup, restore, toggleLang, cycleTheme, appSettings,
    sample: addSample
  };

  // ---------------------------------------------------------------- actions

  const actions = {
    home: () => { ui.home = true; scheduleRender(); },
    openTab: el => { if (ui.renaming) return; openJob(el.dataset.job); },
    closeTab: (el, e) => { e.stopPropagation(); closeTab(el.dataset.job); },
    newJob: newJobForm,
    nav: el => { const j = job(); if (!j) return; ui.views[j.id] = el.dataset.view; resetScroll(); scheduleRender(); },
    toggleLang, cycleTheme, appSettings, exportExcel, exportPdf, print: printReport,
    openJob: el => openJob(el.dataset.job),
    duplicateJob: el => duplicateJob(el.dataset.job),
    deleteJob: el => deleteJob(el.dataset.job),
    sample: addSample
  };

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const name = el.dataset.act;
    const j = job();
    const view = V.get(j ? currentView(j) : 'home');
    const ctx = makeCtx(j, j ? C.compute(j) : null);
    if (view.actions && view.actions[name]) { e.preventDefault(); view.actions[name](ctx, el, e); return; }
    if (V.shared[name]) { e.preventDefault(); V.shared[name](ctx, el, e); return; }
    if (actions[name]) { actions[name](el, e); }
  }

  function onInput(e) {
    const el = e.target;
    if (el.closest('#dialogs')) return;
    if (el.dataset.bind) {
      const j = job();
      if (!j) return;
      const v = readBound(el);
      if (v === undefined) { el.setAttribute('aria-invalid', 'true'); return; }
      el.removeAttribute('aria-invalid');
      setPath(j, el.dataset.bind, v);
      S.touch(j);
      if (el.dataset.live != null) {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(scheduleRender, 180);
      }
    } else if (el.dataset.ui) {
      setPath(ui, el.dataset.ui, el.type === 'checkbox' ? el.checked : el.value);
      clearTimeout(liveTimer);
      liveTimer = setTimeout(scheduleRender, 150);
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.closest('#dialogs')) return;
    if (el.dataset.bind || el.dataset.ui) {
      if (el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'radio' || el.type === 'date') onInput(e);
      scheduleRender();
    }
  }

  function commitRename(input, keep) {
    const j = S.job(input.dataset.rename);
    ui.renaming = null;
    if (j && keep) {
      const name = input.value.trim();
      if (name && name !== j.name) { j.name = name; S.touch(j); }
    }
    scheduleRender();
  }

  // ------------------------------------------------------------ drag & drop

  let dragId = null;
  function onDragStart(e) {
    const tab = e.target.closest('.tab[data-job]');
    if (!tab) return;
    dragId = tab.dataset.job;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    tab.classList.add('dragging');
  }
  function dropSide(tab, e) {
    const r = tab.getBoundingClientRect();
    const before = e.clientX < r.left + r.width / 2;
    return I.dir() === 'rtl' ? !before : before;
  }
  function onDragOver(e) {
    const tab = e.target.closest('.tab[data-job]');
    if (!dragId || !tab) return;
    e.preventDefault();
    document.querySelectorAll('.tab.drop-before, .tab.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    if (tab.dataset.job !== dragId) tab.classList.add(dropSide(tab, e) ? 'drop-before' : 'drop-after');
  }
  function onDrop(e) {
    const tab = e.target.closest('.tab[data-job]');
    if (!dragId || !tab) return;
    e.preventDefault();
    const jobs = data().jobs;
    const from = jobs.findIndex(j => j.id === dragId);
    const moved = jobs.splice(from, 1)[0];
    let to = jobs.findIndex(j => j.id === tab.dataset.job);
    if (!dropSide(tab, e)) to += 1;
    jobs.splice(to, 0, moved);
    dragId = null;
    S.scheduleSave();
    scheduleRender();
  }
  function onDragEnd() {
    dragId = null;
    document.querySelectorAll('.tab.dragging, .tab.drop-before, .tab.drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after'));
  }

  // ----------------------------------------------------------------- start

  async function start() {
    const info = await S.init();
    const d = data();
    if (!d.jobs.some(j => j.open) || !d.activeId) ui.home = !d.jobs.some(j => j.id === d.activeId && j.open);
    render();
    if (info && info.recoveredFrom) U.toast(t('restoreDone') + ' — ' + info.recoveredFrom, { duration: 8000 });
    if (!api.isDesktop) U.toast(t('browserMode'), { duration: 6000 });

    const root = document.getElementById('app');
    root.addEventListener('click', onClick);
    root.addEventListener('auxclick', e => {
      const tab = e.target.closest('.tab[data-job]');
      if (tab && e.button === 1) { e.preventDefault(); closeTab(tab.dataset.job); }
    });
    root.addEventListener('dblclick', e => {
      const tab = e.target.closest('.tab[data-job]');
      if (tab && !e.target.closest('.tab-close')) { ui.renaming = tab.dataset.job; render(); }
    });
    root.addEventListener('keydown', e => {
      if (e.target.classList.contains('tab-rename')) {
        if (e.key === 'Enter') { e.preventDefault(); commitRename(e.target, true); }
        if (e.key === 'Escape') { e.preventDefault(); commitRename(e.target, false); }
        return;
      }
      const tab = e.target.closest('.tab[data-job]');
      if (tab && e.target === tab && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openJob(tab.dataset.job); }
      if (tab && e.target === tab && e.key === 'F2') { ui.renaming = tab.dataset.job; render(); }
      if (e.key === 'Enter' && e.target.matches('input[data-bind]')) { e.target.blur(); e.target.focus(); }
    });
    root.addEventListener('focusout', e => {
      // Re-rendering replaces the input (and blurs it); only a real focus move ends the rename.
      if (rendering || !e.target.isConnected) return;
      if (e.target.classList && e.target.classList.contains('tab-rename') && ui.renaming) commitRename(e.target, true);
    });
    root.addEventListener('wheel', e => {
      const strip = e.target.closest('.tabs-scroll');
      if (strip && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += (I.dir() === 'rtl' ? -1 : 1) * e.deltaY; e.preventDefault(); }
    }, { passive: false });
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragend', onDragEnd);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    document.addEventListener('pointerup', () => {
      pointerDown = false;
      if (pendingRender) { pendingRender = false; setTimeout(scheduleRender, 0); }
    }, true);
    S.on(what => { if (what === 'status') updateSaveState(); });

    api.onMenu(cmd => { if (commands[cmd]) commands[cmd](); });
    api.onBeforeClose(async () => { await S.flush(); api.closeReady(); });
    window.addEventListener('beforeunload', () => { S.flush(); });

    if (!api.isDesktop) {
      document.addEventListener('keydown', e => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || U.dialogsOpen) return;
        const k = e.key.toLowerCase();
        if (k === 'n' && e.altKey) { e.preventDefault(); newJobForm(); }
        if (k === 'e') { e.preventDefault(); exportExcel(); }
        if (k === 'p') { e.preventDefault(); printReport(); }
      });
    }
  }

  window.HLApp = { start, render: scheduleRender, commands, ui };
  document.addEventListener('DOMContentLoaded', start);
})();
