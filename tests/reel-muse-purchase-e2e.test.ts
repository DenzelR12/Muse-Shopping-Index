import test from 'node:test';
import assert from 'node:assert/strict';
import {runMuseToolAgent} from '../apps/demo/src/muse-tool-agent.js';
import {createReelCommerceIntent} from '../apps/demo/src/reel-commerce.js';
import {museConfirmationSheet} from '../apps/storefront/src/muse-confirmation.js';
import {submitMuseConfirmation} from '../apps/api/src/muse-confirmation-submit.js';
import {applyPaidPaymentFulfillment} from '../apps/api/src/provider-webhooks.js';
import {issueApprovalToken} from '../packages/zero-trust/src/index.js';

const pricing={
  currency:'USD',
  lines:[{
    variantId:'gid://shopify/ProductVariant/123',
    quantity:1,
    unitPrice:'54.00',
    availableForSale:true,
    inventoryQuantity:4
  }]
};

const landed={
  currency:'USD',
  subtotal:'54.00',
  tax:'4.32',
  shipping:{handle:'free',title:'Free shipping',amount:'0.00'},
  total:'58.32'
};

const state={
  payment:{provider:'stripe' as const,externalAccountId:'acct-1'},
  fulfillment:{
    provider:'shopify' as const,
    externalAccountId:'example-shop.myshopify.com',
    lineItems:[{variantId:'gid://shopify/ProductVariant/123',quantity:1}],
    shippingAddress:{
      firstName:'Buyer',
      lastName:'Example',
      address1:'123 Main St',
      city:'Atlanta',
      provinceCode:'GA',
      countryCode:'US',
      zip:'30303'
    },
    landedQuote:landed
  },
  pricing,
  description:'Black wireless gaming headset',
  successUrl:'https://example.test/success',
  cancelUrl:'https://example.test/cancel'
};

const connection={
  connectionId:'conn-e2e',
  companyId:'org-a',
  subjectId:'consumer-e2e',
  grantedActions:['create_action_draft','execute_action'],
  secretRef:'vault:test',
  createdAt:'2026-10-25T00:00:00Z'
};

const draft={draftId:'draft-e2e',total:58.32,currency:'USD'} as any;
const draftHash='b'.repeat(64);

function approval(){
  return issueApprovalToken({
    subjectId:'consumer-e2e',
    companyId:'org-a',
    connectionId:'conn-e2e',
    draftId:'draft-e2e',
    draftHash,
    amount:58.32,
    currency:'USD',
    paymentAuthorizationReference:'seti_e2e',
    expiresAt:'2099-01-01T00:00:00Z'
  },'approval-secret','2026-10-25T00:00:00Z');
}

