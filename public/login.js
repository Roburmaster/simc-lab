// Sign-in page of a SimC Lab server. An invite link (/login#invite=…) turns it into the form that makes an account.
const $=s=>document.querySelector(s);
const invite=new URLSearchParams(location.hash.slice(1)).get('invite');
if(invite){
  $('#login-title').textContent='Create your account';
  $('#login-help').textContent='Choose a name and a password of at least 10 characters. The invite link works once.';
  $('#login-password').autocomplete='new-password';$('#login-password').minLength=10;
  $('#login-confirm-row').hidden=false;$('#login-confirm').required=true;
  $('#login-submit').firstChild.textContent='Create account ';
}
function fail(message){$('#login-error').hidden=false;$('#login-error').textContent=message;}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#login-error').hidden=true;
  const name=$('#login-name').value.trim(),password=$('#login-password').value;
  if(invite&&password!==$('#login-confirm').value)return fail('The passwords differ.');
  $('#login-submit').disabled=true;
  try{
    const res=await fetch(invite?'/api/auth/register':'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invite?{invite,name,password}:{name,password})});
    const result=await res.json();if(!res.ok)throw new Error(result.error||'Signing in failed.');
    // The invite is spent; drop it from the address before leaving.
    history.replaceState(null,'','/login');location.href='/';
  }catch(e){fail(e.message);}
  finally{$('#login-submit').disabled=false;}
});
