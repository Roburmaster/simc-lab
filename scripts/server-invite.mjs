// Makes an invite link for a SimC Lab server from the command line: node scripts/server-invite.mjs [--admin]
// For when no admin can sign in any more. Stop the server first: it keeps the accounts in memory and would
// overwrite the invite with its next save.
import {Accounts} from '../lib/accounts.mjs';

const accounts=await new Accounts().init();
const invite=await accounts.invite({admin:process.argv.includes('--admin')});
const base=process.env.SIMC_LAB_PUBLIC_URL?new URL(process.env.SIMC_LAB_PUBLIC_URL).origin:'http://127.0.0.1:'+(process.env.PORT||8642);
console.log(`${invite.admin?'Admin invite':'Invite'} (works once, expires ${invite.expires}):\n  ${base}/login#invite=${invite.code}`);
