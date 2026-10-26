import {randomUUID} from 'node:crypto';
import {signDraft,verifyDraft,type SignedDraftEnvelope} from '@gift-signal/zero-trust';
import {decimalPriceToMinorUnits,type ConnectorActionDraft,type PostgresZeroTrustAuthority,type ShopifyLandedQuote,type ShopifyShippingAddress} from '@gift-signal/mcp-gateway';

export interface ProviderApprovalEnvelope {
  connectionId:string;
  draftId:string;
  displayedDraftHash:string;
  expiresAt:string;
  description:string;
  seller:{provider:'shopify';externalAccountId:string};
  items:Array<{variantId:string;quantity:number;unitPrice:string}>;
  shippingAddress:ShopifyShippingAddress;
  shipping:{handle:string;title:string;amount:string};
  payment:{provider:'stripe';externalAccountId:string};
  subtotal:string;
  tax:string;
  total:string;
  currency:string;
}

export interface ProviderTransactionDraftState {
  payment:{provider:'stripe';externalAccountId:string};
  fulfillment:{
    provider:'shopify';
    externalAccountId:string;
    lineItems:Array<{variantId:string;quantity:number}>;
    shippingAddress?:ShopifyShippingAddress;
    landedQuote?:ShopifyLandedQuote;
  };
  pricing:{
    currency:string;
    lines:Array<{variantId:string;quantity:number;unitPrice:string;availableForSale:boolean;inventoryQuantity:number|null}>;
  };
  description:string;
  successUrl:string;
  cancelUrl:string;
}

export class ProviderTransactionDraftService {
  constructor(
    private readonly authority:PostgresZeroTrustAuthority,
    private readonly draftSigningSecret:string,
    private readonly ttlMs=10*60*1000
  ){}

  async create(args:{
    companyId:string;
    connectionId:string;
    payment:{provider:'stripe';externalAccountId:string};
    fulfillment:{
      provider:'shopify';
      externalAccountId:string;
      lineItems:Array<{variantId:string;quantity:number}>;
      shippingAddress?:ShopifyShippingAddress;
      landedQuote?:ShopifyLandedQuote;
    };
    amount:number;
    currency:string;
    pricing:{currency:string;lines:Array<{variantId:string;quantity:number;unitPrice:string;availableForSale:boolean;inventoryQuantity:number|null}>};
    description:string;
    successUrl:string;
    cancelUrl:string;
    now?:Date;
  }){
    const now=args.now??new Date();
    if(!args.fulfillment.shippingAddress||!args.fulfillment.landedQuote) throw new Error('provider_landed_quote_required');
    const landed=args.fulfillment.landedQuote;
    if(landed.currency.toUpperCase()!==args.currency.toUpperCase()) throw new Error('provider_landed_quote_currency_mismatch');
    if(decimalPriceToMinorUnits(landed.total,landed.currency)!==decimalPriceToMinorUnits(String(args.amount),args.currency)){
      throw new Error('provider_landed_quote_total_mismatch');
    }
    const connection=await this.authority.resolve(args.connectionId);
    if(!connection) throw new Error('connection_not_found');
    if(connection.companyId!==args.companyId) throw new Error('connection_company_mismatch');
    if(connection.revokedAt) throw new Error('connection_revoked');
    if(connection.expiresAt&&new Date(connection.expiresAt).getTime()<=now.getTime()) throw new Error('connection_expired');
    if(!connection.grantedActions.includes('create_action_draft')||!connection.grantedActions.includes('execute_action')){
      throw new Error('connection_transaction_actions_not_granted');
    }

    const draftId=randomUUID();
    const expiresAt=new Date(now.getTime()+this.ttlMs).toISOString();
    const state:ProviderTransactionDraftState={
      payment:structuredClone(args.payment),
      fulfillment:structuredClone(args.fulfillment),
      pricing:structuredClone(args.pricing),
      description:args.description,
      successUrl:args.successUrl,
      cancelUrl:args.cancelUrl
    };
    const draft:ConnectorActionDraft={
      draftId,
      companyId:args.companyId,
      connectionId:args.connectionId,
      kind:'PURCHASE',
      offerIds:args.fulfillment.lineItems.map(item=>item.variantId),
      quantity:args.fulfillment.lineItems.reduce((sum,item)=>sum+item.quantity,0),
      total:args.amount,
      currency:args.currency,
      summary:args.description,
      createdAt:now.toISOString(),
      expiresAt,
      approvalRequired:true,
      liveRevalidationRequired:true,
      providerState:state as unknown as Record<string,unknown>
    };
    const envelope=signDraft(draft,this.draftSigningSecret,now.toISOString());
    await this.authority.save(envelope);
    const approvalEnvelope:ProviderApprovalEnvelope={
      connectionId:draft.connectionId,
      draftId:draft.draftId,
      displayedDraftHash:envelope.payloadHash,
      expiresAt:draft.expiresAt,
      description:state.description,
      seller:{provider:'shopify',externalAccountId:state.fulfillment.externalAccountId},
      items:state.pricing.lines.map(line=>({variantId:line.variantId,quantity:line.quantity,unitPrice:line.unitPrice})),
      shippingAddress:structuredClone(state.fulfillment.shippingAddress!),
      shipping:structuredClone(state.fulfillment.landedQuote!.shipping),
      payment:{provider:'stripe',externalAccountId:state.payment.externalAccountId},
      subtotal:state.fulfillment.landedQuote!.subtotal,
      tax:state.fulfillment.landedQuote!.tax,
      total:state.fulfillment.landedQuote!.total,
      currency:state.fulfillment.landedQuote!.currency,
    };
    return {
      draft:{
        draftId:draft.draftId,
        companyId:draft.companyId,
        connectionId:draft.connectionId,
        total:draft.total,
        currency:draft.currency,
        summary:draft.summary,
        expiresAt:draft.expiresAt,
        providerState:state
      },
      displayedDraftHash:envelope.payloadHash,
      approvalEnvelope
    };
  }

