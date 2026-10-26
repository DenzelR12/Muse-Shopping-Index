import test from 'node:test';
import assert from 'node:assert/strict';
import {bindShopIdentity,consumerCommitGate,stripeSavedPaymentAuthorization,PostgresConsumerCommerceIdentityStore} from '../dist/consumer-commerce-identity.js';

test('consumer commit requires verified Shop identity, payment authorization and explicit approval',()=>{
  assert.deepEqual(
    consumerCommitGate({identity:null,approved:false}),
    {ready:false,missing:['shop_identity','payment_authorization','explicit_approval']}
  );

  const identity=bindShopIdentity({
    subjectId:'consumer-1',
    shopUserPublicId:'shop-user-public-123',
    email:'buyer@example.com',
    verifiedAt:'2026-10-25T19:00:00Z',
    paymentAuthorization:{
      rail:'shop_pay',
      reference:'shop-pay-authorization-1',
      verifiedAt:'2026-10-25T19:00:05Z'
    }
  });

  assert.deepEqual(consumerCommitGate({identity,approved:false}),{
    ready:false,
    missing:['explicit_approval']
  });
  assert.deepEqual(consumerCommitGate({identity,approved:true}),{
    ready:true,
    missing:[]
  });
});

test('Stripe is a consumer payment rail, not a merchant-account identity requirement',()=>{
  const identity=bindShopIdentity({
    subjectId:'consumer-2',
    shopUserPublicId:'shop-user-public-456',
    verifiedAt:'2026-10-25T19:00:00Z',
    paymentAuthorization:{
      rail:'stripe',
      reference:'saved-stripe-authorization-123',
      verifiedAt:'2026-10-25T19:00:05Z',
      customerId:'cus_123',
      paymentMethodId:'pm_123',
      usage:'off_session'
    }
  });
  assert.equal(consumerCommitGate({identity,approved:true}).ready,true);
  assert.deepEqual(stripeSavedPaymentAuthorization(identity),{reference:'saved-stripe-authorization-123',customerId:'cus_123',paymentMethodId:'pm_123',usage:'off_session'});
});


test('saved Stripe authorization rejects malformed reusable identifiers',()=>{
  const identity=bindShopIdentity({
    subjectId:'consumer-3',
    shopUserPublicId:'shop-user-public-789',
    verifiedAt:'2026-10-25T19:00:00Z',
    paymentAuthorization:{
      rail:'stripe',
      reference:'saved-stripe-authorization-bad',
      verifiedAt:'2026-10-25T19:00:05Z',
      customerId:'bad-customer',
      paymentMethodId:'pm_123',
      usage:'off_session'
    }
  });
  assert.throws(()=>stripeSavedPaymentAuthorization(identity),/stripe_customer_id_invalid/);
});


test('server identity store resolves saved Stripe authorization only by consumer subject',async()=>{
  let saved:any=null;
  const pool={
    async query(sql:string,params:unknown[]=[]){
      if(sql.includes('CREATE TABLE')) return {rows:[]};
      if(sql.includes('INSERT INTO consumer_commerce_identities')){
        saved={
          subject_id:params[0],
          shop_user_public_id:params[1],
          email:params[2],
          shop_identity_verified_at:params[3],
          payment_rail:params[4],
          payment_reference:params[5],
          payment_verified_at:params[6],
          stripe_customer_id:params[7],
          stripe_payment_method_id:params[8],
          payment_usage:params[9]
        };
        return {rows:[]};
      }
      if(sql.includes('FROM consumer_commerce_identities')){
        return {rows:saved&&saved.subject_id===params[0]?[saved]:[]};
      }
      throw new Error('unexpected_query');
    }
  };
  const store=new PostgresConsumerCommerceIdentityStore(pool as any);
  await store.save(bindShopIdentity({
    subjectId:'consumer-server-1',
    shopUserPublicId:'shop-public-1',
    verifiedAt:'2026-10-25T19:00:00Z',
    paymentAuthorization:{
      rail:'stripe',
      reference:'saved-authorization-1',
      verifiedAt:'2026-10-25T19:00:05Z',
      customerId:'cus_server_1',
      paymentMethodId:'pm_server_1',
      usage:'off_session'
    }
  }));
  assert.deepEqual(
    await store.resolveStripeSavedPayment('consumer-server-1'),
    {reference:'saved-authorization-1',customerId:'cus_server_1',paymentMethodId:'pm_server_1',usage:'off_session'}
  );
  assert.equal(await store.resolveStripeSavedPayment('other-consumer'),null);
});

test('server identity store returns null for non-Stripe payment rails',async()=>{
  const row={
    subject_id:'consumer-shop-pay',
    shop_user_public_id:'shop-public-2',
    email:null,
    shop_identity_verified_at:'2026-10-25T19:00:00Z',
    payment_rail:'shop_pay',
    payment_reference:'shop-pay-ref',
    payment_verified_at:'2026-10-25T19:00:05Z',
    stripe_customer_id:null,
    stripe_payment_method_id:null,
    payment_usage:null
  };
  const store=new PostgresConsumerCommerceIdentityStore({
    async query(sql:string){
      if(sql.includes('CREATE TABLE')) return {rows:[]};
      return {rows:[row]};
    }
  } as any);
  assert.equal(await store.resolveStripeSavedPayment('consumer-shop-pay'),null);
});
