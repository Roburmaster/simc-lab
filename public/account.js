// On a SimC Lab server: who is signed in (with Discord), signing out, and for admins the list of accounts.
// On the desktop app this does nothing.
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=iso=>iso?new Date(iso).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}):'—';

export function accountUI({api,notice}){
  let me=null;
  function render(status){
    if(!status.app?.server||!status.user)return;
    me=status.user;
    // The game runs on each player's PC, so the addon page belongs to the desktop app.
    document.querySelector('.nav[data-mode="wow"]')?.remove();
    $('.local-label').textContent='SERVER ENGINE';
    $('.sidebar-bottom p').innerHTML='SimulationCraft built on this server.<br>Simulations take turns in a shared queue.';
    $('.local-note').textContent='Simulations run on the server, one at a time, in turns between members. Item tooltips use Wowhead.';
    if(!me.admin)document.body.classList.add('not-admin');
    $('.sidebar-bottom').insertAdjacentHTML('afterbegin',`<div class="account-row"><span class="account-name">${me.avatar?`<img class="avatar" src="${esc(me.avatar)}" alt="">`:''}<span><strong>${esc(me.name)}</strong>${me.admin?' <span class="pill">admin</span>':''}</span></span><button class="text-button" data-account>Account</button></div>`);
    document.body.insertAdjacentHTML('beforeend',`<dialog id="account-dialog" class="panel account-dialog"><div class="panel-heading"><h2>Account</h2><button class="text-button" data-close>Close</button></div>
      <p class="hint">Signed in with Discord as <strong>${esc(me.name)}</strong>. Your simulations are visible to you and to the admins only.</p>
      <button class="button small secondary" data-logout>Sign out</button>
      ${me.admin?`<div class="divider"></div><h3>Members</h3><p class="hint">New members sign in with Discord and enter an invite key once; the key decides their group. Removing someone also blocks their Discord account here.</p><div id="user-list"></div><div id="blocked-note" class="hint"></div>
      <div class="divider"></div><h3>Invite keys</h3><p class="hint">Only a hash of each key is stored, so a key cannot be shown again once added.</p><div id="key-list"></div>
      <form id="key-form" class="two-col key-form"><label>New key<input id="key-value" autocomplete="off" minlength="4" required></label><label>Group<input id="key-label" maxlength="40" placeholder="From the key"></label><button class="button small primary">Add key</button></form>`:''}</dialog>`);
  }

  async function loadUsers(){
    const {users,blocked}=await api('/api/admin/users');
    $('#user-list').innerHTML=`<table class="user-table"><tr><th>Name</th><th>Group</th><th>Role</th><th>Last seen</th><th></th></tr>${users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.group||'—')}</td><td>${u.admin?'Admin':'Member'}</td><td>${when(u.lastSeen)}</td><td>${u.id===me.id?'<small>You</small>':`<button class="text-button" data-role="${esc(u.id)}" data-make="${u.admin?'':'1'}">${u.admin?'Make member':'Make admin'}</button> <button class="text-button danger-text" data-remove-user="${esc(u.id)}" data-name="${esc(u.name)}">Remove</button>`}</td></tr>`).join('')}</table>`;
    const {keys}=await api('/api/admin/keys');
    $('#key-list').innerHTML=keys.length?`<table class="user-table"><tr><th>Group</th><th>Members joined</th><th>Added</th><th></th></tr>${keys.map(k=>`<tr><td>${esc(k.label)}</td><td>${k.uses}</td><td>${when(k.created)}</td><td><button class="text-button danger-text" data-remove-key="${esc(k.id)}" data-label="${esc(k.label)}">Remove</button></td></tr>`).join('')}</table>`:'<p class="hint">No invite keys yet, so nobody new can join.</p>';
    $('#blocked-note').innerHTML=blocked?`${blocked} removed Discord account${blocked===1?' is':'s are'} blocked. <button class="text-button" data-unblock>Let them sign in again</button>`:'';
  }

  document.addEventListener('click',async event=>{
    const t=event.target;
    try{
      if(t.closest('[data-account]')){$('#account-dialog').showModal();if(me.admin)await loadUsers();}
      else if(t.closest('[data-close]'))$('#account-dialog').close();
      else if(t.closest('[data-logout]')){await api('/api/auth/logout',{});location.href='/login';}
      else if(t.closest('[data-remove-key]')){const b=t.closest('[data-remove-key]');if(!confirm(`Remove the ${b.dataset.label} invite key? Members who joined with it stay.`))return;await api('/api/admin/keys/remove',{id:b.dataset.removeKey});await loadUsers();}
      else if(t.closest('[data-unblock]')){await api('/api/admin/unblock',{});await loadUsers();}
      else if(t.closest('[data-remove-user]')){const b=t.closest('[data-remove-user]');if(!confirm(`Remove ${b.dataset.name}? Their Discord account is blocked from signing in; their simulations stay on the server.`))return;await api('/api/admin/remove',{id:b.dataset.removeUser});await loadUsers();}
      else if(t.closest('[data-role]')){const b=t.closest('[data-role]');await api('/api/admin/role',{id:b.dataset.role,admin:!!b.dataset.make});await loadUsers();}
    }catch(e){notice(e.message);}
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='key-form')return;event.preventDefault();
    try{await api('/api/admin/keys',{key:$('#key-value').value,label:$('#key-label').value});event.target.reset();await loadUsers();}catch(e){notice(e.message);}
  });
  return {render};
}
