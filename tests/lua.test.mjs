import test from 'node:test';
import assert from 'node:assert/strict';
import luaparse from 'luaparse';
import {LuaFactory} from 'wasmoon';
import {luaString,luaNumber,toLua,parseLua} from '../lib/lua.mjs';

const factory=new LuaFactory();
// Runs `return <expression>` in a real Lua VM through a global, the non-leaking way to read a value back.
async function evaluate(source,expression='__value'){
  const lua=await factory.createEngine();
  try{await lua.doString(source);await lua.doString(`__out = ${expression}`);return lua.global.get('__out');}
  finally{lua.global.close();}
}

const nasty=['plain','quote " inside','back\\slash','new\nline','carriage\rreturn','tab\tstop','nul\0byte','bell\x07','del\x7f','pipe |cffff0000red|r','long ]] bracket [[','dash -- comment','digits after escape \x01' + '23','Ævar Ødegård 日本 🙂','$(dollar) %s %d','lone \ud800 surrogate'];

test('strings escape quotes, backslashes and every control character',()=>{
  assert.equal(luaString('a"b\\c'),'"a\\"b\\\\c"');
  assert.equal(luaString('x\ny\rz\t'),'"x\\ny\\rz\\t"');
  assert.equal(luaString('\0'),'"\\000"');
  assert.equal(luaString('\x01'+'23'),'"\\00123"','three-digit escapes cannot swallow a following digit');
  assert.equal(luaString('\x7f'),'"\\127"');
  assert.equal(luaString('\ud800'),'"�"');
  for(const s of nasty)assert.doesNotMatch(luaString(s).slice(1,-1),/(?<!\\)"|[\x00-\x1f\x7f]/);
});

test('every escaped string survives a round trip through Lua 5.1 syntax and a real Lua VM',async()=>{
  const source=`__value = ${toLua(nasty)}`;
  luaparse.parse(source,{luaVersion:'5.1'});
  const lua=await factory.createEngine();
  try{
    await lua.doString(source);
    // Compared as hex bytes: wasmoon hands strings to JavaScript as C strings, which would stop at a NUL.
    for(const [i,s] of nasty.entries()){
      await lua.doString(`__out = (__value[${i+1}]:gsub(".", function(c) return string.format("%02x", c:byte()) end))`);
      assert.equal(lua.global.get('__out'),Buffer.from(s.replace('\ud800','�'),'utf8').toString('hex'),`string ${i}`);
    }
  }finally{lua.global.close();}
});

test('numbers are finite and plain',()=>{
  assert.equal(luaNumber(3),'3');
  assert.equal(luaNumber(-0),'0');
  assert.equal(luaNumber(1/3),'0.3333333333');
  assert.equal(luaNumber(1e-9),'1e-9');
  for(const bad of [NaN,Infinity,-Infinity,'1'])assert.throws(()=>luaNumber(bad));
});

test('tables: identifiers stay bare, keywords and odd keys are quoted, numeric keys stay numbers',async()=>{
  const value={plain:1,end:2,'with space':3,'1abc':4,specs:{250:{spec:'blood'},'-97':'trash'},list:[1,null,2],skip:undefined,nil:null,yes:true,no:false};
  const text=toLua(value);
  assert.match(text,/\bplain=1/);assert.match(text,/\["end"\]=2/);assert.match(text,/\["with space"\]=3/);assert.match(text,/\[250\]=/);assert.match(text,/\[-97\]=/);
  assert.doesNotMatch(text,/skip|nil=/);
  luaparse.parse(`x = ${text}`,{luaVersion:'5.1'});
  assert.equal(await evaluate(`__value = ${text}`,'__value.specs[250].spec'),'blood');
  assert.equal(await evaluate(`__value = ${text}`,'#__value.list'),2);
  assert.equal(await evaluate(`__value = ${text}`,'__value["end"] + __value["with space"]'),5);
  assert.throws(()=>toLua({f(){}}));
  assert.throws(()=>toLua({a:1n}));
});

test('the SavedVariables reader handles what WoW writes',()=>{
  const text=`
SimCLabDB = {
["captures"] = {
["temulan-ravencrest"] = {
["text"] = "deathknight=\\"Temulan\\"\\nserver=ravencrest\\n# Checksum: 1",
["time"] = 1758300000,
["name"] = "Temulan",
},
},
["list"] = {
"a", -- [1]
"b", -- [2]
},
["version"] = 1,
["neg"] = -2.5,
["hex"] = 0x10,
["flag"] = true,
["gone"] = nil,
}
Other = 'single \\'quoted\\'' -- trailing comment
--[[ block
comment ]]
Long = [==[raw ]] text]==]
`;
  const g=parseLua(text);
  assert.equal(g.SimCLabDB.captures['temulan-ravencrest'].text,'deathknight="Temulan"\nserver=ravencrest\n# Checksum: 1');
  assert.deepEqual(g.SimCLabDB.list,['a','b']);
  assert.equal(g.SimCLabDB.neg,-2.5);assert.equal(g.SimCLabDB.hex,16);assert.equal(g.SimCLabDB.flag,true);
  assert.equal('gone' in g.SimCLabDB,false);
  assert.equal(g.Other,"single 'quoted'");assert.equal(g.Long,'raw ]] text');
});

test('the reader rejects code and keeps keys from reaching Object.prototype',()=>{
  for(const bad of ['x = os.execute("calc")','x = {} y = function() end','x = ("a"):rep(3)','x = { [1 + 1] = 2 }','x = "unfinished','x = {{{','print("hi")'])
    assert.throws(()=>parseLua(bad),`should reject: ${bad}`);
  const g=parseLua('x = { ["__proto__"] = { polluted = true }, constructor = 1 }');
  assert.equal(({}).polluted,undefined);assert.equal(Object.getPrototypeOf(g.x),null);
  assert.throws(()=>parseLua('x = '+'{'.repeat(80)+'}'.repeat(80)),/nested/);
  assert.throws(()=>parseLua('x = 1',{maxLength:2}),/too large/);
});

test('what the writer writes, the reader reads back',()=>{
  const value={name:'Ævar "the" \\ |cff|r\nsecond line',ids:[1,2,3],nested:{deep:{er:[{a:1},{b:'two'}]}},keyword:{end:true}};
  assert.deepEqual(JSON.parse(JSON.stringify(parseLua(`v = ${toLua(value)}`).v)),value);
});
