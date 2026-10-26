import type {ProviderCapability,ProviderCredentialKey,ShopifyLandedQuote,ShopifyShippingAddress,VaultBackedProviderRuntime} from '@gift-signal/mcp-gateway';
import type {PostgresProviderConnectionStore} from './provider-connections.js';
import type {ProviderSecurityAuditor} from './provider-security-audit.js';
import type {PostgresProviderReadinessEvidenceStore} from './provider-readiness-store.js';

export class ProviderRuntimeControlPlane {
  constructor(
    private readonly runtime:VaultBackedProviderRuntime,
    private readonly connections:PostgresProviderConnectionStore,
    private readonly auditor?:ProviderSecurityAuditor,
    private readonly readinessEvidence?:PostgresProviderReadinessEvidenceStore
  ){}

  async reconcileAuthorization(result:{
    companyId:string;
    provider:string;
    externalAccountId:string;
    expiresAt:string;
    scope?:string;
  }){
    await this.readinessEvidence?.resetAuthorizationEpoch(
      {companyId:result.companyId,provider:result.provider,externalAccountId:result.externalAccountId},
      {identityVerified:true,auditTrail:false}
    );
    const grantedCapabilities=result.provider==='shopify'
      ? shopifyCapabilitiesFromScope(result.scope)
      : undefined;
    const connection=await this.connections.reconcileAuthorization({
      companyId:result.companyId,
      provider:result.provider,
      externalAccountId:result.externalAccountId,
      tokenExpiresAt:result.expiresAt,
      grantedCapabilities
    });
    return connection;
  }

  async refresh(key:ProviderCredentialKey,args:{fetchImpl?:typeof fetch}={}){
    const existing=await this.connections.get(
      key.companyId,
      key.provider,
      key.externalAccountId
    );
    if(!existing) throw new Error('provider_connection_not_found');
    const refreshed=await this.runtime.refresh(key,args);
    const connection=await this.connections.updateTokenExpiry(
      key.companyId,
      key.provider,
      key.externalAccountId,
      refreshed.expiresAt
    );
    if(!connection) throw new Error('provider_connection_not_found');
    await this.auditor?.record('provider.credential.refreshed',{
      companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId
    });
    await this.readinessEvidence?.markTrusted(key,{
      providerRevalidation:true,
      auditTrail:Boolean(this.auditor)
    });
    return {connection};
  }

