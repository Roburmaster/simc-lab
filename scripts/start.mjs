import {spawn} from 'node:child_process';
const url='http://127.0.0.1:8642';
async function running(){try{const res=await fetch(`${url}/api/status`);const body=await res.json();return !!body.engine;}catch{return false;}}
function open(){spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore',windowsHide:true}).unref();}
if(await running()){open();console.log(`SimC Lab is already running at ${url}`);}
else{
 const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),stdio:'inherit',windowsHide:true});
 server.on('error',e=>{console.error(e.message);process.exitCode=1;});
 server.on('exit',code=>{process.exitCode=code||0;});
 let attempts=0;const timer=setInterval(async()=>{if(await running()){clearInterval(timer);open();}else if(++attempts>30){clearInterval(timer);console.error('The server did not start. See the error above.');}},500);
}
