import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresProviderTransactionIntentStore} from '../dist/provider-transaction-store.js';

function fakePool(){
  const rows=new Map();
  return {
    async query(sql,params=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('ALTER TABLE')||sql.includes('CREATE INDEX')) return {rows:[],rowCount:0};
      if(sql.includes('INSERT INTO provider_transaction_intents')){
        const [companyId,draftId,paymentProvider,paymentExternalAccountId,consumerSubjectId,fulfillmentProvider,fulfillmentExternalAccountId,payload,amount,currency]=params;
        const key=companyId+'|'+draftId;
        if(!rows.has(key)){
          rows.set(key,{
            company_id:companyId,draft_id:draftId,payment_provider:paymentProvider,payment_external_account_id:paymentExternalAccountId,consumer_subject_id:consumerSubjectId,
            fulfillment_provider:fulfillmentProvider,fulfillment_external_account_id:fulfillmentExternalAccountId,
            fulfillment_payload:JSON.parse(payload),amount,currency,checkout_session_id:null,payment_reference:null,payment_reference_kind:null,provider_order_id:null,provider_draft_order_id:null,refund_id:null,
            state:'CHECKOUT_PENDING',created_at:new Date('2026-10-25T00:00:00Z'),updated_at:new Date('2026-10-25T00:00:00Z')
          });
        }
        return {rows:[],rowCount:1};
      }
      if(sql.includes('SELECT * FROM provider_transaction_intents WHERE consumer_subject_id=$1 AND draft_id=$2')){
        const row=[...rows.values()].find(value=>value.consumer_subject_id===params[0]&&value.draft_id===params[1]);
        return {rows:row?[row]:[],rowCount:row?1:0};
      }
      if(sql.includes('SELECT * FROM provider_transaction_intents WHERE company_id=$1 AND draft_id=$2')){
        const row=rows.get(params[0]+'|'+params[1]);
        return {rows:row?[row]:[],rowCount:row?1:0};
      }
      if(sql.includes("SET state='DRAFT_PREPARING'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='CHECKOUT_PENDING'||row.provider_draft_order_id) return {rows:[],rowCount:0};
        row.state='DRAFT_PREPARING';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("AND updated_at <= $3")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='DRAFT_PREPARING'||row.provider_draft_order_id) return {rows:[],rowCount:0};
        if(new Date(row.updated_at).getTime()>new Date(params[2]).getTime()) return {rows:[],rowCount:0};
        row.updated_at=new Date();
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET provider_draft_order_id=COALESCE")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||!['DRAFT_PREPARING','CHECKOUT_PENDING'].includes(row.state)) return {rows:[],rowCount:0};
        if(row.provider_draft_order_id&&row.provider_draft_order_id!==params[2]) return {rows:[],rowCount:0};
        row.provider_draft_order_id=row.provider_draft_order_id??params[2];row.state='CHECKOUT_PENDING';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("state='CHECKOUT_PENDING',updated_at=now()")&&sql.includes("state='DRAFT_PREPARING'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='DRAFT_PREPARING'||row.provider_draft_order_id) return {rows:[],rowCount:0};
        row.state='CHECKOUT_PENDING';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET payment_reference=COALESCE")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||!['CHECKOUT_PENDING','CHECKOUT_CREATED'].includes(row.state)) return {rows:[],rowCount:0};
        if(row.payment_reference&&row.payment_reference!==params[2]) return {rows:[],rowCount:0};
        if(row.payment_reference_kind&&row.payment_reference_kind!==params[3]) return {rows:[],rowCount:0};
        row.payment_reference=row.payment_reference??params[2];
        row.payment_reference_kind=row.payment_reference_kind??params[3];
        row.checkout_session_id=row.checkout_session_id??params[4];
        row.state='CHECKOUT_CREATED';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='PAYMENT_FALLBACK_PENDING'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||!['CHECKOUT_CREATED','PAYMENT_FALLBACK_PENDING'].includes(row.state)||row.payment_reference!==params[2]||row.payment_reference_kind!=='payment_intent') return {rows:[],rowCount:0};
        row.state='PAYMENT_FALLBACK_PENDING';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET payment_reference=$5")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||!['CHECKOUT_CREATED','PAYMENT_FALLBACK_PENDING'].includes(row.state)||row.payment_reference!==params[2]||row.payment_reference_kind!==params[3]) return {rows:[],rowCount:0};
        row.payment_reference=params[4];
        row.payment_reference_kind=params[5];
        row.checkout_session_id=params[4];
        row.state='CHECKOUT_CREATED';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='ORDER_EXECUTING'")&&sql.includes("payment_reference")){
        const row=[...rows.values()].find(value=>value.state==='CHECKOUT_CREATED'&&(
          (value.payment_reference===params[0]&&value.payment_reference_kind===params[1])||
          (params[1]==='checkout_session'&&!value.payment_reference&&value.checkout_session_id===params[0])
        ));
        if(!row) return {rows:[],rowCount:0};
        row.state='ORDER_EXECUTING';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='ORDER_CREATED',provider_order_id=$3,reconciliation_note=$4")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='RECONCILE_REQUIRED') return {rows:[],rowCount:0};
        row.state='ORDER_CREATED';row.provider_order_id=params[2];row.reconciliation_note=params[3];
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='ORDER_CREATED'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='ORDER_EXECUTING') return {rows:[],rowCount:0};
        row.state='ORDER_CREATED';row.provider_order_id=params[2];
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("WHERE company_id=$1 AND state='RECONCILE_REQUIRED'")){
        const [companyId,limit]=params;
        const matches=[...rows.values()].filter(row=>row.company_id===companyId&&row.state==='RECONCILE_REQUIRED').slice(0,Number(limit));
        return {rows:matches,rowCount:matches.length};
      }
      if(sql.includes("SET state='REFUND_REQUIRED',reconciliation_note=$3")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='RECONCILE_REQUIRED') return {rows:[],rowCount:0};
        row.state='REFUND_REQUIRED';row.reconciliation_note=params[2];
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("WHERE company_id=$1 AND state='REFUND_REQUIRED'")){
        const [companyId,limit]=params;
        const matches=[...rows.values()].filter(row=>row.company_id===companyId&&row.state==='REFUND_REQUIRED').slice(0,Number(limit));
        return {rows:matches,rowCount:matches.length};
      }
      if(sql.includes("SET state='REFUND_EXECUTING'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||!['REFUND_REQUIRED','REFUND_EXECUTING'].includes(row.state)) return {rows:[],rowCount:0};
        row.state='REFUND_EXECUTING';
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='REFUND_REQUIRED'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||!['REFUND_EXECUTING','REFUND_SUBMITTED'].includes(row.state)) return {rows:[],rowCount:0};
        row.state='REFUND_REQUIRED';
        if(params[2]) row.refund_id=params[2];
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='REFUND_SUBMITTED'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='REFUND_EXECUTING') return {rows:[],rowCount:0};
        row.state='REFUND_SUBMITTED';row.refund_id=params[2];
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='REFUNDED'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||!['REFUND_EXECUTING','REFUND_SUBMITTED'].includes(row.state)) return {rows:[],rowCount:0};
        row.state='REFUNDED';row.refund_id=params[2];
        return {rows:[row],rowCount:1};
      }
      if(sql.includes("SET state='RECONCILE_REQUIRED'")){
        const row=rows.get(params[0]+'|'+params[1]);
        if(!row||row.state!=='ORDER_EXECUTING') return {rows:[],rowCount:0};
        row.state='RECONCILE_REQUIRED';
        return {rows:[row],rowCount:1};
      }
      throw new Error('unexpected_query:'+sql);
    }
  };
}