  async sync(key:ProviderCredentialKey,args:{
    kind:'catalog'|'inventory'|'listings';
    apiKey?:string;
    fetchImpl?:typeof fetch;
    limit?:number;
  }){
    const before=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!before) throw new Error('provider_connection_not_found');
    const recoveringFromSyncError=Boolean(before.lastSyncError);
    try{
      const items=await this.runtime.sync(key,args);
      const connection=await this.connections.markSyncSuccess(
        key.companyId,
        key.provider,
        key.externalAccountId
      );
      if(!connection) throw new Error('provider_connection_not_found');
      await this.auditor?.record('provider.sync.succeeded',{
        companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId,
        syncKind:args.kind,itemCount:items.length
      });
      if(args.kind==='catalog'||args.kind==='listings'){
        await this.readinessEvidence?.markTrusted(key,{
          catalogValidated:true,
          auditTrail:Boolean(this.auditor)
        });
      }
      if(recoveringFromSyncError){
        await this.auditor?.record('provider.recovery.verified',{
          companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId,
          syncKind:args.kind
        });
        await this.readinessEvidence?.markTrusted(key,{
          recoveryActions:true,
          auditTrail:Boolean(this.auditor)
        });
      }
      return {items,connection};
    }catch(error){
      const message=error instanceof Error?error.message:'provider_sync_failed';
      const errorCode=/^[a-z0-9_]{1,80}$/.test(message)?message:'provider_sync_failed';
      await this.connections.markSyncError(
        key.companyId,
        key.provider,
        key.externalAccountId,
        errorCode
      );
      await this.auditor?.record('provider.sync.failed',{
        companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId,
        syncKind:args.kind,errorCode
      });
      throw error;
    }
  }

  async readOrders(key:ProviderCredentialKey,args:{fetchImpl?:typeof fetch;limit?:number}={}){
    const connection=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    if(!connection.grantedCapabilities.includes('order.read')) throw new Error('provider_capability_not_granted');
    if(!connection.grantedCapabilities.includes('fulfillment.read')) throw new Error('provider_capability_not_granted');
    const orders=await this.runtime.readOrders(key,args);
    await this.auditor?.record('provider.orders.read',{
      companyId:key.companyId,
      provider:key.provider,
      externalAccountId:key.externalAccountId,
      itemCount:orders.length
    });
    return {orders,connection};
  }


  async quoteVariants(key:ProviderCredentialKey,args:{lineItems:Array<{variantId:string;quantity:number}>;fetchImpl?:typeof fetch}){
    const connection=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    if(!connection.grantedCapabilities.includes('pricing.read')) throw new Error('provider_capability_not_granted');
    if(!connection.grantedCapabilities.includes('inventory.read')) throw new Error('provider_capability_not_granted');
    const quote=await this.runtime.quoteVariants(key,args);
    return {quote,connection};
  }


  async quoteLandedTotal(key:ProviderCredentialKey,args:{lineItems:Array<{variantId:string;quantity:number}>;shippingAddress:ShopifyShippingAddress;fetchImpl?:typeof fetch}){
    const connection=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    for(const capability of ['pricing.read','inventory.read','quote.create'] as const){
      if(!connection.grantedCapabilities.includes(capability)) throw new Error('provider_capability_not_granted');
    }
    const quote=await this.runtime.quoteLandedTotal(key,args);
    return {quote,connection};
  }


  async createDraftOrder(key:ProviderCredentialKey,args:{
    giftSignalDraftId:string;
    email?:string;
    lineItems:Array<{variantId:string;quantity:number}>;
    shippingAddress:ShopifyShippingAddress;
    landedQuote:ShopifyLandedQuote;
    fetchImpl?:typeof fetch;
  }){
    const connection=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    if(!connection.grantedCapabilities.includes('quote.create')) throw new Error('provider_capability_not_granted');
    const result=await this.runtime.createDraftOrder(key,args);
    await this.auditor?.record('provider.draft_order.created',{
      companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId
    });
    return {result,connection};
  }


  async findDraftOrder(key:ProviderCredentialKey,args:{giftSignalDraftId:string;landedQuote:ShopifyLandedQuote;fetchImpl?:typeof fetch}){
    const connection=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    if(!connection.grantedCapabilities.includes('quote.create')) throw new Error('provider_capability_not_granted');
    const result=await this.runtime.findDraftOrder(key,args);
    return {result,connection};
  }

  async completeDraftOrder(key:ProviderCredentialKey,args:{draftOrderId:string;fetchImpl?:typeof fetch}){
    const connection=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    if(!connection.grantedCapabilities.includes('quote.create')) throw new Error('provider_capability_not_granted');
    const result=await this.runtime.completeDraftOrder(key,args);
    await this.auditor?.record('provider.draft_order.completed',{
      companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId
    });
    return {result,connection};
  }


  async createOrder(key:ProviderCredentialKey,args:{draftId:string;lineItems:Array<{variantId:string;quantity:number}>;fetchImpl?:typeof fetch}){
    const connection=await this.connections.get(key.companyId,key.provider,key.externalAccountId);
    if(!connection) throw new Error('provider_connection_not_found');
    if(connection.revokedAt) throw new Error('provider_connection_not_active');
    if(!connection.grantedCapabilities.includes('order.create')) throw new Error('provider_capability_not_granted');
    const result=await this.runtime.createOrder(key,args);
    await this.auditor?.record('provider.order.created',{
      companyId:key.companyId,
      provider:key.provider,
      externalAccountId:key.externalAccountId
    });
    return {result,connection};
  }

  async rekey(key:ProviderCredentialKey){
    const result=await this.runtime.rekey(key);
    await this.auditor?.record('provider.credential.rekeyed',{
      companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId
    });
    return result;
  }

  async rekeyBatch(companyId:string,limit=100){
    const result=await this.runtime.rekeyBatch(companyId,limit);
    await this.auditor?.record('provider.credential.rekey_batch',{
      companyId,
      provider:'all',
      currentKeyId:result.currentKeyId,
      migratedCount:result.migrated,
      remainingCount:result.remaining
    });
    return result;
  }

  async revoke(key:ProviderCredentialKey,args:{fetchImpl?:typeof fetch}={}){
    const revocation=await this.runtime.revoke(key,args);
    const connection=await this.connections.revoke(
      key.companyId,
      key.provider,
      key.externalAccountId
    );
    await this.auditor?.record('provider.connection.revoked',{
      companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId,
      upstreamRevocation:revocation.upstream
    });
    await this.readinessEvidence?.clearForRevocation(key);
    return {...revocation,connection};
  }
}


export function shopifyCapabilitiesFromScope(scope?:string):ProviderCapability[]{
  const scopes=new Set((scope??'').split(/[\s,]+/).map(value=>value.trim()).filter(Boolean));
  const capabilities=new Set<ProviderCapability>();
  if(scopes.has('read_products')||scopes.has('write_products')){
    capabilities.add('catalog.read');
    capabilities.add('pricing.read');
  }
  if(scopes.has('read_inventory')||scopes.has('write_inventory')) capabilities.add('inventory.read');
  if(scopes.has('read_orders')||scopes.has('write_orders')){
    capabilities.add('order.read');
    capabilities.add('fulfillment.read');
    capabilities.add('returns.read');
  }
  if(scopes.has('write_orders')){
    capabilities.add('order.create');
    capabilities.add('order.cancel');
  }
  if(scopes.has('write_draft_orders')) capabilities.add('quote.create');
  return [...capabilities];
}
