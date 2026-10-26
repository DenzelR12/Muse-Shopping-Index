import {randomUUID} from 'node:crypto';

export interface NormalizedProviderItem {
  provider:'walmart'|'ebay'|'etsy'|'amazon';
  externalId:string;
  sku?:string;
  title?:string;
  price?:number;
  currency?:string;
  quantity?:number;
  status?:string;
  raw:Record<string,unknown>;
}

async function parseJsonResponse(response:Response){
  const body=await response.text();
  let parsed:Record<string,unknown>;
  try{parsed=JSON.parse(body) as Record<string,unknown>;}catch{throw new Error('provider_sync_invalid_json');}
  if(!response.ok) throw new Error('provider_sync_failed');
  return parsed;
}

function object(value:unknown):Record<string,unknown>{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

function number(value:unknown){
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:undefined;
}

export async function syncWalmartCatalog(args:{accessToken:string;fetchImpl?:typeof fetch;limit?:number}):Promise<NormalizedProviderItem[]>{
  const request=args.fetchImpl??fetch;
  const url=new URL('https://marketplace.walmartapis.com/v3/items');
  url.searchParams.set('limit',String(Math.min(50,Math.max(1,args.limit??50))));
  const response=await request(url,{
    headers:{
      accept:'application/json',
      'wm-sec.access_token':args.accessToken,
      'wm-qos.correlation_id':randomUUID(),
      'wm-svc.name':'Walmart Marketplace'
    }
  });
  const body=await parseJsonResponse(response);
  const candidates=(Array.isArray(body.ItemResponse)?body.ItemResponse:Array.isArray(body.items)?body.items:[]) as unknown[];
  return candidates.map((value,index)=>{
    const item=object(value);
    const price=object(item.price);
    return {
      provider:'walmart',
      externalId:String(item.wpid??item.sku??item.id??index),
      sku:item.sku?String(item.sku):undefined,
      title:item.productName?String(item.productName):item.title?String(item.title):undefined,
      price:number(price.amount??item.price),
      currency:price.currency?String(price.currency):undefined,
      status:item.publishedStatus?String(item.publishedStatus):item.lifecycleStatus?String(item.lifecycleStatus):undefined,
      raw:item
    };
  });
}

export async function syncWalmartInventory(args:{accessToken:string;fetchImpl?:typeof fetch;limit?:number}):Promise<NormalizedProviderItem[]>{
  const request=args.fetchImpl??fetch;
  const url=new URL('https://marketplace.walmartapis.com/v3/inventories');
  url.searchParams.set('limit',String(Math.min(50,Math.max(1,args.limit??50))));
  const response=await request(url,{
    headers:{
      accept:'application/json',
      'wm-sec.access_token':args.accessToken,
      'wm-qos.correlation_id':randomUUID(),
      'wm-svc.name':'Walmart Marketplace'
    }
  });
  const body=await parseJsonResponse(response);
  const rows=(Array.isArray(body.elements)?body.elements:Array.isArray(body.items)?body.items:Array.isArray(body.inventories)?body.inventories:[]) as unknown[];
  return rows.map((value,index)=>{
    const item=object(value);
    const quantity=object(item.quantity);
    return {
      provider:'walmart',
      externalId:String(item.sku??index),
      sku:item.sku?String(item.sku):undefined,
      quantity:number(quantity.amount??item.quantity),
      raw:item
    };
  });
}

export async function syncEbayInventory(args:{accessToken:string;fetchImpl?:typeof fetch;limit?:number}):Promise<NormalizedProviderItem[]>{
  const request=args.fetchImpl??fetch;
  const url=new URL('https://api.ebay.com/sell/inventory/v1/inventory_item');
  url.searchParams.set('limit',String(Math.min(100,Math.max(1,args.limit??100))));
  const response=await request(url,{headers:{authorization:'Bearer '+args.accessToken,accept:'application/json'}});
  const body=await parseJsonResponse(response);
  const rows=(Array.isArray(body.inventoryItems)?body.inventoryItems:[]) as unknown[];
  return rows.map((value,index)=>{
    const item=object(value);
    const product=object(item.product);
    const availability=object(item.availability);
    const shipToLocationAvailability=object(availability.shipToLocationAvailability);
    return {
      provider:'ebay',
      externalId:String(item.sku??index),
      sku:item.sku?String(item.sku):undefined,
      title:product.title?String(product.title):undefined,
      quantity:number(shipToLocationAvailability.quantity),
      status:item.condition?String(item.condition):undefined,
      raw:item
    };
  });
}


export async function syncEtsyListings(args:{
  accessToken:string;
  apiKey:string;
  shopId:string;
  fetchImpl?:typeof fetch;
  limit?:number;
}):Promise<NormalizedProviderItem[]>{
  const request=args.fetchImpl??fetch;
  const url=new URL('https://api.etsy.com/v3/application/shops/'+encodeURIComponent(args.shopId)+'/listings');
  url.searchParams.set('state','active');
  url.searchParams.set('limit',String(Math.min(100,Math.max(1,args.limit??100))));
  const response=await request(url,{
    headers:{
      authorization:'Bearer '+args.accessToken,
      'x-api-key':args.apiKey,
      accept:'application/json'
    }
  });
  const body=await parseJsonResponse(response);
  const rows=(Array.isArray(body.results)?body.results:[]) as unknown[];
  return rows.map((value,index)=>{
    const item=object(value);
    const price=object(item.price);
    return {
      provider:'etsy',
      externalId:String(item.listing_id??index),
      sku:Array.isArray(item.skus)&&item.skus[0]?String(item.skus[0]):undefined,
      title:item.title?String(item.title):undefined,
      price:number(price.amount)!==undefined&&number(price.divisor)
        ? Number((Number(price.amount)/Number(price.divisor)).toFixed(2))
        : number(item.price),
      currency:price.currency_code?String(price.currency_code):undefined,
      quantity:number(item.quantity),
      status:item.state?String(item.state):undefined,
      raw:item
    };
  });
}

export interface AmazonSignedFetch {
  (url:URL,init:{
    method:'GET';
    headers:Record<string,string>;
  }):Promise<Response>;
}

export async function syncAmazonListings(args:{
  lwaAccessToken:string;
  sellerId:string;
  marketplaceId:string;
  signedFetch:AmazonSignedFetch;
  endpoint?:string;
  pageSize?:number;
}):Promise<NormalizedProviderItem[]>{
  const url=new URL(
    '/listings/2021-08-01/items/'+encodeURIComponent(args.sellerId),
    args.endpoint??'https://sellingpartnerapi-na.amazon.com'
  );
  url.searchParams.set('marketplaceIds',args.marketplaceId);
  url.searchParams.set('pageSize',String(Math.min(20,Math.max(1,args.pageSize??20))));
  url.searchParams.set('includedData','summaries,offers,fulfillmentAvailability');
  const response=await args.signedFetch(url,{
    method:'GET',
    headers:{
      accept:'application/json',
      'x-amz-access-token':args.lwaAccessToken
    }
  });
  const body=await parseJsonResponse(response);
  const rows=(Array.isArray(body.items)?body.items:[]) as unknown[];
  return rows.map((value,index)=>{
    const item=object(value);
    const summaries=Array.isArray(item.summaries)?item.summaries:[];
    const summary=object(summaries[0]);
    const offers=Array.isArray(item.offers)?item.offers:[];
    const offer=object(offers[0]);
    const fulfillment=Array.isArray(item.fulfillmentAvailability)?item.fulfillmentAvailability:[];
    const availability=object(fulfillment[0]);
    const price=object(offer.price);
    return {
      provider:'amazon',
      externalId:String(item.sku??index),
      sku:item.sku?String(item.sku):undefined,
      title:summary.itemName?String(summary.itemName):summary.title?String(summary.title):undefined,
      price:number(price.amount),
      currency:price.currencyCode?String(price.currencyCode):undefined,
      quantity:number(availability.quantity),
      status:summary.status?String(summary.status):undefined,
      raw:item
    };
  });
}