const input={
  companyId:'org-a',draftId:'draft-1',
  paymentProvider:'stripe',paymentExternalAccountId:'acct-1',
  fulfillmentProvider:'shopify',fulfillmentExternalAccountId:'example.myshopify.com',
  fulfillmentPayload:{lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}]},
  amount:125.5,currency:'USD'
};

test('paid checkout claim is atomic and cannot be claimed twice',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending(input);
  await store.attachCheckout('org-a','draft-1','cs_123');
  const first=await store.claimPaidCheckout('cs_123');
  const second=await store.claimPaidCheckout('cs_123');
  assert.equal(first.state,'ORDER_EXECUTING');
  assert.equal(second,null);
  const created=await store.markOrderCreated('org-a','draft-1','gid://shopify/Order/9');
  assert.equal(created.state,'ORDER_CREATED');
  assert.equal(created.providerOrderId,'gid://shopify/Order/9');
});

test('uncertain execution is quarantined and cannot be automatically reclaimed',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-2'});
  await store.attachCheckout('org-a','draft-2','cs_456');
  const claimed=await store.claimPaidCheckout('cs_456');
  assert.equal(claimed.state,'ORDER_EXECUTING');
  const reconciled=await store.markReconcileRequired('org-a','draft-2');
  assert.equal(reconciled.state,'RECONCILE_REQUIRED');
  assert.equal(await store.claimPaidCheckout('cs_456'),null);
});


