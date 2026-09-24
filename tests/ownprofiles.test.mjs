// The reference profiles we write ourselves. These checks need no engine: they read what is committed in
// profiles/ and hold it to the shape the loader and the app expect.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseProfile,slots} from '../lib/profile.mjs';

const dir=fileURLToPath(new URL('../profiles',import.meta.url));
const files=(await fs.readdir(dir)).filter(f=>f.endsWith('.json')).sort();
const read=async file=>JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));

test('every profile we carry names where it came from and when',async()=>{
  assert.ok(files.length,'profiles/ holds at least one');
  for(const file of files){
    const data=await read(file);
    assert.match(data.key,/^[a-z]+-[a-z_]+$/,`${file}: key`);
    assert.equal(data.key,`${data.class}-${data.spec}`,`${file}: the key names the class and spec`);
    assert.equal(file,`${data.key}.json`,`${file}: named after its key`);
    for(const field of ['label','race','role','position','talents'])assert.ok(data[field],`${file}: ${field}`);
    assert.ok(data.source?.name&&data.source.gear&&data.source.talents,`${file}: the source is named with its pages`);
    assert.match(data.source.readAt,/^\d{4}-\d{2}-\d{2}$/,`${file}: the date it was read`);
    assert.match(data.talents,/^[A-Za-z0-9+/]{40,}$/,`${file}: a talent export string`);
    assert.ok(data.gear.length>=15,`${file}: ${data.gear.length} gear slots`);
    for(const g of data.gear){
      assert.ok(slots.includes(g.slot),`${file}: ${g.slot} is a SimC slot`);
      assert.ok(Number.isInteger(g.item)&&g.item>0,`${file}: ${g.slot} has an item id`);
    }
    assert.equal(new Set(data.gear.map(g=>g.slot)).size,data.gear.length,`${file}: one item per slot`);
  }
});

test('the generated profile matches its data and reads as a profile',async()=>{
  for(const file of files){
    const data=await read(file);
    const text=await fs.readFile(path.join(dir,`${data.key}.simc`),'utf8');
    // The header has to say it is ours, where it came from, and that the engine wins when it catches up.
    assert.match(text,/SimC Lab's own reference profile/,`${data.key}: says whose it is`);
    assert.match(text,new RegExp(data.source.name),`${data.key}: names the source`);
    assert.match(text,/dropped the moment SimulationCraft publishes its own/,`${data.key}: says it stands down`);
    assert.match(text,/build-profiles\.mjs/,`${data.key}: says how to rebuild it`);
    const parsed=parseProfile(text.split('\n').filter(l=>!l.startsWith('#')).join('\n'),{reference:true});
    assert.equal(parsed.info.class,data.class);
    assert.equal(parsed.info.spec,data.spec);
    assert.equal(parsed.info.talents,data.talents,`${data.key}: the talents are the ones in the data`);
    assert.equal(Object.keys(parsed.gear).length,data.gear.length,`${data.key}: every slot came through`);
    for(const g of data.gear)assert.equal(parsed.gear[g.slot].id,g.item,`${data.key}: ${g.slot}`);
    // Nothing may be left at a base item level: each line carries a level, from a bonus or an explicit one.
    for(const [slot,item] of Object.entries(parsed.gear))
      assert.match(item.value,/(?:^|,)(?:bonus_id=|ilevel=)/,`${data.key}: ${slot} has no item level`);
  }
});

test('a crafted piece is written at a level of its own, never on a raid track',async()=>{
  for(const file of files){
    const data=await read(file);
    const text=await fs.readFile(path.join(dir,`${data.key}.simc`),'utf8');
    const lines=Object.fromEntries(text.split('\n').filter(l=>/^[a-z_0-9]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l]));
    for(const g of data.gear.filter(g=>/crafted/i.test(g.from||'')))
      assert.match(lines[g.slot],/,ilevel=\d+/,`${data.key}: ${g.slot} is crafted and needs its own item level`);
  }
});