test('native Muse tool protocol reaches verified payment and Shopify order without merchant handoff (mocked model)',async()=>{
  const reel=await createReelCommerceIntent({
    source:{
      platform:'meta',
      reelId:'reel-e2e',
      creatorId:'creator-e2e',
      caption:'Black wireless gaming headset',
      productHints:['gaming headset']
    },
    offers:[{
      offerId:'offer-e2e',
      companyId:'org-a',
      entityId:'product-1',
      kind:'PRODUCT',
      title:'Black wireless gaming headset',
      summary:'Wireless headset',
      price:54,
      currency:'USD',
      availability:'AVAILABLE',
      fulfillmentMode:'SHIP',
      attributes:{category:'gaming'},
      intents:['gaming','headset'],
      actions:['BUY'],
      evidence:[{
        sourceId:'catalog-1',
        observedAt:'2026-10-25T00:00:00.000Z',
        sourceType:'CATALOG',
        fields:['title','price','availability']
      }]
    }] as any,
    now:new Date('2026-10-25T00:05:00.000Z')
  });

  assert.equal(reel.source.reelId,'reel-e2e');
  assert.equal(reel.next,'MUSE_REVIEW');
  assert.equal(reel.merchantHandoffRequired,false);
  assert.equal(reel.results[0]?.offer.offerId,'offer-e2e');

  const sheet=museConfirmationSheet({
    connectionId:'conn-e2e',
    draftId:'draft-e2e',
    displayedDraftHash:draftHash,
    expiresAt:'2099-01-01T00:00:00Z',
    description:state.description,
    seller:{provider:'shopify',externalAccountId:'example-shop.myshopify.com'},
    items:[{variantId:'gid://shopify/ProductVariant/123',quantity:1,unitPrice:'54.00'}],
    shippingAddress:state.fulfillment.shippingAddress,
    shipping:landed.shipping,
    payment:{provider:'stripe',externalAccountId:'acct-1'},
    subtotal:landed.subtotal,
    tax:landed.tax,
    total:landed.total,
    currency:landed.currency
  });
  assert.equal(sheet.approvalLabel,'Buy now');
  assert.equal(sheet.total,'58.32');

  let approvalConsumes=0;
  const transaction:any={
    companyId:'org-a',
    draftId:'draft-e2e',
    consumerSubjectId:'consumer-e2e',
    state:'CHECKOUT_PENDING',
    fulfillmentPayload:{lineItems:state.fulfillment.lineItems},
    fulfillmentProvider:'shopify',
    fulfillmentExternalAccountId:'example-shop.myshopify.com',
    providerDraftOrderId:'gid://shopify/DraftOrder/55',
    amount:58.32,
    currency:'USD'
  };

  const submit=()=>submitMuseConfirmation({
    connectionId:'conn-e2e',
    draftId:'draft-e2e',
    approvalToken:approval(),
    agentId:'muse-agent',
    subjectId:'consumer-e2e',
    consumerEmail:'buyer@example.com',
    approvalSecret:'approval-secret',
    authority:{
      async resolve(id:string){assert.equal(id,'conn-e2e');return connection as any;},
      async consumeOnce(key:string){assert.match(key,/^approval:/);approvalConsumes++;return true;}
    } as any,
    drafts:{
      async verifyForExecution(){
        return {connection,draft,draftHash,state} as any;
      }
    } as any,
    runtime:{
      async quoteVariants(){return {quote:pricing};},
      async quoteLandedTotal(){return {quote:landed};}
    } as any,
    savedStripeAuthorization:{
      reference:'seti_e2e',
      customerId:'cus_e2e',
      paymentMethodId:'pm_e2e',
      usage:'off_session'
    },
    execution:{
      async createCheckout(args:any){
        assert.equal(args.consumerSubjectId,'consumer-e2e');
        assert.equal(args.consumerEmail,'buyer@example.com');
        assert.equal(args.savedStripeAuthorization.reference,'seti_e2e');
        await args.approval.consume();
        transaction.state='CHECKOUT_CREATED';
        transaction.paymentReference='pi_e2e';
        transaction.paymentReferenceKind='payment_intent';
        return {
          paymentIntentId:'pi_e2e',
          status:'succeeded',
          paymentRail:'stripe',
          handoff:{required:false,kind:'none',provider:'stripe'},
          paymentReference:'pi_e2e',
          paymentReferenceKind:'payment_intent',
          execution:{fulfillmentMode:'server_api',merchantHandoffRequired:false}
        };
      }
    } as any
  });

  let payment:any;
  let modelCalls=0;
  const agent=await runMuseToolAgent({
    userMessage:'Buy the exact reviewed Reel product.',
    configuration:{apiKey:'mock-only',baseUrl:'https://model.invalid/v1',model:'mock-muse'},
    host:{
      async readContext(){return {
        intentId:reel.intentId,productResolved:true,businessReady:true,consumerEnrolled:true,missingDetails:[],
        draft:{draftId:'draft-e2e',draftHash,expiresAt:'2099-01-01T00:00:00Z',paymentAuthorizationReference:'seti_e2e'},
        approval:{verified:true,draftId:'draft-e2e',draftHash,expiresAt:'2099-01-01T00:00:00Z',paymentAuthorizationReference:'seti_e2e'},
        ...(transaction.state==='CHECKOUT_CREATED'?{execution:{state:'IN_PROGRESS' as const,draftId:'draft-e2e'}}:{})
      };},
      async dispatch(step){
        if(step.action==='execute_approved_purchase') payment=await submit();
        else assert.equal(step.action,'read_order');
        return {status:'payment_processing'};
      }
    },
    fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[{
      id:'call-'+modelCalls,type:'function',function:{name:modelCalls++===0?'execute_approved_purchase':'read_order',arguments:JSON.stringify({draftId:'draft-e2e'})}
    }]}}]}))
  });
  assert.equal(agent.stop,'WAITING');
  assert.equal(modelCalls,2);
  assert.deepEqual(agent.trace.map(step=>step.action),['execute_approved_purchase','read_order']);
  assert.equal(payment.handoff.required,false);
  assert.equal(approvalConsumes,1);

  const fulfillment=await applyPaidPaymentFulfillment({
    paymentReference:'pi_e2e',
    paymentReferenceKind:'payment_intent',
    intents:{
      async claimPaidPayment(reference:string,kind:string){
        assert.equal(reference,'pi_e2e');
        assert.equal(kind,'payment_intent');
        assert.equal(transaction.state,'CHECKOUT_CREATED');
        transaction.state='ORDER_EXECUTING';
        return transaction;
      },
      async markOrderCreated(companyId:string,draftId:string,providerOrderId:string){
        assert.equal(companyId,'org-a');
        assert.equal(draftId,'draft-e2e');
        transaction.state='ORDER_CREATED';
        transaction.providerOrderId=providerOrderId;
        return transaction;
      },
      async markReconcileRequired(){
        transaction.state='RECONCILE_REQUIRED';
        return transaction;
      }
    } as any,
    orderControl:{
      async completeDraftOrder(key:any,args:any){
        assert.equal(key.companyId,'org-a');
        assert.equal(key.provider,'shopify');
        assert.equal(args.draftOrderId,'gid://shopify/DraftOrder/55');
        return {result:{providerOrderId:'gid://shopify/Order/9001'}};
      },
      async createOrder(){throw new Error('legacy_order_create_must_not_run');}
    } as any
  });

  assert.equal(fulfillment.fulfillmentState,'ORDER_CREATED');
  assert.equal(transaction.state,'ORDER_CREATED');
  assert.equal(transaction.consumerSubjectId,'consumer-e2e');
  assert.equal(transaction.providerOrderId,'gid://shopify/Order/9001');
});

test('Reel purchase fails closed on landed-total drift before approval consumption or payment',async()=>{
  let consumes=0;
  let executions=0;
  await assert.rejects(
    submitMuseConfirmation({
      connectionId:'conn-e2e',
      draftId:'draft-e2e',
      approvalToken:approval(),
      agentId:'muse-agent',
      subjectId:'consumer-e2e',
      approvalSecret:'approval-secret',
      authority:{
        async resolve(){return connection as any;},
        async consumeOnce(){consumes++;return true;}
      } as any,
      drafts:{
        async verifyForExecution(){return {connection,draft,draftHash,state} as any;}
      } as any,
      runtime:{
        async quoteVariants(){return {quote:pricing};},
        async quoteLandedTotal(){
          return {quote:{...landed,total:'59.32'}};
        }
      } as any,
      savedStripeAuthorization:{
        reference:'seti_e2e',
        customerId:'cus_e2e',
        paymentMethodId:'pm_e2e',
        usage:'off_session'
      },
      execution:{
        async createCheckout(){executions++;throw new Error('must_not_execute');}
      } as any
    }),
    /provider_checkout_reapproval_required/
  );
  assert.equal(consumes,0);
  assert.equal(executions,0);
});

