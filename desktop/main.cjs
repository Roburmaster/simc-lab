// SimC Lab desktop shell: starts the local server with Electron's own Node, shows it in a window and keeps the
// app itself up to date. The engine, game data and runs live in %LOCALAPPDATA%\SimC Lab, outside the install.
const {app,BrowserWindow,shell,ipcMain,dialog,Menu}=require('electron');
const {autoUpdater}=require('electron-updater');
const path=require('node:path');
const fs=require('node:fs');
const net=require('node:net');
const {spawn,execFile}=require('node:child_process');

const home=path.join(process.env.LOCALAPPDATA||app.getPath('userData'),'SimC Lab');
const serverDir=app.isPackaged?path.join(process.resourcesPath,'server'):path.resolve(__dirname,'..');
let server=null,port=0,win=null,quitting=false;

if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});

function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});}

async function startServer(){
  fs.mkdirSync(path.join(home,'logs'),{recursive:true});
  port=await freePort();
  const log=fs.openSync(path.join(home,'logs','server.log'),'a');
  server=spawn(process.execPath,[path.join(serverDir,'server.mjs')],{cwd:serverDir,windowsHide:true,stdio:['ignore',log,log],
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PORT:String(port),SIMC_LAB_HOME:home,SIMC_LAB_DESKTOP:'1'}});
  server.on('exit',code=>{server=null;if(!quitting){dialog.showErrorBox('SimC Lab stopped',`The local server stopped (code ${code}). See ${path.join(home,'logs','server.log')}.`);app.quit();}});
  for(let i=0;i<150;i++){
    try{const res=await fetch(`http://127.0.0.1:${port}/api/status`);if(res.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  throw new Error('The local server did not start.');
}

// SimC runs as a child of the server; killing the whole tree stops a simulation that is still running.
function stopServer(){
  if(!server)return Promise.resolve();
  const pid=server.pid;quitting=true;
  return new Promise(resolve=>execFile('taskkill',['/pid',String(pid),'/T','/F'],{windowsHide:true},()=>resolve()));
}

function createWindow(){
  win=new BrowserWindow({width:1480,height:960,minWidth:900,minHeight:600,backgroundColor:'#10131b',title:'SimC Lab',show:false,autoHideMenuBar:true,
    icon:path.join(__dirname,'build','icon.png'),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true}});
  const local=url=>url.startsWith(`http://127.0.0.1:${port}/`);
  // Wowhead, GitHub and other links open in the normal browser.
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!local(url)){event.preventDefault();if(/^https?:/.test(url))shell.openExternal(url);}});
  win.once('ready-to-show',()=>win.show());
  win.loadURL(`http://127.0.0.1:${port}/`);
}

function sendUpdate(state,message){win?.webContents.send('app-update',{state,message});}
function setupUpdates(){
  if(!app.isPackaged){ipcMain.handle('app-update:check',()=>sendUpdate('disabled','App updates are available in the installed version.'));ipcMain.handle('app-update:install',()=>{});return;}
  autoUpdater.autoDownload=true;
  autoUpdater.on('checking-for-update',()=>sendUpdate('checking','Checking for a new SimC Lab version …'));
  autoUpdater.on('update-not-available',()=>sendUpdate('none',`SimC Lab ${app.getVersion()} is the newest version.`));
  autoUpdater.on('update-available',info=>sendUpdate('available',`Downloading SimC Lab ${info.version} …`));
  autoUpdater.on('download-progress',p=>sendUpdate('downloading',`Downloading update: ${Math.round(p.percent)}%`));
  autoUpdater.on('update-downloaded',info=>sendUpdate('downloaded',`SimC Lab ${info.version} is ready. Restart to update.`));
  autoUpdater.on('error',e=>sendUpdate('error',`Update check failed: ${e.message}`));
  ipcMain.handle('app-update:check',()=>autoUpdater.checkForUpdates().catch(()=>{}));
  ipcMain.handle('app-update:install',async()=>{await stopServer();autoUpdater.quitAndInstall();});
  const check=()=>autoUpdater.checkForUpdates().catch(()=>{});
  setTimeout(check,15000);setInterval(check,6*3600*1000);
}

app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
  try{await startServer();}catch(e){dialog.showErrorBox('SimC Lab could not start',`${e.message}\n\nLog: ${path.join(home,'logs','server.log')}`);app.quit();return;}
  setupUpdates();
  createWindow();
});
app.on('before-quit',event=>{if(server&&!quitting){event.preventDefault();stopServer().then(()=>app.quit());}});
app.on('window-all-closed',()=>app.quit());
