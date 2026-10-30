/* High Level Calc — app state, autosave and undo. */
(function () {
  'use strict';
  const M = window.HLModel;

  // In the desktop app the preload script provides window.hlc. Opening
  // index.html straight in a browser (for a quick look) falls back to
  // localStorage so the page still works.
  const browserApi = {
    isDesktop: false,
    async loadData() {
      try { return { ok: true, text: localStorage.getItem('hlc-data'), path: 'localStorage' }; }
      catch (e) { return { ok: true, text: null, path: 'memory' }; }
    },
    async saveData(text) {
      try { localStorage.setItem('hlc-data', text); return { ok: true }; }
      catch (e) { return { ok: false, error: String(e) }; }
    },
    async dataPath() { return 'localStorage'; },
    async showDataFolder() { return false; },
    async exportXlsx() { return { ok: false, error: 'Excel export needs the desktop app' }; },
    async exportPdf() { window.print(); return { ok: false, canceled: true }; },
    async saveBackup(text) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `High Level Calc backup ${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return { ok: true };
    },
    openBackup() {
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = () => {
          const f = input.files[0];
          if (!f) return resolve({ ok: false, canceled: true });
          f.text().then(text => resolve({ ok: true, text }), err => resolve({ ok: false, error: String(err) }));
        };
        input.click();
      });
    },
    setLanguage() {},
    onMenu() {},
    onBeforeClose() {},
    closeReady() {}
  };

  const api = window.hlc || browserApi;
  let data = null;
  let saveTimer = null;
  let status = 'saved';
  let undoSnapshot = null;
  const listeners = new Set();

  function emit(what) { listeners.forEach(fn => fn(what)); }

  async function init() {
    const res = await api.loadData();
    let parsed = null;
    if (res && res.ok && res.text) {
      try { parsed = M.migrateData(JSON.parse(res.text)); } catch (e) { parsed = null; }
    }
    data = parsed || M.newData();
    return res || {};
  }

  function scheduleSave() {
    status = 'pending';
    emit('status');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }

  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const res = await api.saveData(JSON.stringify(data));
    status = res && res.ok ? 'saved' : 'error';
    emit('status');
    return res;
  }

  function touch(job) {
    if (job) job.updatedAt = new Date().toISOString();
    scheduleSave();
  }

  function snapshot() { undoSnapshot = JSON.stringify(data); }

  function undo() {
    if (!undoSnapshot) return false;
    data = M.migrateData(JSON.parse(undoSnapshot));
    undoSnapshot = null;
    scheduleSave();
    return true;
  }

  function replace(newData) {
    snapshot();
    data = newData;
    scheduleSave();
  }

  window.HLStore = {
    api, init, flush, touch, snapshot, undo, replace, scheduleSave,
    get data() { return data; },
    get status() { return status; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    job(id) { return data.jobs.find(j => j.id === id) || null; }
  };
})();
