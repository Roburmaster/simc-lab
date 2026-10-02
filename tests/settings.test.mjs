import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('app settings: the nightly is followed by default, a choice is kept, and the old auto-update setting is gone',async()=>{
  process.env.SIMC_LAB_HOME=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-settings-'));
  const {loadSettings,saveSettings}=await import('../lib/settings.mjs?home='+Date.now());
  assert.deepEqual(await loadSettings(),{followLatestCommit:false},'follow the nightly unless chosen');
  assert.equal((await saveSettings({followLatestCommit:true})).followLatestCommit,true);
  // A settings file from before 1.30.0 still says autoUpdateSimc; it no longer means anything.
  await fs.writeFile(path.join(process.env.SIMC_LAB_HOME,'data','settings.json'),JSON.stringify({autoUpdateSimc:true,followLatestCommit:true}));
  assert.deepEqual(await loadSettings(),{followLatestCommit:true});
  assert.deepEqual(await saveSettings({followLatestCommit:false}),{followLatestCommit:false});
  await assert.rejects(saveSettings({autoUpdateSimc:false}),/Unknown setting/);
  await assert.rejects(saveSettings({followLatestCommit:'yes'}),/Invalid value/);
});
