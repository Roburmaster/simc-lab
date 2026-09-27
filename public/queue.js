// The Queue page: every job waiting for the engine, in the order it will run. On a server the next turn goes
// to whoever has waited longest, so the order here is the real one, not creation order. Other members' jobs
// show their display name and mode, never their character.
import {timeLeft,duration} from '/activity.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={quick:'Quick Sim',enchants:'Enchant Lab',compare:'Gear Compare',upgrades:'Upgrade Finder',crests:'Crest Planner',weapons:'Weapon Lab',talents:'Talent Search'};

export function queueUI({api,notice,openJob}){
  let limits=null,timer=null,visible=false,server=false;
  function render(status){server=!!status.app?.server;limits=status.app?.queue||null;}

  async function refresh(){
    clearTimeout(timer);if(!visible)return;
    let active=[];try{active=await api('/api/jobs/active');}catch(e){notice(e.message);}
    const mine=active.filter(j=>j.id).length;
    const rule=server&&limits?`<p class="hint">One simulation runs at a time. When it finishes, the next turn goes to the member who has waited longest, so one person’s long queue never holds everyone else up. You can have ${limits.perUser} job${limits.perUser===1?'':'s'} waiting at once${mine?` (you have ${mine})`:''}; the server takes ${limits.total} in total.</p>`:'<p class="hint">One simulation runs at a time, in the order shown.</p>';
    $('#queue-list').innerHTML=rule+(active.length?`<ol class="queue-list">${active.map(j=>{
      const own=!!j.id,running=j.status==='running';
      const left=running?timeLeft(j,j.fraction):null;
      const who=server?`<span class="queue-by">${esc(j.by||'')}</span>`:'';
      return `<li class="queue-row${own?' own':''}${running?' running':''}"><span class="queue-pos">${running?'▶':j.position}</span>
        <span class="queue-main"><strong>${esc(names[j.mode]||j.mode)}${own&&j.name?` · ${esc(j.name)}`:''}</strong>${who}
        <small>${running?`Running · step ${Math.min(j.done+1,j.total)} of ${j.total} · ${Math.round(100*(j.fraction||0))}%${left!==null?` · about ${duration(left)} left`:''}`:`Waiting · ${j.total} step${j.total===1?'':'s'}`}</small>
        ${running?`<span class="history-track"><span style="width:${Math.round(100*(j.fraction||0))}%"></span></span>`:''}</span>
        ${own?`<span class="queue-actions"><button class="text-button" data-queue-open="${esc(j.id)}">Open</button><button class="text-button danger-text" data-queue-cancel="${esc(j.id)}">Cancel</button></span>`:''}</li>`;}).join('')}</ol>`:'<p class="empty-small">The queue is empty. A new simulation starts right away.</p>');
    timer=setTimeout(refresh,2000);
  }

  $('#queue-list').addEventListener('click',async event=>{
    const open=event.target.closest('[data-queue-open]'),cancel=event.target.closest('[data-queue-cancel]');
    try{
      if(open)await openJob(open.dataset.queueOpen);
      if(cancel&&confirm('Cancel this simulation?')){await api(`/api/jobs/${cancel.dataset.queueCancel}/cancel`,{});await refresh();}
    }catch(e){notice(e.message);}
  });
  return {render,show(on){visible=on;if(on)refresh();else clearTimeout(timer);}};
}