test('reconciliation queue is tenant scoped and resolution is one-time',async()=>{
  const pool=fakePool();
  const store=new PostgresProviderTransactionIntentStore(pool);
  await store.createPending({...input,draftId:'draft-r1'});
  await store.attachCheckout('org-a','draft-r1','cs_r1');
  await store.claimPaidCheckout('cs_r1');
  await store.markReconcileRequired('org-a','draft-r1');

  const queue=await store.listReconcileRequired('org-a',50);
  assert.equal(queue.length,1);
  assert.equal(queue[0].draftId,'draft-r1');
  assert.equal((await store.listReconcileRequired('org-b',50)).length,0);

  const resolved=await store.resolveReconciliation({
    companyId:'org-a',draftId:'draft-r1',resolution:'CONFIRM_ORDER',
    providerOrderId:'gid://shopify/Order/42',note:'Verified in Shopify admin.'
  });
  assert.equal(resolved.state,'ORDER_CREATED');
  assert.equal(resolved.providerOrderId,'gid://shopify/Order/42');
  assert.equal(resolved.reconciliationNote,'Verified in Shopify admin.');

  assert.equal(await store.resolveReconciliation({
    companyId:'org-a',draftId:'draft-r1',resolution:'NO_ORDER',note:'second attempt'
  }),null);
});

test('no-order reconciliation closes uncertainty without retrying order creation',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-r2'});
  await store.attachCheckout('org-a','draft-r2','cs_r2');
  await store.claimPaidCheckout('cs_r2');
  await store.markReconcileRequired('org-a','draft-r2');
  const resolved=await store.resolveReconciliation({
    companyId:'org-a',draftId:'draft-r2',resolution:'NO_ORDER',note:'Confirmed no order exists.'
  });
  assert.equal(resolved.state,'REFUND_REQUIRED');
  const queue=await store.listRefundRequired('org-a',50);
  assert.equal(queue.length,1);
  const refundClaim=await store.claimRefund('org-a','draft-r2');
  assert.equal(refundClaim.state,'REFUND_EXECUTING');
  const submitted=await store.markRefundSubmitted('org-a','draft-r2','re_123');
  assert.equal(submitted.state,'REFUND_SUBMITTED');
  const refunded=await store.markRefunded('org-a','draft-r2','re_123');
  assert.equal(refunded.state,'REFUNDED');
  assert.equal(refunded.refundId,'re_123');
  assert.equal(await store.claimPaidCheckout('cs_r2'),null);
});


test('refund execution can be retried from executing state after ambiguous persistence',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-r3'});
  await store.attachCheckout('org-a','draft-r3','cs_r3');
  await store.claimPaidCheckout('cs_r3');
  await store.markReconcileRequired('org-a','draft-r3');
  await store.resolveReconciliation({
    companyId:'org-a',draftId:'draft-r3',resolution:'NO_ORDER',note:'Confirmed no order exists.'
  });
  const first=await store.claimRefund('org-a','draft-r3');
  assert.equal(first.state,'REFUND_EXECUTING');
  const retry=await store.claimRefund('org-a','draft-r3');
  assert.equal(retry.state,'REFUND_EXECUTING');
  const submitted=await store.markRefundSubmitted('org-a','draft-r3','re_retry');
  assert.equal(submitted.state,'REFUND_SUBMITTED');
  const refunded=await store.markRefunded('org-a','draft-r3','re_retry');
  assert.equal(refunded.state,'REFUNDED');
});


