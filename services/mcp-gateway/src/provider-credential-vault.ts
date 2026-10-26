import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import type {ProviderTokenSet} from './provider-token-exchange.js';

export interface ProviderCredentialKey {
  companyId:string;
  provider:string;
  externalAccountId:string;
}

export interface StoredProviderCredential extends ProviderCredentialKey {
  token:ProviderTokenSet;
  version:number;
  updatedAt:string;
}

function decodeKey(raw:string,errorCode:string){
  const decoded=Buffer.from(raw,'base64');
  if(decoded.length!==32) throw new Error(errorCode);
  return decoded;
}

function legacyMasterKey(env:NodeJS.ProcessEnv=process.env){
  const raw=env.PROVIDER_TOKEN_ENCRYPTION_KEY;
  if(!raw) throw new Error('provider_token_encryption_key_not_configured');
  return decodeKey(raw,'provider_token_encryption_key_invalid');
}

function keyring(env:NodeJS.ProcessEnv=process.env){
  const currentKeyId=(env.PROVIDER_TOKEN_ENCRYPTION_KEY_ID??'primary').trim();
  if(!currentKeyId) throw new Error('provider_token_encryption_key_id_invalid');

  const entries=new Map<string,Buffer>();
  if(env.PROVIDER_TOKEN_ENCRYPTION_KEYS){
    let parsed:unknown;
    try{parsed=JSON.parse(env.PROVIDER_TOKEN_ENCRYPTION_KEYS);}
    catch{throw new Error('provider_token_encryption_keys_invalid');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){
      throw new Error('provider_token_encryption_keys_invalid');
    }
    for(const [id,value] of Object.entries(parsed as Record<string,unknown>)){
      if(!id.trim()||typeof value!=='string') throw new Error('provider_token_encryption_keys_invalid');
      entries.set(id,decodeKey(value,'provider_token_encryption_keys_invalid'));
    }
  }

  if(env.PROVIDER_TOKEN_ENCRYPTION_KEY&&!entries.has(currentKeyId)){
    entries.set(currentKeyId,legacyMasterKey(env));
  }
  const current=entries.get(currentKeyId);
  if(!current) throw new Error('provider_token_current_key_not_configured');
  return {currentKeyId,current,entries};
}

export function currentProviderTokenKeyId(env:NodeJS.ProcessEnv=process.env){
  return keyring(env).currentKeyId;
}

function aadFor(key:ProviderCredentialKey){
  return Buffer.from(
    ['gift-signal-provider-token-v1',key.companyId,key.provider,key.externalAccountId].join('\n'),
    'utf8'
  );
}

function tenantKey(key:ProviderCredentialKey,master:Buffer){
  return createHmac('sha256',master)
    .update('tenant-provider-key-v1\n')
    .update(key.companyId)
    .update('\n')
    .update(key.provider)
    .update('\n')
    .update(key.externalAccountId)
    .digest();
}

export function sealProviderToken(
  plaintext:string,
  key:ProviderCredentialKey,
  env:NodeJS.ProcessEnv=process.env
){
  const {currentKeyId,current}=keyring(env);
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',tenantKey(key,current),iv);
  cipher.setAAD(aadFor(key));
  const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return ['v2',currentKeyId,iv.toString('base64url'),tag.toString('base64url'),ciphertext.toString('base64url')].join('.');
}

export function openProviderToken(
  sealed:string,
  key:ProviderCredentialKey,
  env:NodeJS.ProcessEnv=process.env
){
  const parts=sealed.split('.');
  let master:Buffer;
  let ivText:string|undefined;
  let tagText:string|undefined;
  let cipherText:string|undefined;

  if(parts[0]==='v1'){
    [,ivText,tagText,cipherText]=parts;
    master=legacyMasterKey(env);
  }else if(parts[0]==='v2'){
    const [,keyId,iv,tag,ciphertext]=parts;
    if(!keyId||!iv||!tag||!ciphertext) throw new Error('invalid_provider_token_ciphertext');
    const ring=keyring(env);
    const selected=ring.entries.get(keyId);
    if(!selected) throw new Error('provider_token_key_unavailable');
    master=selected;
    ivText=iv;
    tagText=tag;
    cipherText=ciphertext;
  }else{
    throw new Error('invalid_provider_token_ciphertext');
  }

  if(!ivText||!tagText||!cipherText) throw new Error('invalid_provider_token_ciphertext');
  const decipher=createDecipheriv('aes-256-gcm',tenantKey(key,master),Buffer.from(ivText,'base64url'));
  decipher.setAAD(aadFor(key));
  decipher.setAuthTag(Buffer.from(tagText,'base64url'));
  try{
    return Buffer.concat([
      decipher.update(Buffer.from(cipherText,'base64url')),
      decipher.final()
    ]).toString('utf8');
  }catch{
    throw new Error('provider_token_tenant_mismatch');
  }
}

