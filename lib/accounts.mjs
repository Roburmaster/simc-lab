// Server mode: accounts come from Discord, and joining takes an invite key. Signing in is Discord's OAuth2
// (identify, plus guilds.members.read when membership of a Discord server is required). The first sign-in asks
// for an invite key; each key names the group its members belong to (for example "Kaken" or "Crimegang").
// The app keeps no passwords, never stores Discord tokens, keeps invite keys and sessions only as hashes, and
// writes the whole account store encrypted (AES-256-GCM) to disk.
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash,randomUUID,createCipheriv,createDecipheriv,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {home} from './paths.mjs';

const scrypt=promisify(scryptCb);
export const serverDir=path.join(home,'server');
export const accountsFile=path.join(serverDir,'accounts.enc');
export const keyFile=path.join(serverDir,'data.key');
// A session lasts a week, so someone who is removed or leaves the Discord server loses access within days.
const sessionDays=7;
const sha=text=>createHash('sha256').update(text).digest('hex');
const now=()=>Date.now();
const snowflake=/^\d{5,25}$/;
const list=value=>String(value||'').split(',').map(s=>s.trim()).filter(Boolean);
// A setting may come from NAME or, for secrets, from a file named by NAME_FILE (Docker secrets, systemd credentials).
export function secret(env,name){
  if(env[name+'_FILE'])return readFileSync(env[name+'_FILE'],'utf8').trim();
  return env[name]||'';
}

export function discordSettings(env=process.env,publicUrl=null){
  const settings={
    clientId:env.DISCORD_CLIENT_ID||'',clientSecret:secret(env,'DISCORD_CLIENT_SECRET'),
    guild:env.SIMC_LAB_DISCORD_GUILD||'',role:env.SIMC_LAB_DISCORD_ROLE||'',
    adminRole:env.SIMC_LAB_DISCORD_ADMIN_ROLE||'',admins:list(env.SIMC_LAB_DISCORD_ADMINS),
    // Overridable for tests, which talk to a stand-in for Discord.
    api:(env.SIMC_LAB_DISCORD_API||'https://discord.com/api/v10').replace(/\/$/,''),
    authorize:env.SIMC_LAB_DISCORD_AUTHORIZE||'https://discord.com/oauth2/authorize',
    redirect:publicUrl?new URL('/auth/discord/callback',publicUrl).href:'',
  };
  const missing=[!settings.clientId&&'DISCORD_CLIENT_ID',!settings.clientSecret&&'DISCORD_CLIENT_SECRET',!publicUrl&&'SIMC_LAB_PUBLIC_URL'].filter(Boolean);
  for(const [name,value] of [['SIMC_LAB_DISCORD_GUILD',settings.guild],['SIMC_LAB_DISCORD_ROLE',settings.role],['SIMC_LAB_DISCORD_ADMIN_ROLE',settings.adminRole]])if(value&&!snowflake.test(value))missing.push(name);
  if((settings.role||settings.adminRole)&&!settings.guild)missing.push('SIMC_LAB_DISCORD_GUILD (roles need their server)');
  if(settings.admins.some(id=>!snowflake.test(id)))missing.push('SIMC_LAB_DISCORD_ADMINS');
  // Admins come in without an invite key and hand out the rest, so at least one must be named.
  if(!settings.admins.length&&!settings.adminRole)missing.push('SIMC_LAB_DISCORD_ADMINS or SIMC_LAB_DISCORD_ADMIN_ROLE');
  if(missing.length)throw new Error(`Server mode signs in with Discord and needs valid: ${missing.join(', ')}. See docs/server.md.`);
  return settings;
}

// The store's key: SIMC_LAB_DATA_KEY (or _FILE), 32 bytes in base64. Without one, a random key is made once and
// kept in server/data.key, readable by the service user only.
export async function dataKey(env=process.env){
  const given=secret(env,'SIMC_LAB_DATA_KEY');
  if(given){const key=Buffer.from(given,'base64');if(key.length!==32)throw new Error('SIMC_LAB_DATA_KEY must be 32 bytes in base64 (openssl rand -base64 32).');return key;}
  try{const key=Buffer.from((await fs.readFile(keyFile,'utf8')).trim(),'base64');if(key.length===32)return key;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const key=randomBytes(32);
  await fs.mkdir(serverDir,{recursive:true});
  await fs.writeFile(keyFile,key.toString('base64')+'\n',{mode:0o600,flag:'wx'});
  return key;
}
export function seal(key,object){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(JSON.stringify(object),'utf8'),cipher.final()]);
  return JSON.stringify({v:1,alg:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
}
export function open(key,text){
  const box=JSON.parse(text);
  if(box.v!==1||box.alg!=='aes-256-gcm')throw new Error('The account store has an unknown format.');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(box.iv,'base64'));decipher.setAuthTag(Buffer.from(box.tag,'base64'));
  try{return JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data,'base64')),decipher.final()]).toString('utf8'));}
  catch{throw new Error('The account store cannot be decrypted with this key (SIMC_LAB_DATA_KEY or server/data.key).');}
}

