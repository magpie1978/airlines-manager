/* Affiliated-origin eligibility. Verified server register; fail closed. */
(()=>{'use strict';
const $=id=>document.getElementById(id), norm=v=>String(v??'').trim().toUpperCase();
let affiliated=new Set(), ready=false, pending=null, generation=0;
const eligible=hub=>ready && /^[A-Z0-9]{3,5}$/.test(norm(hub)) && !affiliated.has(norm(hub));
function sync(){
 const select=$('hub');if(!select)return;
 for(const option of select.options){const code=norm(option.value||option.textContent);option.disabled=!eligible(code);option.hidden=ready&&affiliated.has(code);option.title=ready&&affiliated.has(code)?'Affiliated hub — unavailable':'';}
 if(ready&&!eligible(select.value)){
  const first=Array.from(select.options).find(o=>eligible(o.value||o.textContent));
  if(first){select.value=first.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
  else select.selectedIndex=-1;
 }
 const blocked=!eligible(select.value);
 for(const id of ['scan-start','scan-resume','validate']){const btn=$(id);if(btn)btn.disabled=blocked;}
 const note=$('aff-origin-status');if(note)note.textContent=!ready?'Verifying affiliated hubs. Scanning is unavailable until verification succeeds.':blocked?'No eligible hub selected. Scanning is disabled.':`${norm(select.value)} is eligible as an origin hub.`;
}
async function refresh(){
 if(pending)return pending;
 const serial=++generation;ready=false;affiliated=new Set();sync();
 pending=(async()=>{
  const endpoint=$('endpoint')?.value.trim(),key=$('api-key')?.value.trim();
  if(!endpoint||!key||!window.routeImporterAuth?.isSignedIn?.())throw Error('Sign in to verify affiliated hubs.');
  const url=new URL(endpoint);url.searchParams.set('action','affiliated-hubs');
  const token=await window.routeImporterAuth.token();
  const response=await fetch(url,{headers:{apikey:key,Authorization:'Bearer '+token},cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.ok!==true||!Array.isArray(data.hubs))throw Error(data.error||'Affiliation register could not be verified.');
  const next=new Set();
  for(const row of data.hubs){
   if(!row||typeof row!=='object'||!(/^[A-Z0-9]{3,5}$/.test(norm(row.hub)))||typeof row.is_affiliated!=='boolean')throw Error('Invalid affiliated-hub record.');
   if(row.is_affiliated)next.add(norm(row.hub));
  }
  if(serial!==generation)throw Error('Affiliation settings changed during verification.');
  affiliated=next;ready=true;sync();return true;
 })().catch(error=>{ready=false;affiliated=new Set();sync();const note=$('aff-origin-status');if(note)note.textContent=error.message;throw error;}).finally(()=>{pending=null;});
 return pending;
}
async function assertAllowed(hub){await refresh();const selected=norm($('hub')?.value),target=norm(hub??selected);if(!eligible(target)||selected!==target)throw Error('Hub is affiliated, changed, or could not be verified. Operation blocked.');return target;}
function init(){const select=$('hub');if(!select)return;const note=document.createElement('p');note.id='aff-origin-status';note.className='warn';note.setAttribute('role','status');select.parentElement.append(note);
 select.addEventListener('change',sync);
 window.addEventListener('route-importer-auth-changed',()=>{generation++;ready=false;affiliated.clear();sync();if(window.routeImporterAuth?.isSignedIn?.())refresh().catch(()=>{});});
 window.addEventListener('pageshow',()=>{refresh().catch(()=>{});});
 $('aff-refresh')?.addEventListener('click',()=>refresh().catch(()=>{}));
 for(const id of ['endpoint','api-key'])$(id)?.addEventListener('change',()=>{generation++;ready=false;affiliated.clear();sync();refresh().catch(()=>{});});
 sync();refresh().catch(()=>{});
}
window.amOriginGuard={refresh,assertAllowed,isBlocked:()=>!eligible($('hub')?.value)};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
