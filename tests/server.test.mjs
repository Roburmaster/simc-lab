// Server mode end to end, without SimC and without the real Discord: a stand-in answers Discord's OAuth2 and
// user endpoints, so sign-in, membership, roles, admins, blocking and job privacy can all be checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const root=path.resolve(import.meta.dirname,'..');
const port=8700+Math.floor(Math.random()*200);
const base=`http://localhost:${port}`;
const guild='111111111111111111',role='222222222222222222',adminRole='333333333333333333';

// Discord's side: a code names a person; people are on the server with roles, or not.
const people={
  'code-boss':{user:{id:'900000000000000001',username:'boss',global_name:'Boss'},member:{roles:[role,adminRole]}},
  'code-friend':{user:{id:'900000000000000002',username:'friend',global_name:'Friend',avatar:'0123456789abcdef0123456789abcdef'},member:{nick:'Frenn',roles:[role]}},
  'code-friend2':{user:{id:'900000000000000005',username:'guesser'},member:{roles:[role]}},
  'code-norole':{user:{id:'900000000000000003',username:'norole'},member:{roles:[]}},
  'code-stranger':{user:{id:'900000000000000004',username:'stranger'},member:null},
};
function discordStub(){
  const tokens=new Map();
  return http.createServer(async(req,res)=>{
    const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    if(req.method==='POST'&&req.url==='/api/oauth2/token'){
      let text='';for await(const c of req)text+=c;const form=new URLSearchParams(text);
      if(form.get('client_secret')!=='test-secret'||!people[form.get('code')]||!form.get('redirect_uri').endsWith('/auth/discord/callback'))return send(400,{error:'invalid_grant'});
      const token='tok-'+form.get('code');tokens.set(token,people[form.get('code')]);return send(200,{access_token:token,token_type:'Bearer'});
    }
    const who=tokens.get(String(req.headers.authorization||'').replace('Bearer ',''));
    if(!who)return send(401,{message:'401: Unauthorized'});
    if(req.url==='/api/users/@me')return send(200,who.user);
    if(req.url===`/api/users/@me/guilds/${guild}/member`)return who.member?send(200,who.member):send(404,{message:'Unknown Guild'});
    send(404,{});
  });
}

async function start(home,discordPort){
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,stdio:['ignore','pipe','inherit'],env:{...process.env,PORT:String(port),SIMC_LAB_HOME:home,SIMC_LAB_SERVER:'1',SIMC_LAB_PUBLIC_URL:base,WOW_BUILD_INFO:'',
    DISCORD_CLIENT_ID:'123456789012345678',DISCORD_CLIENT_SECRET:'test-secret',SIMC_LAB_DISCORD_GUILD:guild,SIMC_LAB_DISCORD_ROLE:role,SIMC_LAB_DISCORD_ADMIN_ROLE:adminRole,
    SIMC_LAB_DISCORD_API:`http://127.0.0.1:${discordPort}/api`,SIMC_LAB_DISCORD_AUTHORIZE:`http://127.0.0.1:${discordPort}/authorize`}});
  let out='';child.stdout.on('data',d=>out+=d);
  for(let i=0;i<150&&!out.includes('Sign in with Discord');i++)await new Promise(r=>setTimeout(r,100));
  return child;
}

