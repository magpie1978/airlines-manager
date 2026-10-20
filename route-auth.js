/* Route Importer v0.3.1: Supabase Auth password grant; session stays in memory. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let session=null,refreshInFlight=null;
function settings(){
 const endpoint=$('endpoint').value.trim(), key=$('api-key').value.trim();
 const match=endpoint.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/functions\/v1\/[\w-]+\/?$/i);
 if(!match)throw Error('Enter a valid Edge Function URL first.');
 if(!key)throw Error('Enter your Supabase publishable / anon key first.');
 return {origin:`https://${match[1]}.supabase.co`,key};
}
async function authCall(path,body){
 const {origin,key}=settings();
 const response=await fetch(`${origin}/auth/v1/${path}`,{
  method:'POST',headers:{apikey:key,'Content-Type':'application/json'},
  body:JSON.stringify(body),cache:'no-store'
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.msg||data.error_description||data.message||data.error||`Auth HTTP ${response.status}`);
 return data;
}
function status(){
 const valid=Boolean(session?.access_token);
 $('auth-status').textContent=valid?`Signed in as ${session.user?.email||'Supabase Auth user'}`:'Not signed in';
 $('auth-logout').disabled=!valid;
 $('auth-login').disabled=valid;
}
function save(data){
 if(!data.access_token||!data.refresh_token)throw Error('Supabase did not return a complete user session.');
 session={...data,expires_at:Date.now()+Math.max(0,(Number(data.expires_in)||3600)-60)*1000};
 status();
 window.dispatchEvent(new CustomEvent('route-importer-auth-changed',{detail:{signedIn:true}}));
}
async function login(){
 try{
  const email=$('auth-email').value.trim(),password=$('auth-password').value;
  if(!email||!password)throw Error('Enter your Supabase Auth email and password.');
  $('auth-login').disabled=true;
  const data=await authCall('token?grant_type=password',{email,password});
  save(data);$('auth-password').value='';
  $('scan-log').textContent='Signed in to Supabase Auth. You may now check an existing scan ID with Refresh status.';
 }catch(e){$('scan-log').textContent='Sign-in failed: '+e.message;}
 finally{status();}
}
async function token(){
 if(window.parent!==window && window.parent.amSharedAuth)return window.parent.amSharedAuth.token();
 if(!session)throw Error('Sign in to Supabase Auth before using scanner controls.');
 if(Date.now()<session.expires_at)return session.access_token;
 if(!refreshInFlight)refreshInFlight=authCall('token?grant_type=refresh_token',{refresh_token:session.refresh_token})
   .then(data=>{save(data);return session.access_token;})
   .catch(e=>{session=null;status();throw Error('Session expired. Sign in again: '+e.message)})
   .finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}
$('auth-login').addEventListener('click',login);
$('auth-password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('auth-logout').addEventListener('click',()=>{
 const refresh=session?.refresh_token;session=null;status();
 $('scan-log').textContent='Signed out. Local session cleared.';
 window.dispatchEvent(new CustomEvent('route-importer-auth-changed',{detail:{signedIn:false}}));
 // No persistent session; token is not retained after logout.
});
window.routeImporterAuth={token, isSignedIn:()=>Boolean(session?.access_token)||(window.parent!==window && Boolean(window.parent.amSharedAuth?.isSignedIn()))};
window.dispatchEvent(new CustomEvent('route-importer-auth-changed',{detail:{signedIn:Boolean(session?.access_token)}}));
status();
})();
