// Lua text in both directions. The writer turns plain data into a Lua table constructor for the WoW addon's
// Data.lua; the reader parses the literal subset WoW writes to SavedVariables. Nothing here executes Lua.
const keywords=new Set(['and','break','do','else','elseif','end','false','for','function','goto','if','in','local','nil','not','or','repeat','return','then','true','until','while']);

// Every character that could end the string, start an escape or confuse an editor is escaped. Control
// characters use three-digit decimal escapes so a following digit can never extend them. Text stays UTF-8.
export function luaString(value){
  let out='"';
  for(const ch of String(value)){
    const code=ch.codePointAt(0);
    if(ch==='\\')out+='\\\\';
    else if(ch==='"')out+='\\"';
    else if(ch==='\n')out+='\\n';
    else if(ch==='\r')out+='\\r';
    else if(ch==='\t')out+='\\t';
    else if(code<32||code===127)out+='\\'+String(code).padStart(3,'0');
    else if(code>=0xd800&&code<=0xdfff)out+='\ufffd'; // a lone surrogate has no UTF-8 form
    else out+=ch;
  }
  return out+'"';
}

export function luaNumber(n){
  if(typeof n!=='number'||!Number.isFinite(n))throw new Error('Lua data accepts only finite numbers.');
  if(Object.is(n,-0))return '0';
  return String(Number.isInteger(n)?n:Number(n.toPrecision(10)));
}

const identifier=key=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)&&!keywords.has(key);
function luaKey(key){
  if(typeof key==='number'){if(!Number.isInteger(key))throw new Error('Lua table keys must be integers or strings.');return `[${key}]`;}
  return identifier(key)?key:`[${luaString(key)}]`;
}

// Arrays become sequences, objects become records. Undefined and null are left out, as Lua has no nil entries.
// Objects whose keys all look like integers keep numeric keys, so specialization IDs index as numbers in Lua.
// A table that fits in `width` characters stays on one line; larger ones get one entry per line.
export function toLua(value,{indent='  ',width=160}={}){
  function render(value,depth){
    if(typeof value==='string'){const s=luaString(value);return {text:s,inline:s};}
    if(typeof value==='number'){const s=luaNumber(value);return {text:s,inline:s};}
    if(typeof value==='boolean'){const s=value?'true':'false';return {text:s,inline:s};}
    if(typeof value!=='object')throw new Error(`Lua data cannot hold a ${typeof value}.`);
    if(depth>32)throw new Error('The Lua data is nested too deeply.');
    const keys=Object.keys(value);
    const numeric=!Array.isArray(value)&&keys.length>0&&keys.every(k=>/^-?\d+$/.test(k)&&Number.isSafeInteger(Number(k)));
    const entries=Array.isArray(value)
      ?value.filter(v=>v!==null&&v!==undefined).map(v=>['',render(v,depth+1)])
      :Object.entries(value).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>[`${luaKey(numeric?Number(k):k)}=`,render(v,depth+1)]);
    if(!entries.length)return {text:'{}',inline:'{}'};
    let inline=null;
    if(entries.every(([,r])=>r.inline!==null)){inline=`{${entries.map(([k,r])=>k+r.inline).join(',')}}`;if(inline.length>width)inline=null;}
    if(inline!==null)return {text:inline,inline};
    const pad=indent.repeat(depth+1);
    return {text:`{\n${entries.map(([k,r])=>pad+k+r.text).join(',\n')},\n${indent.repeat(depth)}}`,inline:null};
  }
  if(value===null||value===undefined)return 'nil';
  return render(value,0).text;
}

