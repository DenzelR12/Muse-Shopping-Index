import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PostgresProviderOAuthTransactionStore,
  ProviderOAuthCoordinator
} from '../dist/provider-oauth-transactions.js';

const env={
  PROVIDER_OAUTH_STATE_SECRET:'s'.repeat(64),
  PROVIDER_OAUTH_TRANSACTION_SECRET:Buffer.alloc(32,9).toString('base64'),
  ETSY_CLIENT_ID:'etsy-client',
  ETSY_OAUTH_SCOPES:'listings_r',
  SHOPIFY_CLIENT_ID:'shopify-client',
  SHOPIFY_CLIENT_SECRET:'shopify-secret',
  SHOPIFY_OAUTH_SCOPES:'read_products,read_orders'
};

function fakePool(){
  const rows=new Map();
  return {
    async query(sql,params=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('CREATE INDEX')||sql.includes('ALTER TABLE')) return {rows:[]};
      if(sql.includes('DELETE FROM provider_oauth_transactions')){
        for(const [key,row] of rows){
          if(row.expires_at.getTime()<=Date.now()||(row.consumed_at&&row.consumed_at.getTime()<Date.now()-60*60*1000)) rows.delete(key);
        }
        return {rows:[]};
      }
      if(sql.includes('INSERT INTO provider_oauth_transactions')){
        const [stateHash,companyId,provider,redirectUri,sellerId,shopDomain,pkce,expiresAt]=params;
        rows.set(stateHash,{
          state_hash:stateHash,
          company_id:companyId,
          provider,
          redirect_uri:redirectUri,
          seller_id:sellerId,
          shop_domain:shopDomain,
          pkce_verifier_ciphertext:pkce,
          expires_at:new Date(expiresAt),
          consumed_at:null
        });
        return {rows:[]};
      }
      if(sql.includes('UPDATE provider_oauth_transactions')){
        const [stateHash,companyId,provider,redirectUri]=params;
        const row=rows.get(stateHash);
        if(
          !row||
          row.company_id!==companyId||
          row.provider!==provider||
          row.redirect_uri!==redirectUri||
          row.consumed_at||
          row.expires_at.getTime()<=Date.now()
        ) return {rows:[]};
        row.consumed_at=new Date();
        return {rows:[row]};
      }
      throw new Error('unexpected_query');
    }
  };
}

test('OAuth transaction is consumable exactly once',async()=>{
  const store=new PostgresProviderOAuthTransactionStore(fakePool(),env);
  const started=await store.begin({
    companyId:'org-a',
    provider:'etsy',
    redirectUri:'https://example.test/callback'
  });
  const first=await store.consume(started.state);
  assert.equal(first.companyId,'org-a');
  assert.equal(first.provider,'etsy');
  assert.ok(first.codeVerifier);

  await assert.rejects(
    store.consume(started.state),
    /provider_oauth_transaction_invalid_or_replayed/
  );
});

test('tampered signed state is rejected before transaction lookup',async()=>{
  const store=new PostgresProviderOAuthTransactionStore(fakePool(),env);
  const started=await store.begin({
    companyId:'org-a',
    provider:'etsy',
    redirectUri:'https://example.test/callback'
  });
  const tampered=started.state.slice(0,-1)+(started.state.endsWith('a')?'b':'a');
  await assert.rejects(store.consume(tampered),/invalid_provider_oauth_state/);
});

test('coordinator passes only consumed transaction identity into runtime',async()=>{
  const store=new PostgresProviderOAuthTransactionStore(fakePool(),env);
  const started=await store.begin({
    companyId:'org-a',
    provider:'etsy',
    redirectUri:'https://example.test/callback'
  });
  let received;
  const runtime={
    async completeAuthorization(args){
      received=args;
      return {companyId:args.companyId,provider:args.provider,externalAccountId:'shop-1',expiresAt:'2099-01-01T00:00:00Z'};
    }
  };
  const coordinator=new ProviderOAuthCoordinator(store,runtime);
  const result=await coordinator.complete({state:started.state,code:'abc'});
  assert.equal(result.companyId,'org-a');
  assert.equal(received.companyId,'org-a');
  assert.equal(received.provider,'etsy');
  assert.equal(received.redirectUri,'https://example.test/callback');
  assert.ok(received.codeVerifier);
});

test('begin cleans expired OAuth transactions before inserting a new one',async()=>{
  const pool=fakePool();
  const store=new PostgresProviderOAuthTransactionStore(pool,env);
  const first=await store.begin({
    companyId:'org-a',
    provider:'etsy',
    redirectUri:'https://example.test/callback'
  });
  const consumed=await store.consume(first.state);
  assert.equal(consumed.companyId,'org-a');
  const second=await store.begin({
    companyId:'org-a',
    provider:'etsy',
    redirectUri:'https://example.test/callback'
  });
  assert.ok(second.authorizationUrl);
});

