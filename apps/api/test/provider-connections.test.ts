import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresProviderConnectionStore} from '../dist/provider-connections.js';

function fakePool(){
  const rows=new Map();
  return {
    async query(sql,params=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('CREATE UNIQUE INDEX')) return {rows:[]};
      if(sql.includes('SELECT company_id FROM provider_connections WHERE provider=$1 AND external_account_id=$2')){
        const [provider,externalAccountId]=params;
        const match=[...rows.values()].find(row=>row.provider===provider&&row.external_account_id===externalAccountId);
        return {rows:match?[{company_id:match.company_id}]:[]};
      }
      if(sql.includes("FROM provider_connections")&&sql.includes("provider='shopify'")&&sql.includes("lower(external_account_id)")){
        const [companyId,externalAccountId]=params;
        return {rows:[...rows.values()]
          .filter(row=>row.company_id===companyId&&row.provider==='shopify'&&String(row.external_account_id).toLowerCase()===String(externalAccountId).toLowerCase())
          .slice(0,2)
          .map(row=>({external_account_id:row.external_account_id}))};
      }
      if(sql.includes('INSERT INTO provider_connections')){
        const [companyId,provider,externalAccountId,granted,tokenExpiresAt]=params;
        const key=[companyId,provider,externalAccountId].join('|');
        rows.set(key,{
          company_id:companyId,
          provider,
          external_account_id:externalAccountId,
          granted_capabilities:JSON.parse(granted),
          token_expires_at:tokenExpiresAt,
          last_sync_at:null,
          last_sync_error:null,
          revoked_at:null,
          created_at:new Date('2026-10-24T17:00:00Z'),
          updated_at:new Date('2026-10-24T17:00:00Z')
        });
        return {rows:[]};
      }
      if(sql.includes('WHERE company_id=$1 AND provider=$2 AND external_account_id=$3')&&sql.includes('SELECT')){
        const key=params.slice(0,3).join('|');
        return {rows:rows.has(key)?[rows.get(key)]:[]};
      }
      if(sql.includes('WHERE company_id=$1')&&sql.includes('ORDER BY provider')){
        return {rows:[...rows.values()].filter(row=>row.company_id===params[0])};
      }
      if(sql.includes('SET last_sync_at=$4')){
        const key=params.slice(0,3).join('|');
        const row=rows.get(key);
        if(!row) return {rows:[]};
        row.last_sync_at=new Date(params[3]);
        row.last_sync_error=null;
        row.updated_at=new Date('2026-10-24T18:00:00Z');
        return {rows:[row]};
      }
      if(sql.includes('SET last_sync_error=$4')){
        const key=params.slice(0,3).join('|');
        const row=rows.get(key);
        if(!row) return {rows:[]};
        row.last_sync_error=params[3];
        return {rows:[row]};
      }
      if(sql.includes('SET revoked_at=now()')){
        const key=params.slice(0,3).join('|');
        const row=rows.get(key);
        if(!row) return {rows:[]};
        row.revoked_at=new Date('2026-10-24T18:00:00Z');
        return {rows:[row]};
      }
      throw new Error('unexpected_query');
    }
  };
}

test('provider connection store keeps organizations isolated',async()=>{
  const store=new PostgresProviderConnectionStore(fakePool());
  await store.upsert({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    grantedCapabilities:['catalog.read'],
    tokenExpiresAt:'2026-10-24T19:00:00Z'
  });
  await store.upsert({
    companyId:'org-b',
    provider:'ebay',
    externalAccountId:'seller-2',
    grantedCapabilities:['inventory.read']
  });
  const a=await store.list('org-a');
  const b=await store.list('org-b');
  assert.equal(a.length,1);
  assert.equal(a[0].provider,'walmart');
  assert.equal(b.length,1);
  assert.equal(b[0].provider,'ebay');
});

test('sync and revoke updates are scoped to exact provider account',async()=>{
  const store=new PostgresProviderConnectionStore(fakePool());
  await store.upsert({
    companyId:'org-a',
    provider:'etsy',
    externalAccountId:'shop-1',
    grantedCapabilities:['catalog.read']
  });
  const synced=await store.markSyncSuccess('org-a','etsy','shop-1','2026-10-24T17:30:00Z');
  assert.equal(synced.lastSyncAt,'2026-10-24T17:30:00.000Z');

  const revoked=await store.revoke('org-a','etsy','shop-1');
  assert.ok(revoked.revokedAt);

  const missing=await store.revoke('org-b','etsy','shop-1');
  assert.equal(missing,null);
});

test('sync errors are bounded before persistence',async()=>{
  const store=new PostgresProviderConnectionStore(fakePool());
  await store.upsert({
    companyId:'org-a',
    provider:'ebay',
    externalAccountId:'seller-1',
    grantedCapabilities:['catalog.read']
  });
  const updated=await store.markSyncError('org-a','ebay','seller-1','x'.repeat(1000));
  assert.equal(updated.lastSyncError.length,500);
});

test('Shopify connection writes canonicalize shop identity',async()=>{
  const store=new PostgresProviderConnectionStore(fakePool());
  const created=await store.upsert({
    companyId:'org-a',
    provider:'shopify',
    externalAccountId:'  Example.MyShopify.Com  ',
    grantedCapabilities:['catalog.read']
  });
  assert.equal(created.externalAccountId,'example.myshopify.com');
});

test('Shopify connection writes fail closed on legacy noncanonical identity',async()=>{
  const pool=fakePool();
  await pool.query(
    'INSERT INTO provider_connections',
    ['org-a','shopify','Example.MyShopify.Com','["catalog.read"]',null]
  );
  const store=new PostgresProviderConnectionStore(pool);
  await assert.rejects(
    store.upsert({
      companyId:'org-a',
      provider:'shopify',
      externalAccountId:'example.myshopify.com',
      grantedCapabilities:['catalog.read']
    }),
    /provider_connection_identity_noncanonical/
  );
});


test('provider connection store rejects cross-tenant duplicate provider account claims',async()=>{
  const store=new PostgresProviderConnectionStore(fakePool());
  await store.upsert({
    companyId:'org-a',
    provider:'walmart',
    externalAccountId:'seller-1',
    grantedCapabilities:['order.read']
  });
  await assert.rejects(
    store.upsert({
      companyId:'org-b',
      provider:'walmart',
      externalAccountId:'seller-1',
      grantedCapabilities:['order.read']
    }),
    /provider_account_already_claimed/
  );
});
