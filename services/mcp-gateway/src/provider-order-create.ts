export interface ShopifyOrderLineInput {
  variantId:string;
  quantity:number;
}

export async function createShopifyOrder(args:{
  shopDomain:string;
  accessToken:string;
  draftId:string;
  lineItems:ShopifyOrderLineInput[];
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
}):Promise<{providerOrderId:string}>{
  const domain=args.shopDomain.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('shopify_shop_identity_invalid_domain');
  if(!args.lineItems.length||args.lineItems.some(item=>!item.variantId||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100)){
    throw new Error('provider_order_create_line_items_invalid');
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
      query:`mutation GiftSignalOrderCreate($order:OrderCreateOrderInput!){
        orderCreate(order:$order){
          userErrors{field message}
          order{id}
        }
      }`,
      variables:{
        order:{
          lineItems:args.lineItems.map(item=>({variantId:item.variantId,quantity:item.quantity})),
          financialStatus:'PAID',
          note:`Gift Signal draft ${args.draftId}`,
          tags:['gift-signal',`gift-signal-draft-${args.draftId}`]
        }
      }
    })
  });
  const text=await response.text();
  let body:any;
  try{body=JSON.parse(text);}catch{throw new Error('provider_order_create_invalid_json');}
  if(!response.ok||Array.isArray(body.errors)&&body.errors.length) throw new Error('provider_order_create_failed');
  const result=body?.data?.orderCreate;
  if(Array.isArray(result?.userErrors)&&result.userErrors.length) throw new Error('provider_order_create_rejected');
  const providerOrderId=result?.order?.id;
  if(typeof providerOrderId!=='string'||!providerOrderId) throw new Error('provider_order_create_missing_id');
  return {providerOrderId};
}
