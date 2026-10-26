import test from 'node:test';
import assert from 'node:assert/strict';
import {GiftSignalApiClient} from './api.js';

test('Muse confirmation issues hash-bound approval then submits it without privileged browser credentials',async()=>{
  const original=globalThis.fetch;
  const calls:Array<{url:string;init:RequestInit|undefined}>=[];
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);
    calls.push({url,init});
    if(url.endsWith('/v1/muse/approvals/issue')){
      return new Response(JSON.stringify({approvalToken:'approval-token-1'}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(url.endsWith('/v1/muse/confirm')){
      return new Response(JSON.stringify({checkout:{checkoutSessionId:'cs_1',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_1',status:'open',paymentRail:'stripe',handoff:{required:true,kind:'payment_rail',provider:'stripe'},execution:{fulfillmentMode:'server_api',merchantHandoffRequired:false}}}),{status:201,headers:{'content-type':'application/json'}});
    }
    return new Response('{}',{status:404});
  }) as typeof fetch;
  try{
    const client=new GiftSignalApiClient('https://api.example');
    const result=await client.commitMuseConfirmation({
      connectionId:'conn-1',
      draftId:'draft-1',
      displayedDraftHash:'a'.repeat(64),
      identityToken:'oidc-token'
    });
    assert.equal(result.handoff.required,true);
    assert.ok('checkoutSessionId' in result);
    assert.equal(result.checkoutSessionId,'cs_1');
    assert.equal(result.execution.merchantHandoffRequired,false);
    assert.equal(result.execution.fulfillmentMode,'server_api');
    assert.equal(result.handoff.provider,'stripe');
    assert.equal(calls.length,2);
    const approvalBody=JSON.parse(String(calls[0].init?.body));
    assert.deepEqual(approvalBody,{
      connectionId:'conn-1',draftId:'draft-1',displayedDraftHash:'a'.repeat(64),approved:true
    });
    const confirmBody=JSON.parse(String(calls[1].init?.body));
    assert.deepEqual(confirmBody,{connectionId:'conn-1',draftId:'draft-1',approvalToken:'approval-token-1'});
    for(const call of calls){
      const headers=call.init?.headers as Record<string,string>;
      assert.equal(headers.authorization,'Bearer oidc-token');
      assert.equal(headers['x-api-key'],undefined);
      assert.equal(headers['x-credential-id'],undefined);
    }
  }finally{
    globalThis.fetch=original;
  }
});


test('Muse confirmation accepts direct PaymentIntent result without checkout redirect',async()=>{
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=(async(input:RequestInfo|URL)=>{
    calls++;
    const url=String(input);
    if(url.endsWith('/v1/muse/approvals/issue')){
      return new Response(JSON.stringify({approvalToken:'approval-token-direct'}),{status:200,headers:{'content-type':'application/json'}});
    }
    if(url.endsWith('/v1/muse/confirm')){
      return new Response(JSON.stringify({checkout:{
        paymentIntentId:'pi_direct_1',
        status:'succeeded',
        paymentRail:'stripe',
        handoff:{required:false,kind:'none',provider:'stripe'},
        execution:{fulfillmentMode:'server_api',merchantHandoffRequired:false}
      }}),{status:201,headers:{'content-type':'application/json'}});
    }
    return new Response('{}',{status:404});
  }) as typeof fetch;
  try{
    const client=new GiftSignalApiClient('https://api.example');
    const result=await client.commitMuseConfirmation({
      connectionId:'conn-direct',
      draftId:'draft-direct',
      displayedDraftHash:'b'.repeat(64),
      identityToken:'oidc-direct'
    });
    assert.equal(result.handoff.required,false);
    assert.ok('paymentIntentId' in result);
    assert.equal(result.paymentIntentId,'pi_direct_1');
    assert.equal(calls,2);
  }finally{
    globalThis.fetch=original;
  }
});

test('consumer enrollment sends only challenge ID with verified identity bearer',async()=>{
  const original=globalThis.fetch;
  let body:any;
  let headers:any;
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
    assert.equal(String(input),'https://api.example/v1/consumer-commerce/enrollment/complete');
    body=JSON.parse(String(init?.body));
    headers=init?.headers;
    return new Response(JSON.stringify({enrolled:true,paymentRail:'stripe',shopIdentityVerified:true}),{
      status:201,headers:{'content-type':'application/json'}
    });
  }) as typeof fetch;
  try{
    const client=new GiftSignalApiClient('https://api.example');
    const result=await client.enrollConsumerCommerce({
      enrollmentId:'challenge_123',
      identityToken:'oidc-token'
    });
    assert.equal(result.enrolled,true);
    assert.deepEqual(body,{enrollmentId:'challenge_123'});
    assert.equal(headers.authorization,'Bearer oidc-token');
    assert.equal('customerId' in body,false);
    assert.equal('paymentMethodId' in body,false);
    assert.equal('shopUserPublicId' in body,false);
  }finally{
    globalThis.fetch=original;
  }
});

test('Muse enrollment retry preserves the exact approved draft and hash',async()=>{
  const client=new GiftSignalApiClient('https://api.example');
  const confirmation={
    connectionId:'conn-retry',
    draftId:'draft-retry',
    displayedDraftHash:'c'.repeat(64),
    identityToken:'oidc-retry'
  };
  const seen:any[]=[];
  let attempts=0;
  (client as any).commitMuseConfirmation=async(request:any)=>{
    attempts++;
    seen.push({...request});
    if(attempts===1) throw new Error('consumer_commerce_enrollment_required:409');
    return {
      paymentIntentId:'pi_retry',
      status:'succeeded',
      paymentRail:'stripe',
      handoff:{required:false,kind:'none',provider:'stripe'},
      execution:{fulfillmentMode:'server_api',merchantHandoffRequired:false}
    };
  };
  let enrolled:any;
  (client as any).startConsumerCommerceEnrollment=async(token:string)=>{assert.equal(token,'oidc-retry');return {enrollmentId:'challenge_retry',clientSecret:'secret_retry'};};
  (client as any).enrollConsumerCommerce=async(request:any)=>{enrolled=request;return {enrolled:true,paymentRail:'stripe',shopIdentityVerified:true};};

  const result=await client.commitMuseWithEnrollment({
    confirmation,
    confirmSetupIntent:async(secret:string)=>{assert.equal(secret,'secret_retry');}
  });

  assert.equal(attempts,2);
  assert.deepEqual(seen,[confirmation,confirmation]);
  assert.deepEqual(enrolled,{enrollmentId:'challenge_retry',identityToken:'oidc-retry'});
  assert.equal(result.handoff.required,false);
});



test('enrollment start sends no browser-selected payment identifiers',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async(input:any,init:any)=>{
    assert.equal(String(input),'https://api.example/v1/consumer-commerce/enrollment/start');
    assert.deepEqual(JSON.parse(init.body),{});
    assert.equal(init.headers.authorization,'Bearer oidc');
    return new Response(JSON.stringify({enrollmentId:'challenge',clientSecret:'secret'}));
  }) as typeof fetch;
  try{assert.deepEqual(await new GiftSignalApiClient('https://api.example').startConsumerCommerceEnrollment('oidc'),{enrollmentId:'challenge',clientSecret:'secret'});}
  finally{globalThis.fetch=original;}
});

test('Muse approval preserves enrollment conflicts so the enrollment controller can recover',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=(async(input:any)=>{
    assert.equal(String(input),'https://api.example/v1/muse/approvals/issue');
    return new Response(JSON.stringify({error:'consumer_commerce_enrollment_required'}),{status:409});
  }) as typeof fetch;
  try{
    await assert.rejects(new GiftSignalApiClient('https://api.example').commitMuseConfirmation({
      connectionId:'conn',draftId:'draft',displayedDraftHash:'a'.repeat(64),identityToken:'oidc'
    }),/consumer_commerce_enrollment_required:409/);
  }finally{globalThis.fetch=original;}
});
