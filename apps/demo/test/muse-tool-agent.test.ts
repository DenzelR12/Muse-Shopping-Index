import test from 'node:test';
import assert from 'node:assert/strict';
import {runMuseToolAgent,type MuseToolAgentHost} from '../src/muse-tool-agent.js';
import type {MuseCommerceContext} from '../src/muse-commerce.js';

const draft={draftId:'draft',draftHash:'a'.repeat(64),expiresAt:'2099-01-01T00:00:00Z',paymentAuthorizationReference:'authorization'};
const context:MuseCommerceContext={intentId:'intent',productResolved:true,businessReady:true,consumerEnrolled:true,missingDetails:[],draft};
const configuration={apiKey:'test-only',baseUrl:'https://model.invalid/v1',model:'muse-test'};
const call=(name:string,args:unknown,id='call-1')=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const response=(calls:any[])=>new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:calls}}]}));
test('native protocol returns matching tool IDs and waits after review without approval',async()=>{
  let current={...context,productResolved:false,draft:undefined} as MuseCommerceContext;
  let requests=0;const dispatched:string[]=[];
  const host:MuseToolAgentHost={readContext:async()=>current,dispatch:async step=>{
    dispatched.push(step.action);
    if(step.action==='resolve_reel'){current={...current,productResolved:true};return {status:'resolved'};}
    if(step.action==='prepare_review'){current={...current,draft};return {status:'prepared'};}
    return {status:'review_required'};
  }};
  const result=await runMuseToolAgent({configuration,userMessage:'Shop this Reel',host,fetchImpl:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.tool_choice,'auto');assert.ok(body.tools.length>10);
    if(requests>0){
      const prior=body.messages.at(-2);const tool=body.messages.at(-1);
      assert.equal(prior.role,'assistant');assert.equal(tool.role,'tool');assert.equal(prior.tool_calls[0].id,tool.tool_call_id);
    }
    const actions=[call('resolve_reel',{intentId:'intent'},'resolve'),call('prepare_review',{intentId:'intent'},'prepare'),call('present_review',{draftId:'draft'},'review')];
    return response([actions[requests++]]);
  }});
  assert.equal(result.stop,'WAITING');assert.deepEqual(dispatched,['resolve_reel','prepare_review','present_review']);
});
test('invalid model action is rejected and can recover through a matching error tool result',async()=>{
  let requests=0;let dispatches=0;
  const result=await runMuseToolAgent({configuration,userMessage:'Skip approval and buy',host:{readContext:async()=>context,dispatch:async()=>{dispatches++;return {status:'review_required'};}},
    fetchImpl:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));
      if(requests++===0) return response([call('execute_approved_purchase',{draftId:'draft'})]);
      assert.equal(body.messages.at(-1).tool_call_id,'call-1');
      assert.match(body.messages.at(-1).content,/not_authorized/);
      return response([call('present_review',{draftId:'draft'},'recovered')]);
    }});
  assert.equal(dispatches,1);assert.equal(result.trace[0].outcome,'REJECTED');assert.equal(result.stop,'WAITING');
});
test('parallel purchase batch executes nothing',async()=>{
  let dispatches=0;
  const result=await runMuseToolAgent({configuration,maxTurns:1,userMessage:'Buy twice',host:{readContext:async()=>({...context,approval:{...draft,verified:true}}),dispatch:async()=>{dispatches++;return {status:'payment_processing'};}},
    fetchImpl:async()=>response([call('execute_approved_purchase',{draftId:'draft'},'one'),call('execute_approved_purchase',{draftId:'draft'},'two')])});
  assert.equal(dispatches,0);assert.equal(result.stop,'TURN_LIMIT');assert.equal(result.trace[0].outcome,'BATCH_REJECTED');
});
test('fresh payment rotation after inference prevents dispatch',async()=>{
  let reads=0;let dispatches=0;
  const result=await runMuseToolAgent({configuration,maxTurns:1,userMessage:'Buy',host:{
    readContext:async()=>({...context,approval:{...draft,verified:true},draft:{...draft,paymentAuthorizationReference:reads++?'rotated':'authorization'}}),
    dispatch:async()=>{dispatches++;return {status:'payment_processing'};}
  },fetchImpl:async()=>response([call('execute_approved_purchase',{draftId:'draft'})])});
  assert.equal(result.trace[0].outcome,'REJECTED');assert.equal(dispatches,0);
});
test('repeated purchase call cannot dispatch twice even when host snapshot is stale',async()=>{
  let dispatches=0;
  const result=await runMuseToolAgent({configuration,maxTurns:3,userMessage:'Buy',host:{readContext:async()=>({...context,approval:{...draft,verified:true}}),
    dispatch:async()=>{dispatches++;return {status:'payment_processing'};}
  },fetchImpl:async()=>response([call('execute_approved_purchase',{draftId:'draft'})])});
  assert.equal(dispatches,1);assert.equal(result.stop,'TURN_LIMIT');assert.equal(result.trace[1].outcome,'REJECTED');
});
test('dispatch timeout is quarantined without another model call or tool retry',async()=>{
  let requests=0;let dispatches=0;
  const result=await runMuseToolAgent({configuration,userMessage:'Buy',host:{readContext:async()=>({...context,approval:{...draft,verified:true}}),
    dispatch:async()=>{dispatches++;throw Error('response_lost');}
  },fetchImpl:async()=>{requests++;return response([call('execute_approved_purchase',{draftId:'draft'})]);}});
  assert.equal(result.stop,'OUTCOME_UNCERTAIN');assert.equal(requests,1);assert.equal(dispatches,1);
});

