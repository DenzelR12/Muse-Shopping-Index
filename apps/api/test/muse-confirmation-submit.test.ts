import test from 'node:test';
import assert from 'node:assert/strict';
import {issueApprovalToken} from '@gift-signal/zero-trust';
import {submitMuseConfirmation} from '../dist/muse-confirmation-submit.js';

const connection={
  connectionId:'conn-1',companyId:'org-a',subjectId:'human-1',
  grantedActions:['create_action_draft','execute_action'],
  secretRef:'vault:test',createdAt:'2026-10-25T00:00:00Z'
};
const pricing={
  currency:'USD',
  lines:[{variantId:'gid://shopify/ProductVariant/123',quantity:1,unitPrice:'54.00',availableForSale:true,inventoryQuantity:4}]
};
const landed={
  currency:'USD',subtotal:'54.00',tax:'4.32',
  shipping:{handle:'free',title:'Free shipping',amount:'0.00'},
  total:'58.32'
};
const state={
  payment:{provider:'stripe' as const,externalAccountId:'acct-1'},
  fulfillment:{
    provider:'shopify' as const,
    externalAccountId:'example-shop.myshopify.com',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
    shippingAddress:{address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
    landedQuote:landed
  },
  pricing,
  description:'Approved gift order',
  successUrl:'https://example.test/success',
  cancelUrl:'https://example.test/cancel'
};
const draft={draftId:'draft-1',total:58.32,currency:'USD'} as any;
const draftHash='a'.repeat(64);
const approval=issueApprovalToken({
  subjectId:'human-1',companyId:'org-a',connectionId:'conn-1',draftId:'draft-1',
  draftHash,amount:58.32,currency:'USD',paymentAuthorizationReference:'seti_saved_1',expiresAt:'2099-01-01T00:00:00Z'
},'approval-secret','2026-10-25T00:00:00Z');

test('Muse confirmation revalidates and delegates only the approved signed state',async()=>{
  let consumed=0;
  let captured:any;
  const result=await submitMuseConfirmation({
    connectionId:'conn-1',
    draftId:'draft-1',
    approvalToken:approval,
    agentId:'muse-agent',
    subjectId:'human-1',
    approvalSecret:'approval-secret',
    requestId:'req-1',
    authority:{
      async resolve(id:string){assert.equal(id,'conn-1');return connection as any;},
      async consumeOnce(key:string){assert.match(key,/^approval:/);consumed++;return true;}
    } as any,
    drafts:{
      async verifyForExecution(args:any){
        assert.deepEqual(args,{companyId:'org-a',connectionId:'conn-1',draftId:'draft-1'});
        return {connection,draft,draftHash,state} as any;
      }
    } as any,
    runtime:{
      async quoteVariants(){return {quote:pricing};},
      async quoteLandedTotal(){return {quote:landed};}
    } as any,
    savedStripeAuthorization:{reference:'seti_saved_1',customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'},
    execution:{
      async createCheckout(args:any){captured=args;await args.approval.consume();return {checkoutSessionId:'cs_1',checkoutUrl:'https://checkout.test/1'};}
    } as any
  });
  assert.equal(result.checkoutSessionId,'cs_1');
  assert.equal(captured.companyId,'org-a');
  assert.equal(captured.consumerSubjectId,'human-1');
  assert.equal(captured.agentId,'muse-agent');
  assert.equal(captured.amount,58.32);
  assert.deepEqual(captured.savedStripeAuthorization,{reference:'seti_saved_1',customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'});
  assert.equal(consumed,1);
});

test('Muse confirmation requires reapproval when live landed total changes',async()=>{
  await assert.rejects(submitMuseConfirmation({
    connectionId:'conn-1',draftId:'draft-1',approvalToken:approval,agentId:'muse-agent',subjectId:'human-1',
    approvalSecret:'approval-secret',
    authority:{async resolve(){return connection as any;},async consumeOnce(){return true;}} as any,
    drafts:{async verifyForExecution(){return {connection,draft,draftHash,state} as any;}} as any,
    runtime:{
      async quoteVariants(){return {quote:pricing};},
      async quoteLandedTotal(){return {quote:{...landed,total:'59.32'}};}
    } as any,
    savedStripeAuthorization:{reference:'seti_saved_1',customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'},
    execution:{async createCheckout(){throw new Error('must_not_execute');}} as any
  }),/provider_checkout_reapproval_required/);
});


test('Muse confirmation rejects a different verified consumer subject',async()=>{
  await assert.rejects(submitMuseConfirmation({
    connectionId:'conn-1',draftId:'draft-1',approvalToken:approval,agentId:'muse-agent',subjectId:'other-human',
    approvalSecret:'approval-secret',
    authority:{async resolve(){return connection as any;},async consumeOnce(){return true;}} as any,
    drafts:{async verifyForExecution(){throw new Error('must_not_verify_draft');}} as any,
    runtime:{} as any,
    execution:{} as any
  }),/approval_identity_mismatch/);
});


test('Muse confirmation rejects payment authorization substitution after approval',async()=>{
  await assert.rejects(submitMuseConfirmation({
    connectionId:'conn-1',
    draftId:'draft-1',
    approvalToken:approval,
    agentId:'muse-agent',
    subjectId:'human-1',
    approvalSecret:'approval-secret',
    authority:{
      async resolve(){return connection as any;},
      async consumeOnce(){throw new Error('must_not_consume');}
    } as any,
    drafts:{
      async verifyForExecution(){return {connection,draft,draftHash,state} as any;}
    } as any,
    runtime:{
      async quoteVariants(){return {quote:pricing};},
      async quoteLandedTotal(){return {quote:landed};}
    } as any,
    savedStripeAuthorization:{
      reference:'seti_rotated_2',
      customerId:'cus_456',
      paymentMethodId:'pm_456',
      usage:'off_session'
    },
    execution:{
      async createCheckout(){throw new Error('must_not_execute');}
    } as any
  }),/approval_payment_authorization_mismatch/);
});

test('generic approval cannot authorize a Muse purchase or consume its approval',async()=>{
  const token=issueApprovalToken({subjectId:'human-1',companyId:'org-a',connectionId:'conn-1',draftId:'draft-1',
    draftHash,amount:58.32,currency:'USD',expiresAt:'2099-01-01T00:00:00Z'},'approval-secret');
  await assert.rejects(submitMuseConfirmation({
    connectionId:'conn-1',draftId:'draft-1',approvalToken:token,agentId:'muse-agent',subjectId:'human-1',approvalSecret:'approval-secret',
    authority:{resolve:async()=>connection,consumeOnce:async()=>{throw Error('must_not_consume');}} as any,
    drafts:{verifyForExecution:async()=>({connection,draft,draftHash,state})} as any,
    runtime:{quoteVariants:async()=>({quote:pricing}),quoteLandedTotal:async()=>({quote:landed})} as any,
    savedStripeAuthorization:{reference:'seti_saved_1',customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'},
    execution:{createCheckout:async()=>{throw Error('must_not_execute');}} as any
  }),/approval_payment_authorization_mismatch/);
});

test('Muse module fails closed if a caller omits saved payment authorization',async()=>{
  await assert.rejects(submitMuseConfirmation({
    connectionId:'conn-1',draftId:'draft-1',approvalToken:approval,agentId:'muse-agent',subjectId:'human-1',approvalSecret:'approval-secret',
    authority:{resolve:async()=>connection} as any,
    drafts:{verifyForExecution:async()=>{throw Error('must_not_load_draft');}} as any,
    runtime:{} as any,execution:{} as any
  } as any),/consumer_commerce_enrollment_required/);
});


// --- Shop Pay vehicle (additional, alongside Stripe) ---
const shopPayState={...state,paymentVehicle:'shop_pay' as const,payment:{provider:'shop_pay' as const,externalAccountId:'acct-1'}};
const shopPayApproval=issueApprovalToken({
  subjectId:'human-1',companyId:'org-a',connectionId:'conn-1',draftId:'draft-1',
  draftHash,amount:58.32,currency:'USD',paymentAuthorizationReference:'shop-pay-ref-1',expiresAt:'2099-01-01T00:00:00Z'
},'approval-secret','2026-10-25T00:00:00Z');
function shopPaySubmit(overrides:any={}){
  return submitMuseConfirmation({
    connectionId:'conn-1',draftId:'draft-1',approvalToken:overrides.approvalToken??shopPayApproval,agentId:'muse-agent',subjectId:'human-1',
    approvalSecret:'approval-secret',
    authority:{async resolve(){return connection as any;},async consumeOnce(){if(overrides.onConsume) overrides.onConsume();return true;}} as any,
    drafts:{async verifyForExecution(){return {connection,draft,draftHash,state:overrides.state??shopPayState} as any;}} as any,
    runtime:{async quoteVariants(){return {quote:overrides.livePricing??pricing};},async quoteLandedTotal(){return {quote:overrides.liveLanded??landed};}} as any,
    savedShopPayAuthorization:{reference:'shop-pay-ref-1'},
    ...(overrides.extra??{}),
    execution:{async createCheckout(){if(overrides.onExecute) overrides.onExecute();throw new Error('must_not_execute');}} as any
  });
}

test('Shop Pay confirmation with a valid approval is blocked by name, without execution or approval consumption',async()=>{
  let executed=false;let consumed=false;
  await assert.rejects(shopPaySubmit({onExecute:()=>{executed=true;},onConsume:()=>{consumed=true;}}),/shop_pay_execution_blocked/);
  assert.equal(executed,false);
  assert.equal(consumed,false);
});

test('Shop Pay confirmation requires reapproval when live landed total drifts, exactly like Stripe',async()=>{
  await assert.rejects(shopPaySubmit({liveLanded:{...landed,total:'59.32'}}),/provider_checkout_reapproval_required/);
});

test('Shop Pay confirmation rejects a Stripe authorization substituted for the Shop Pay reference',async()=>{
  await assert.rejects(submitMuseConfirmation({
    connectionId:'conn-1',draftId:'draft-1',approvalToken:shopPayApproval,agentId:'muse-agent',subjectId:'human-1',approvalSecret:'approval-secret',
    authority:{async resolve(){return connection as any;},async consumeOnce(){throw new Error('must_not_consume');}} as any,
    drafts:{async verifyForExecution(){return {connection,draft,draftHash,state:shopPayState} as any;}} as any,
    runtime:{async quoteVariants(){return {quote:pricing};},async quoteLandedTotal(){return {quote:landed};}} as any,
    savedStripeAuthorization:{reference:'seti_saved_1',customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'},
    execution:{async createCheckout(){throw new Error('must_not_execute');}} as any
  }),/consumer_commerce_enrollment_required/);
});

test('Shop Pay confirmation rejects an approval bound to a different payment reference',async()=>{
  const wrongRef=issueApprovalToken({subjectId:'human-1',companyId:'org-a',connectionId:'conn-1',draftId:'draft-1',
    draftHash,amount:58.32,currency:'USD',paymentAuthorizationReference:'shop-pay-other',expiresAt:'2099-01-01T00:00:00Z'},'approval-secret','2026-10-25T00:00:00Z');
  await assert.rejects(shopPaySubmit({approvalToken:wrongRef}),/approval_payment_authorization_mismatch/);
});

test('Shop Pay confirmation reports a not-ready vehicle distinctly from the execution block',async()=>{
  await assert.rejects(shopPaySubmit({extra:{shopPayReadiness:{businessReadiness:'CONNECTED',shopPayVehicleReady:false}}}),/shop_pay_vehicle_not_ready/);
  await assert.rejects(shopPaySubmit({extra:{shopPayReadiness:{businessReadiness:'TRANSACTION_READY',shopPayVehicleReady:true}}}),/shop_pay_execution_blocked/);
});

test('Stripe confirmation is unchanged when the draft carries no vehicle field (legacy default)',async()=>{
  let captured:any;
  const result=await submitMuseConfirmation({
    connectionId:'conn-1',draftId:'draft-1',approvalToken:approval,agentId:'muse-agent',subjectId:'human-1',approvalSecret:'approval-secret',
    authority:{async resolve(){return connection as any;},async consumeOnce(){return true;}} as any,
    drafts:{async verifyForExecution(){return {connection,draft,draftHash,state} as any;}} as any,
    runtime:{async quoteVariants(){return {quote:pricing};},async quoteLandedTotal(){return {quote:landed};}} as any,
    savedStripeAuthorization:{reference:'seti_saved_1',customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'},
    execution:{async createCheckout(args:any){captured=args;return {checkoutSessionId:'cs_legacy'};}} as any
  });
  assert.equal(result.checkoutSessionId,'cs_legacy');
  assert.equal(captured.paymentVehicle,'stripe');
});
