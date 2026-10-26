import {currencyFractionDigits,decimalPriceToMinorUnits} from './provider-pricing.js';
import type {ShopifyOrderLineInput} from './provider-order-create.js';

export interface ShopifyShippingAddress {
  firstName?:string;
  lastName?:string;
  address1:string;
  address2?:string;
  city:string;
  provinceCode?:string;
  countryCode:string;
  zip:string;
  phone?:string;
}

export interface ShopifyLandedQuote {
  currency:string;
  subtotal:string;
  tax:string;
  shipping:{handle:string;title:string;amount:string};
  total:string;
}

function validateAddress(address:ShopifyShippingAddress){
  if(!address.address1.trim()||!address.city.trim()||!address.zip.trim()) throw new Error('provider_landed_quote_address_invalid');
  if(!/^[A-Z]{2}$/.test(address.countryCode)) throw new Error('provider_landed_quote_address_invalid');
  if(address.provinceCode!==undefined&&!/^[A-Z0-9-]{1,12}$/.test(address.provinceCode)) throw new Error('provider_landed_quote_address_invalid');
}

async function calculate(args:{
  domain:string;
  accessToken:string;
  lineItems:ShopifyOrderLineInput[];
  shippingAddress:ShopifyShippingAddress;
  shippingRateHandle?:string;
  request:typeof fetch;
  version:string;
}){
  const response=await args.request(`https://${args.domain}/admin/api/${args.version}/graphql.json`,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      accept:'application/json',
      'x-shopify-access-token':args.accessToken
    },
    body:JSON.stringify({
      query:`mutation GiftSignalDraftOrderCalculate($input:DraftOrderInput!){
        draftOrderCalculate(input:$input){
          userErrors{field message}
          calculatedDraftOrder{
            currencyCode
            subtotalPriceSet{shopMoney{amount currencyCode}}
            totalTaxSet{shopMoney{amount currencyCode}}
            totalShippingPriceSet{shopMoney{amount currencyCode}}
            totalPriceSet{shopMoney{amount currencyCode}}
            availableShippingRates{handle title price{amount currencyCode}}
          }
        }
      }`,
      variables:{
        input:{
          lineItems:args.lineItems.map(item=>({variantId:item.variantId,quantity:item.quantity})),
          shippingAddress:args.shippingAddress,
          acceptAutomaticDiscounts:true,
          ...(args.shippingRateHandle?{shippingLine:{shippingRateHandle:args.shippingRateHandle}}:{})
        }
      }
    })
  });
  const text=await response.text();
  let body:any;
  try{body=JSON.parse(text);}catch{throw new Error('provider_landed_quote_invalid_json');}
  if(!response.ok||Array.isArray(body.errors)&&body.errors.length) throw new Error('provider_landed_quote_failed');
  const result=body?.data?.draftOrderCalculate;
  if(Array.isArray(result?.userErrors)&&result.userErrors.length) throw new Error('provider_landed_quote_rejected');
  if(!result?.calculatedDraftOrder) throw new Error('provider_landed_quote_missing_fields');
  return result.calculatedDraftOrder;
}

function money(value:any,currency:string,label:string){
  const amount=String(value?.shopMoney?.amount??'');
  const code=String(value?.shopMoney?.currencyCode??'');
  if(code!==currency||!/^[0-9]+(?:\.[0-9]+)?$/.test(amount)) throw new Error(`provider_landed_quote_${label}_invalid`);
  decimalPriceToMinorUnits(amount,currency);
  return amount;
}

export async function quoteShopifyLandedTotal(args:{
  shopDomain:string;
  accessToken:string;
  lineItems:ShopifyOrderLineInput[];
  shippingAddress:ShopifyShippingAddress;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ShopifyLandedQuote>{
  const domain=args.shopDomain.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('shopify_shop_identity_invalid_domain');
  if(!args.lineItems.length||args.lineItems.length>100||args.lineItems.some(item=>!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variantId)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100)){
    throw new Error('provider_landed_quote_line_items_invalid');
  }
  validateAddress(args.shippingAddress);
  const request=args.fetchImpl??fetch;
  const version=(args.env??process.env).SHOPIFY_ADMIN_API_VERSION||'2026-10';
  const initial=await calculate({domain,accessToken:args.accessToken,lineItems:args.lineItems,shippingAddress:args.shippingAddress,request,version});
  const currency=String(initial.currencyCode??'');
  if(!/^[A-Z]{3}$/.test(currency)) throw new Error('provider_landed_quote_currency_invalid');
  const rates=Array.isArray(initial.availableShippingRates)?initial.availableShippingRates:[];
  if(!rates.length) throw new Error('provider_landed_quote_shipping_unavailable');
  const normalized=rates.map((rate:any)=>{
    const amount=String(rate?.price?.amount??'');
    const code=String(rate?.price?.currencyCode??'');
    const handle=String(rate?.handle??'');
    const title=String(rate?.title??'');
    if(!handle||!title||code!==currency) throw new Error('provider_landed_quote_shipping_invalid');
    const minor=decimalPriceToMinorUnits(amount,currency);
    return {handle,title,amount,minor};
  }).sort((a:{handle:string;title:string;amount:string;minor:number},b:{handle:string;title:string;amount:string;minor:number})=>a.minor-b.minor||a.handle.localeCompare(b.handle));
  const selected=normalized[0];
  if(!selected) throw new Error('provider_landed_quote_shipping_unavailable');
  const final=await calculate({domain,accessToken:args.accessToken,lineItems:args.lineItems,shippingAddress:args.shippingAddress,shippingRateHandle:selected.handle,request,version});
  const finalCurrency=String(final.currencyCode??'');
  if(finalCurrency!==currency) throw new Error('provider_landed_quote_currency_changed');
  const quote={
    currency,
    subtotal:money(final.subtotalPriceSet,currency,'subtotal'),
    tax:money(final.totalTaxSet,currency,'tax'),
    shipping:money(final.totalShippingPriceSet,currency,'shipping'),
    total:money(final.totalPriceSet,currency,'total')
  };
  return {currency,subtotal:quote.subtotal,tax:quote.tax,shipping:{handle:selected.handle,title:selected.title,amount:quote.shipping},total:quote.total};
}

export function landedQuoteTotalAmount(quote:ShopifyLandedQuote){
  const minor=decimalPriceToMinorUnits(quote.total,quote.currency);
  return minor/(10**currencyFractionDigits(quote.currency));
}
