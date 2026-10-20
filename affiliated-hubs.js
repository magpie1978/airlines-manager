/* Affiliated Hub Manager v1.2 — uses Route Importer's in-memory session. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let busy=false, loading=false;
const message=t=>{$('aff-message').textContent=t};
function credentials(){
 const endpoint=$('endpoint')?.value.trim();
 const key=$('api-key')?.value.trim();
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/[\w-]+\/?$/i.test(endpoint||''))throw Error('Set the scanner Edge Function URL above.');
 if(!key)throw Error('Set the Supabase publishable key above.');
 if(!window.routeImporterAuth?.token)throw Error('Route Importer authentication is not available.');
 return {endpoint,key};
}
function signedIn(){return !!window.routeImporterAuth?.isSignedIn?.();}
function controls(){
 const allowed=signedIn()&&!busy;
 $('aff-refresh').disabled=!allowed;
 $('aff-add').disabled=!allowed;
 // Old separate login is intentionally disabled and hidden.
 $('aff-signin').disabled=true;
 $('aff-signout').disabled=true;
}
async function call(action,payload){
 const {endpoint,key}=credentials();
 const token=await window.routeImporterAuth.token();
 const url=new URL(endpoint);
 url.searchParams.set('action',action);
 const response=await fetch(url,{
   method:payload?'POST':'GET',cache:'no-store',
   headers:{apikey:key,Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},
   ...(payload?{body:JSON.stringify(payload)}:{})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok||data.ok===false)throw Error(data.error||data.message||`HTTP ${response.status}`);
 return data;
}
async function refresh(){
 if(loading)return;
 loading=true;busy=true;controls();
 try{
   const data=await call('affiliated-hubs');
   if(!Array.isArray(data.hubs))throw Error('Invalid affiliation response.');
   const list=$('aff-list');list.replaceChildren();
   for(const row of data.hubs){
     const wrap=document.createElement('div');
     wrap.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)';
     const label=document.createElement('span');
     label.textContent=`${row.hub} — ${row.is_affiliated?'Affiliated':'Not affiliated'}`;
     const actions=document.createElement('div');
     actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';
     const toggle=document.createElement('button');
     toggle.className='secondary';toggle.textContent=row.is_affiliated?'Remove affiliation':'Affiliate';
     toggle.onclick=()=>change(row.hub,!row.is_affiliated);
     actions.append(toggle);
     if(!row.is_affiliated){
       const del=document.createElement('button');
       del.className='secondary';del.textContent='Delete record';
       del.onclick=()=>removeInactive(row.hub);
       actions.append(del);
     }
     wrap.append(label,actions);list.append(wrap);
   }
   message(`Loaded ${data.hubs.filter(h=>h.is_affiliated).length} affiliated hubs. Last refreshed just now.`);
 }catch(e){message('Refresh failed: '+e.message);}
 finally{loading=false;busy=false;controls();}
}
async function change(hub,affiliated){
 if(!window.confirm(`${affiliated?'Affiliate':'Remove affiliation for'} ${hub}? Fleet allocations and route data are unaffected.`))return;
 busy=true;controls();
 try{await call('affiliated-hub-set',{hub,affiliated});await refresh();if(affiliated&&$('aff-new').value.trim().toUpperCase()===hub)$('aff-new').value='';}
 catch(e){message('Update failed: '+e.message);}
 finally{busy=false;controls();}
}
async function removeInactive(hub){
 if(!window.confirm(`Delete inactive record ${hub}? Audit history will be retained.`))return;
 busy=true;controls();
 try{await call('affiliated-hub-delete',{hub});await refresh();}
 catch(e){message('Delete failed: '+e.message);}
 finally{busy=false;controls();}
}
function syncAuth(){
 controls();
 if(signedIn()){message('Using Route Importer session. Refresh to load affiliated hubs.');refresh();}
 else{$('aff-list').replaceChildren();message('Sign in using the Route Importer session above to manage affiliations.');}
}
function init(){
 // Hide duplicate login controls; the existing Route Importer login remains authoritative.
 for(const id of ['aff-endpoint','aff-email','aff-password']){
   const field=$(id);if(field){const parent=field.closest('div');if(parent)parent.hidden=true;}
 }
 $('aff-signin').hidden=true;$('aff-signout').hidden=true;
 $('aff-refresh').onclick=refresh;
 $('aff-add').onclick=()=>{
   const hub=$('aff-new').value.trim().toUpperCase();
   if(!/^[A-Z0-9]{3,5}$/.test(hub)){message('Enter a valid 3–5 character hub code.');return;}
   change(hub,true);
 };
 window.addEventListener('route-importer-auth-changed',syncAuth);
 syncAuth();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();
