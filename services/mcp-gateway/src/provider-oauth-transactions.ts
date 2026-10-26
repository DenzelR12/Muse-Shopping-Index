import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {
  buildProviderAuthorization,
  createPkcePair,
  verifyProviderState,
  verifyShopifyOAuthCallback,
  type OAuthProvider
} from './provider-oauth.js';
import type {VaultBackedProviderRuntime} from './provider-runtime.js';

const MAX_AGE_MS=10*60*1000;

function transactionKey(env:NodeJS.ProcessEnv=process.env){
  const raw=env.PROVIDER_OAUTH_TRANSACTION_SECRET;
  if(!raw) throw new Error('provider_oauth_transaction_secret_not_configured');
  const decoded=Buffer.from(raw,'base64');
  if(decoded.length!==32) throw new Error('provider_oauth_transaction_secret_invalid');
  return decoded;
}

function hashState(state:string){
  return createHash('sha256').update(state).digest('hex');
}

function sealVerifier(verifier:string,stateHash:string,env:NodeJS.ProcessEnv){
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',transactionKey(env),iv);
  cipher.setAAD(Buffer.from('gift-signal-oauth-pkce-v1\n'+stateHash));
  const body=Buffer.concat([cipher.update(verifier,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),body.toString('base64url')].join('.');
}

function openVerifier(sealed:string,stateHash:string,env:NodeJS.ProcessEnv){
  const [version,ivText,tagText,bodyText]=sealed.split('.');
  if(version!=='v1'||!ivText||!tagText||!bodyText) throw new Error('invalid_provider_oauth_pkce');
  try{
    const decipher=createDecipheriv('aes-256-gcm',transactionKey(env),Buffer.from(ivText,'base64url'));
    decipher.setAAD(Buffer.from('gift-signal-oauth-pkce-v1\n'+stateHash));
    decipher.setAuthTag(Buffer.from(tagText,'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyText,'base64url')),
      decipher.final()
    ]).toString('utf8');
  }catch{
    throw new Error('provider_oauth_pkce_binding_mismatch');
  }
}

export interface ConsumedProviderOAuthTransaction {
  companyId:string;
  provider:OAuthProvider;
  redirectUri:string;
  codeVerifier?:string;
  sellerId?:string;
  shopDomain?:string;
}

export class PostgresProviderOAuthTransactionStore {
  private initialized=false;
  constructor(
    private readonly pool:Pool,
    private readonly env:NodeJS.ProcessEnv=process.env
  ){}

  private async init(){
    if(this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_oauth_transactions (
        state_hash TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        seller_id TEXT,
        shop_domain TEXT,
        pkce_verifier_ciphertext TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      ALTER TABLE provider_oauth_transactions
      ADD COLUMN IF NOT EXISTS seller_id TEXT
    `);
    await this.pool.query(`
      ALTER TABLE provider_oauth_transactions
      ADD COLUMN IF NOT EXISTS shop_domain TEXT
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS provider_oauth_transactions_expires_idx
      ON provider_oauth_transactions (expires_at)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS provider_oauth_transactions_consumed_idx
      ON provider_oauth_transactions (consumed_at)
      WHERE consumed_at IS NOT NULL
    `);
    this.initialized=true;
  }

  async begin(args:{
    companyId:string;
    provider:OAuthProvider;
    redirectUri:string;
    sellerId?:string;
    shopDomain?:string;
    env?:NodeJS.ProcessEnv;
  }){
    await this.init();
    await this.pool.query(`
      DELETE FROM provider_oauth_transactions
      WHERE expires_at<=now()
         OR (consumed_at IS NOT NULL AND consumed_at<now()-interval '1 hour')
    `);
    const env=args.env??this.env;
    if(args.provider==='shopify'&&!args.shopDomain) throw new Error('shopify_shop_domain_required');
    const pkce=args.provider==='etsy'?createPkcePair():undefined;
    const authorization=buildProviderAuthorization({
      provider:args.provider,
      companyId:args.companyId,
      redirectUri:args.redirectUri,
      pkceChallenge:pkce?.challenge,
      shopDomain:args.provider==='shopify'?args.shopDomain:undefined,
      env
    });
    const stateHash=hashState(authorization.state);
    const expiresAt=new Date(Date.now()+MAX_AGE_MS).toISOString();
    await this.pool.query(
      `INSERT INTO provider_oauth_transactions
       (state_hash,company_id,provider,redirect_uri,seller_id,shop_domain,pkce_verifier_ciphertext,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        stateHash,
        args.companyId,
        args.provider,
        args.redirectUri,
        null,
        args.provider==='shopify'?args.shopDomain?.trim().toLowerCase():null,
        pkce?sealVerifier(pkce.verifier,stateHash,env):null,
        expiresAt
      ]
    );
    return {
      provider:args.provider,
      authorizationUrl:authorization.authorizationUrl,
      state:authorization.state,
      expiresAt
    };
  }

  verifyCallback(state:string,callbackUrl?:URL){
    const verified=verifyProviderState(state,MAX_AGE_MS,this.env);
    if(verified.provider==='shopify'){
      if(!callbackUrl||!verified.shopDomain) throw new Error('shopify_oauth_callback_invalid');
      verifyShopifyOAuthCallback(callbackUrl,verified.shopDomain,this.env);
    }
    if(verified.provider==='walmart'){
      if(!callbackUrl) throw new Error('walmart_oauth_callback_invalid');
      const sellerId=callbackUrl.searchParams.get('sellerId')?.trim();
      const clientId=callbackUrl.searchParams.get('clientId')?.trim();
      const type=callbackUrl.searchParams.get('type')?.trim();
      const expectedClientId=this.env.WALMART_CLIENT_ID;
      if(!sellerId) throw new Error('walmart_oauth_seller_id_missing');
      if(!expectedClientId||clientId!==expectedClientId) throw new Error('walmart_oauth_client_id_mismatch');
      if(type!=='auth') throw new Error('walmart_oauth_callback_invalid');
      return {verified,walmartSellerId:sellerId};
    }
    return {verified};
  }

  async consume(state:string):Promise<ConsumedProviderOAuthTransaction>{
    await this.init();
    const verified=verifyProviderState(state,MAX_AGE_MS,this.env);
    const stateHash=hashState(state);
    const result=await this.pool.query(
      `UPDATE provider_oauth_transactions
       SET consumed_at=now()
       WHERE state_hash=$1
         AND company_id=$2
         AND provider=$3
         AND redirect_uri=$4
         AND consumed_at IS NULL
         AND expires_at>now()
       RETURNING company_id,provider,redirect_uri,seller_id,shop_domain,pkce_verifier_ciphertext`,
      [stateHash,verified.companyId,verified.provider,verified.redirectUri]
    );
    const row=result.rows[0];
    if(!row) throw new Error('provider_oauth_transaction_invalid_or_replayed');
    return {
      companyId:String(row.company_id),
      provider:String(row.provider) as OAuthProvider,
      redirectUri:String(row.redirect_uri),
      sellerId:row.seller_id?String(row.seller_id):undefined,
      shopDomain:row.shop_domain?String(row.shop_domain):undefined,
      codeVerifier:row.pkce_verifier_ciphertext
        ? openVerifier(String(row.pkce_verifier_ciphertext),stateHash,this.env)
        : undefined
    };
  }
}

export class ProviderOAuthCoordinator {
  constructor(
    private readonly transactions:PostgresProviderOAuthTransactionStore,
    private readonly runtime:VaultBackedProviderRuntime
  ){}

  async begin(args:{companyId:string;provider:OAuthProvider;redirectUri:string;sellerId?:string;shopDomain?:string}){
    return this.transactions.begin(args);
  }

  async complete(args:{
    state:string;
    code:string;
    callbackUrl?:URL;
    fetchImpl?:typeof fetch;
  }){
    const callback=this.transactions.verifyCallback(args.state,args.callbackUrl);
    const transaction=await this.transactions.consume(args.state);
    return this.runtime.completeAuthorization({
      companyId:transaction.companyId,
      provider:transaction.provider,
      code:args.code,
      redirectUri:transaction.redirectUri,
      sellerId:transaction.provider==='walmart'?callback.walmartSellerId:transaction.sellerId,
      shopDomain:transaction.shopDomain,
      codeVerifier:transaction.codeVerifier,
      fetchImpl:args.fetchImpl
    });
  }
}
