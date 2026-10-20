/* Stage 2 report: authenticated, read-only production snapshot. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const n=v=>Number(v??0).toLocaleString('en-GB');
let busy=false;
async function refresh(){
 if(busy)return;busy=true;
 const button=$('pub-refresh');button.disabled=true;
 $('pub-readiness').textContent='Checking published records…';
 try{
   const endpoint=$('endpoint').value.trim(),key=$('api-key').value.trim();
   const hub=$('hub').value.trim().toUpperCase();
   if(!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/[\w-]+\/?$/i.test(endpoint))throw Error('Enter the scanner Edge Function URL.');
   if(!key)throw Error('Enter the publishable key.');
   if(!window.routeImporterAuth?.token)throw Error('Route Importer sign-in is required.');
   const token=await window.routeImporterAuth.token();
   const url=new URL(endpoint);url.searchParams.set('action','publication-report');url.searchParams.set('hub',hub);
   const response=await fetch(url,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+token},cache:'no-store'});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||data.ok===false)throw Error(data.error||data.message||`HTTP ${response.status}`);
   const r=data.report;if(!r||r.hub!==hub)throw Error('Unexpected report response.');
   $('pub-routes').textContent=n(r.routes);
   $('pub-pricing').textContent=n(r.pricingRecords);
   $('pub-categories').textContent=n(r.validCategories);
   $('pub-unresolved').textContent=n(r.unresolvedCategories);
   $('pub-eligible').textContent=`${n(r.validEligiblePricing)} / ${n(r.eligibleDestinations)}`;
   $('pub-errors').textContent=n(r.pricingErrors);
   $('pub-readiness').textContent=window.amOriginGuard?.isBlocked()&&r.affiliatedOrigin===true?`${hub}: affiliated origin — scanning, publication and optimisation disabled.`:r.ready?`${hub}: ready for optimisation (subject to aircraft and engine checks).`:`${hub}: needs attention — ${n(r.unresolvedCategories)} unresolved categories; ${n(r.missingEligiblePricing)} eligible routes without valid pricing.`;
   $('pub-note').textContent=`${n(r.affiliatedDestinations)} affiliated destinations excluded. Database snapshot; newly recovered categories and per-scan changes are not historically tracked.`;
 }catch(e){$('pub-readiness').textContent='Publication report failed: '+e.message;}
 finally{busy=false;button.disabled=false;}
}
function init(){
 $('pub-refresh').addEventListener('click',refresh);
 // Route Scanner publishes on successful results load; refresh after its handler resolves.
 $('scan-results').addEventListener('click',()=>{setTimeout(refresh,1500)});
 $('hub').addEventListener('change',()=>{$('pub-readiness').textContent='Hub changed — refresh the publication report.';});
 window.addEventListener('route-importer-auth-changed',()=>{if(window.routeImporterAuth?.isSignedIn?.())refresh();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
