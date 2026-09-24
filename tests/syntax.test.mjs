// The browser loads public/ as it is, with no build step to catch a slip. 1.10.2 shipped a Weapon Lab script
// that did not parse (an apostrophe inside a single-quoted string), and the whole mode failed to load. Every
// script the app serves, and every module the server runs, has to parse.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const scripts=async dir=>(await fs.readdir(path.join(root,dir))).filter(f=>/\.(m?js)$/.test(f)).map(f=>path.join(root,dir,f));

test('every browser script and server module parses',async()=>{
  const files=[...await scripts('public'),...await scripts('lib'),path.join(root,'server.mjs')];
  assert.ok(files.length>10);
  for(const file of files){
    // Browser scripts are ES modules; --check reads a .js file as CommonJS, so it is fed as a module on stdin.
    const result=spawnSync(process.execPath,['--input-type=module','--check'],{input:await fs.readFile(file,'utf8'),encoding:'utf8'});
    assert.equal(result.status,0,`${path.relative(root,file)} does not parse:\n${result.stderr}`);
  }
});