export class PostgresTenantProviderCredentialVault {
  private initialized=false;
  constructor(
    private readonly pool:Pool,
    private readonly env:NodeJS.ProcessEnv=process.env
  ){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_credentials (
        company_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_account_id TEXT NOT NULL,
        access_token_ciphertext TEXT NOT NULL,
        refresh_token_ciphertext TEXT,
        token_type TEXT NOT NULL,
        scope TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        credential_version INTEGER NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(company_id, provider, external_account_id)
      )
    `);
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS provider_credentials_global_owner_uq
      ON provider_credentials(provider, external_account_id)
    `);
    this.initialized=true;
  }

  async save(key:ProviderCredentialKey,token:ProviderTokenSet){
    await this.init();
    if(token.provider!==key.provider) throw new Error('provider_token_provider_mismatch');
    if(token.externalAccountId!==key.externalAccountId) throw new Error('provider_token_account_mismatch');

    const owner=await this.pool.query(
      `SELECT company_id FROM provider_credentials WHERE provider=$1 AND external_account_id=$2 LIMIT 1`,
      [key.provider,key.externalAccountId]
    );
    if(owner.rows[0]&&String(owner.rows[0].company_id)!==key.companyId){
      throw new Error('provider_account_already_claimed');
    }

    try{
      await this.pool.query(
      `INSERT INTO provider_credentials
       (company_id,provider,external_account_id,access_token_ciphertext,refresh_token_ciphertext,
        token_type,scope,expires_at,credential_version,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,now())
       ON CONFLICT(company_id,provider,external_account_id) DO UPDATE SET
       access_token_ciphertext=EXCLUDED.access_token_ciphertext,
       refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
       token_type=EXCLUDED.token_type,
       scope=EXCLUDED.scope,
       expires_at=EXCLUDED.expires_at,
       credential_version=provider_credentials.credential_version+1,
       updated_at=now()`,
      [
        key.companyId,
        key.provider,
        key.externalAccountId,
        sealProviderToken(token.accessToken,key,this.env),
        token.refreshToken?sealProviderToken(token.refreshToken,key,this.env):null,
        token.tokenType,
        token.scope??null,
        token.expiresAt
      ]
      );
    }catch(error){
      if((error as {code?:string})?.code==='23505') throw new Error('provider_account_already_claimed');
      throw error;
    }
  }

  async load(key:ProviderCredentialKey):Promise<StoredProviderCredential|null>{
    await this.init();
    const result=await this.pool.query(
      `SELECT company_id,provider,external_account_id,access_token_ciphertext,refresh_token_ciphertext,
              token_type,scope,expires_at,credential_version,updated_at
       FROM provider_credentials
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3`,
      [key.companyId,key.provider,key.externalAccountId]
    );
    const row=result.rows[0];
    if(!row) return null;
    const rowKey={
      companyId:String(row.company_id),
      provider:String(row.provider),
      externalAccountId:String(row.external_account_id)
    };
    if(
      rowKey.companyId!==key.companyId||
      rowKey.provider!==key.provider||
      rowKey.externalAccountId!==key.externalAccountId
    ) throw new Error('provider_credential_scope_mismatch');

    return {
      ...rowKey,
      token:{
        provider:rowKey.provider as ProviderTokenSet['provider'],
        externalAccountId:rowKey.externalAccountId,
        accessToken:openProviderToken(String(row.access_token_ciphertext),rowKey,this.env),
        refreshToken:row.refresh_token_ciphertext
          ? openProviderToken(String(row.refresh_token_ciphertext),rowKey,this.env)
          : undefined,
        tokenType:String(row.token_type),
        expiresAt:new Date(row.expires_at).toISOString(),
        scope:row.scope?String(row.scope):undefined
      },
      version:Number(row.credential_version),
      updatedAt:new Date(row.updated_at).toISOString()
    };
  }


  async rekey(key:ProviderCredentialKey){
    const credential=await this.load(key);
    if(!credential) return null;
    await this.save(key,credential.token);
    return this.load(key);
  }

  async rekeyBatch(companyId:string,limit=100){
    await this.init();
    const boundedLimit=Math.max(1,Math.min(100,Math.trunc(limit)||100));
    const currentKeyId=currentProviderTokenKeyId(this.env);
    const stalePredicate=`
      company_id=$1 AND (
        split_part(access_token_ciphertext,'.',1)<>'v2'
        OR split_part(access_token_ciphertext,'.',2)<>$2
        OR (
          refresh_token_ciphertext IS NOT NULL AND (
            split_part(refresh_token_ciphertext,'.',1)<>'v2'
            OR split_part(refresh_token_ciphertext,'.',2)<>$2
          )
        )
      )`;
    const candidates=await this.pool.query(
      `SELECT company_id,provider,external_account_id
       FROM provider_credentials
       WHERE ${stalePredicate}
       ORDER BY updated_at ASC
       LIMIT $3`,
      [companyId,currentKeyId,boundedLimit]
    );
    let migrated=0;
    for(const row of candidates.rows){
      const key={
        companyId:String(row.company_id),
        provider:String(row.provider),
        externalAccountId:String(row.external_account_id)
      };
      const credential=await this.load(key);
      if(!credential) continue;
      await this.save(key,credential.token);
      migrated+=1;
    }
    const remainingResult=await this.pool.query(
      `SELECT COUNT(*)::int AS remaining
       FROM provider_credentials
       WHERE ${stalePredicate}`,
      [companyId,currentKeyId]
    );
    return {
      companyId,
      currentKeyId,
      migrated,
      remaining:Number(remainingResult.rows[0]?.remaining??0)
    };
  }

  async revoke(key:ProviderCredentialKey){
    await this.init();
    const result=await this.pool.query(
      `DELETE FROM provider_credentials
       WHERE company_id=$1 AND provider=$2 AND external_account_id=$3
       RETURNING company_id`,
      [key.companyId,key.provider,key.externalAccountId]
    );
    return result.rowCount===1;
  }
}
