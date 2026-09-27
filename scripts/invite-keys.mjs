// Invite keys of a SimC Lab server, from the command line (admins can also manage them under Account):
//   node scripts/invite-keys.mjs list
//   node scripts/invite-keys.mjs add [--label Group]      (reads the key from standard input, so it stays out of
//                                                          the shell history: echo kaken | node ... add)
//   node scripts/invite-keys.mjs remove <id>
// Stop the server first: it keeps the store in memory and would overwrite the change with its next save.
// SIMC_LAB_HOME and SIMC_LAB_DATA_KEY must be the server's, or the encrypted store cannot be opened.
import {Accounts} from '../lib/accounts.mjs';

const [command,...rest]=process.argv.slice(2);
const option=name=>{const i=rest.indexOf(name);return i>=0?rest[i+1]:undefined;};
const accounts=await new Accounts({}).init();
const show=keys=>{for(const k of keys)console.log(`${k.id}  ${k.label}  (${k.uses} joined, added ${k.created.slice(0,10)})`);if(!keys.length)console.log('No invite keys.');};

if(command==='list')show(accounts.keys());
else if(command==='add'){
  let key='';for await(const chunk of process.stdin)key+=chunk;
  key=key.split(/\r?\n/)[0];
  if(!key.trim())throw new Error('Give the key on standard input: echo mykey | node scripts/invite-keys.mjs add');
  show(await accounts.addKey(key,option('--label')));
}
else if(command==='remove'&&rest[0])show(await accounts.removeKey(rest[0]));
else{console.error('Usage: node scripts/invite-keys.mjs list | add [--label Group] | remove <id>');process.exitCode=1;}
