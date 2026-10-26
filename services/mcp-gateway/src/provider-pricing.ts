export interface ShopifyVariantQuoteLine {
  variantId:string;
  quantity:number;
  unitPrice:string;
  availableForSale:boolean;
  inventoryQuantity:number|null;
}

export interface ShopifyVariantQuote {
  currency:string;
  lines:ShopifyVariantQuoteLine[];
}

export async function quoteShopifyVariants(args:{
  shopDomain:string;
  accessToken:string;
  lineItems:Array<{variantId:string;quantity:number}>;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<ShopifyVariantQuote>{
  const domain=args.shopDomain.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('shopify_shop_identity_invalid_domain');
  if(!args.lineItems.length||args.lineItems.length>100) throw new Error('provider_pricing_line_items_invalid');
  if(args.lineItems.some(item=>!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variantId)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100)){
    throw new Error('provider_pricing_line_items_invalid');
  }

  const request=args.fetchImpl??fetch;
  const version=(args.env??process.env).SHOPIFY_ADMIN_API_VERSION||'2026-10';
  const response=await request(`https://${domain}/admin/api/${version}/graphql.json`,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      accept:'application/json',
      'x-shopify-access-token':args.accessToken
    },
    body:JSON.stringify({
      query:`query GiftSignalVariantQuote($ids:[ID!]!){
        shop{currencyCode}
        nodes(ids:$ids){
          ... on ProductVariant{
            id
            price
            availableForSale
            inventoryQuantity
          }
        }
      }`,
      variables:{ids:args.lineItems.map(item=>item.variantId)}
    })
  });
  const text=await response.text();
  let body:any;
  try{body=JSON.parse(text);}catch{throw new Error('provider_pricing_invalid_json');}
  if(!response.ok||Array.isArray(body.errors)&&body.errors.length) throw new Error('provider_pricing_failed');
  const currency=body?.data?.shop?.currencyCode;
  const nodes=Array.isArray(body?.data?.nodes)?body.data.nodes:[];
  if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)||nodes.length!==args.lineItems.length){
    throw new Error('provider_pricing_missing_fields');
  }

  const byId=new Map(nodes.filter(Boolean).map((node:any)=>[String(node.id),node]));
  const lines=args.lineItems.map(item=>{
    const node=byId.get(item.variantId) as any;
    if(!node) throw new Error('provider_pricing_variant_not_found');
    const unitPrice=String(node.price??'');
    if(!/^\d+(?:\.\d+)?$/.test(unitPrice)) throw new Error('provider_pricing_price_invalid');
    const availableForSale=Boolean(node.availableForSale);
    const inventoryQuantity=node.inventoryQuantity===null||node.inventoryQuantity===undefined?null:Number(node.inventoryQuantity);
    if(!availableForSale) throw new Error('provider_pricing_variant_unavailable');
    if(inventoryQuantity!==null&&(!Number.isFinite(inventoryQuantity)||inventoryQuantity<item.quantity)){
      throw new Error('provider_pricing_inventory_insufficient');
    }
    return {variantId:item.variantId,quantity:item.quantity,unitPrice,availableForSale,inventoryQuantity};
  });
  return {currency,lines};
}

export function currencyFractionDigits(currency:string){
  const digits:number=new Intl.NumberFormat('en-US',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;
  if(!Number.isInteger(digits)||digits<0||digits>4) throw new Error('provider_pricing_currency_precision_invalid');
  return digits;
}

export function decimalPriceToMinorUnits(price:string,currency:string){
  const digits=currencyFractionDigits(currency);
  const match=price.match(/^(\d+)(?:\.(\d+))?$/);
  if(!match) throw new Error('provider_pricing_price_invalid');
  const fraction=match[2]??'';
  if(fraction.length>digits&&/[1-9]/.test(fraction.slice(digits))) throw new Error('provider_pricing_precision_unsupported');
  const padded=(fraction.slice(0,digits)+'0'.repeat(digits)).slice(0,digits);
  const major=BigInt(match[1]);
  const minor=major*10n**BigInt(digits)+BigInt(padded||'0');
  if(minor>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('provider_pricing_amount_too_large');
  return Number(minor);
}

export function quoteTotalMinorUnits(quote:ShopifyVariantQuote){
  let total=0;
  for(const line of quote.lines){
    const unit=decimalPriceToMinorUnits(line.unitPrice,quote.currency);
    total+=unit*line.quantity;
    if(!Number.isSafeInteger(total)||total<=0) throw new Error('provider_pricing_amount_invalid');
  }
  return total;
}


export function quoteTotalAmount(quote:ShopifyVariantQuote){
  const minor=quoteTotalMinorUnits(quote);
  const digits=currencyFractionDigits(quote.currency);
  return minor/(10**digits);
}