test('Walmart seller identity is bound from the provider callback',async()=>{
  const store=new PostgresProviderOAuthTransactionStore(fakePool(),{
    ...env,
    WALMART_CLIENT_ID:'walmart-client'
  });
  const started=await store.begin({
    companyId:'org-a',
    provider:'walmart',
    redirectUri:'https://example.test/callback'
  });
  let received;
  const runtime={
    async completeAuthorization(args){
      received=args;
      return {companyId:args.companyId,provider:args.provider,externalAccountId:args.sellerId,expiresAt:'2099-01-01T00:00:00Z'};
    }
  };
  const coordinator=new ProviderOAuthCoordinator(store,runtime);
  const callback=new URL('https://example.test/callback');
  callback.searchParams.set('state',started.state);
  callback.searchParams.set('code','abc');
  callback.searchParams.set('type','auth');
  callback.searchParams.set('clientId','walmart-client');
  callback.searchParams.set('sellerId','seller-from-walmart');
  await coordinator.complete({state:started.state,code:'abc',callbackUrl:callback});
  assert.equal(received.sellerId,'seller-from-walmart');
});

test('Walmart OAuth callback rejects missing or mismatched provider identity',async()=>{
  const makeStore=()=>new PostgresProviderOAuthTransactionStore(fakePool(),{
    ...env,
    WALMART_CLIENT_ID:'walmart-client'
  });
  const runtime={async completeAuthorization(args){return {companyId:args.companyId,provider:args.provider,externalAccountId:args.sellerId,expiresAt:'2099-01-01T00:00:00Z'};}};

  {
    const store=makeStore();
    const started=await store.begin({companyId:'org-a',provider:'walmart',redirectUri:'https://example.test/callback'});
    const callback=new URL('https://example.test/callback');
    callback.searchParams.set('state',started.state);
    callback.searchParams.set('code','abc');
    callback.searchParams.set('type','auth');
    callback.searchParams.set('clientId','walmart-client');
    await assert.rejects(
      new ProviderOAuthCoordinator(store,runtime).complete({state:started.state,code:'abc',callbackUrl:callback}),
      /walmart_oauth_seller_id_missing/
    );
  }

  {
    const store=makeStore();
    const started=await store.begin({companyId:'org-a',provider:'walmart',redirectUri:'https://example.test/callback'});
    const callback=new URL('https://example.test/callback');
    callback.searchParams.set('state',started.state);
    callback.searchParams.set('code','abc');
    callback.searchParams.set('type','auth');
    callback.searchParams.set('clientId','attacker-client');
    callback.searchParams.set('sellerId','seller-from-walmart');
    await assert.rejects(
      new ProviderOAuthCoordinator(store,runtime).complete({state:started.state,code:'abc',callbackUrl:callback}),
      /walmart_oauth_client_id_mismatch/
    );
  }
});


test('Shopify callback is HMAC verified and bound to the started shop before consume',async()=>{
  const store=new PostgresProviderOAuthTransactionStore(fakePool(),env);
  const started=await store.begin({
    companyId:'org-a',
    provider:'shopify',
    redirectUri:'https://example.test/callback',
    shopDomain:'Example-Shop.myshopify.com'
  });
  let received;
  const runtime={
    async completeAuthorization(args){
      received=args;
      return {companyId:args.companyId,provider:args.provider,externalAccountId:args.shopDomain,expiresAt:'2099-01-01T00:00:00Z'};
    }
  };
  const coordinator=new ProviderOAuthCoordinator(store,runtime);
  const callback=new URL('https://example.test/callback');
  callback.searchParams.set('code','abc');
  callback.searchParams.set('shop','example-shop.myshopify.com');
  callback.searchParams.set('state',started.state);
  callback.searchParams.set('timestamp','1700000000');
  const message=[...callback.searchParams.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');
  const {createHmac}=await import('node:crypto');
  callback.searchParams.set('hmac',createHmac('sha256',env.SHOPIFY_CLIENT_SECRET).update(message).digest('hex'));
  await coordinator.complete({state:started.state,code:'abc',callbackUrl:callback});
  assert.equal(received.shopDomain,'example-shop.myshopify.com');

  const replay=new URL(callback);
  replay.searchParams.set('shop','attacker.myshopify.com');
  await assert.rejects(
    coordinator.complete({state:started.state,code:'abc',callbackUrl:replay}),
    /shopify_oauth_shop_mismatch|shopify_oauth_hmac_invalid/
  );
});
