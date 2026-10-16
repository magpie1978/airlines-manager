import {optimise} from './engine.js';
let stopped=false;
onmessage=e=>{if(e.data.type==='stop'){stopped=true;return;}if(e.data.type!=='run')return;stopped=false;try{const result=optimise(e.data.data,{...e.data.settings,stop:()=>stopped,onProgress:p=>postMessage({type:'progress',data:p})});postMessage({type:'result',data:result});}catch(error){postMessage({type:'error',message:error.message});}};
