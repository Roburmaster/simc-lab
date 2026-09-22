import fs from 'node:fs/promises';
import path from 'node:path';

// Program files may be read-only once installed. Everything the app writes (engine, game data, runs) lives
// under SIMC_LAB_HOME; without it the project folder doubles as home, as in development.
export const appRoot=path.resolve(import.meta.dirname,'..');
export const home=path.resolve(process.env.SIMC_LAB_HOME||appRoot);
export const dataDir=path.join(home,'data');
export const upstreamDir=path.join(dataDir,'upstream');
export const engineFile=path.join(dataDir,'engine.json');
export const runsDir=path.join(home,'runs');
export const enginesDir=path.join(home,'engine');

export async function readEngineMetadata(){
  try{return JSON.parse((await fs.readFile(engineFile,'utf8')).replace(/^﻿/,''));}catch{return {};}
}

// An installed engine is a folder holding simc.exe plus the part of the SimC source tree the app reads
// (generated item, bonus, enchant and talent data, build_info.txt and profiles). Older metadata without a
// folder refers to the original source checkout and CMake build in the project.
export function enginePaths(metadata){
  if(metadata?.dir){const dir=path.resolve(home,metadata.dir);return {executable:path.join(dir,'simc.exe'),source:dir};}
  return {executable:path.join(home,'build/Release/simc.exe'),source:path.join(home,'vendor/simc')};
}

// Reference profiles live in one folder per season (MID1, MID2, ...); the highest number is the current one.
export async function seasonProfileDirs(source){
  const entries=await fs.readdir(path.join(source,'profiles'),{withFileTypes:true});
  const seasons=entries.filter(e=>e.isDirectory()&&/^[A-Z]{2,}\d+$/.test(e.name)).map(e=>({name:e.name,prefix:e.name.replace(/\d+$/,''),n:Number(e.name.match(/\d+$/)[0]),dir:path.join(source,'profiles',e.name)}));
  if(!seasons.length)throw new Error('The SimC engine has no season profiles.');
  return seasons.sort((a,b)=>b.n-a.n);
}
export async function currentProfileDir(source){
  return (await seasonProfileDirs(source))[0].dir;
}
