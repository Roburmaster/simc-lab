// On a SimC Lab server: who is signed in, their password, and for admins the accounts and invite links.
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
    $('.sidebar-bottom p').innerHTML='SimulationCraft built on this server.<br>Simulations are shared fairly between accounts.';
    $('.local-note').textContent='Simulations run on the server, one at a time. Item tooltips use Wowhead.';
    if(!me.admin)document.body.classList.add('not-admin');
    $('.sidebar-bottom').insertAdjacentHTML('afterbegin',`<div class="account-row"><span>Signed in as <strong>${esc(me.name)}</strong>${me.admin?' <span class="pill">admin</span>':''}</span><button class="text-button" data-account>Account</button></div>`);
    document.body.insertAdjacentHTML('beforeend',`<dialog id="account-dialog" class="panel account-dialog"><div class="panel-heading"><h2>Account</h2><button class="text-button" data-close>Close</button></div>
      <form id="password-form"><h3>Change password</h3><label>Current password<input type="password" id="pw-old" autocomplete="current-password" required></label><label>New password<input type="password" id="pw-new" autocomplete="new-password" minlength="10" required></label><button class="button small primary">Change password</button><p class="hint" id="pw-result"></p></form>
      <div class="divider"></div><button class="button small secondary" data-logout>Sign out</button>
      ${me.admin?`<div class="divider"></div><h3>Accounts</h3><div id="user-list"></div><div class="engine-actions"><button class="button small primary" data-invite>New invite link</button><button class="button small secondary" data-invite-admin>New admin invite</button></div><div id="invite-result" class="hint"></div><div id="invite-list" class="hint"></div>`:''}</dialog>`);
  }

  async function loadUsers(){
    const {users,invites}=await api('/api/admin/users');
    $('#user-list').innerHTML=`<table class="user-table"><tr><th>Name</th><th>Role</th><th>Last seen</th><th></th></tr>${users.map(u=>`<tr><td>${esc(u.name)}</td><td>${u.admin?'Admin':'Member'}</td><td>${when(u.lastSeen)}</td><td>${u.id===me.id?'<small>You</small>':`<button class="text-button" data-role="${esc(u.id)}" data-make="${u.admin?'':'1'}">${u.admin?'Make member':'Make admin'}</button> <button class="text-button danger-text" data-remove-user="${esc(u.id)}" data-name="${esc(u.name)}">Remove</button>`}</td></tr>`).join('')}</table>`;
    $('#invite-list').textContent=invites.length?`${invites.length} unused invite link${invites.length===1?'':'s'}; the oldest expires ${when(invites.map(i=>i.expires).sort()[0])}.`:'';
  }

  document.addEventListener('click',async event=>{
    const t=event.target;
    try{
      if(t.closest('[data-account]')){$('#account-dialog').showModal();if(me.admin)await loadUsers();}
      else if(t.closest('[data-close]'))$('#account-dialog').close();
      else if(t.closest('[data-logout]')){await api('/api/auth/logout',{});location.href='/login';}
      else if(t.closest('[data-invite],[data-invite-admin]')){
        const invite=await api('/api/admin/invite',{admin:!!t.closest('[data-invite-admin]')});
        $('#invite-result').innerHTML=`Send this link to one person. It works once and expires ${when(invite.expires)}.<br><input class="invite-link" readonly value="${esc(invite.link)}">`;
        const field=$('#invite-result input');field.select();navigator.clipboard?.writeText(invite.link).catch(()=>{});
        await loadUsers();
      }
      else if(t.closest('[data-remove-user]')){const b=t.closest('[data-remove-user]');if(!confirm(`Remove ${b.dataset.name}? Their simulations stay on the server.`))return;await api('/api/admin/remove',{id:b.dataset.removeUser});await loadUsers();}
      else if(t.closest('[data-role]')){const b=t.closest('[data-role]');await api('/api/admin/role',{id:b.dataset.role,admin:!!b.dataset.make});await loadUsers();}
    }catch(e){notice(e.message);}
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='password-form')return;event.preventDefault();
    // A new password starts a new session, and with it a new request token, so the page reloads.
    try{await api('/api/auth/password',{old:$('#pw-old').value,password:$('#pw-new').value});$('#pw-result').textContent='Password changed. Other sessions were signed out.';setTimeout(()=>location.reload(),1200);}
    catch(e){$('#pw-result').textContent=e.message;}
  });
  return {render};
}
