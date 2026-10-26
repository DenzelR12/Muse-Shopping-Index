import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readStripeTransactionCheckout,createStripeCheckout,createStripeDirectPayment,prepareStripeDirectPayment,confirmStripeDirectPayment,cancelStripePaymentIntent,verifyStripeSetupIntent,currencyAmountToMinorUnits,refundStripeCheckout,getStripeRefund,verifyStripeWebhook,verifyStripeWebhookOnce,fulfillmentMayStart,assertTrustedStripeCheckoutUrl} from '../src/stripe.js';
import {InMemoryReplayStore} from '../../../packages/zero-trust/src/index.js';

test('creates idempotent server-side Stripe checkout request',async()=>{
  let headers;
  const fake=async(_url,init)=>{
    headers=init?.headers;
    return new Response(JSON.stringify({id:'cs_test_123',url:'https://checkout.stripe.com/c/pay/cs_test_123',status:'open'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const result=await createStripeCheckout({
    draftId:'draft-1',companyId:'company-1',amountCents:28900,currency:'USD',
    description:'Atlas Carry-On 22',successUrl:'https://example.test/success',cancelUrl:'https://example.test/cancel'
  },'sk_test_example',fake);
  assert.equal(result.checkoutSessionId,'cs_test_123');
  assert.equal(result.paymentRail,'stripe');
  assert.deepEqual(result.handoff,{required:true,kind:'payment_rail',provider:'stripe'});
  assert.equal(headers['idempotency-key'],'gift-signal:company-1:draft-1');
});

test('verifies Stripe webhook signatures with freshness',()=>{
  const raw=Buffer.from('{"type":"checkout.session.completed"}');
  const timestamp='1792854000';
  const secret='whsec_test';
  const signature=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
  assert.equal(verifyStripeWebhook({rawBody:raw,signatureHeader:`t=${timestamp},v1=${signature}`,webhookSecret:secret,nowSeconds:1792854000}).ok,true);
  assert.equal(verifyStripeWebhook({rawBody:raw,signatureHeader:`t=${timestamp},v1=${signature}`,webhookSecret:secret,nowSeconds:1792855000}).ok,false);
});

test('fulfillment accepts paid checkout or succeeded direct PaymentIntent events',()=>{
  assert.equal(fulfillmentMayStart({type:'checkout.session.completed',data:{object:{payment_status:'paid'}}}),true);
  assert.equal(fulfillmentMayStart({type:'checkout.session.completed',data:{object:{payment_status:'unpaid'}}}),false);
  assert.equal(fulfillmentMayStart({type:'payment_intent.succeeded',data:{object:{status:'succeeded'}}}),true);
  assert.equal(fulfillmentMayStart({type:'payment_intent.payment_failed',data:{object:{status:'requires_payment_method'}}}),false);
});


test('Stripe webhook event IDs are accepted only once',async()=>{
  const raw=Buffer.from('{"id":"evt_1","type":"checkout.session.completed"}');
  const timestamp='1792854000';
  const secret='whsec_test';
  const signature=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
  const replay=new InMemoryReplayStore();
  const first=await verifyStripeWebhookOnce({rawBody:raw,signatureHeader:`t=${timestamp},v1=${signature}`,webhookSecret:secret,replay,nowSeconds:1792854000});
  const second=await verifyStripeWebhookOnce({rawBody:raw,signatureHeader:`t=${timestamp},v1=${signature}`,webhookSecret:secret,replay,nowSeconds:1792854000});
  assert.equal(first.ok,true);
  assert.equal(second.reason,'webhook_replayed');
});


test('refunds a paid checkout with a stable idempotency key',async()=>{
  const calls=[];
  const fake=async(url,init={})=>{
    calls.push({url:String(url),init});
    if(String(url).includes('/checkout/sessions/')){
      return new Response(JSON.stringify({payment_intent:'pi_123',payment_status:'paid'}),{status:200,headers:{'content-type':'application/json'}});
    }
    return new Response(JSON.stringify({id:'re_123',status:'succeeded'}),{status:200,headers:{'content-type':'application/json'}});
  };
  const result=await refundStripeCheckout({
    checkoutSessionId:'cs_test_123',
    companyId:'company-1',
    draftId:'draft-1',
    secretKey:'sk_test_example',
    fetchImpl:fake
  });
  assert.equal(result.refundId,'re_123');
  assert.equal(result.paymentIntentId,'pi_123');
  assert.equal(calls.length,2);
  assert.equal(calls[1].init.headers['idempotency-key'],'gift-signal:refund:company-1:draft-1');
  assert.equal(String(calls[1].init.body),'payment_intent=pi_123&metadata%5Bcompany_id%5D=company-1&metadata%5Bdraft_id%5D=draft-1');
});

test('refund refuses an unpaid checkout before refund creation',async()=>{
  let calls=0;
  const fake=async()=>{
    calls++;
    return new Response(JSON.stringify({payment_intent:'pi_123',payment_status:'unpaid'}),{status:200,headers:{'content-type':'application/json'}});
  };
  await assert.rejects(
    refundStripeCheckout({
      checkoutSessionId:'cs_test_unpaid',
      companyId:'company-1',
      draftId:'draft-unpaid',
      secretKey:'sk_test_example',
      fetchImpl:fake
    }),
    /stripe_checkout_not_paid/
  );
  assert.equal(calls,1);
});


test('reads Stripe refund status for settlement recovery',async()=>{
  let authorization;
  const result=await getStripeRefund({
    refundId:'re_123',
    secretKey:'sk_test_example',
    fetchImpl:async(url:any,init:any)=>{
      assert.equal(String(url),'https://api.stripe.com/v1/refunds/re_123');
      authorization=init.headers.authorization;
      return new Response(JSON.stringify({
        id:'re_123',
        status:'succeeded',
        metadata:{company_id:'company-1',draft_id:'draft-1'}
      }),{status:200,headers:{'content-type':'application/json'}});
    }
  });
  assert.equal(authorization,'Bearer sk_test_example');
  assert.equal(result.status,'succeeded');
  assert.equal(result.metadata.draft_id,'draft-1');
});


test('currency-aware Stripe amount conversion preserves approved major units',()=>{
  assert.equal(currencyAmountToMinorUnits(19.99,'USD'),1999);
  assert.equal(currencyAmountToMinorUnits(125,'JPY'),125);
  assert.equal(currencyAmountToMinorUnits(1.234,'KWD'),1234);
});


test('checkout handoff firewall rejects merchant and arbitrary external URLs',()=>{
  assert.throws(()=>assertTrustedStripeCheckoutUrl('https://merchant.example/checkout'),/stripe_checkout_url_untrusted/);
  assert.throws(()=>assertTrustedStripeCheckoutUrl('https://example-shop.myshopify.com/checkouts/1'),/stripe_checkout_url_untrusted/);
  assert.throws(()=>assertTrustedStripeCheckoutUrl('http://checkout.stripe.com/c/pay/cs_test'),/stripe_checkout_url_untrusted/);
  assert.equal(assertTrustedStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test'),'https://checkout.stripe.com/c/pay/cs_test');
});


test('direct Stripe payment uses saved customer and payment method without handoff',async()=>{
  let body='';
  let idempotency='';
  const result=await createStripeDirectPayment({
    draftId:'draft-direct-1',
    companyId:'company-1',
    amountCents:5832,
    currency:'USD',
    description:'Approved gift order',
    customerId:'cus_123',
    paymentMethodId:'pm_123'
  },'sk_test_example',async(_url,init)=>{
    body=String(init?.body);
    idempotency=String((init?.headers as Record<string,string>)['idempotency-key']);
    return new Response(JSON.stringify({id:'pi_123',status:'succeeded'}),{status:200,headers:{'content-type':'application/json'}});
  });
  const form=new URLSearchParams(body);
  assert.equal(form.get('customer'),'cus_123');
  assert.equal(form.get('payment_method'),'pm_123');
  assert.equal(form.get('off_session'),'true');
  assert.equal(form.get('confirm'),'true');
  assert.equal(form.get('error_on_requires_action'),'true');
  assert.equal(idempotency,'gift-signal:direct:company-1:draft-direct-1');
  assert.deepEqual(result.handoff,{required:false,kind:'none',provider:'stripe'});
});

test('direct Stripe payment fails closed when authentication is still required',async()=>{
  await assert.rejects(createStripeDirectPayment({
    draftId:'draft-direct-2',
    companyId:'company-1',
    amountCents:5832,
    currency:'USD',
    description:'Approved gift order',
    customerId:'cus_123',
    paymentMethodId:'pm_123'
  },'sk_test_example',async()=>new Response(JSON.stringify({
    error:{code:'authentication_required'}
  }),{status:402,headers:{'content-type':'application/json'}})),/stripe_payment_requires_action/);
});


test('two-phase direct payment persists reference before confirmation',async()=>{
  const calls:string[]=[];
  const prepared=await prepareStripeDirectPayment({
    draftId:'draft-two-phase',
    companyId:'company-1',
    amountCents:5832,
    currency:'USD',
    description:'Approved gift order',
    customerId:'cus_123',
    paymentMethodId:'pm_123'
  },'sk_test_example',async(url)=>{
    calls.push(String(url));
    return new Response(JSON.stringify({id:'pi_two_phase',status:'requires_confirmation'}),{status:200});
  });
  assert.equal(prepared.paymentIntentId,'pi_two_phase');

  const confirmed=await confirmStripeDirectPayment({
    paymentIntentId:'pi_two_phase',
    companyId:'company-1',
    draftId:'draft-two-phase',
    secretKey:'sk_test_example',
    fetchImpl:async(url)=>{
      calls.push(String(url));
      return new Response(JSON.stringify({id:'pi_two_phase',status:'succeeded'}),{status:200});
    }
  });
  assert.equal(confirmed.handoff.required,false);
  assert.deepEqual(calls,[
    'https://api.stripe.com/v1/payment_intents',
    'https://api.stripe.com/v1/payment_intents/pi_two_phase/confirm'
  ]);
});

test('blocked direct payment can be canceled before fallback',async()=>{
  const canceled=await cancelStripePaymentIntent({
    paymentIntentId:'pi_cancel_123',
    companyId:'company-1',
    draftId:'draft-cancel',
    secretKey:'sk_test_example',
    fetchImpl:async(url,init)=>{
      assert.equal(String(url),'https://api.stripe.com/v1/payment_intents/pi_cancel_123/cancel');
      assert.equal(String((init?.headers as Record<string,string>)['idempotency-key']),'gift-signal:direct:cancel:company-1:draft-cancel');
      return new Response(JSON.stringify({id:'pi_cancel_123',status:'canceled'}),{status:200});
    }
  });
  assert.equal(canceled.status,'canceled');
});


test('verifies succeeded off-session SetupIntent before reusable enrollment',async()=>{
  const result=await verifyStripeSetupIntent({
    setupIntentId:'seti_123',
    secretKey:'sk_test_example',
    fetchImpl:async(url,init)=>{
      assert.equal(String(url),'https://api.stripe.com/v1/setup_intents/seti_123');
      assert.equal(String((init?.headers as Record<string,string>).authorization),'Bearer sk_test_example');
      return new Response(JSON.stringify({
        id:'seti_123',
        status:'succeeded',
        usage:'off_session',
        customer:'cus_123',
        payment_method:'pm_123'
      }),{status:200});
    }
  });
  assert.deepEqual(result,{
    setupIntentId:'seti_123',
    customerId:'cus_123',
    paymentMethodId:'pm_123',
    usage:'off_session'
  });
});

test('SetupIntent enrollment fails closed unless setup is succeeded and reusable off-session',async()=>{
  await assert.rejects(
    verifyStripeSetupIntent({
      setupIntentId:'seti_pending',
      secretKey:'sk_test_example',
      fetchImpl:async()=>new Response(JSON.stringify({
        id:'seti_pending',
        status:'requires_action',
        usage:'off_session',
        customer:'cus_123',
        payment_method:'pm_123'
      }),{status:200})
    }),
    /stripe_setup_intent_not_succeeded/
  );
  await assert.rejects(
    verifyStripeSetupIntent({
      setupIntentId:'seti_on_session',
      secretKey:'sk_test_example',
      fetchImpl:async()=>new Response(JSON.stringify({
        id:'seti_on_session',
        status:'succeeded',
        usage:'on_session',
        customer:'cus_123',
        payment_method:'pm_123'
      }),{status:200})
    }),
    /stripe_setup_intent_usage_invalid/
  );
});


test('verified buyer email is delegated to Stripe receipt and Checkout email fields',async()=>{
  let checkoutBody='';
  await createStripeCheckout({
    draftId:'draft-email-checkout',companyId:'company-1',amountCents:1999,currency:'USD',
    description:'Gift',successUrl:'https://example.test/success',cancelUrl:'https://example.test/cancel',
    customerEmail:'buyer@example.com'
  },'sk_test_example',async(_url,init)=>{
    checkoutBody=String(init?.body);
    return new Response(JSON.stringify({id:'cs_email',url:'https://checkout.stripe.com/c/pay/cs_email',status:'open'}),{status:200});
  });
  assert.equal(new URLSearchParams(checkoutBody).get('customer_email'),'buyer@example.com');

  let directBody='';
  await prepareStripeDirectPayment({
    draftId:'draft-email-direct',companyId:'company-1',amountCents:1999,currency:'USD',
    description:'Gift',customerId:'cus_123',paymentMethodId:'pm_123',receiptEmail:'buyer@example.com'
  },'sk_test_example',async(_url,init)=>{
    directBody=String(init?.body);
    return new Response(JSON.stringify({id:'pi_email',status:'requires_confirmation'}),{status:200});
  });
  assert.equal(new URLSearchParams(directBody).get('receipt_email'),'buyer@example.com');
});



test('enrollment creates customer and off-session SetupIntent server-side',async()=>{
  const {createStripeEnrollmentSetup}=await import('../dist/stripe.js');
  const calls:any[]=[];
  const result=await createStripeEnrollmentSetup({enrollmentId:'server-challenge',secretKey:'test-only',fetchImpl:async(url:any,init:any)=>{
    calls.push({url,body:new URLSearchParams(init.body),headers:init.headers});
    return new Response(JSON.stringify(calls.length===1?{id:'cus_server'}:{id:'seti_server',customer:'cus_server',usage:'off_session',client_secret:'secret'}),{status:200});
  }});
  assert.deepEqual(result,{customerId:'cus_server',setupIntentId:'seti_server',clientSecret:'secret'});
  assert.equal(calls[1].body.get('customer'),'cus_server');
  assert.equal(calls[1].body.get('usage'),'off_session');
  assert.equal(calls[1].body.get('automatic_payment_methods[enabled]'),'true');
  assert.equal(calls[1].body.has('payment_method'),false);
  assert.match(calls[1].headers['idempotency-key'],/server-challenge/);
});

test('rehydrates only the original scoped open Checkout without creating another payment',async()=>{
  const session={id:'cs_test_existing',mode:'payment',status:'open',payment_status:'unpaid',amount_total:5832,currency:'usd',
    metadata:{company_id:'company',draft_id:'draft'},url:'https://checkout.stripe.com/c/pay/existing'};
  let calls=0;
  const args={checkoutSessionId:'cs_test_existing',companyId:'company',draftId:'draft',amount:58.32,currency:'USD',secretKey:'sk_test_mock'};
  const request=(value:any)=>async(url:any,init:any)=>{
    calls++;assert.match(String(url),/checkout\/sessions\/cs_test_existing$/);assert.equal(init.method,undefined);
    return new Response(JSON.stringify(value));
  };
  assert.deepEqual(await readStripeTransactionCheckout({...args,fetchImpl:request(session)}),{status:'open',checkoutUrl:session.url});
  for(const change of [{amount_total:1},{currency:'eur'},{id:'cs_test_other'},{metadata:{company_id:'attacker',draft_id:'draft'}},{metadata:{company_id:'company',draft_id:'other'}}]){
    await assert.rejects(readStripeTransactionCheckout({...args,fetchImpl:request({...session,...change})}),/mismatch/);
  }
  for(const status of ['complete','expired'] as const){
    assert.deepEqual(await readStripeTransactionCheckout({...args,fetchImpl:request({...session,status,url:null})}),{status});
  }
  await assert.rejects(readStripeTransactionCheckout({...args,fetchImpl:request({...session,url:'https://merchant.example/pay'})}),/untrusted/);
  assert.throws(()=>assertTrustedStripeCheckoutUrl('https://checkout.stripe.com:8443/pay'),/untrusted/);
  assert.equal(calls,9);
});
