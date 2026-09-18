// Downloads the live game data for the active engine's WoW build (the app's Update SimC button does the same).
import fs from 'node:fs/promises';
import path from 'node:path';
import {Updater,parseBuildInfo} from '../lib/updater.mjs';
import {upstreamDir,readEngineMetadata,enginePaths} from '../lib/paths.mjs';
const {source}=enginePaths(await readEngineMetadata());
const build=parseBuildInfo(await fs.readFile(path.join(source,'SpellDataDump/build_info.txt'),'utf8'));
if(!build)throw new Error('The active engine is not a live SimC build.');
const live=await(await fetch('https://www.raidbots.com/static/data/live/metadata.json')).json();
const updater=new Updater({busy:()=>false,onInstalled:async()=>{}});
const staged=await updater.downloadData(live,build.wowVersion);
await fs.rm(upstreamDir+'.old',{recursive:true,force:true});
await fs.rename(upstreamDir,upstreamDir+'.old').catch(()=>{});await fs.rename(staged,upstreamDir);await fs.rm(upstreamDir+'.old',{recursive:true,force:true});
console.log(`Cached verified public data for ${live.wowBuild}: ${live.contentHash}`);
