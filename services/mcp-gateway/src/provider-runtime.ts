import type {ProviderCredentialKey,PostgresTenantProviderCredentialVault} from './provider-credential-vault.js';
import {exchangeProviderAuthorizationCode} from './provider-token-exchange.js';
import {refreshEbayToken,refreshEtsyToken,refreshShopifyToken,refreshWalmartToken} from './provider-refresh.js';
import {syncEbayInventory,syncEtsyListings,syncWalmartCatalog,syncWalmartInventory,type NormalizedProviderItem} from './provider-sync.js';
import {resolveEtsyShopId} from './provider-account-identity.js';
import {revokeProviderAuthorization} from './provider-revoke.js';
import {readShopifyOrders,readWalmartOrders,type NormalizedProviderOrder} from './provider-orders.js';
import {createShopifyOrder,type ShopifyOrderLineInput} from './provider-order-create.js';
import {quoteShopifyVariants} from './provider-pricing.js';
import {quoteShopifyLandedTotal,type ShopifyLandedQuote,type ShopifyShippingAddress} from './provider-landed-quote.js';
import {createShopifyDraftOrder,completeShopifyDraftOrder,findShopifyDraftOrderByGiftSignalId} from './provider-draft-order.js';

export type VaultBackedProvider='walmart'|'ebay'|'etsy'|'shopify';

export class VaultBackedProviderRuntime {
  constructor(
    private readonly vault:PostgresTenantProviderCredentialVault,
    private readonly env:NodeJS.ProcessEnv=process.env
  ){}

