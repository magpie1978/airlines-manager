/* One session owner for same-origin embedded tools. */
(()=>{'use strict';
const URL='https://eukgodthgusongsbhdwg.supabase.co';
const KEY='sb_publishable_pBMWDgyFgIUGetg6NwkKkA_rMa1--kc';
const STORE='am_shared_auth_v1';
let session=null,refreshing=null;
try{session=JSON.parse(localStorage.getItem(STORE)||'null')}catch{}
const $=id=>document.getElementById(id);
function render(){const logged=!!session?.access_token;$('shared-auth-status').textContent=logged?`Signed in as ${session.user?.email||'Supabase user'}`:'Not signed in';$('shared-login').hidden=logged;$('shared-logout').hidden=!logged;}
function store(data){if(!data.access_token||!data.refresh_token)throw Error('Incomplete authentication response');session={...data,expires_at:Date.now()+Math.max(0,Number(data.expires_in||3600)-60)*1000};localStorage.setItem(STORE,JSON.stringify(session));render();}
async function request(grant,body){const r=await fetch(`${URL}/auth/v1/token?grant_type=${grant}`,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error_description||d.msg||d.message||`Authentication HTTP ${r.status}`);return d;}
async function token(){if(!session)throw Error('Sign in using the Airlines Manager header.');if(Date.now()<session.expires_at)return session.access_token;if(!refreshing)refreshing=request('refresh_token',{refresh_token:session.refresh_token}).then(d=>{store(d);return session.access_token}).catch(e=>{signOut();throw e}).finally(()=>{refreshing=null});return refreshing;}
function signOut(){session=null;localStorage.removeItem(STORE);render();for(const f of document.querySelectorAll('iframe')){try{f.contentWindow?.location.reload()}catch{}}}
$('shared-login').onclick=async()=>{const email=$('shared-email').value.trim(),password=$('shared-password').value;if(!email||!password){$('shared-auth-error').textContent='Enter your email and password.';return} $('shared-login').disabled=true;$('shared-auth-error').textContent='';try{store(await request('password',{email,password}));$('shared-password').value='';for(const f of document.querySelectorAll('iframe')){if(f.src)f.contentWindow?.location.reload()}}catch(e){$('shared-auth-error').textContent=e.message}finally{$('shared-login').disabled=false}};
$('shared-logout').onclick=signOut;
$('shared-password').addEventListener('keydown',e=>{if(e.key==='Enter')$('shared-login').click()});
window.amSharedAuth={token,isSignedIn:()=>!!session?.access_token,signOut};render();
})();