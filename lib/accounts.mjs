// Server mode: accounts for a small group (friends, a guild) sharing one SimC Lab. There is no sign-up form.
// An admin hands out invite links, each good for one account; the first admin invite is printed on the first start.
// Passwords are scrypt hashes, sessions are random cookies stored as SHA-256, and everything lives in one JSON file.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,scrypt as scryptCb,createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {home} from './paths.mjs';

const scrypt=promisify(scryptCb);
export const accountsFile=path.join(home,'server','accounts.json');
const sessionDays=30,inviteDays=7;
const sha=text=>createHash('sha256').update(text).digest('hex');
const now=()=>Date.now();

export const nameRule=/^[\p{L}\p{N}_.-]{2,24}$/u;
export function checkName(name){
  name=String(name??'').trim();
  if(!nameRule.test(name))throw new Error('Names are 2–24 letters, digits, dots, dashes or underscores.');
  return name;
}
export function checkPassword(password){
  password=String(password??'');
  if(password.length<10)throw new Error('Passwords need at least 10 characters.');
  if(password.length>200)throw new Error('That password is too long.');
  return password;
}

async function hash(password,salt=randomBytes(16).toString('hex')){
  const key=await scrypt(password,salt,64,{N:16384,r:8,p:1});
  return {salt,hash:key.toString('hex')};
}
async function verify(password,user){
  const {hash:h}=await hash(password,user.salt);
  return timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(user.hash,'hex'));
}

export class Accounts{
  constructor(file=accountsFile){this.file=file;this.data={users:[],invites:[],sessions:{}};this.failures=new Map();this.writes=Promise.resolve();}

  async init(){
    try{this.data={users:[],invites:[],sessions:{},...JSON.parse(await fs.readFile(this.file,'utf8'))};}
    catch(e){if(e.code!=='ENOENT')throw e;}
    this.prune();
    return this;
  }
  save(){
    const text=JSON.stringify(this.data,null,2);
    this.writes=this.writes.catch(()=>{}).then(async()=>{
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      await fs.writeFile(this.file+'.tmp',text,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);
    });
    return this.writes;
  }
  prune(){
    const t=now();
    for(const [key,s] of Object.entries(this.data.sessions))if(s.expires<t||!this.user(s.user))delete this.data.sessions[key];
    this.data.invites=this.data.invites.filter(i=>i.expires>t);
  }

  user(id){return this.data.users.find(u=>u.id===id)||null;}
  publicUser(u){return u&&{id:u.id,name:u.name,admin:!!u.admin,created:u.created,lastSeen:u.lastSeen||null};}
  get empty(){return !this.data.users.length;}

  // An invite is shown once; only its hash is kept.
  async invite({admin=false,by=null}={}){
    const code=randomBytes(18).toString('base64url');
    this.data.invites.push({hash:sha(code),admin:!!admin,by,created:new Date().toISOString(),expires:now()+inviteDays*864e5});
    await this.save();
    return {code,admin:!!admin,expires:new Date(now()+inviteDays*864e5).toISOString()};
  }
  // With no accounts at all there is no admin to invite one, so the server prints a fresh admin invite at start.
  async bootstrap(){
    if(!this.empty)return null;
    this.data.invites=this.data.invites.filter(i=>!i.bootstrap);
    const invite=await this.invite({admin:true});
    this.data.invites.at(-1).bootstrap=true;await this.save();
    return invite;
  }

  async register({invite,name,password}){
    this.prune();
    const found=this.data.invites.find(i=>i.hash===sha(String(invite||'')));
    if(!found)throw new Error('That invite link is used or has expired. Ask for a new one.');
    name=checkName(name);password=checkPassword(password);
    if(this.data.users.some(u=>u.name.toLowerCase()===name.toLowerCase()))throw new Error('That name is taken.');
    const user={id:randomUUID(),name,admin:found.admin||this.empty,created:new Date().toISOString(),...await hash(password)};
    this.data.users.push(user);this.data.invites=this.data.invites.filter(i=>i!==found);
    return this.startSession(user);
  }

  // Ten wrong passwords for a name or an address lock it for 15 minutes.
  limited(keys){
    const t=now();
    for(const key of keys){const f=this.failures.get(key);if(f&&f.until>t)throw new Error('Too many attempts. Wait 15 minutes and try again.');}
  }
  failed(keys){
    const t=now();
    for(const key of keys){
      const f=this.failures.get(key);const entry=!f||f.first<t-15*6e4?{count:0,first:t,until:0}:f;
      entry.count++;if(entry.count>=10)entry.until=t+15*6e4;this.failures.set(key,entry);
    }
    if(this.failures.size>10000)this.failures.clear();
  }

  async login({name,password},address=''){
    const keys=[`name:${String(name||'').toLowerCase()}`,`ip:${address}`];
    this.limited(keys);
    const user=this.data.users.find(u=>u.name.toLowerCase()===String(name||'').trim().toLowerCase());
    // A missing user still costs one hash, so a wrong name and a wrong password take the same time.
    const ok=user?await verify(String(password||''),user):(await hash(String(password||'')),false);
    if(!ok){this.failed(keys);throw new Error('Wrong name or password.');}
    for(const key of keys)this.failures.delete(key);
    return this.startSession(user);
  }

  async startSession(user){
    const key=randomBytes(32).toString('base64url');
    this.data.sessions[sha(key)]={user:user.id,csrf:randomBytes(24).toString('hex'),expires:now()+sessionDays*864e5};
    user.lastSeen=new Date().toISOString();
    await this.save();
    return {key,user:this.publicUser(user)};
  }
  // The session behind a cookie, extended while it is used.
  session(key){
    if(!key)return null;
    const s=this.data.sessions[sha(key)];
    if(!s||s.expires<now())return null;
    const user=this.user(s.user);if(!user)return null;
    if(s.expires-now()<(sessionDays-1)*864e5){s.expires=now()+sessionDays*864e5;user.lastSeen=new Date().toISOString();void this.save();}
    return {user,csrf:s.csrf};
  }
  async logout(key){if(key){delete this.data.sessions[sha(key)];await this.save();}}

  async changePassword(user,{old,password}){
    if(!await verify(String(old||''),user))throw new Error('The current password is wrong.');
    Object.assign(user,await hash(checkPassword(password)));
    for(const [k,s] of Object.entries(this.data.sessions))if(s.user===user.id)delete this.data.sessions[k];
    return this.startSession(user);
  }

  list(){return this.data.users.map(u=>this.publicUser(u));}
  pendingInvites(){this.prune();return this.data.invites.filter(i=>!i.bootstrap).map(i=>({admin:i.admin,created:i.created,expires:new Date(i.expires).toISOString()}));}
  async remove(id,by){
    const user=this.user(id);if(!user)throw new Error('No such user.');
    if(user.id===by.id)throw new Error('You cannot remove yourself.');
    if(user.admin&&this.data.users.filter(u=>u.admin).length<2)throw new Error('The last admin cannot be removed.');
    this.data.users=this.data.users.filter(u=>u!==user);
    this.prune();await this.save();
    return this.list();
  }
  async setAdmin(id,admin,by){
    const user=this.user(id);if(!user)throw new Error('No such user.');
    if(!admin&&user.id===by.id)throw new Error('You cannot remove your own admin rights.');
    user.admin=!!admin;await this.save();return this.list();
  }
}

// Cookies are read by hand: only the session cookie matters.
export function cookie(req,name){
  for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}
  return null;
}
