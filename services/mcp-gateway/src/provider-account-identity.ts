async function parseJson(response:Response,errorCode:string){
  const text=await response.text();
  let body:Record<string,unknown>;
  try{body=JSON.parse(text) as Record<string,unknown>;}catch{throw new Error(errorCode+'_invalid_json');}
  if(!response.ok) throw new Error(errorCode);
  return body;
}

export async function resolveEbayAccountId(args:{
  accessToken:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}){
  const request=args.fetchImpl??fetch;
  const env=args.env??process.env;
  const response=await request(
    env.EBAY_IDENTITY_URL||'https://apiz.ebay.com/commerce/identity/v1/user/',
    {headers:{authorization:'Bearer '+args.accessToken,accept:'application/json'}}
  );
  const body=await parseJson(response,'ebay_identity_lookup_failed');
  const value=body.userId??body.userID??body.username;
  if(!value) throw new Error('ebay_identity_missing_user_id');
  return String(value);
}

export async function resolveEtsyShopId(args:{
  userId:string;
  apiKey:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}){
  const request=args.fetchImpl??fetch;
  const env=args.env??process.env;
  const base=env.ETSY_API_BASE_URL||'https://openapi.etsy.com';
  const url=new URL('/v3/application/users/'+encodeURIComponent(args.userId)+'/shops',base);
  const response=await request(url,{headers:{'x-api-key':args.apiKey,accept:'application/json'}});
  const body=await parseJson(response,'etsy_shop_identity_lookup_failed');
  const shopId=body.shop_id;
  if(shopId===undefined||shopId===null||String(shopId)==='') throw new Error('etsy_shop_identity_missing_shop_id');
  return String(shopId);
}


export async function resolveShopifyShopDomain(args:{
  shopDomain:string;
  accessToken:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}){
  const request=args.fetchImpl??fetch;
  const env=args.env??process.env;
  const expected=args.shopDomain.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(expected)){
    throw new Error('shopify_shop_identity_invalid_domain');
  }
  const version=env.SHOPIFY_ADMIN_API_VERSION||'2026-10';
  const response=await request(`https://${expected}/admin/api/${version}/graphql.json`,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      accept:'application/json',
      'x-shopify-access-token':args.accessToken
    },
    body:JSON.stringify({query:'query GiftSignalShopIdentity { shop { myshopifyDomain } }'})
  });
  const body=await parseJson(response,'shopify_shop_identity_lookup_failed');
  const errors=Array.isArray(body.errors)?body.errors:[];
  if(errors.length) throw new Error('shopify_shop_identity_lookup_failed');
  const data=body.data as {shop?:{myshopifyDomain?:unknown}}|undefined;
  const authoritative=String(data?.shop?.myshopifyDomain??'').trim().toLowerCase();
  if(!authoritative) throw new Error('shopify_shop_identity_missing_domain');
  if(authoritative!==expected) throw new Error('shopify_shop_identity_mismatch');
  return authoritative;
}