// Invite keys are compared case-insensitively and without surrounding spaces; only a scrypt hash is kept.
const normalKey=key=>String(key??'').trim().toLowerCase();
async function hashKey(key,salt=randomBytes(16).toString('hex')){return {salt,hash:(await scrypt(normalKey(key),salt,32,{N:16384,r:8,p:1})).toString('hex')};}

export class Accounts{
  constructor(discord,{file=accountsFile,key}={}){this.discord=discord;this.file=file;this.key=key;this.data={users:[],sessions:{},blocked:[],keys:[]};this.states=new Map();this.pending=new Map();this.failures=new Map();this.writes=Promise.resolve();}

  async init(){
    this.key??=await dataKey();
    try{this.data={users:[],sessions:{},blocked:[],keys:[],...open(this.key,await fs.readFile(this.file,'utf8'))};}
    catch(e){if(e.code!=='ENOENT')throw e;}
    // An unencrypted store from an earlier version is not carried over; it only ever held test accounts.
    await fs.rm(path.join(path.dirname(this.file),'accounts.json'),{force:true});
    this.prune();
    return this;
  }
  save(){
    const text=seal(this.key,this.data);
    this.writes=this.writes.catch(()=>{}).then(async()=>{
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      await fs.writeFile(this.file+'.tmp',text,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);
    });
    return this.writes;
  }
  prune(){
    const t=now();
    for(const [key,s] of Object.entries(this.data.sessions))if(s.expires<t||!this.user(s.user))delete this.data.sessions[key];
    for(const map of [this.states,this.pending])for(const [key,s] of map)if(s.expires<t)map.delete(key);
  }

  user(id){return this.data.users.find(u=>u.id===id)||null;}
  publicUser(u){return u&&{id:u.id,name:u.name,avatar:u.avatar||null,admin:!!u.admin,group:u.group||null,created:u.created,lastSeen:u.lastSeen||null};}

