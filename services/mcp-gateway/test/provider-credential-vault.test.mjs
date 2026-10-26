import test from 'node:test';
import assert from 'node:assert/strict';
import {
  openProviderToken,
  sealProviderToken,
  PostgresTenantProviderCredentialVault
} from '../dist/provider-credential-vault.js';

const env={
  PROVIDER_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')
};

test('provider token ciphertext is bound to exact tenant provider account tuple',()=>{
  const keyA={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  const keyB={companyId:'org-b',provider:'ebay',externalAccountId:'seller-1'};
  const sealed=sealProviderToken('access-value',keyA,env);
  assert.equal(openProviderToken(sealed,keyA,env),'access-value');
  assert.throws(()=>openProviderToken(sealed,keyB,env),/provider_token_tenant_mismatch/);
  assert.throws(
    ()=>openProviderToken(sealed,{...keyA,provider:'walmart'},env),
    /provider_token_tenant_mismatch/
  );
  assert.throws(
    ()=>openProviderToken(sealed,{...keyA,externalAccountId:'seller-2'},env),
    /provider_token_tenant_mismatch/
  );
});

function fakePool(){
  const rows=new Map();
  const stale=(row,keyId)=>{
    const parts=String(row.access_token_ciphertext).split('.');
    if(parts[0]!=='v2'||parts[1]!==keyId) return true;
    if(row.refresh_token_ciphertext){
      const refresh=String(row.refresh_token_ciphertext).split('.');
      if(refresh[0]!=='v2'||refresh[1]!==keyId) return true;
    }
    return false;
  };
  return {
    async query(sql,params=[]){
      if(sql.includes('CREATE TABLE')||sql.includes('CREATE UNIQUE INDEX')) return {rows:[],rowCount:0};
      if(sql.includes('COUNT(*)::int AS remaining')){
        const [companyId,keyId]=params;
        const remaining=[...rows.values()].filter(row=>row.company_id===companyId&&stale(row,keyId)).length;
        return {rows:[{remaining}],rowCount:1};
      }
      if(sql.includes('ORDER BY updated_at ASC')&&sql.includes('LIMIT $3')){
        const [companyId,keyId,limit]=params;
        const matches=[...rows.values()]
          .filter(row=>row.company_id===companyId&&stale(row,keyId))
          .slice(0,Number(limit))
          .map(row=>({
            company_id:row.company_id,
            provider:row.provider,
            external_account_id:row.external_account_id
          }));
        return {rows:matches,rowCount:matches.length};
      }
      if(sql.includes('SELECT company_id FROM provider_credentials WHERE provider=$1 AND external_account_id=$2')){
        const [provider,externalAccountId]=params;
        const match=[...rows.values()].find(row=>row.provider===provider&&row.external_account_id===externalAccountId);
        return {rows:match?[{company_id:match.company_id}]:[],rowCount:match?1:0};
      }
      if(sql.includes('INSERT INTO provider_credentials')){
        const [companyId,provider,externalAccountId,accessCipher,refreshCipher,tokenType,scope,expiresAt]=params;
        const key=[companyId,provider,externalAccountId].join('|');
        const current=rows.get(key);
        rows.set(key,{
          company_id:companyId,
          provider,
          external_account_id:externalAccountId,
          access_token_ciphertext:accessCipher,
          refresh_token_ciphertext:refreshCipher,
          token_type:tokenType,
          scope,
          expires_at:new Date(expiresAt),
          credential_version:(current?.credential_version??0)+1,
          updated_at:new Date('2026-10-24T18:00:00Z')
        });
        return {rows:[],rowCount:1};
      }
      if(sql.includes('FROM provider_credentials')&&sql.includes('SELECT')){
        const key=params.slice(0,3).join('|');
        return {rows:rows.has(key)?[rows.get(key)]:[],rowCount:rows.has(key)?1:0};
      }
      if(sql.includes('DELETE FROM provider_credentials')){
        const key=params.slice(0,3).join('|');
        const existed=rows.delete(key);
        return {rows:existed?[{company_id:params[0]}]:[],rowCount:existed?1:0};
      }
      throw new Error('unexpected_query');
    }
  };
}

test('provider token keyring decrypts old key ids after current key rotation',()=>{
  const key={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  const oldKey=Buffer.alloc(32,11).toString('base64');
  const newKey=Buffer.alloc(32,12).toString('base64');
  const oldEnv={
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'old',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({old:oldKey})
  };
  const rotatedEnv={
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'new',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({old:oldKey,new:newKey})
  };

  const sealedOld=sealProviderToken('old-access',key,oldEnv);
  assert.match(sealedOld,/^v2\.old\./);
  assert.equal(openProviderToken(sealedOld,key,rotatedEnv),'old-access');

  const sealedNew=sealProviderToken('new-access',key,rotatedEnv);
  assert.match(sealedNew,/^v2\.new\./);
  assert.equal(openProviderToken(sealedNew,key,rotatedEnv),'new-access');
});

test('provider token keyring fails closed when ciphertext key id is retired',()=>{
  const key={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  const oldKey=Buffer.alloc(32,21).toString('base64');
  const newKey=Buffer.alloc(32,22).toString('base64');
  const sealed=sealProviderToken('access',key,{
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'old',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({old:oldKey})
  });
  assert.throws(
    ()=>openProviderToken(sealed,key,{
      PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'new',
      PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({new:newKey})
    }),
    /provider_token_key_unavailable/
  );
});

test('legacy v1 ciphertext remains readable during migration',()=>{
  const key={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  const sealedV2=sealProviderToken('legacy-access',key,env);
  const [,keyId,iv,tag,ciphertext]=sealedV2.split('.');
  assert.equal(keyId,'primary');
  const sealedV1=['v1',iv,tag,ciphertext].join('.');
  assert.equal(openProviderToken(sealedV1,key,env),'legacy-access');
});

test('credential vault rejects a provider account already claimed by another tenant',async()=>{
  const vault=new PostgresTenantProviderCredentialVault(fakePool(),env);
  await vault.save(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {
      provider:'ebay',
      externalAccountId:'seller-1',
      accessToken:'org-a-access',
      refreshToken:'org-a-refresh',
      tokenType:'Bearer',
      expiresAt:'2026-10-24T19:00:00Z'
    }
  );
  await assert.rejects(
    vault.save(
      {companyId:'org-b',provider:'ebay',externalAccountId:'seller-1'},
      {
        provider:'ebay',
        externalAccountId:'seller-1',
        accessToken:'org-b-access',
        refreshToken:'org-b-refresh',
        tokenType:'Bearer',
        expiresAt:'2026-10-24T19:00:00Z'
      }
    ),
    /provider_account_already_claimed/
  );
  const a=await vault.load({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'});
  assert.equal(a.token.accessToken,'org-a-access');
});

test('credential save rejects provider and account mismatches',async()=>{
  const vault=new PostgresTenantProviderCredentialVault(fakePool(),env);
  await assert.rejects(
    vault.save(
      {companyId:'org-a',provider:'walmart',externalAccountId:'seller-1'},
      {
        provider:'ebay',
        externalAccountId:'seller-1',
        accessToken:'value',
        tokenType:'Bearer',
        expiresAt:'2026-10-24T19:00:00Z'
      }
    ),
    /provider_token_provider_mismatch/
  );
});

test('credential rekey rewrites ciphertext under the active key without changing token values',async()=>{
  const pool=fakePool();
  const oldKey=Buffer.alloc(32,31).toString('base64');
  const newKey=Buffer.alloc(32,32).toString('base64');
  const oldEnv={
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'old',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({old:oldKey})
  };
  const rotatedEnv={
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'new',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({old:oldKey,new:newKey})
  };
  const key={companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'};
  const oldVault=new PostgresTenantProviderCredentialVault(pool,oldEnv);
  await oldVault.save(key,{
    provider:'ebay',
    externalAccountId:'seller-1',
    accessToken:'access-value',
    refreshToken:'refresh-value',
    tokenType:'Bearer',
    expiresAt:'2026-10-24T19:00:00Z'
  });

  const rotatedVault=new PostgresTenantProviderCredentialVault(pool,rotatedEnv);
  const before=await rotatedVault.load(key);
  const after=await rotatedVault.rekey(key);

  assert.equal(after.token.accessToken,'access-value');
  assert.equal(after.token.refreshToken,'refresh-value');
  assert.equal(after.version,before.version+1);

  const newOnlyVault=new PostgresTenantProviderCredentialVault(pool,{
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'new',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({new:newKey})
  });
  const migrated=await newOnlyVault.load(key);
  assert.equal(migrated.token.accessToken,'access-value');
  assert.equal(migrated.token.refreshToken,'refresh-value');
});


test('credential revoke is scoped to exact tenant tuple',async()=>{
  const vault=new PostgresTenantProviderCredentialVault(fakePool(),env);
  await vault.save(
    {companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'},
    {
      provider:'ebay',
      externalAccountId:'seller-1',
      accessToken:'org-a-access',
      tokenType:'Bearer',
      expiresAt:'2026-10-24T19:00:00Z'
    }
  );

  assert.equal(
    await vault.revoke({companyId:'org-b',provider:'ebay',externalAccountId:'seller-1'}),
    false
  );
  assert.ok(await vault.load({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'}));

  assert.equal(
    await vault.revoke({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'}),
    true
  );
  assert.equal(
    await vault.load({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'}),
    null
  );
});

test('batch rekey migrates only one tenant and reports remaining stale credentials',async()=>{
  const pool=fakePool();
  const oldKey=Buffer.alloc(32,41).toString('base64');
  const newKey=Buffer.alloc(32,42).toString('base64');
  const oldEnv={
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'old',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({old:oldKey})
  };
  const rotatedEnv={
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'new',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({old:oldKey,new:newKey})
  };
  const oldVault=new PostgresTenantProviderCredentialVault(pool,oldEnv);
  for(const [companyId,externalAccountId] of [['org-a','seller-1'],['org-a','seller-2'],['org-b','seller-3']]){
    await oldVault.save(
      {companyId,provider:'ebay',externalAccountId},
      {
        provider:'ebay',
        externalAccountId,
        accessToken:'access-'+externalAccountId,
        refreshToken:'refresh-'+externalAccountId,
        tokenType:'Bearer',
        expiresAt:'2099-01-01T00:00:00Z'
      }
    );
  }

  const rotatedVault=new PostgresTenantProviderCredentialVault(pool,rotatedEnv);
  const first=await rotatedVault.rekeyBatch('org-a',1);
  assert.deepEqual(first,{companyId:'org-a',currentKeyId:'new',migrated:1,remaining:1});

  const second=await rotatedVault.rekeyBatch('org-a',100);
  assert.deepEqual(second,{companyId:'org-a',currentKeyId:'new',migrated:1,remaining:0});

  const newOnlyVault=new PostgresTenantProviderCredentialVault(pool,{
    PROVIDER_TOKEN_ENCRYPTION_KEY_ID:'new',
    PROVIDER_TOKEN_ENCRYPTION_KEYS:JSON.stringify({new:newKey})
  });
  const migrated=await newOnlyVault.load({companyId:'org-a',provider:'ebay',externalAccountId:'seller-1'});
  assert.ok(migrated);
  await assert.rejects(
    newOnlyVault.load({companyId:'org-b',provider:'ebay',externalAccountId:'seller-3'}),
    /provider_token_key_unavailable/
  );
});