  async completeAuthorization(args:{
    companyId:string;
    provider:VaultBackedProvider;
    code:string;
    redirectUri:string;
    sellerId?:string;
    shopDomain?:string;
    codeVerifier?:string;
    fetchImpl?:typeof fetch;
  }){
    const token=await exchangeProviderAuthorizationCode({
      provider:args.provider,
      code:args.code,
      redirectUri:args.redirectUri,
      sellerId:args.sellerId,
      shopDomain:args.shopDomain,
      codeVerifier:args.codeVerifier,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
    const key:ProviderCredentialKey={
      companyId:args.companyId,
      provider:token.provider,
      externalAccountId:token.externalAccountId
    };
    await this.vault.save(key,token);
    return {
      companyId:key.companyId,
      provider:key.provider,
      externalAccountId:key.externalAccountId,
      expiresAt:token.expiresAt,
      scope:token.scope
    };
  }

  async refresh(key:ProviderCredentialKey,args:{fetchImpl?:typeof fetch}={}){
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    const refreshToken=stored.token.refreshToken;
    if(!refreshToken) throw new Error('provider_refresh_token_missing');

    let next;
    if(key.provider==='shopify'){
      next=await refreshShopifyToken({
        refreshToken,
        externalAccountId:key.externalAccountId,
        fetchImpl:args.fetchImpl,
        env:this.env
      });
    }else if(key.provider==='walmart'){
      next=await refreshWalmartToken({
        refreshToken,
        sellerId:key.externalAccountId,
        fetchImpl:args.fetchImpl,
        env:this.env
      });
    }else if(key.provider==='ebay'){
      next=await refreshEbayToken({
        refreshToken,
        externalAccountId:key.externalAccountId,
        fetchImpl:args.fetchImpl,
        env:this.env
      });
    }else if(key.provider==='etsy'){
      next=await refreshEtsyToken({
        refreshToken,
        externalAccountId:key.externalAccountId,
        fetchImpl:args.fetchImpl,
        env:this.env
      });
    }else{
      throw new Error('provider_refresh_not_supported');
    }

    await this.vault.save(key,next);
    return {
      companyId:key.companyId,
      provider:key.provider,
      externalAccountId:key.externalAccountId,
      expiresAt:next.expiresAt,
      scope:next.scope
    };
  }

  async sync(key:ProviderCredentialKey,args:{
    kind:'catalog'|'inventory'|'listings';
    apiKey?:string;
    fetchImpl?:typeof fetch;
    limit?:number;
  }):Promise<NormalizedProviderItem[]>{
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');

    if(key.provider==='walmart'&&args.kind==='catalog'){
      return syncWalmartCatalog({accessToken:stored.token.accessToken,fetchImpl:args.fetchImpl,limit:args.limit});
    }
    if(key.provider==='walmart'&&args.kind==='inventory'){
      return syncWalmartInventory({accessToken:stored.token.accessToken,fetchImpl:args.fetchImpl,limit:args.limit});
    }
    if(key.provider==='ebay'&&args.kind==='inventory'){
      return syncEbayInventory({accessToken:stored.token.accessToken,fetchImpl:args.fetchImpl,limit:args.limit});
    }
    if(key.provider==='etsy'&&args.kind==='listings'){
      if(!args.apiKey) throw new Error('etsy_api_key_required');
      const shopId=await resolveEtsyShopId({
        userId:key.externalAccountId,
        apiKey:args.apiKey,
        fetchImpl:args.fetchImpl,
        env:this.env
      });
      return syncEtsyListings({
        accessToken:stored.token.accessToken,
        apiKey:args.apiKey,
        shopId,
        fetchImpl:args.fetchImpl,
        limit:args.limit
      });
    }
    throw new Error('provider_sync_not_supported');
  }

  async readOrders(key:ProviderCredentialKey,args:{fetchImpl?:typeof fetch;limit?:number}={}):Promise<NormalizedProviderOrder[]>{
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');
    if(key.provider==='shopify'){
      return readShopifyOrders({
        shopDomain:key.externalAccountId,
        accessToken:stored.token.accessToken,
        fetchImpl:args.fetchImpl,
        env:this.env,
        limit:args.limit
      });
    }
    if(key.provider==='walmart'){
      return readWalmartOrders({
        accessToken:stored.token.accessToken,
        fetchImpl:args.fetchImpl,
        limit:args.limit
      });
    }
    throw new Error('provider_order_read_not_supported');
  }

  async quoteVariants(key:ProviderCredentialKey,args:{lineItems:ShopifyOrderLineInput[];fetchImpl?:typeof fetch}){
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');
    if(key.provider!=='shopify') throw new Error('provider_pricing_not_supported');
    return quoteShopifyVariants({
      shopDomain:key.externalAccountId,
      accessToken:stored.token.accessToken,
      lineItems:args.lineItems,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
  }

  async quoteLandedTotal(key:ProviderCredentialKey,args:{lineItems:ShopifyOrderLineInput[];shippingAddress:ShopifyShippingAddress;fetchImpl?:typeof fetch}){
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');
    if(key.provider!=='shopify') throw new Error('provider_landed_quote_not_supported');
    return quoteShopifyLandedTotal({
      shopDomain:key.externalAccountId,
      accessToken:stored.token.accessToken,
      lineItems:args.lineItems,
      shippingAddress:args.shippingAddress,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
  }


  async createDraftOrder(key:ProviderCredentialKey,args:{
    giftSignalDraftId:string;
    email?:string;
    lineItems:ShopifyOrderLineInput[];
    shippingAddress:ShopifyShippingAddress;
    landedQuote:ShopifyLandedQuote;
    fetchImpl?:typeof fetch;
  }){
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');
    if(key.provider!=='shopify') throw new Error('provider_draft_order_not_supported');
    return createShopifyDraftOrder({
      shopDomain:key.externalAccountId,
      accessToken:stored.token.accessToken,
      giftSignalDraftId:args.giftSignalDraftId,
      ...(args.email?{email:args.email}:{}),
      lineItems:args.lineItems,
      shippingAddress:args.shippingAddress,
      landedQuote:args.landedQuote,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
  }


  async findDraftOrder(key:ProviderCredentialKey,args:{giftSignalDraftId:string;landedQuote:ShopifyLandedQuote;fetchImpl?:typeof fetch}){
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');
    if(key.provider!=='shopify') throw new Error('provider_draft_order_not_supported');
    return findShopifyDraftOrderByGiftSignalId({
      shopDomain:key.externalAccountId,
      accessToken:stored.token.accessToken,
      giftSignalDraftId:args.giftSignalDraftId,
      landedQuote:args.landedQuote,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
  }

  async completeDraftOrder(key:ProviderCredentialKey,args:{draftOrderId:string;fetchImpl?:typeof fetch}){
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');
    if(key.provider!=='shopify') throw new Error('provider_draft_order_not_supported');
    return completeShopifyDraftOrder({
      shopDomain:key.externalAccountId,
      accessToken:stored.token.accessToken,
      draftOrderId:args.draftOrderId,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
  }

  async createOrder(key:ProviderCredentialKey,args:{draftId:string;lineItems:ShopifyOrderLineInput[];fetchImpl?:typeof fetch}){
    const stored=await this.vault.load(key);
    if(!stored) throw new Error('provider_credential_not_found');
    if(new Date(stored.token.expiresAt).getTime()<=Date.now()) throw new Error('provider_access_token_expired');
    if(key.provider!=='shopify') throw new Error('provider_order_create_not_supported');
    return createShopifyOrder({
      shopDomain:key.externalAccountId,
      accessToken:stored.token.accessToken,
      draftId:args.draftId,
      lineItems:args.lineItems,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
  }

  async rekey(key:ProviderCredentialKey){
    const migrated=await this.vault.rekey(key);
    if(!migrated) throw new Error('provider_credential_not_found');
    return {companyId:key.companyId,provider:key.provider,externalAccountId:key.externalAccountId,version:migrated.version};
  }

  async rekeyBatch(companyId:string,limit=100){
    return this.vault.rekeyBatch(companyId,limit);
  }

  async revoke(key:ProviderCredentialKey,args:{fetchImpl?:typeof fetch}={}){
    const stored=await this.vault.load(key);
    if(!stored) return {credentialRevoked:false,upstream:'not_found' as const};
    const upstream=await revokeProviderAuthorization({
      token:stored.token,
      fetchImpl:args.fetchImpl,
      env:this.env
    });
    const credentialRevoked=await this.vault.revoke(key);
    return {credentialRevoked,upstream:upstream.upstream};
  }
}
