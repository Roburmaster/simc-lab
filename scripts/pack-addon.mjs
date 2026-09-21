// Packs the WoW addon for its own release channel: node scripts/pack-addon.mjs [output folder]
//
// addon.json is what the app downloads. It carries the addon's version, the data schema it understands, and
// every file with its SHA-256 and its text, so the app needs nothing but one HTTPS request and no unpacking.
// SimCLab-addon.zip is published beside it for anyone who wants to drop the folder in by hand.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {schemaVersion} from '../lib/wowdata.mjs';
import {addonName,readToc,shippedDir} from '../lib/wowaddon.mjs';

export const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');

export async function buildManifest(dir=shippedDir){
  const toc=await readToc(dir);
  if(!toc?.version)throw new Error('The addon TOC has no version.');
  const files=[];
  const walk=async(folder,prefix='')=>{
    for(const entry of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const rel=path.join(prefix,entry.name);
      if(entry.isDirectory())await walk(path.join(folder,entry.name),rel);
      // Data.lua is written by the app for each player; the shipped stub is not worth sending.
      else if(entry.isFile()&&rel!=='Data.lua')files.push({path:rel.replaceAll('\\','/'),text:await fs.readFile(path.join(folder,entry.name),'utf8')});
    }
  };
  await walk(dir);
  if(!files.some(f=>f.path===`${addonName}.toc`))throw new Error('The addon folder has no TOC.');
  return {
    addon:addonName,
    version:toc.version,
    // The app installs an addon only when it speaks the same Data.lua schema.
    schemaVersion,
    generated:new Date().toISOString(),
    files:files.map(f=>({path:f.path,bytes:Buffer.byteLength(f.text,'utf8'),sha256:sha256(f.text),text:f.text})),
  };
}

async function main(){
  const out=path.resolve(process.argv[2]||'dist/addon');
  await fs.mkdir(out,{recursive:true});
  const manifest=await buildManifest();
  await fs.writeFile(path.join(out,'addon.json'),JSON.stringify(manifest,null,1));
  // The zip is a convenience for manual installs, so a missing archiver is not fatal.
  try{
    const zip=path.join(out,`${addonName}-addon.zip`);
    await fs.rm(zip,{force:true});
    await promisify(execFile)('powershell',['-NoProfile','-Command',`Compress-Archive -Path '${shippedDir}' -DestinationPath '${zip}'`],{windowsHide:true});
  }catch(e){console.warn('No zip was written:',e.message);}
  console.log(`SimCLab ${manifest.version} (schema ${manifest.schemaVersion}), ${manifest.files.length} files -> ${out}`);
}

if(process.argv[1]&&import.meta.url.endsWith(path.basename(process.argv[1])))await main();
