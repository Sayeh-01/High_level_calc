'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only bridge between the page and the computer. Everything is a narrow,
// named call; the page never gets Node or the file system.
contextBridge.exposeInMainWorld('hlc', {
  isDesktop: true,
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: text => ipcRenderer.invoke('data:save', text),
  dataPath: () => ipcRenderer.invoke('data:path'),
  showDataFolder: () => ipcRenderer.invoke('data:showFolder'),
  exportXlsx: payload => ipcRenderer.invoke('export:xlsx', payload),
  exportPdf: payload => ipcRenderer.invoke('export:pdf', payload),
  saveBackup: text => ipcRenderer.invoke('backup:save', text),
  openBackup: () => ipcRenderer.invoke('backup:open'),
  setLanguage: lang => ipcRenderer.send('app:set-lang', lang),
  onMenu: handler => ipcRenderer.on('menu', (e, command) => handler(command)),
  onBeforeClose: handler => ipcRenderer.on('app:before-close', () => handler()),
  closeReady: () => ipcRenderer.send('app:close-ready')
});
