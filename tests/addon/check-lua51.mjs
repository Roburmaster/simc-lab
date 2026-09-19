// Lua 5.1 syntax check for the addon: every file in the TOC must parse as 5.1 (WoW's dialect), and string
// escapes that only 5.2+ understands (\x, \z, \u{...}) are rejected even though luaparse accepts them.
import fs from 'node:fs/promises';
import path from 'node:path';
import luaparse from 'luaparse';

export async function tocFiles(addonDir){
  const name=path.basename(addonDir);
  const toc=await fs.readFile(path.join(addonDir,`${name}.toc`),'utf8');
  return toc.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')).map(l=>l.replaceAll('\\','/'));
}

function walk(node,visit){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const n of node)walk(n,visit);return;}
  if(node.type)visit(node);
  for(const [key,value] of Object.entries(node))if(key!=='loc'&&key!=='range')walk(value,visit);
}

export function checkSource(source,file='chunk'){
  const problems=[];
  let ast;
  try{ast=luaparse.parse(source,{luaVersion:'5.1',locations:true,comments:false});}
  catch(e){return [`${file}: ${e.message}`];}
  walk(ast,node=>{
    if(node.type==='StringLiteral'&&/(^|[^\\])(\\\\)*\\(x|z|u\{)/.test(node.raw))problems.push(`${file}:${node.loc.start.line}: escape not in Lua 5.1: ${node.raw.slice(0,40)}`);
  });
  return problems;
}

export async function checkAddon(addonDir){
  const problems=[];
  const files=await tocFiles(addonDir);
  for(const file of files){
    let source;
    try{source=await fs.readFile(path.join(addonDir,file),'utf8');}catch{problems.push(`${file}: listed in the TOC but missing`);continue;}
    problems.push(...checkSource(source,file));
  }
  return {files,problems};
}
