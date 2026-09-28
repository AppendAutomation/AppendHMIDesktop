// The launcher page's only way to reach the main process: a fixed set of
// requests, each checked again in main (src/main/main.js).

const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('launcher', {
	state: () => ipcRenderer.invoke('launcher:state'),
	browse: () => ipcRenderer.invoke('launcher:browse'),
	info: (file) => ipcRenderer.invoke('launcher:info', file),
	run: (file) => ipcRenderer.invoke('launcher:run', file),
	shortcut: (file, place) => ipcRenderer.invoke('launcher:shortcut', file, place),
	startup: (file, on) => ipcRenderer.invoke('launcher:startup', file, on),
	forget: (file) => ipcRenderer.invoke('launcher:forget', file),
	show: (file) => ipcRenderer.invoke('launcher:show', file)
});
