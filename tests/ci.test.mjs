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

test('engine installation refuses GitHub Actions before downloading or building',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/install-engine.mjs',import.meta.url))],{
    encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true'}
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/SimC installation runs locally/);
});
