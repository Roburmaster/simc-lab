// Loads the SimCLab addon into a real Lua VM (wasmoon) on top of wowmock.lua, in TOC order and with the
// addon namespace, the way the game does. All files load in one doString and questions are answered through a
// global rather than a return value: wasmoon leaks its stack on every doString that returns something.
import fs from 'node:fs/promises';
import path from 'node:path';
import {LuaFactory} from 'wasmoon';
import {tocFiles} from './check-lua51.mjs';

export const addonDir=path.resolve(import.meta.dirname,'../../addon/SimCLab');
const factory=new LuaFactory();

export async function world({data}={}){
  const lua=await factory.createEngine();
  await lua.doString(await fs.readFile(path.join(import.meta.dirname,'wowmock.lua'),'utf8'));
  const files=await tocFiles(addonDir);
  for(const [i,file] of files.entries()){
    const source=file==='Data.lua'&&data!==undefined?data:await fs.readFile(path.join(addonDir,file),'utf8');
    lua.global.set(`__src${i}`,source);lua.global.set(`__file${i}`,file);
  }
  lua.global.set('__count',files.length);
  await lua.doString(`
    __ns = {}
    for i = 0, __count - 1 do
      local chunk, err = load(_G["__src" .. i], "@" .. _G["__file" .. i])
      if not chunk then error(err) end
      chunk("SimCLab", __ns)
    end`);
  const w={
    lua,
    run:code=>lua.doString(code),
    async get(expression){await lua.doString(`__result = (${expression})`);const v=lua.global.get('__result');await lua.doString('__result = nil');return v;},
    // SavedVariables land after the addon's files and before its ADDON_LOADED, as in the game.
    async login(saved){
      if(saved)await lua.doString(saved);
      await lua.doString('__mock.event("ADDON_LOADED", "SimCLab") __mock.event("PLAYER_LOGIN") __mock.event("PLAYER_ENTERING_WORLD") __mock.runTimers()');
    },
    // A list of strings, read without wasmoon's table proxies: joined in Lua on a unit separator.
    async lines(expression){
      const joined=await w.get(`(function(list) local out = {} for i, v in ipairs(list or {}) do out[i] = tostring(v) end return table.concat(out, "\\31") end)(${expression})`);
      return joined?joined.split('\x1f'):[];
    },
    close:()=>lua.global.close(),
  };
  return w;
}