test('Shopify draft preparation is atomic and persists exactly one draft id',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-shopify'});
  const first=await store.claimDraftPreparation('org-a','draft-shopify');
  const second=await store.claimDraftPreparation('org-a','draft-shopify');
  assert.equal(first.state,'DRAFT_PREPARING');
  assert.equal(second,null);
  const attached=await store.attachProviderDraftOrder('org-a','draft-shopify','gid://shopify/DraftOrder/55');
  assert.equal(attached.state,'CHECKOUT_PENDING');
  assert.equal(attached.providerDraftOrderId,'gid://shopify/DraftOrder/55');
  assert.equal(await store.claimDraftPreparation('org-a','draft-shopify'),null);
});


test('stale Shopify draft preparation can be reclaimed exactly once',async()=>{
  const pool=fakePool();
  const store=new PostgresProviderTransactionIntentStore(pool);
  await store.createPending({...input,draftId:'draft-stale'});
  await store.claimDraftPreparation('org-a','draft-stale');
  const reclaimed=await store.reclaimStaleDraftPreparation('org-a','draft-stale',new Date('2026-10-25T00:01:00Z'));
  assert.equal(reclaimed.state,'DRAFT_PREPARING');
  const second=await store.reclaimStaleDraftPreparation('org-a','draft-stale',new Date('2026-10-25T00:01:00Z'));
  assert.equal(second,null);
});


test('direct PaymentIntent reference is persisted and claimed exactly once',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-pi'});
  const attached=await store.attachPaymentReference('org-a','draft-pi',{reference:'pi_123',kind:'payment_intent'});
  assert.equal(attached.paymentReference,'pi_123');
  assert.equal(attached.paymentReferenceKind,'payment_intent');
  assert.equal(attached.checkoutSessionId,undefined);
  const first=await store.claimPaidPayment('pi_123','payment_intent');
  const second=await store.claimPaidPayment('pi_123','payment_intent');
  assert.equal(first.state,'ORDER_EXECUTING');
  assert.equal(second,null);
});


test('blocked PaymentIntent can transition once to checkout reference',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-fallback'});
  await store.attachPaymentReference('org-a','draft-fallback',{reference:'pi_blocked',kind:'payment_intent'});
  const replaced=await store.replacePaymentReference('org-a','draft-fallback',{
    fromReference:'pi_blocked',
    fromKind:'payment_intent',
    toReference:'cs_fallback',
    toKind:'checkout_session'
  });
  assert.equal(replaced.paymentReference,'cs_fallback');
  assert.equal(replaced.paymentReferenceKind,'checkout_session');
  assert.equal(replaced.checkoutSessionId,'cs_fallback');
  assert.equal(await store.replacePaymentReference('org-a','draft-fallback',{
    fromReference:'pi_blocked',
    fromKind:'payment_intent',
    toReference:'cs_other',
    toKind:'checkout_session'
  }),null);
});


test('canceled PaymentIntent persists fallback state until checkout reference replaces it',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-fallback-retry'});
  await store.attachPaymentReference('org-a','draft-fallback-retry',{reference:'pi_blocked_retry',kind:'payment_intent'});
  const pending=await store.markPaymentFallbackPending('org-a','draft-fallback-retry','pi_blocked_retry');
  assert.equal(pending.state,'PAYMENT_FALLBACK_PENDING');
  assert.equal(pending.paymentReference,'pi_blocked_retry');
  assert.equal(pending.paymentReferenceKind,'payment_intent');

  const replaced=await store.replacePaymentReference('org-a','draft-fallback-retry',{
    fromReference:'pi_blocked_retry',
    fromKind:'payment_intent',
    toReference:'cs_retry',
    toKind:'checkout_session'
  });
  assert.equal(replaced.state,'CHECKOUT_CREATED');
  assert.equal(replaced.paymentReference,'cs_retry');
  assert.equal(replaced.paymentReferenceKind,'checkout_session');
});


test('consumer-owned transaction lookup is scoped to verified subject',async()=>{
  const store=new PostgresProviderTransactionIntentStore(fakePool());
  await store.createPending({...input,draftId:'draft-consumer',consumerSubjectId:'consumer-1'});
  const owned=await store.getForConsumer('consumer-1','draft-consumer');
  assert.equal(owned?.consumerSubjectId,'consumer-1');
  assert.equal(owned?.draftId,'draft-consumer');
  assert.equal(await store.getForConsumer('consumer-2','draft-consumer'),null);
});