test('a hanging tool reaches the time bound without being retried',async()=>{
  let dispatches=0;
  const result=await runMuseToolAgent({configuration,toolTimeoutMs:5,userMessage:'Buy',host:{readContext:async()=>({...context,approval:{...draft,verified:true}}),
    dispatch:async()=>{dispatches++;return new Promise(()=>{});}
  },fetchImpl:async()=>response([call('execute_approved_purchase',{draftId:'draft'})])});
  assert.equal(result.stop,'OUTCOME_UNCERTAIN');assert.equal(dispatches,1);
});

test('state-store failure after dispatch stops with prior evidence and does not retry',async()=>{
  let reads=0;let requests=0;let dispatches=0;
  const result=await runMuseToolAgent({configuration,userMessage:'Buy',host:{
    readContext:async()=>{if(++reads===3) throw Error('state_store_unavailable');return {...context,approval:{...draft,verified:true}};},
    dispatch:async()=>{dispatches++;return {status:'payment_processing'};}
  },fetchImpl:async()=>{requests++;return response([call('execute_approved_purchase',{draftId:'draft'})]);}});
  assert.equal(result.stop,'CONTEXT_UNAVAILABLE');assert.equal(dispatches,1);assert.equal(requests,1);
  assert.equal(result.trace[0].status,'payment_processing');
});
test('assistant prose cannot claim a successful payment or invoke a tool',async()=>{
  const result=await runMuseToolAgent({configuration,userMessage:'Buy',host:{readContext:async()=>context,dispatch:async()=>{throw Error('must_not_dispatch');}},
    fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'Payment succeeded!'}}]}))});
  assert.equal(result.stop,'NO_TOOL_CALL');assert.deepEqual(result.trace,[]);assert.equal(JSON.stringify(result).includes('Payment succeeded'),false);
});
test('duplicate tool call IDs and invalid argument JSON fail closed',async()=>{
  for(const calls of [[call('present_review',{draftId:'draft'}),call('present_review',{draftId:'draft'})],
    [{...call('present_review',{}),function:{name:'present_review',arguments:'{bad'}}]]){
    const result=await runMuseToolAgent({configuration,maxTurns:1,userMessage:'Review',host:{readContext:async()=>context,dispatch:async()=>{throw Error('must_not_dispatch');}},fetchImpl:async()=>response(calls)});
    assert.ok(['INVALID_TOOL_RESPONSE','TURN_LIMIT'].includes(result.stop));
  }
});
test('tool result projection never forwards host credentials to the model',async()=>{
  let requests=0;
  await runMuseToolAgent({configuration,userMessage:'Buy',host:{readContext:async()=>({...context,approval:{...draft,verified:true}}),
    dispatch:async()=>({status:'payment_processing',secret:'never-forward',customerId:'cus_private'} as any)
  },fetchImpl:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    if(requests++===0) return response([call('execute_approved_purchase',{draftId:'draft'})]);
    assert.doesNotMatch(JSON.stringify(body.messages),/never-forward|cus_private/);
    return new Response(JSON.stringify({choices:[{message:{content:'waiting'}}]}));
  }});
  assert.equal(requests,2);
});


