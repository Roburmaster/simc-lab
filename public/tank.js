const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields=[['pressure','Sustained damage (% health / sec)',0.5,20,0.5],['buster','Starting tank-buster (% health)',0,150,5],['magic','Magic share (%)',0,100,5],['healGap','Healer top-up every (sec)',1,30,1],['deathTarget','Current gear dies in (% of fights)',5,60,5]];
export const signed=(n,digits=2)=>`${n>=0?'+':''}${n.toFixed(digits)}`;

export function tankUI({updateCount}){
  let presets=null,active=false;
  $('#results').insertAdjacentHTML('beforebegin',`<section class="panel" id="tank-panel" hidden><div class="panel-heading"><h2>Tank survival</h2><span class="pill">Tank specialization</span></div><p class="panel-intro">Tanks are ranked on DPS and survival. A boss is calibrated to your imported gear once per job, then every build fights the same boss.</p><div id="tank-content"></div></section>`);
  function render(){
    $('#tank-content').innerHTML=`<div class="two-col"><label>Boss<select id="tank-preset">${Object.entries(presets).map(([key,p])=>`<option value="${key}" ${key==='mythic'?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>Ranking weight<input id="tank-weight" type="range" min="0" max="100" step="5" value="50"><span class="hint" id="tank-weight-label"></span></label></div>
      <details class="environment-detail"><summary>Boss details</summary><div class="tank-fields">${fields.map(([key,label,min,max,step])=>`<label>${label}<input type="number" data-tank="${key}" min="${min}" max="${max}" step="${step}"></label>`).join('')}</div><p class="hint">The sustained damage and tank-buster sizes are measured after your mitigation. The buster is then resized until your current gear dies in the chosen share of fights, so better gear can survive more often and worse gear less often. Healers top you up to full health on a fixed rhythm; SimC does not time your defensives to the tank-busters.</p></details>
      <p class="result-note">Survival adds two measures, in percent: net damage taken (damage taken minus your own healing) relative to the boss's damage, and the change in how much of the fight you survive. Score = weight × survival + (1 − weight) × DPS change.</p>`;
    fill();
    $('#tank-preset').onchange=()=>{fill();updateCount();};
    $('#tank-weight').oninput=label;
    label();
  }
  function fill(){const p=presets[$('#tank-preset').value];for(const [key] of fields)$(`[data-tank="${key}"]`).value=p[key];}
  function label(){const w=Number($('#tank-weight').value);$('#tank-weight-label').textContent=`${w}% survival · ${100-w}% DPS`;}
  return {
    init(options){presets=options.tankPresets;render();},
    show(profile){active=!!profile?.isTank;$('#tank-panel').hidden=!active;},
    settings(){
      if(!active||!presets)return undefined;
      const result={preset:$('#tank-preset').value,weight:Number($('#tank-weight').value)};
      for(const [key] of fields){const value=$(`[data-tank="${key}"]`).value;if(value!=='')result[key]=Number(value);}
      return result;
    },
    summary(job){
      const t=job.settings?.tank;if(!t)return '';
      const m=t.boss?.measured;
      return `<details class="environment-detail" open><summary>Tank boss · ${esc(presets?.[t.preset]?.name||t.preset)} · ${t.weight}% survival weight</summary><p class="hint">${m?`Calibrated to ${Math.round(t.boss.health).toLocaleString('en-US')} health: ${m.sustained.toFixed(1)}% health per second sustained, tank-busters of ${m.buster.toFixed(0)}% every 30 seconds, healer top-up every ${t.boss.healGap} seconds. Current gear died in ${m.deaths.toFixed(0)}% of calibration fights (target ${m.deathTarget}%).${m.reached?'':' The target was not reached, so survival differences may be muted.'}`:'The boss is calibrated before the first simulation.'}</p></details>`;
    }
  };
}
