// App preferences the user sets once, kept in the app's own home (data/settings.json) so they survive app updates.
import fs from 'node:fs/promises';
import path from 'node:path';
import {dataDir} from './paths.mjs';

const file=path.join(dataDir,'settings.json');
// Following the latest commit builds SimC from source (Windows otherwise takes the official nightly, a day behind at most).
// SimC is never installed by itself, so there is no setting for that: the app only says when a newer build is out.
export const defaults={followLatestCommit:false};

export async function loadSettings(){
  // Settings that no longer exist (autoUpdateSimc before 1.30.0) are dropped.
  try{const saved=JSON.parse(await fs.readFile(file,'utf8'));return {...defaults,...Object.fromEntries(Object.entries(saved).filter(([key])=>key in defaults))};}catch{return {...defaults};}
}
export async function saveSettings(changes){
  const current=await loadSettings(),next={...current};
  for(const [key,value] of Object.entries(changes||{})){
    if(!(key in defaults))throw new Error(`Unknown setting ${key}.`);
    if(typeof value!==typeof defaults[key])throw new Error(`Invalid value for ${key}.`);
    next[key]=value;
  }
  await fs.mkdir(dataDir,{recursive:true});
  await fs.writeFile(file+'.tmp',JSON.stringify(next,null,2));await fs.rename(file+'.tmp',file);
  return next;
}
