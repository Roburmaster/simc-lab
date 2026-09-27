// Sign-in page of a SimC Lab server: the Discord button, why the last sign-in failed, and the invite key that
// someone new enters after Discord has said who they are.
const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search);
const error=params.get('error');
if(error){$('#login-error').hidden=false;$('#login-error').textContent=error;history.replaceState(null,'','/login');}

if(params.has('invite')){
  const {name}=await fetch('/api/auth/pending').then(r=>r.json()).catch(()=>({name:null}));
  if(name){
    $('#login-start').hidden=true;$('#invite-form').hidden=false;
    $('#invite-help').textContent=`Welcome, ${name}! Enter the invite key you were given to join. You only need it once.`;
    $('#invite-key').focus();
  }else history.replaceState(null,'','/login');
}
$('#invite-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#invite-error').hidden=true;$('#invite-submit').disabled=true;
  try{
    const res=await fetch('/api/auth/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:$('#invite-key').value})});
    const result=await res.json();if(!res.ok)throw new Error(result.error||'That did not work.');
    location.href='/';
  }catch(e){$('#invite-error').hidden=false;$('#invite-error').textContent=e.message;if(/expired|Sign in with Discord again/.test(e.message))setTimeout(()=>location.href='/login',2500);}
  finally{$('#invite-submit').disabled=false;}
});
