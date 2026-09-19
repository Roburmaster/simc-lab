// What the engine is doing right now: a bar in the header on every page, and the shared wording for a job's
// progress. Jobs run one at a time; everything else waits in the queue.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={quick:'Quick Sim',enchants:'Enchant Lab',compare:'Gear Compare',upgrades:'Upgrade Finder',talents:'Talent Search'};

export function duration(seconds){
  if(!Number.isFinite(seconds)||seconds<0)return '';
  if(seconds<60)return `${Math.max(1,Math.round(seconds))} s`;
  const m=Math.floor(seconds/60),s=Math.round(seconds%60);
  return m<60?`${m} min${s&&m<10?` ${s} s`:''}`:`${Math.floor(m/60)} h ${m%60} min`;
}

// Time left from the time spent so far; only shown once enough is done for the estimate to mean something.
export function timeLeft(job,fraction){
  if(!job.started||!(fraction>0.03)||fraction>=1)return null;
  const elapsed=(Date.now()-new Date(job.started).getTime())/1000;
  return elapsed*(1-fraction)/fraction;
}

export function describeProgress(job){
  const fraction=job.fraction??0,p=job.progress;
  const lines=[];
  if(job.status==='running'){
    lines.push(`Step ${Math.min(job.done+1,job.total)} of ${job.total}${job.current?` · ${esc(job.current.name??job.current)}`:''}`);
    // With a target error SimC stops early, so the iteration count only means something while it is climbing.
    const iterations=p&&p.iteration<p.iterations?` · iteration ${p.iteration.toLocaleString('en-US')} of ${p.iterations.toLocaleString('en-US')}`:'';
    if(p?.phase==='profileset')lines.push(`Candidate ${p.set-1} of ${p.sets-1}${iterations}`);
    else if(p)lines.push(`${p.set===1&&p.sets>1?'Current gear':'Simulating'}${iterations}`);
    else lines.push('Starting SimulationCraft …');
    const left=timeLeft(job,fraction);
    lines.push(`${Math.round(100*fraction)}% done${left!==null?` · about ${duration(left)} left`:''}`);
  }
  return {fraction,lines};
}

export function activityUI({api,openJob,onChange}){
  document.querySelector('#engine-badge').insertAdjacentHTML('beforebegin','<button class="activity" id="activity" hidden></button>');
  const bar=document.querySelector('#activity');let timer=null,first=null,last='';
  async function refresh(){
    clearTimeout(timer);
    let active=[];try{active=await api('/api/jobs/active');}catch{}
    const running=active.find(j=>j.status==='running'),queued=active.filter(j=>j.status==='queued').length;
    bar.hidden=!active.length;
    if(active.length){
      first=(running||active[0]).id;
      const job=running||active[0];const left=running?timeLeft(running,running.fraction):null;
      bar.innerHTML=`<span class="activity-dot ${running?'on':''}"></span><span class="activity-text"><strong>${running?'Simulating':'Waiting'}</strong> ${esc(names[job.mode]||job.mode)} · ${esc(job.name)}${running?` · ${Math.round(100*running.fraction)}%${left!==null?` · ${duration(left)} left`:''}`:''}${queued?` <em>+${queued} queued</em>`:''}</span><span class="activity-track"><span style="width:${Math.round(100*(running?.fraction||0))}%"></span></span>`;
      bar.title=running?.current?`Now: ${running.current}`:'Open the running job';
    }
    // Tell the page when the set of waiting and running jobs changes, so lists can redraw.
    const signature=active.map(j=>`${j.id}:${j.status}:${Math.round(100*j.fraction)}`).join(',');
    if(signature!==last){last=signature;onChange?.(active);}
    timer=setTimeout(refresh,active.length?1500:5000);
  }
  bar.addEventListener('click',()=>{if(first)openJob(first);});
  refresh();
  return {refresh};
}
