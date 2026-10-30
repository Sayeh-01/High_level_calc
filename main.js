'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { writeWorkbook } = require('./lib/xlsx-export');

const DATA_NAME = 'high-level-calc-data.json';
const KEEP_DAILY_BACKUPS = 14;
const WINDOW_BG = '#eef2ec';

// HLC_DATA_DIR lets the app keep its data somewhere else (a USB stick, a
// shared folder, or a scratch folder for tests).
if (process.env.HLC_DATA_DIR) app.setPath('userData', path.resolve(process.env.HLC_DATA_DIR));

let win = null;
let menuLang = 'ar';
let readyToClose = false;

const dataFile = () => path.join(app.getPath('userData'), DATA_NAME);
const backupDir = () => path.join(app.getPath('userData'), 'backups');

// ---------------------------------------------------------------- storage

async function readJson(file) {
  const text = await fsp.readFile(file, 'utf8');
  JSON.parse(text); // validate before handing it over
  return text;
}

async function loadData() {
  try {
    return { ok: true, text: await readJson(dataFile()), path: dataFile() };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, text: null, path: dataFile() };
    // Corrupt main file: fall back to the newest daily backup.
    try {
      const files = (await fsp.readdir(backupDir())).filter(f => f.endsWith('.json')).sort().reverse();
      for (const f of files) {
        try { return { ok: true, text: await readJson(path.join(backupDir(), f)), path: dataFile(), recoveredFrom: f }; } catch (e) { /* try older */ }
      }
    } catch (e) { /* no backups */ }
    return { ok: false, error: String(err.message || err), path: dataFile() };
  }
}

async function dailyBackup() {
  const today = new Date().toISOString().slice(0, 10);
  const target = path.join(backupDir(), `data-${today}.json`);
  try {
    await fsp.access(target);
    return; // already backed up today
  } catch (e) { /* not yet */ }
  try {
    await fsp.mkdir(backupDir(), { recursive: true });
    await fsp.copyFile(dataFile(), target);
    const files = (await fsp.readdir(backupDir())).filter(f => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const old of files.slice(0, Math.max(0, files.length - KEEP_DAILY_BACKUPS))) await fsp.unlink(path.join(backupDir(), old));
  } catch (e) { /* first run: nothing to back up yet */ }
}

let writing = Promise.resolve();
function saveData(text) {
  // Serialize writes and replace the file atomically so a crash mid-write
  // never leaves half a file behind.
  writing = writing.then(async () => {
    JSON.parse(text);
    await fsp.mkdir(path.dirname(dataFile()), { recursive: true });
    await dailyBackup();
    const tmp = dataFile() + '.tmp';
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, dataFile());
  });
  return writing.then(() => ({ ok: true }), err => ({ ok: false, error: String(err.message || err) }));
}

// ------------------------------------------------------------------- menu

const MENU_TEXT = {
  en: {
    file: 'File', newJob: 'New client / job', allJobs: 'All clients & jobs', closeTab: 'Close tab', nextTab: 'Next tab', prevTab: 'Previous tab',
    exportExcel: 'Export to Excel…', exportPdf: 'Save report as PDF…', print: 'Print report…', backup: 'Back up all data…', restore: 'Restore from backup…',
    dataFolder: 'Show data folder', quit: 'Quit', edit: 'Edit', view: 'View', help: 'Help', about: 'About High Level Calc', language: 'العربية',
    aboutText: 'Bilingual accounting for clients and jobs.'
  },
  ar: {
    file: 'ملف', newJob: 'عميل / عملية جديدة', allJobs: 'كل العملاء والعمليات', closeTab: 'إغلاق التبويب', nextTab: 'التبويب التالي', prevTab: 'التبويب السابق',
    exportExcel: 'تصدير إلى Excel…', exportPdf: 'حفظ التقرير PDF…', print: 'طباعة التقرير…', backup: 'نسخ احتياطي لكل البيانات…', restore: 'استعادة من نسخة احتياطية…',
    dataFolder: 'فتح مجلد البيانات', quit: 'خروج', edit: 'تحرير', view: 'عرض', help: 'مساعدة', about: 'عن High Level Calc', language: 'English',
    aboutText: 'محاسبة ثنائية اللغة للعملاء والعمليات.'
  }
};

