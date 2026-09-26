// Server mode end to end, without SimC: accounts, sessions, who sees which job, and what members may not do.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';

const root=path.resolve(import.meta.dirname,'..');
const port=8700+Math.floor(Math.random()*200);
const base=`http://127.0.0.1:${port}`;

async function start(home){
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:String(port),SIMC_LAB_HOME:home,SIMC_LAB_SERVER:'1',SIMC_LAB_WOW_DIR:'',WOW_BUILD_INFO:''},stdio:['ignore','pipe','inherit']});
  let out='';child.stdout.on('data',d=>out+=d);
  for(let i=0;i<150&&!out.includes('invite=');i++)await new Promise(r=>setTimeout(r,100));
  return {child,output:()=>out};
}

// A tiny browser: one cookie jar and the request token from /api/status.
function client(){
  let jar='',token='';
  const call=async(route,data,{origin=base,headers={}}={})=>{
    const res=await fetch(base+route,{method:data===undefined?'GET':'POST',headers:{...(data!==undefined?{'Content-Type':'application/json','X-SimC-Token':token,...(origin?{Origin:origin}:{})}:{}),...(jar?{Cookie:jar}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
    const set=res.headers.get('set-cookie');if(set)jar=set.split(';')[0];
    const body=res.headers.get('content-type')?.includes('json')?await res.json():await res.text();
    return {status:res.status,body,cookie:set};
  };
  return {call,async refresh(){const s=await call('/api/status');token=s.body.token;return s;},get jar(){return jar;}};
}

test('server mode: invites, sessions and admin rights',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-server-'));
  const server=await start(home);
  t.after(async()=>{server.child.kill();await once(server.child,'exit').catch(()=>{});await fs.rm(home,{recursive:true,force:true});});
  const code=server.output().match(/invite=([\w-]+)/)?.[1];
  assert.ok(code,'the first start prints an admin invite');

  const anon=client();
  assert.equal((await anon.call('/api/status')).status,401,'the API needs a session');
  assert.equal((await anon.call('/api/jobs')).status,401);
  assert.equal((await anon.call('/login')).status,200,'the sign-in page is public');
  // fetch cannot set Host, so this one goes through http.request.
  const hostStatus=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'/api/status',headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(hostStatus,403,'unknown hosts are refused');

  const admin=client();
  const reg=await admin.call('/api/auth/register',{invite:code,name:'Boss',password:'correct horse battery'});
  assert.equal(reg.status,200);assert.equal(reg.body.user.admin,true,'the bootstrap invite makes an admin');
  assert.match(reg.cookie,/HttpOnly/);assert.match(reg.cookie,/SameSite=Strict/);
  assert.equal((await client().call('/api/auth/register',{invite:code,name:'Again',password:'correct horse battery'})).status,400,'an invite works once');

  const status=await admin.refresh();
  assert.equal(status.body.user.name,'Boss');assert.equal(status.body.app.server,true);
  const invite=await admin.call('/api/admin/invite',{});
  assert.equal(invite.status,200);assert.match(invite.body.link,/\/login#invite=/);

  const member=client();
  assert.equal((await member.call('/api/auth/register',{invite:invite.body.code,name:'boss',password:'another long password'})).status,400,'names are unique regardless of case');
  const joined=await member.call('/api/auth/register',{invite:invite.body.code,name:'Friend',password:'short'});
  assert.equal(joined.status,400,'short passwords are refused');
  assert.equal((await member.call('/api/auth/register',{invite:invite.body.code,name:'Friend',password:'another long password'})).body.user.admin,false);
  await member.refresh();

  assert.equal((await member.call('/api/admin/users')).status,403,'members cannot list accounts');
  assert.equal((await member.call('/api/admin/invite',{})).status,403);
  assert.equal((await member.call('/api/engine/update',{mode:'auto'})).status,403,'members cannot update SimC');
  assert.equal((await member.call('/api/wow')).status,404,'the WoW addon bridge is desktop only');
  assert.equal((await member.call('/api/jobs',{},{origin:'https://evil.example'})).status,403,'foreign origins are refused');
  assert.equal((await member.call('/api/jobs',{},{headers:{'X-SimC-Token':'nope'}})).status,403,'the request token is checked');

  const users=(await admin.call('/api/admin/users')).body.users;
  assert.deepEqual(users.map(u=>u.name).sort(),['Boss','Friend']);

  // Wrong passwords are counted; the tenth locks the name for a while.
  const guesser=client();
  for(let i=0;i<10;i++)assert.equal((await guesser.call('/api/auth/login',{name:'Friend',password:'wrong password '+i})).status,400);
  assert.match((await guesser.call('/api/auth/login',{name:'Friend',password:'another long password'})).body.error,/Too many attempts/);

  // Signing out ends the session.
  assert.equal((await member.call('/api/auth/logout',{})).status,200);
  assert.equal((await member.call('/api/status')).status,401);

  // Removing an account ends its sessions too.
  const friend=users.find(u=>u.name==='Friend');
  assert.equal((await admin.call('/api/admin/remove',{id:friend.id})).status,200);
  assert.equal((await admin.call('/api/admin/remove',{id:status.body.user.id})).status,400,'an admin cannot remove themself');

  const saved=JSON.parse(await fs.readFile(path.join(home,'server','accounts.json'),'utf8'));
  assert.ok(saved.users.every(u=>!('password' in u)&&u.hash&&u.salt),'only password hashes are stored');
  assert.ok(Object.keys(saved.sessions).every(k=>/^[0-9a-f]{64}$/.test(k)),'sessions are stored as hashes');
});
