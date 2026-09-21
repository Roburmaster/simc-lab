import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('CI and releases package the app without installing SimC',async()=>{
  for(const name of ['ci','release']){
    const workflow=await fs.readFile(new URL('../.github/workflows/'+name+'.yml',import.meta.url),'utf8');
    assert.match(workflow,/run: npm run test:ci/);
    assert.doesNotMatch(workflow,/install-engine|build-engine|build:engine|cmake|winget/);
  }
});

// The app, the desktop shell and the WoW addon carry one version, so a release is one number everywhere and
// an installed addon is updated whenever the app is.
test('app, desktop shell, lockfile and addon all carry the same version',async()=>{
  const read=async name=>JSON.parse(await fs.readFile(new URL('../'+name,import.meta.url),'utf8'));
  const {version}=await read('package.json');
  assert.match(version,/^\d+\.\d+\.\d+$/);
  assert.equal((await read('desktop/package.json')).version,version,'desktop/package.json');
  assert.equal((await read('package-lock.json')).version,version,'package-lock.json');
  const toc=await fs.readFile(new URL('../addon/SimCLab/SimCLab.toc',import.meta.url),'utf8');
  assert.equal(toc.match(/^## Version: (.+?)\s*$/m)?.[1],version,'addon/SimCLab/SimCLab.toc');
});

test('engine installation refuses GitHub Actions before downloading or building',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/install-engine.mjs',import.meta.url))],{
    encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true'}
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/SimC installation runs locally/);
});
