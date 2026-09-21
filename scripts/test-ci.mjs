// Standalone app and addon tests need no installed engine. npm test keeps full local coverage.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const localDataTests=new Set(['profile.test.mjs','talents.test.mjs']);
const files=(await fs.readdir(path.join(root,'tests')))
  .filter(name=>name.endsWith('.test.mjs')&&!localDataTests.has(name)).sort();
const home=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-ci-'));
try{
  console.log('Local engine/data tests remain in npm test: '+[...localDataTests].join(', '));
  const result=spawnSync(process.execPath,['--test',...files.map(name=>path.join(root,'tests',name))],{
    cwd:root,stdio:'inherit',env:{...process.env,SIMC_LAB_HOME:home}
  });
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}finally{
  await fs.rm(home,{recursive:true,force:true});
}
