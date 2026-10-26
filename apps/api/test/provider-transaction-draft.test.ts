import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderTransactionDraftService} from '../dist/provider-transaction-draft.js';

function authority(){
  const envelopes=new Map<string,any>();
  const connection={
    connectionId:'conn-1',
    companyId:'org-a',
    subjectId:'human-1',
    grantedActions:['create_action_draft','execute_action'],
    secretRef:'vault:test',
    createdAt:'2026-10-25T00:00:00Z'
  };
  return {
    envelopes,
    async resolve(id:string){return id==='conn-1'?structuredClone(connection):null;},
    async save(envelope:any){envelopes.set(envelope.draftId,structuredClone(envelope));},
    async get(id:string){const value=envelopes.get(id);return value?structuredClone(value):null;}
  };
}

const input={
  companyId:'org-a',
  connectionId:'conn-1',
  payment:{provider:'stripe' as const,externalAccountId:'acct-1'},
  fulfillment:{
    provider:'shopify' as const,
    externalAccountId:'example-shop.myshopify.com',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:2}],
    shippingAddress:{address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
    landedQuote:{
      currency:'USD',
      subtotal:'125.50',
      tax:'10.04',
      shipping:{handle:'ground',title:'Ground',amount:'7.50'},
      total:'143.04'
    }
  },
  amount:143.04,
  currency:'USD',
  pricing:{currency:'USD',lines:[{variantId:'gid://shopify/ProductVariant/123',quantity:2,unitPrice:'62.75',availableForSale:true,inventoryQuantity:10}]},
  description:'Approved gift order',
  successUrl:'https://example.test/success',
  cancelUrl:'https://example.test/cancel',
  now:new Date('2026-10-25T02:00:00Z')
};

test('signed provider transaction draft round-trips exact execution state',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create(input);
  assert.match(created.displayedDraftHash,/^[a-f0-9]{64}$/);
  assert.equal(created.draft.total,143.04);
  assert.deepEqual(created.approvalEnvelope,{
    connectionId:'conn-1',
    draftId:created.draft.draftId,
    displayedDraftHash:created.displayedDraftHash,
    expiresAt:created.draft.expiresAt,
    description:'Approved gift order',
    seller:{provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
    items:[{variantId:'gid://shopify/ProductVariant/123',quantity:2,unitPrice:'62.75'}],
    shippingAddress:input.fulfillment.shippingAddress,
    shipping:{handle:'ground',title:'Ground',amount:'7.50'},
    paymentVehicle:'stripe',
    payment:{provider:'stripe',externalAccountId:'acct-1'},
    subtotal:'125.50',
    tax:'10.04',
    total:'143.04',
    currency:'USD'
  });
  assert.deepEqual(created.draft.providerState.fulfillment.lineItems,input.fulfillment.lineItems);
  assert.deepEqual(created.draft.providerState.pricing,input.pricing);

  const verified=await service.verifyForExecution({
    companyId:'org-a',
    connectionId:'conn-1',
    draftId:created.draft.draftId,
    now:new Date('2026-10-25T02:01:00Z')
  });
  assert.equal(verified.draftHash,created.displayedDraftHash);
  assert.equal(verified.state.payment.externalAccountId,'acct-1');
  assert.deepEqual(verified.state.fulfillment.lineItems,input.fulfillment.lineItems);
  assert.deepEqual(verified.state.fulfillment.shippingAddress,input.fulfillment.shippingAddress);
  assert.deepEqual(verified.state.fulfillment.landedQuote,input.fulfillment.landedQuote);
  assert.deepEqual(verified.state.pricing,input.pricing);
});

test('tampering with approved provider state invalidates the signed draft',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create(input);
  const envelope=auth.envelopes.get(created.draft.draftId);
  envelope.payload.providerState.fulfillment.lineItems[0].quantity=99;
  auth.envelopes.set(created.draft.draftId,envelope);

  await assert.rejects(
    service.verifyForExecution({
      companyId:'org-a',
      connectionId:'conn-1',
      draftId:created.draft.draftId,
      now:new Date('2026-10-25T02:01:00Z')
    }),
    /draft_payload_tampered/
  );
});

test('draft creation requires a connection authorized for draft and execute actions',async()=>{
  const auth=authority();
  const original=auth.resolve;
  auth.resolve=async(id:string)=>{
    const value=await original(id);
    return value?{...value,grantedActions:['create_action_draft']}:null;
  };
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  await assert.rejects(service.create(input),/connection_transaction_actions_not_granted/);
});


test('signed draft rejects partial shipping state without a matching landed quote',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create(input);
  const envelope=auth.envelopes.get(created.draft.draftId);
  delete envelope.payload.providerState.fulfillment.landedQuote;
  const {signDraft}=await import('@gift-signal/zero-trust');
  const resigned=signDraft(envelope.payload,'draft-secret',envelope.signedAt);
  auth.envelopes.set(created.draft.draftId,resigned);
  await assert.rejects(
    service.verifyForExecution({
      companyId:'org-a',
      connectionId:'conn-1',
      draftId:created.draft.draftId,
      now:new Date('2026-10-25T02:01:00Z')
    }),
    /provider_transaction_draft_state_invalid/
  );
});


test('draft creation rejects any landed total that differs from the amount being approved',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  await assert.rejects(
    service.create({...input,amount:143.03}),
    /provider_landed_quote_total_mismatch/
  );
  assert.equal(auth.envelopes.size,0);
});

