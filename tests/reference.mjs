// Reference characters from the active engine's current season (MID2_Warrior_Fury.simc and so on), so tests
// follow the installed SimC instead of a fixed season or a local checkout.
import fs from 'node:fs/promises';
import path from 'node:path';
import {readEngineMetadata,enginePaths,currentProfileDir} from '../lib/paths.mjs';

export async function referenceProfile(spec,{stripActions=false}={}){
  const dir=await currentProfileDir(enginePaths(await readEngineMetadata()).source);
  const file=(await fs.readdir(dir)).find(f=>f.endsWith(`_${spec}.simc`)&&/^[A-Z]+\d+_/.test(f));
  if(!file)throw new Error(`No ${spec} reference profile in ${dir}.`);
  const text=await fs.readFile(path.join(dir,file),'utf8');
  return stripActions?text.split('\n').filter(l=>!l.startsWith('actions')).join('\n'):text;
}