function send(command) {
  if (win && !win.isDestroyed()) win.webContents.send('menu', command);
}

function buildMenu() {
  const m = MENU_TEXT[menuLang] || MENU_TEXT.en;
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: m.file,
      submenu: [
        { label: m.newJob, accelerator: 'CmdOrCtrl+N', click: () => send('newJob') },
        { label: m.allJobs, accelerator: 'CmdOrCtrl+Shift+H', click: () => send('allJobs') },
        { label: m.closeTab, accelerator: 'CmdOrCtrl+W', click: () => send('closeTab') },
        { label: m.nextTab, accelerator: 'Ctrl+Tab', click: () => send('nextTab') },
        { label: m.prevTab, accelerator: 'Ctrl+Shift+Tab', click: () => send('prevTab') },
        { type: 'separator' },
        { label: m.exportExcel, accelerator: 'CmdOrCtrl+E', click: () => send('exportExcel') },
        { label: m.exportPdf, accelerator: 'CmdOrCtrl+Shift+P', click: () => send('exportPdf') },
        { label: m.print, accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: m.backup, click: () => send('backup') },
        { label: m.restore, click: () => send('restore') },
        { label: m.dataFolder, click: () => shell.showItemInFolder(dataFile()) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: m.quit, role: 'quit' }
      ]
    },
    { label: m.edit, submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: m.view,
      submenu: [
        { label: m.language, click: () => send('toggleLang') },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }, { role: 'toggleDevTools' }
      ]
    },
    {
      label: m.help,
      submenu: [{
        label: m.about,
        click: () => dialog.showMessageBox(win, { type: 'info', title: m.about, message: `High Level Calc ${app.getVersion()}`, detail: m.aboutText })
      }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ----------------------------------------------------------------- window

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    title: 'High Level Calc',
    backgroundColor: WINDOW_BG,
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', e => {
    if (readyToClose) return;
    // Let the page flush its last change to disk first.
    e.preventDefault();
    win.webContents.send('app:before-close');
    setTimeout(() => { readyToClose = true; if (win && !win.isDestroyed()) win.close(); }, 2000);
  });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

function safeFileName(name, fallback) {
  const clean = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean || fallback;
}

// -------------------------------------------------------------------- IPC

// Any failure (dialog, disk, export) comes back to the page as
// { ok: false, error } so it can say what went wrong.
const safe = fn => async (...args) => {
  try { return await fn(...args); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
};

ipcMain.handle('data:load', () => loadData());
ipcMain.handle('data:save', (e, text) => saveData(String(text)));
ipcMain.handle('data:path', () => dataFile());
ipcMain.handle('data:showFolder', () => { shell.showItemInFolder(dataFile()); return true; });
ipcMain.on('app:close-ready', () => {
  readyToClose = true;
  if (win && !win.isDestroyed()) win.close();
});
ipcMain.on('app:set-lang', (e, lang) => {
  menuLang = lang === 'en' ? 'en' : 'ar';
  buildMenu();
});

ipcMain.handle('export:xlsx', safe(async (e, payload) => {
  const { job, lang, fileName } = payload || {};
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), safeFileName(fileName, 'High Level Calc') + '.xlsx'),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    await writeWorkbook(job, res.filePath, { lang });
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}));

ipcMain.handle('export:pdf', safe(async (e, payload) => {
  const { fileName, landscape } = payload || {};
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), safeFileName(fileName, 'High Level Calc') + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    // The window's own background colour would otherwise show in the page margins.
    win.setBackgroundColor('#ffffff');
    let pdf;
    try {
      pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, landscape: !!landscape, margins: { top: 0.5, bottom: 0.5, left: 0.45, right: 0.45 } });
    } finally {
      win.setBackgroundColor(WINDOW_BG);
    }
    await fsp.writeFile(res.filePath, pdf);
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}));

ipcMain.handle('backup:save', safe(async (e, text) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), `High Level Calc backup ${stamp}.json`),
    filters: [{ name: 'High Level Calc backup', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    await fsp.writeFile(res.filePath, String(text), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}));

ipcMain.handle('backup:open', safe(async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'High Level Calc backup', extensions: ['json'] }] });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try {
    return { ok: true, text: await fsp.readFile(res.filePaths[0], 'utf8') };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}));

// -------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) { readyToClose = false; createWindow(); } });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