test('draft creation carries a validated seller display name and item titles into the signed approval envelope',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create({
    ...input,
    sellerDisplayName:'Demo Seller',
    itemTitles:{'gid://shopify/ProductVariant/123':'Assassin’s Creed Black Flag'}
  });
  assert.equal(created.approvalEnvelope.seller.displayName,'Demo Seller');
  assert.equal(created.approvalEnvelope.items[0].title,'Assassin’s Creed Black Flag');
  assert.equal(created.draft.providerState.fulfillment.sellerDisplayName,'Demo Seller');
  assert.equal(created.draft.providerState.pricing.lines[0].title,'Assassin’s Creed Black Flag');
  const verified=await service.verifyForExecution({
    companyId:'org-a',
    connectionId:'conn-1',
    draftId:created.draft.draftId,
    now:new Date('2026-10-25T02:01:00Z')
  });
  assert.equal(verified.state.fulfillment.sellerDisplayName,'Demo Seller');
  assert.equal(verified.state.pricing.lines[0].title,'Assassin’s Creed Black Flag');
});

test('draft creation without display data leaves the envelope without a name or title, so a review must fail closed',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create(input);
  assert.equal(created.approvalEnvelope.seller.displayName,undefined);
  assert.equal(created.approvalEnvelope.items[0].title,undefined);
});

test('draft creation rejects a seller name derived from the shop domain and a title equal to a variant ID',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  await assert.rejects(
    service.create({...input,sellerDisplayName:'example-shop.myshopify.com'}),
    /muse_review_seller_display_required/
  );
  await assert.rejects(
    service.create({...input,itemTitles:{'gid://shopify/ProductVariant/123':'gid://shopify/ProductVariant/123'}}),
    /muse_review_item_title_required/
  );
  assert.equal(auth.envelopes.size,0);
});

test('draft creation carries validated terms, payment timing, and estimated arrival into the signed approval envelope',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create({
    ...input,
    terms:'Returns within 30 days of delivery.',
    paymentTiming:'Charged when you approve this exact transaction.',
    estimatedArrival:'October 28, 2026'
  });
  assert.equal(created.approvalEnvelope.terms,'Returns within 30 days of delivery.');
  assert.equal(created.approvalEnvelope.paymentTiming,'Charged when you approve this exact transaction.');
  assert.equal(created.approvalEnvelope.estimatedArrival,'October 28, 2026');
  assert.equal(created.draft.providerState.terms,'Returns within 30 days of delivery.');
  assert.equal(created.draft.providerState.paymentTiming,'Charged when you approve this exact transaction.');
  assert.equal(created.draft.providerState.estimatedArrival,'October 28, 2026');
  const verified=await service.verifyForExecution({
    companyId:'org-a',
    connectionId:'conn-1',
    draftId:created.draft.draftId,
    now:new Date('2026-10-25T02:01:00Z')
  });
  assert.equal(verified.state.terms,'Returns within 30 days of delivery.');
  assert.equal(verified.state.paymentTiming,'Charged when you approve this exact transaction.');
  assert.equal(verified.state.estimatedArrival,'October 28, 2026');
});

test('draft creation without review facts leaves the envelope without them, so a review shows not available',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create(input);
  assert.equal(created.approvalEnvelope.terms,undefined);
  assert.equal(created.approvalEnvelope.paymentTiming,undefined);
  assert.equal(created.approvalEnvelope.estimatedArrival,undefined);
});

test('draft creation rejects a raw-ID or over-long review fact and saves no envelope',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  await assert.rejects(
    service.create({...input,terms:'gid://shopify/ProductVariant/123'}),
    /muse_review_fact_invalid/
  );
  await assert.rejects(
    service.create({...input,paymentTiming:'x'.repeat(1001)}),
    /muse_review_fact_invalid/
  );
  await assert.rejects(
    service.create({...input,estimatedArrival:'acct_123'}),
    /muse_review_fact_invalid/
  );
  assert.equal(auth.envelopes.size,0);
});

test('Shop Pay draft carries paymentVehicle shop_pay through the signed envelope and verifies it',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create({...input,payment:{provider:'shop_pay' as const,externalAccountId:'acct-1'},paymentVehicle:'shop_pay' as const});
  assert.equal(created.approvalEnvelope.paymentVehicle,'shop_pay');
  assert.equal(created.approvalEnvelope.payment.provider,'shop_pay');
  assert.equal(created.draft.providerState.paymentVehicle,'shop_pay');
  const verified=await service.verifyForExecution({companyId:'org-a',connectionId:'conn-1',draftId:created.draft.draftId,now:new Date('2026-10-25T02:01:00Z')});
  assert.equal(verified.state.paymentVehicle,'shop_pay');
  assert.equal(verified.state.payment.provider,'shop_pay');
});

test('Shop Pay draft defaults paymentVehicle from payment.provider when the field is omitted',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create({...input,payment:{provider:'shop_pay' as const,externalAccountId:'acct-1'}});
  assert.equal(created.approvalEnvelope.paymentVehicle,'shop_pay');
});

test('legacy Stripe draft without a vehicle field still verifies as stripe',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  const created=await service.create(input);
  assert.equal(created.approvalEnvelope.paymentVehicle,'stripe');
  assert.equal(created.draft.providerState.paymentVehicle,'stripe');
});

test('draft creation rejects a paymentVehicle that disagrees with payment.provider and saves nothing',async()=>{
  const auth=authority();
  const service=new ProviderTransactionDraftService(auth as any,'draft-secret');
  await assert.rejects(service.create({...input,paymentVehicle:'shop_pay' as const}),/provider_transaction_payment_vehicle_mismatch/);
  assert.equal(auth.envelopes.size,0);
});