  async verifyForExecution(args:{
    companyId:string;
    connectionId:string;
    draftId:string;
    now?:Date;
  }){
    const now=args.now??new Date();
    const connection=await this.authority.resolve(args.connectionId);
    if(!connection) throw new Error('connection_not_found');
    if(connection.companyId!==args.companyId) throw new Error('connection_company_mismatch');
    if(connection.revokedAt) throw new Error('connection_revoked');
    if(connection.expiresAt&&new Date(connection.expiresAt).getTime()<=now.getTime()) throw new Error('connection_expired');
    if(!connection.grantedActions.includes('execute_action')) throw new Error('connection_execute_action_not_granted');

    const envelope=await this.authority.get(args.draftId) as SignedDraftEnvelope<ConnectorActionDraft>|null;
    if(!envelope) throw new Error('draft_not_found');
    const verified=verifyDraft(envelope,this.draftSigningSecret,now);
    if(!verified.ok) throw new Error(verified.reason);
    const draft=verified.payload;
    if(draft.companyId!==args.companyId||draft.connectionId!==args.connectionId) throw new Error('draft_scope_mismatch');
    const state=parseState(draft.providerState);
    return {
      connection,
      draft,
      draftHash:verified.payloadHash,
      state
    };
  }
}

function parseState(value:Record<string,unknown>|undefined):ProviderTransactionDraftState{
  if(!value||typeof value!=='object') throw new Error('provider_transaction_draft_state_invalid');
  const payment=value.payment as Record<string,unknown>|undefined;
  const fulfillment=value.fulfillment as Record<string,unknown>|undefined;
  const pricing=value.pricing as Record<string,unknown>|undefined;
  if(!payment||payment.provider!=='stripe'||typeof payment.externalAccountId!=='string') throw new Error('provider_transaction_draft_state_invalid');
  if(!fulfillment||fulfillment.provider!=='shopify'||typeof fulfillment.externalAccountId!=='string'||!Array.isArray(fulfillment.lineItems)){
    throw new Error('provider_transaction_draft_state_invalid');
  }
  const lineItems=fulfillment.lineItems.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)) throw new Error('provider_transaction_draft_state_invalid');
    const record=item as Record<string,unknown>;
    if(typeof record.variantId!=='string'||typeof record.quantity!=='number') throw new Error('provider_transaction_draft_state_invalid');
    return {variantId:record.variantId,quantity:record.quantity};
  });
  if(!pricing||typeof pricing.currency!=='string'||!Array.isArray(pricing.lines)) throw new Error('provider_transaction_draft_state_invalid');
  const pricingLines=pricing.lines.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)) throw new Error('provider_transaction_draft_state_invalid');
    const record=item as Record<string,unknown>;
    if(typeof record.variantId!=='string'||typeof record.quantity!=='number'||typeof record.unitPrice!=='string'||typeof record.availableForSale!=='boolean'){
      throw new Error('provider_transaction_draft_state_invalid');
    }
    const inventoryQuantity=record.inventoryQuantity===null?null:Number(record.inventoryQuantity);
    if(inventoryQuantity!==null&&!Number.isFinite(inventoryQuantity)) throw new Error('provider_transaction_draft_state_invalid');
    return {variantId:record.variantId,quantity:record.quantity,unitPrice:record.unitPrice,availableForSale:record.availableForSale,inventoryQuantity};
  });
  if(typeof value.description!=='string'||typeof value.successUrl!=='string'||typeof value.cancelUrl!=='string'){
    throw new Error('provider_transaction_draft_state_invalid');
  }
  const shippingAddress=parseOptionalShippingAddress(fulfillment.shippingAddress);
  const landedQuote=parseOptionalLandedQuote(fulfillment.landedQuote);
  if(Boolean(shippingAddress)!==Boolean(landedQuote)) throw new Error('provider_transaction_draft_state_invalid');
  return {
    payment:{provider:'stripe',externalAccountId:payment.externalAccountId},
    fulfillment:{provider:'shopify',externalAccountId:fulfillment.externalAccountId,lineItems,...(shippingAddress?{shippingAddress,landedQuote}: {})},
    pricing:{currency:pricing.currency,lines:pricingLines},
    description:value.description,
    successUrl:value.successUrl,
    cancelUrl:value.cancelUrl
  };
}


