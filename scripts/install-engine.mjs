// Installs or updates SimC and game data from the command line, exactly as the Update SimC button does:
// node scripts/install-engine.mjs [auto|nightly|source|data]
import {Updater} from '../lib/updater.mjs';
const updater=new Updater({busy:()=>false,onInstalled:async()=>{}});
updater.start(process.argv[2]||'auto');
let shown=0;
while(updater.state.status==='running'){await new Promise(r=>setTimeout(r,1000));for(;shown<updater.state.log.length;shown++)console.log(updater.state.log[shown]);}
for(;shown<updater.state.log.length;shown++)console.log(updater.state.log[shown]);
if(updater.state.status!=='complete'){console.error(updater.state.error);process.exit(1);}