  // Invite keys, as an admin sees them: the group name and how often each was used, never the key.
  keys(){return this.data.keys.map(k=>({id:k.id,label:k.label,uses:k.uses||0,created:k.created}));}
  async addKey(key,label){
    if(normalKey(key).length<4)throw new Error('An invite key needs at least 4 characters.');
    label=String(label||'').trim().slice(0,40)||normalKey(key).replace(/^./,c=>c.toUpperCase());
    if(await this.matchKey(key))throw new Error('That invite key exists already.');
    this.data.keys.push({id:randomUUID(),label,created:new Date().toISOString(),uses:0,...await hashKey(key)});
    await this.save();return this.keys();
  }
  async removeKey(id){this.data.keys=this.data.keys.filter(k=>k.id!==id);await this.save();return this.keys();}
  async matchKey(key){
    let found=null;
    for(const k of this.data.keys){const {hash}=await hashKey(key,k.salt);if(timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(k.hash,'hex'))&&!found)found=k;}
    return found;
  }

  // Step 1: where to send the browser. The state ties Discord's answer to this browser.
  begin(){
    this.prune();
    const state=randomBytes(24).toString('base64url');
    this.states.set(sha(state),{expires:now()+10*6e4});
    const url=new URL(this.discord.authorize);
    const scope=this.discord.guild?'identify guilds.members.read':'identify';
    for(const [k,v] of Object.entries({client_id:this.discord.clientId,response_type:'code',redirect_uri:this.discord.redirect,scope,state,prompt:'none'}))url.searchParams.set(k,v);
    return {state,url:url.href};
  }

  async discordFetch(route,init){
    const res=await fetch(this.discord.api+route,{...init,headers:{'User-Agent':'SimC-Lab',...init?.headers}});
    const body=await res.json().catch(()=>null);
    return {status:res.status,body};
  }

  // Step 2: Discord sent the browser back with a code. Who is it, and may they in? A known member gets a session;
  // someone new gets a short-lived pending sign-up that an invite key turns into an account.
  async finish({code,state,cookieState}){
    this.prune();
    if(!state||state!==cookieState||!this.states.delete(sha(state)))throw new Error('The Discord sign-in expired or came from another browser. Try again.');
    const token=await this.discordFetch('/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'authorization_code',code:String(code||''),redirect_uri:this.discord.redirect,client_id:this.discord.clientId,client_secret:this.discord.clientSecret})});
    if(token.status!==200||!token.body?.access_token)throw new Error('Discord did not accept the sign-in. Try again.');
    const auth={headers:{Authorization:`Bearer ${token.body.access_token}`}};
    const me=await this.discordFetch('/users/@me',auth);
    if(me.status!==200||!snowflake.test(me.body?.id||''))throw new Error('Discord did not say who you are. Try again.');
    let roles=[],nick=null;
    if(this.discord.guild){
      const member=await this.discordFetch(`/users/@me/guilds/${this.discord.guild}/member`,auth);
      if(member.status===404||member.status===403)throw new Error('This SimC Lab is for members of our Discord server. Join it, then sign in again.');
      if(member.status!==200)throw new Error('Discord could not confirm your membership. Try again in a moment.');
      roles=Array.isArray(member.body?.roles)?member.body.roles:[];nick=member.body?.nick||null;
      if(this.discord.role&&!roles.includes(this.discord.role))throw new Error('Your Discord account does not have the role this SimC Lab is for. Ask an admin.');
    }
    const discordId=me.body.id;
    if(this.data.blocked.includes(discordId))throw new Error('An admin has removed your access to this SimC Lab.');
    const profile={discordId,name:String(nick||me.body.global_name||me.body.username||'Discord user').slice(0,40),
      avatar:me.body.avatar&&/^(a_)?[0-9a-f]{32}$/.test(me.body.avatar)?`https://cdn.discordapp.com/avatars/${discordId}/${me.body.avatar}.png?size=64`:null};
    const configuredAdmin=this.discord.admins.includes(discordId)||(!!this.discord.adminRole&&roles.includes(this.discord.adminRole));
    let user=this.data.users.find(u=>u.discordId===discordId);
    if(!user&&!configuredAdmin){
      const pending=randomBytes(24).toString('base64url');
      this.pending.set(sha(pending),{...profile,attempts:0,expires:now()+15*6e4});
      return {pending};
    }
    if(!user){user={id:randomUUID(),discordId,created:new Date().toISOString(),group:null,admin:true};this.data.users.push(user);}
    Object.assign(user,{name:profile.name,avatar:profile.avatar});
    // Admins named in the settings stay admins; others keep what an admin gave them in the app.
    if(configuredAdmin)user.admin=true;
    return this.startSession(user);
  }

  pendingName(token){const p=token&&this.pending.get(sha(token));return p&&p.expires>now()?p.name:null;}

  // Step 3, first time only: the invite key. Five wrong keys end the pending sign-up; ten from one address in
  // a quarter of an hour lock that address out for the rest of it.
  async redeem({pending:token,key},address=''){
    this.prune();
    const p=token&&this.pending.get(sha(token));
    if(!p)throw new Error('The sign-up expired. Sign in with Discord again.');
    const ip=this.failures.get(address);
    if(ip&&ip.count>=10&&ip.first>now()-15*6e4)throw new Error('Too many wrong invite keys. Wait 15 minutes and try again.');
    const found=await this.matchKey(key);
    if(!found){
      p.attempts++;if(p.attempts>=5)this.pending.delete(sha(token));
      const entry=!ip||ip.first<now()-15*6e4?{count:0,first:now()}:ip;entry.count++;this.failures.set(address,entry);
      if(this.failures.size>10000)this.failures.clear();
      throw new Error(p.attempts>=5?'That was the fifth wrong invite key. Sign in with Discord again to retry.':'That invite key is not right.');
    }
    this.pending.delete(sha(token));
    if(this.data.blocked.includes(p.discordId))throw new Error('An admin has removed your access to this SimC Lab.');
    let user=this.data.users.find(u=>u.discordId===p.discordId);
    if(!user){user={id:randomUUID(),discordId:p.discordId,created:new Date().toISOString(),admin:false};this.data.users.push(user);}
    Object.assign(user,{name:p.name,avatar:p.avatar,group:found.label});
    found.uses=(found.uses||0)+1;
    return this.startSession(user);
  }

  async startSession(user){
    const key=randomBytes(32).toString('base64url');
    this.data.sessions[sha(key)]={user:user.id,csrf:randomBytes(24).toString('hex'),expires:now()+sessionDays*864e5};
    user.lastSeen=new Date().toISOString();
    await this.save();
    return {key,user:this.publicUser(user)};
  }
  session(key){
    if(!key)return null;
    const s=this.data.sessions[sha(key)];
    if(!s||s.expires<now())return null;
    const user=this.user(s.user);if(!user)return null;
    if(now()-new Date(user.lastSeen||0).getTime()>36e5){user.lastSeen=new Date().toISOString();void this.save();}
    return {user,csrf:s.csrf};
  }
  async logout(key){if(key){delete this.data.sessions[sha(key)];await this.save();}}

  list(){return this.data.users.map(u=>this.publicUser(u));}
  // Removing someone also blocks their Discord account, or they would be back with the next sign-in.
  async remove(id,by){
    const user=this.user(id);if(!user)throw new Error('No such user.');
    if(user.id===by.id)throw new Error('You cannot remove yourself.');
    if(user.admin&&this.data.users.filter(u=>u.admin).length<2)throw new Error('The last admin cannot be removed.');
    this.data.users=this.data.users.filter(u=>u!==user);
    if(!this.data.blocked.includes(user.discordId))this.data.blocked.push(user.discordId);
    this.prune();await this.save();
    return this.list();
  }
  blockedCount(){return this.data.blocked.length;}
  async unblockAll(){this.data.blocked=[];await this.save();}
  async setAdmin(id,admin,by){
    const user=this.user(id);if(!user)throw new Error('No such user.');
    if(!admin&&user.id===by.id)throw new Error('You cannot remove your own admin rights.');
    if(!admin&&this.discord.admins.includes(user.discordId))throw new Error('That admin is named in SIMC_LAB_DISCORD_ADMINS on the server.');
    user.admin=!!admin;await this.save();return this.list();
  }
}

// Cookies are read by hand: only three matter.
export function cookie(req,name){
  for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}
  return null;
}