function parseOptionalShippingAddress(value:unknown):ShopifyShippingAddress|undefined{
  if(value===undefined) return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('provider_transaction_draft_state_invalid');
  const record=value as Record<string,unknown>;
  for(const key of ['address1','city','countryCode','zip'] as const){
    if(typeof record[key]!=='string'||!record[key].trim()) throw new Error('provider_transaction_draft_state_invalid');
  }
  if(!/^[A-Z]{2}$/.test(String(record.countryCode))) throw new Error('provider_transaction_draft_state_invalid');
  const optional=['firstName','lastName','address2','provinceCode','phone'] as const;
  for(const key of optional){
    if(record[key]!==undefined&&typeof record[key]!=='string') throw new Error('provider_transaction_draft_state_invalid');
  }
  return {
    ...(typeof record.firstName==='string'?{firstName:record.firstName}:{}),
    ...(typeof record.lastName==='string'?{lastName:record.lastName}:{}),
    address1:String(record.address1),
    ...(typeof record.address2==='string'?{address2:record.address2}:{}),
    city:String(record.city),
    ...(typeof record.provinceCode==='string'?{provinceCode:record.provinceCode}:{}),
    countryCode:String(record.countryCode),
    zip:String(record.zip),
    ...(typeof record.phone==='string'?{phone:record.phone}:{})
  };
}

function parseOptionalLandedQuote(value:unknown):ShopifyLandedQuote|undefined{
  if(value===undefined) return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('provider_transaction_draft_state_invalid');
  const record=value as Record<string,unknown>;
  const shipping=record.shipping as Record<string,unknown>|undefined;
  if(
    typeof record.currency!=='string'||!/^[A-Z]{3}$/.test(record.currency)||
    typeof record.subtotal!=='string'||typeof record.tax!=='string'||typeof record.total!=='string'||
    !shipping||typeof shipping.handle!=='string'||!shipping.handle||
    typeof shipping.title!=='string'||!shipping.title||typeof shipping.amount!=='string'
  ) throw new Error('provider_transaction_draft_state_invalid');
  for(const amount of [record.subtotal,record.tax,record.total,shipping.amount]){
    if(!/^\d+(?:\.\d+)?$/.test(String(amount))) throw new Error('provider_transaction_draft_state_invalid');
  }
  return {
    currency:record.currency,
    subtotal:record.subtotal,
    tax:record.tax,
    shipping:{handle:shipping.handle,title:shipping.title,amount:shipping.amount},
    total:record.total
  } as ShopifyLandedQuote;
}
