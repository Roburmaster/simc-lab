// App preferences the user sets once, kept in the app's own home (data/settings.json) so they survive app updates.
import fs from 'node:fs/promises';
import path from 'node:path';
import {dataDir} from './paths.mjs';

const file=path.join(dataDir,'settings.json');
// Checking for a newer official SimC build at start, and installing it, is on unless the user turns it off.
export const defaults={autoUpdateSimc:true};

export async function loadSettings(){
  try{return {...defaults,...JSON.parse(await fs.readFile(file,'utf8'))};}catch{return {...defaults};}
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