// A tiny browser: a cookie jar, the request token, and Discord's round trip.
function browser(){
  const jar=new Map();let token='';
  const call=async(route,data,{origin=base,headers={}}={})=>{
    const cookies=[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
    const res=await fetch(base+route,{redirect:'manual',method:data===undefined?'GET':'POST',headers:{...(data!==undefined?{'Content-Type':'application/json','X-SimC-Token':token,...(origin?{Origin:origin}:{})}:{}),...(cookies?{Cookie:cookies}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
    for(const c of res.headers.getSetCookie()){const [pair]=c.split(';');const i=pair.indexOf('=');const v=pair.slice(i+1);if(v)jar.set(pair.slice(0,i),v);else jar.delete(pair.slice(0,i));}
    const body=res.headers.get('content-type')?.includes('json')?await res.json():await res.text();
    return {status:res.status,body,location:res.headers.get('location'),cookies:res.headers.getSetCookie()};
  };
  return {call,jar,
    async signIn(code){
      const go=await call('/auth/discord');const to=new URL(go.location);
      assert.equal(to.searchParams.get('scope'),'identify guilds.members.read');
      assert.equal(to.searchParams.get('redirect_uri'),`${base}/auth/discord/callback`);
      const back=await call(`/auth/discord/callback?code=${code}&state=${to.searchParams.get('state')}`);
      const error=back.location?.startsWith('/login?error=')?decodeURIComponent(back.location.slice(13)):null;
      const pending=back.location==='/login?invite=1';
      if(!error&&!pending){const s=await call('/api/status');token=s.body.token;}
      return {back,error,pending};
    },
    async invite(key){
      const res=await call('/api/auth/invite',{key});
      if(res.status===200){const s=await call('/api/status');token=s.body.token;}
      return res;
    }};
}

test('server mode: Discord sign-in, membership, admins and job privacy',async t=>{
  const stub=discordStub();stub.listen(0,'127.0.0.1');await once(stub,'listening');
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-server-'));
  const server=await start(home,stub.address().port);
  t.after(async()=>{server.kill();await once(server,'exit').catch(()=>{});stub.close();await fs.rm(home,{recursive:true,force:true});});

  const anon=browser();
  assert.equal((await anon.call('/api/status')).status,401,'the API needs a session');
  assert.equal((await anon.call('/')).location,'/login','the app sends strangers to the sign-in page');
  assert.equal((await anon.call('/login')).status,200,'the sign-in page is public');
  const hostStatus=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'/api/status',headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(hostStatus,403,'unknown hosts are refused');

  // The state must come back to the same browser.
  const go=await anon.call('/auth/discord');const state=new URL(go.location).searchParams.get('state');
  const forged=browser();
  assert.match((await forged.call(`/auth/discord/callback?code=code-friend&state=${state}`)).location,/error=.*expired/);
  assert.match((await anon.call('/auth/discord/callback?error=access_denied')).location,/cancelled/);

  assert.match((await browser().signIn('code-stranger')).error,/members of our Discord server/);
  assert.match((await browser().signIn('code-norole')).error,/does not have the role/);

  const boss=browser();
  const signed=await boss.signIn('code-boss');
  assert.equal(signed.error,null);assert.equal(signed.back.location,'/');
  const session=signed.back.cookies.find(c=>c.startsWith('simclab_session='));
  assert.match(session,/HttpOnly/);assert.match(session,/SameSite=Lax/);
  const bossStatus=(await boss.call('/api/status')).body;
  assert.equal(bossStatus.user.name,'Boss');assert.equal(bossStatus.user.admin,true,'the admin role makes an admin');
  assert.deepEqual(bossStatus.app.queue,{total:20,perUser:2});

  // Admins hand out invite keys; each names a group. Only hashes are kept, so the list never shows a key.
  assert.equal((await boss.call('/api/admin/keys',{key:'kaken'})).status,200);
  const keys=(await boss.call('/api/admin/keys',{key:'CrimeGang',label:'Crimegang'})).body.keys;
  assert.deepEqual(keys.map(k=>k.label),['Kaken','Crimegang']);
  assert.ok(keys.every(k=>!('hash' in k)&&!('salt' in k)),'key hashes never leave the server');
  assert.match((await boss.call('/api/admin/keys',{key:' KAKEN '})).body.error,/exists already/,'keys ignore case and spaces');

  // Someone new signs in with Discord, then needs a key once.
  const friend=browser();
  const first=await friend.signIn('code-friend');
  assert.equal(first.pending,true,'a new member is asked for an invite key');
  assert.equal((await friend.call('/api/status')).status,401,'no session before the key');
  assert.equal((await friend.call('/api/auth/pending')).body.name,'Frenn');
  assert.match((await friend.invite('wrong')).body.error,/not right/);
  assert.equal((await friend.invite('crimegang')).status,200);
  const me=(await friend.call('/api/status')).body.user;
  assert.equal(me.name,'Frenn','the server nickname wins');assert.equal(me.admin,false);assert.equal(me.group,'Crimegang');
  const again=browser();
  assert.equal((await again.signIn('code-friend')).pending,false,'the key is needed only once');

  // Five wrong keys end a pending sign-up.
  const guesser=browser();
  await guesser.signIn('code-friend2');
  for(let i=0;i<4;i++)assert.match((await guesser.invite('nope'+i)).body.error,/not right/);
  assert.match((await guesser.invite('nope4')).body.error,/fifth wrong invite key/);
  assert.match((await guesser.invite('kaken')).body.error,/expired/);
  assert.match(me.avatar,/^https:\/\/cdn\.discordapp\.com\/avatars\/900000000000000002\//);

  assert.equal((await friend.call('/api/admin/users')).status,403,'members cannot list accounts');
  assert.equal((await friend.call('/api/engine/update',{mode:'auto'})).status,403,'members cannot update SimC');
  assert.equal((await friend.call('/api/wow')).status,404,'the WoW addon bridge is desktop only');
  assert.equal((await friend.call('/api/jobs',{},{origin:'https://evil.example'})).status,403,'foreign origins are refused');
  assert.equal((await friend.call('/api/jobs',{},{headers:{'X-SimC-Token':'nope'}})).status,403,'the request token is checked');

  // Job privacy and the queue order are covered in queue.test.mjs; here only that a new member starts empty.
  assert.equal((await friend.call('/api/jobs')).body.length,0);

  const users=(await boss.call('/api/admin/users')).body.users;
  assert.deepEqual(users.map(u=>u.name).sort(),['Boss','Frenn']);
  const friendId=users.find(u=>u.name==='Frenn').id;

  // Removing someone ends their session and blocks their Discord account until an admin lets them back.
  assert.equal((await boss.call('/api/admin/remove',{id:friendId})).status,200);
  assert.equal((await friend.call('/api/status')).status,401);
  assert.match((await browser().signIn('code-friend')).error,/removed your access/);
  assert.equal((await boss.call('/api/admin/users')).body.blocked,1);
  await boss.call('/api/admin/unblock',{});
  const back=browser();
  assert.equal((await back.signIn('code-friend')).pending,true,'a removed member needs a key again once unblocked');
  assert.equal((await back.invite('Kaken')).status,200);
  assert.equal((await boss.call('/api/admin/remove',{id:bossStatus.user.id})).status,400,'an admin cannot remove themself');

  assert.equal((await boss.call('/api/auth/logout',{})).status,200);
  assert.equal((await boss.call('/api/status')).status,401,'signing out ends the session');

  // The account store is encrypted: no names, Discord ids, keys or group names in the file.
  const raw=await fs.readFile(path.join(home,'server','accounts.enc'),'utf8');
  assert.equal(JSON.parse(raw).alg,'aes-256-gcm');
  for(const plain of ['Frenn','Boss','900000000000000002','kaken','Kaken','Crimegang','tok-'])assert.ok(!raw.includes(plain),`${plain} is not in the store in clear text`);
  const {open}=await import('../lib/accounts.mjs');
  const saved=open(Buffer.from((await fs.readFile(path.join(home,'server','data.key'),'utf8')).trim(),'base64'),raw);
  assert.ok(Object.keys(saved.sessions).every(k=>/^[0-9a-f]{64}$/.test(k)),'sessions are stored as hashes');
  assert.ok(saved.keys.every(k=>/^[0-9a-f]{64}$/.test(k.hash)&&/^[0-9a-f]{32}$/.test(k.salt)&&!('key' in k)),'keys are stored as salted scrypt hashes');
  assert.ok(!JSON.stringify(saved).includes('tok-'),'Discord access tokens are never stored');
  await assert.rejects(async()=>open(Buffer.alloc(32),raw),/cannot be decrypted/,'a wrong key opens nothing');
});

test('server mode refuses to start without its Discord settings',async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'simclab-server-'));
  const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port+1),SIMC_LAB_HOME:home,SIMC_LAB_SERVER:'1',SIMC_LAB_PUBLIC_URL:base,DISCORD_CLIENT_ID:'',DISCORD_CLIENT_SECRET:''}});
  let err='';child.stderr.on('data',d=>err+=d);
  const [code]=await once(child,'exit');
  await fs.rm(home,{recursive:true,force:true});
  assert.notEqual(code,0);assert.match(err,/DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET.*SIMC_LAB_DISCORD_ADMINS or SIMC_LAB_DISCORD_ADMIN_ROLE/);
});
