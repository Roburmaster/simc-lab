// Import from the Armory: region, realm and name, or a character link pasted into any of the fields.
// The result lands in the character field like an addon export, marked so it is never sent to the WoW addon.
const $=s=>document.querySelector(s);
const read=key=>{try{return localStorage.getItem(key)||'';}catch{return '';}};
const store=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};

export function armoryUI({api,notice,importText}){
  const anchor=$('#wow-characters')||$('#character');
  anchor.insertAdjacentHTML(anchor.id==='character'?'beforebegin':'afterend',`<details id="armory" class="armory-import"><summary>Import from the Armory</summary>
<div class="armory-row"><label>Region<select id="armory-region"><option value="eu">EU</option><option value="us">US</option><option value="kr">KR</option><option value="tw">TW</option></select></label><label>Realm<input id="armory-realm" placeholder="Ravencrest" autocomplete="off" spellcheck="false"></label><label>Character<input id="armory-name" placeholder="Name or character link" autocomplete="off" spellcheck="false"></label><button id="armory-import" class="button secondary">Import</button></div>
<p id="armory-hint" class="hint">SimC downloads the character from Blizzard's Armory. It shows the gear from the last logout, without bags, vault or crests. Armory characters are not sent to the WoW addon.</p></details>`);
  $('#armory-region').value=read('simc-lab-armory-region')||'eu';$('#armory-realm').value=read('simc-lab-armory-realm');

  async function run(){
    notice('');const button=$('#armory-import');
    const fields={region:$('#armory-region').value,realm:$('#armory-realm').value.trim(),name:$('#armory-name').value.trim()};
    // A worldofwarcraft.com, Raider.IO or Warcraft Logs link carries all three, whichever field it was pasted in.
    const url=[fields.name,fields.realm].find(v=>/^https?:\/\//i.test(v));
    button.disabled=true;$('#armory-hint').textContent='Downloading from the Armory …';
    try{
      const r=await api('/api/armory',url?{url}:fields);
      $('#armory-region').value=r.region;$('#armory-realm').value=r.realm;$('#armory-name').value=r.character;
      store('simc-lab-armory-region',r.region);store('simc-lab-armory-realm',r.realm);
      await importText(r.profile);
      $('#armory-hint').textContent=`Imported ${r.character} of ${r.realm} (${r.region.toUpperCase()}) from the Armory. Not sent to the WoW addon.`;
    }catch(e){notice(e.message);$('#armory-hint').textContent='The import did not finish.';}
    finally{button.disabled=false;}
  }
  $('#armory-import').addEventListener('click',run);
  for(const id of ['#armory-realm','#armory-name'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter')run();});
}
