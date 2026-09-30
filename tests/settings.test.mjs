import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('app settings: automatic SimC updates are on by default, and a choice is kept',async()=>{
  process.env.SIMC_LAB_HOME=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-settings-'));
  const {loadSettings,saveSettings}=await import('../lib/settings.mjs?home='+Date.now());
  assert.deepEqual(await loadSettings(),{autoUpdateSimc:true});
  assert.deepEqual(await saveSettings({autoUpdateSimc:false}),{autoUpdateSimc:false});
  assert.deepEqual(await loadSettings(),{autoUpdateSimc:false});
  await assert.rejects(saveSettings({autoUpdateSimc:'yes'}),/Invalid value/);
  await assert.rejects(saveSettings({other:true}),/Unknown setting/);
});
