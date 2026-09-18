const {contextBridge,ipcRenderer}=require('electron');
// The page only gets these three app-update calls; it has no other access to Electron or Node.
contextBridge.exposeInMainWorld('simcDesktop',{
  checkForUpdates:()=>ipcRenderer.invoke('app-update:check'),
  installUpdate:()=>ipcRenderer.invoke('app-update:install'),
  onUpdateStatus:callback=>ipcRenderer.on('app-update',(_,status)=>callback(status))
});
