import {decimalPriceToMinorUnits} from './provider-pricing.js';
import type {ShopifyOrderLineInput} from './provider-order-create.js';
import type {ShopifyLandedQuote,ShopifyShippingAddress} from './provider-landed-quote.js';

export interface ShopifyDraftOrderResult {
  draftOrderId:string;
  currency:string;
  subtotal:string;
  tax:string;
  shipping:string;
  total:string;
}

function shopDomain(value:string){
  const domain=value.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('shopify_shop_identity_invalid_domain');
  return domain;
}

async function parse(response:Response,errorCode:string){
  const text=await response.text();
  let body:any;
  try{body=JSON.parse(text);}catch{throw new Error(errorCode+'_invalid_json');}
  if(!response.ok||Array.isArray(body.errors)&&body.errors.length) throw new Error(errorCode);
  return body;
}

function money(set:any,currency:string,label:string){
  const amount=String(set?.shopMoney?.amount??'');
  const code=String(set?.shopMoney?.currencyCode??'');
  if(code!==currency||!/^\d+(?:\.\d+)?$/.test(amount)) throw new Error('provider_draft_order_'+label+'_invalid');
  return amount;
}

export async function createShopifyDraftOrder(args:{
  shopDomain:string;
  accessToken:string;
  giftSignalDraftId:string;
  email?:string;
  lineItems:ShopifyOrderLineInput[];
  shippingAddress:ShopifyShippingAddress;
  landedQuote:ShopifyLandedQuote;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ShopifyDraftOrderResult>{
  const domain=shopDomain(args.shopDomain);
  if(!args.lineItems.length||args.lineItems.some(item=>!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variantId)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100)){
    throw new Error('provider_draft_order_line_items_invalid');
  }
  if(!/^[A-Za-z0-9._:-]{1,160}$/.test(args.giftSignalDraftId)) throw new Error('provider_draft_order_reference_invalid');
  const request=args.fetchImpl??fetch;
  const version=(args.env??process.env).SHOPIFY_ADMIN_API_VERSION||'2026-10';
  const response=await request(`https://${domain}/admin/api/${version}/graphql.json`,{
    method:'POST',
    headers:{'content-type':'application/json',accept:'application/json','x-shopify-access-token':args.accessToken},
    body:JSON.stringify({
      query:`mutation GiftSignalDraftOrderCreate($input:DraftOrderInput!){
        draftOrderCreate(input:$input){
          userErrors{field message}
          draftOrder{
            id
            subtotalPriceSet{shopMoney{amount currencyCode}}
            totalTaxSet{shopMoney{amount currencyCode}}
            totalPriceSet{shopMoney{amount currencyCode}}
            shippingLine{originalPriceSet{shopMoney{amount currencyCode}}}
          }
        }
      }`,
      variables:{input:{
        ...(args.email?{email:args.email}:{}),
        lineItems:args.lineItems.map(item=>({variantId:item.variantId,quantity:item.quantity})),
        shippingAddress:args.shippingAddress,
        shippingLine:{shippingRateHandle:args.landedQuote.shipping.handle,title:args.landedQuote.shipping.title},
        acceptAutomaticDiscounts:true,
        note:`Gift Signal transaction ${args.giftSignalDraftId}`,
        tags:['gift-signal',`gift-signal-draft-${args.giftSignalDraftId}`]
      }}
    })
  });
  const body=await parse(response,'provider_draft_order_create_failed');
  const result=body?.data?.draftOrderCreate;
  if(Array.isArray(result?.userErrors)&&result.userErrors.length) throw new Error('provider_draft_order_create_rejected');
  const draft=result?.draftOrder;
  const draftOrderId=String(draft?.id??'');
  if(!/^gid:\/\/shopify\/DraftOrder\/\d+$/.test(draftOrderId)) throw new Error('provider_draft_order_create_missing_id');
  const currency=args.landedQuote.currency;
  const created={
    draftOrderId,
    currency,
    subtotal:money(draft.subtotalPriceSet,currency,'subtotal'),
    tax:money(draft.totalTaxSet,currency,'tax'),
    shipping:money(draft.shippingLine?.originalPriceSet,currency,'shipping'),
    total:money(draft.totalPriceSet,currency,'total')
  };
  const sameMoney=(left:string,right:string)=>decimalPriceToMinorUnits(left,currency)===decimalPriceToMinorUnits(right,currency);
  if(
    !sameMoney(created.subtotal,args.landedQuote.subtotal)||
    !sameMoney(created.tax,args.landedQuote.tax)||
    !sameMoney(created.shipping,args.landedQuote.shipping.amount)||
    !sameMoney(created.total,args.landedQuote.total)
  ) throw new Error('provider_draft_order_total_mismatch');
  return created;
}


export async function findShopifyDraftOrderByGiftSignalId(args:{
  shopDomain:string;
  accessToken:string;
  giftSignalDraftId:string;
  landedQuote:ShopifyLandedQuote;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ShopifyDraftOrderResult|null>{
  const domain=shopDomain(args.shopDomain);
  if(!/^[A-Za-z0-9._:-]{1,160}$/.test(args.giftSignalDraftId)) throw new Error('provider_draft_order_reference_invalid');
  const request=args.fetchImpl??fetch;
  const version=(args.env??process.env).SHOPIFY_ADMIN_API_VERSION||'2026-10';
  const response=await request(`https://${domain}/admin/api/${version}/graphql.json`,{
    method:'POST',
    headers:{'content-type':'application/json',accept:'application/json','x-shopify-access-token':args.accessToken},
    body:JSON.stringify({
      query:`query GiftSignalDraftOrderRecovery($query:String!){
        draftOrders(first:2,query:$query){
          nodes{
            id
            status
            subtotalPriceSet{shopMoney{amount currencyCode}}
            totalTaxSet{shopMoney{amount currencyCode}}
            totalPriceSet{shopMoney{amount currencyCode}}
            shippingLine{originalPriceSet{shopMoney{amount currencyCode}}}
          }
        }
      }`,
      variables:{query:`tag:gift-signal-draft-${args.giftSignalDraftId}`}
    })
  });
  const body=await parse(response,'provider_draft_order_recovery_failed');
  const nodes=body?.data?.draftOrders?.nodes;
  if(!Array.isArray(nodes)) throw new Error('provider_draft_order_recovery_invalid');
  if(nodes.length===0) return null;
  if(nodes.length!==1) throw new Error('provider_draft_order_recovery_ambiguous');
  const draft=nodes[0];
  if(draft?.status!=='OPEN') throw new Error('provider_draft_order_recovery_not_open');
  const draftOrderId=String(draft?.id??'');
  if(!/^gid:\/\/shopify\/DraftOrder\/\d+$/.test(draftOrderId)) throw new Error('provider_draft_order_recovery_invalid');
  const currency=args.landedQuote.currency;
  const recovered={
    draftOrderId,
    currency,
    subtotal:money(draft.subtotalPriceSet,currency,'subtotal'),
    tax:money(draft.totalTaxSet,currency,'tax'),
    shipping:money(draft.shippingLine?.originalPriceSet,currency,'shipping'),
    total:money(draft.totalPriceSet,currency,'total')
  };
  const sameMoney=(left:string,right:string)=>decimalPriceToMinorUnits(left,currency)===decimalPriceToMinorUnits(right,currency);
  if(
    !sameMoney(recovered.subtotal,args.landedQuote.subtotal)||
    !sameMoney(recovered.tax,args.landedQuote.tax)||
    !sameMoney(recovered.shipping,args.landedQuote.shipping.amount)||
    !sameMoney(recovered.total,args.landedQuote.total)
  ) throw new Error('provider_draft_order_total_mismatch');
  return recovered;
}

export async function completeShopifyDraftOrder(args:{
  shopDomain:string;
  accessToken:string;
  draftOrderId:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<{providerOrderId:string}>{
  const domain=shopDomain(args.shopDomain);
  if(!/^gid:\/\/shopify\/DraftOrder\/\d+$/.test(args.draftOrderId)) throw new Error('provider_draft_order_id_invalid');
  const request=args.fetchImpl??fetch;
  const version=(args.env??process.env).SHOPIFY_ADMIN_API_VERSION||'2026-10';
  const response=await request(`https://${domain}/admin/api/${version}/graphql.json`,{
    method:'POST',
    headers:{'content-type':'application/json',accept:'application/json','x-shopify-access-token':args.accessToken},
    body:JSON.stringify({
      query:`mutation GiftSignalDraftOrderComplete($id:ID!){
        draftOrderComplete(id:$id){
          userErrors{field message}
          draftOrder{id order{id}}
        }
      }`,
      variables:{id:args.draftOrderId}
    })
  });
  const body=await parse(response,'provider_draft_order_complete_failed');
  const result=body?.data?.draftOrderComplete;
  if(Array.isArray(result?.userErrors)&&result.userErrors.length) throw new Error('provider_draft_order_complete_rejected');
  const providerOrderId=String(result?.draftOrder?.order?.id??'');
  if(!/^gid:\/\/shopify\/Order\/\d+$/.test(providerOrderId)) throw new Error('provider_draft_order_complete_missing_order');
  return {providerOrderId};
}
