const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
    onData: (callback) => ipcRenderer.on('data', (_event, chunk) => callback(chunk)),
    flood: (command) => ipcRenderer.send('flood', command),
    pause: () => ipcRenderer.send('pause'),
    resume: () => ipcRenderer.send('resume'),
    stop: () => ipcRenderer.send('stop'),
    type: (text) => ipcRenderer.send('type', text),
    report: (report) => ipcRenderer.send('report', report),
});
