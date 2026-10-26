import {hackathonReadiness} from '../apps/demo/dist/hackathon-readiness.js';
import {runMuseToolAgent} from '../apps/demo/dist/muse-tool-agent.js';

const profile=process.argv.includes('--stripe-shopify')?'stripe-shopify':'core';
const report=hackathonReadiness(process.env,profile);
console.log(JSON.stringify({type:'configuration',...report},null,2));
if(process.argv.includes('--remote')){
  for(const [service,base] of [['api','https://gift-signal-api-prod.onrender.com'],['muse','https://gift-signal-muse-live.onrender.com']]){
    for(const path of ['/health','/ready']){
      try{
        const response=await fetch(base+path,{signal:AbortSignal.timeout(15000)});
        const value=await response.json();
        console.log(JSON.stringify({type:'remote_readiness',service,path,httpStatus:response.status,buildSha:value.buildSha??null,
          ready:value.ready??value.runtime?.productionReady??null,missing:value.missing??value.runtime?.missing??[],
          modelConfigured:value.muse?.configured??value.gates?.muse??null}));
      }catch{console.log(JSON.stringify({type:'remote_readiness',service,path,reachable:false}));}
    }
  }
}
if(process.argv.includes('--probe-model')){
  if(!report.modelReady){console.error('Model configuration is incomplete. No model call was made.');process.exit(2);}
  const result=await runMuseToolAgent({maxTurns:1,userMessage:'Show the exact review. Do not buy anything.',host:{
    readContext:async()=>({intentId:'probe-intent',productResolved:true,businessReady:true,consumerEnrolled:true,missingDetails:[],
      draft:{draftId:'probe-draft',draftHash:'a'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),paymentAuthorizationReference:'synthetic-probe-reference'}}),
    dispatch:async step=>{
      if(step.action!=='present_review') throw Error('probe_read_only');
      return {status:'review_required'};
    }
  }});
  const passed=result.trace.some(step=>step.action==='present_review'&&step.outcome==='TOOL_RESULT');
  console.log(JSON.stringify({type:'live_model_probe',passed,stop:result.stop,...(result.modelDiagnostic?{modelDiagnostic:result.modelDiagnostic}:{}),trace:result.trace,commerceApisCalled:0,paymentsExecuted:0}));
  if(!passed) process.exitCode=1;
}else if(!(process.argv.includes('--model-only')?report.modelReady:profile==='core'?report.coreConfigured:report.sandboxReady)) process.exitCode=2;