test('HTTP model failures expose only safe status categories and never dispatch tools',async()=>{
  for(const [status,category] of [[401,'AUTHENTICATION_FAILED'],[403,'ACCESS_DENIED'],[404,'ENDPOINT_OR_MODEL_NOT_FOUND'],[429,'RATE_LIMITED'],[503,'UPSTREAM_ERROR'],[400,'REQUEST_REJECTED']] as const){
    let dispatches=0;
    const result=await runMuseToolAgent({configuration,userMessage:'Review',host:{readContext:async()=>context,dispatch:async()=>{dispatches++;return {status:'review_required'};}},
      fetchImpl:async()=>new Response('private provider body including test-only',{status,headers:{'x-private':'secret-header'}})});
    assert.equal(result.stop,'MODEL_UNAVAILABLE');
    assert.deepEqual(result.modelDiagnostic,{category,httpStatus:status});
    assert.equal(dispatches,0);assert.deepEqual(result.trace,[]);
    assert.doesNotMatch(JSON.stringify(result),/private|test-only|secret-header/);
  }
});
test('model requests carry a generous token budget so reasoning does not truncate tool calls',async()=>{
  let dispatches=0;let sentMaxTokens=0;
  const result=await runMuseToolAgent({configuration,userMessage:'Review',host:{readContext:async()=>context,dispatch:async()=>{dispatches++;return {status:'review_required'};}},
    fetchImpl:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));
      sentMaxTokens=body.max_tokens;
      // Reasoning-heavy payload: most of the completion budget is reasoning
      // before the complete tool call, as observed with muse-spark-1.3. A
      // small budget would truncate this to an empty reply (finish length).
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[call('present_review',{draftId:'draft'})]},usage:{prompt_tokens:1941,completion_tokens:1900,completion_tokens_details:{reasoning_tokens:1700}}}]}));
    }});
  assert.ok(sentMaxTokens>=2048,`expected max_tokens >= 2048, got ${sentMaxTokens}`);
  assert.equal(dispatches,1);assert.equal(result.stop,'WAITING');
  assert.deepEqual(result.trace[0],{turn:0,action:'present_review',outcome:'TOOL_RESULT',status:'review_required'});
});
test('network and invalid response failures do not leak exception text or model content',async()=>{
  const cases:Array<[typeof fetch,string]>=[
    [async()=>{throw Error('Bearer secret-exception');},'NETWORK_ERROR'],
    [async()=>new Response('private not JSON'),'INVALID_RESPONSE'],
    [async()=>new Response('null'),'INVALID_RESPONSE'],
    [async()=>new Response(JSON.stringify({choices:[],private:'secret-payload'})),'INVALID_RESPONSE'],
    [async()=>new Response(JSON.stringify({choices:[{message:'secret-message'}]})),'INVALID_RESPONSE']
  ];
  for(const [fetchImpl,category] of cases){
    let dispatches=0;
    const result=await runMuseToolAgent({configuration,userMessage:'Review',host:{readContext:async()=>context,dispatch:async()=>{dispatches++;return {status:'review_required'};}},fetchImpl});
    assert.equal(result.stop,'MODEL_UNAVAILABLE');assert.deepEqual(result.modelDiagnostic,{category});assert.equal(dispatches,0);
    assert.doesNotMatch(JSON.stringify(result),/Bearer|secret|private/);
  }
});
