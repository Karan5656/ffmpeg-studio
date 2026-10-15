const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Electron wraps errors thrown in ipcMain.handle as "Error invoking remote method 'x': Error: msg".
const call = (channel, ...args) =>
  ipcRenderer.invoke(channel, ...args).catch((err) => {
    throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  });

contextBridge.exposeInMainWorld('studio', {
  formats: () => call('formats'),
  pickFile: () => call('pick-file'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  probe: (file) => call('probe', file),
  defaultOutput: (input, format) => call('default-output', input, format),
  pickOutput: (suggested, format) => call('pick-output', suggested, format),
  convert: (opts) => call('convert', opts),
  cancel: () => call('cancel'),
  reveal: (file) => call('reveal', file),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, p) => fn(p)),
});
