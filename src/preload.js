const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onPrompt: (cb) => ipcRenderer.on('prompt', (_e, prompt) => cb(prompt)),
  ready: () => ipcRenderer.send('ready'),
  select: (id) => ipcRenderer.send('select', id),
  addAccount: () => ipcRenderer.send('add-prompt'),
  accountMenu: (id) => ipcRenderer.send('account-menu', id),
  promptDone: (result) => ipcRenderer.send('prompt-done', result),
});