// Reads `name = value` assignments of literal data: strings in all quoting styles, numbers, booleans, nil and
// nested tables. Records become null-prototype objects; a table holding only the keys 1..n becomes an array.
export function parseLua(text,{maxLength=32*1024*1024,maxDepth=64}={}){
  if(typeof text!=='string')throw new Error('Lua text must be a string.');
  if(text.length>maxLength)throw new Error('The Lua file is too large.');
  let i=text.charCodeAt(0)===0xfeff?1:0;
  const fail=message=>{const line=text.slice(0,i).split('\n').length;throw new Error(`Lua data, line ${line}: ${message}`);};
  const longBracket=()=>{const m=/^\[(=*)\[/.exec(text.slice(i,i+80));if(!m)return null;const close=`]${m[1]}]`;const end=text.indexOf(close,i+m[0].length);if(end<0)fail('unfinished long bracket.');let body=text.slice(i+m[0].length,end);if(body.startsWith('\r\n'))body=body.slice(2);else if(body[0]==='\n')body=body.slice(1);i=end+close.length;return body;};
  function space(){
    for(;;){
      while(i<text.length&&/\s/.test(text[i]))i++;
      if(text.startsWith('--',i)){i+=2;if(text[i]==='['&&longBracket()!==null)continue;while(i<text.length&&text[i]!=='\n')i++;continue;}
      return;
    }
  }
  function string(){
    const quote=text[i++];let out='';
    for(;;){
      if(i>=text.length)fail('unfinished string.');
      const ch=text[i++];
      if(ch===quote)return out;
      if(ch==='\n')fail('unfinished string.');
      if(ch!=='\\'){out+=ch;continue;}
      const e=text[i++];
      const simple={n:'\n',r:'\r',t:'\t',a:'\x07',b:'\b',f:'\f',v:'\v','\\':'\\','"':'"',"'":"'",'\n':'\n'}[e];
      if(simple!==undefined){out+=simple;continue;}
      if(e==='\r'){if(text[i]==='\n')i++;out+='\n';continue;}
      if(/\d/.test(e)){let digits=e;while(digits.length<3&&/\d/.test(text[i]))digits+=text[i++];const code=Number(digits);if(code>255)fail('escape too large.');out+=String.fromCharCode(code);continue;}
      if(e==='x'){const hex=text.slice(i,i+2);if(!/^[0-9a-fA-F]{2}$/.test(hex))fail('bad hex escape.');i+=2;out+=String.fromCharCode(parseInt(hex,16));continue;}
      fail(`unknown escape \\${e}.`);
    }
  }
  function number(){
    const m=/^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf|nan)/.exec(text.slice(i,i+64));
    if(!m)fail('expected a value.');i+=m[0].length;
    const s=m[0];const n=/inf/.test(s)?(s.startsWith('-')?-Infinity:Infinity):/nan/.test(s)?NaN:/0[xX]/.test(s)?(s.startsWith('-')?-1:1)*parseInt(s.replace(/^-?0[xX]/,''),16):Number(s);
    return n;
  }
  function value(depth){
    space();const ch=text[i];
    if(ch==='"'||ch==="'")return string();
    if(ch==='['){const s=longBracket();if(s===null)fail('unexpected [.');return s;}
    if(ch==='{')return table(depth+1);
    for(const [word,v] of [['true',true],['false',false],['nil',null]])if(text.startsWith(word,i)&&!/\w/.test(text[i+word.length]||'')){i+=word.length;return v;}
    return number();
  }
  function table(depth){
    if(depth>maxDepth)fail('tables are nested too deeply.');
    i++;const record=Object.create(null);let next=1;
    for(;;){
      space();
      if(text[i]==='}'){i++;break;}
      let key;
      if(text[i]==='['&&!/^\[=*\[/.test(text.slice(i,i+80))){i++;key=value(depth);space();if(text[i]!==']')fail('expected ].');i++;space();if(text[i]!=='=')fail('expected =.');i++;}
      else{const m=/^[A-Za-z_]\w*/.exec(text.slice(i,i+256));let save=i;if(m&&!['true','false','nil'].includes(m[0])){i+=m[0].length;space();if(text[i]==='='&&text[i+1]!=='='){i++;key=m[0];}else i=save;}}
      const v=value(depth);
      if(key===undefined)key=next++;
      if(key===null||Number.isNaN(key))fail('invalid table key.');
      if(v!==null)record[typeof key==='number'?String(key):key]=v;
      space();
      if(text[i]===','||text[i]===';'){i++;continue;}
      space();if(text[i]==='}'){i++;break;}
      fail('expected , or }.');
    }
    const keys=Object.keys(record);
    if(keys.length&&keys.every((k,n)=>k===String(n+1)))return keys.map(k=>record[k]);
    return record;
  }
  const globals=Object.create(null);
  for(;;){
    space();if(i>=text.length)break;
    const m=/^[A-Za-z_]\w*/.exec(text.slice(i,i+256));if(!m)fail('expected an assignment.');
    i+=m[0].length;space();if(text[i]!=='=')fail('expected =.');i++;
    globals[m[0]]=value(0);
    space();if(text[i]===';')i++;
  }
  return globals;
}
