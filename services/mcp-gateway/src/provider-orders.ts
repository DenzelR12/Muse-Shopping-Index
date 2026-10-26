import {randomUUID} from 'node:crypto';
export interface NormalizedProviderFulfillment {
  id:string;
  status?:string;
  displayStatus?:string;
  createdAt?:string;
  updatedAt?:string;
  deliveredAt?:string;
  tracking:Array<{company?:string;number?:string;url?:string}>;
}

export interface NormalizedProviderOrder {
  provider:'shopify'|'walmart';
  externalId:string;
  name?:string;
  createdAt?:string;
  financialStatus?:string;
  fulfillmentStatus?:string;
  totalAmount?:number;
  currency?:string;
  fulfillments:NormalizedProviderFulfillment[];
  raw:Record<string,unknown>;
}

function object(value:unknown):Record<string,unknown>{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

function array(value:unknown):unknown[]{
  return Array.isArray(value)?value:[];
}

async function parseJsonResponse(response:Response){
  const text=await response.text();
  let body:Record<string,unknown>;
  try{body=JSON.parse(text) as Record<string,unknown>;}catch{throw new Error('provider_order_read_invalid_json');}
  if(!response.ok) throw new Error('provider_order_read_failed');
  if(array(body.errors).length) throw new Error('provider_order_read_failed');
  return body;
}

export async function readShopifyOrders(args:{
  shopDomain:string;
  accessToken:string;
  fetchImpl?:typeof fetch;
  env?:NodeJS.ProcessEnv;
  limit?:number;
}):Promise<NormalizedProviderOrder[]>{
  const domain=args.shopDomain.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error('shopify_shop_identity_invalid_domain');
  const env=args.env??process.env;
  const version=env.SHOPIFY_ADMIN_API_VERSION||'2026-10';
  const request=args.fetchImpl??fetch;
  const first=Math.min(50,Math.max(1,args.limit??25));
  const response=await request(`https://${domain}/admin/api/${version}/graphql.json`,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      accept:'application/json',
      'x-shopify-access-token':args.accessToken
    },
    body:JSON.stringify({
      query:`query GiftSignalOrders($first:Int!){
        orders(first:$first,reverse:true,sortKey:CREATED_AT){
          nodes{
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet{shopMoney{amount currencyCode}}
            fulfillments(first:10){
              id
              status
              displayStatus
              createdAt
              updatedAt
              deliveredAt
              trackingInfo{company number url}
            }
          }
        }
      }`,
      variables:{first}
    })
  });
  const body=await parseJsonResponse(response);
  const data=object(body.data);
  const orders=object(data.orders);
  return array(orders.nodes).map((value,index)=>{
    const order=object(value);
    const priceSet=object(order.totalPriceSet);
    const shopMoney=object(priceSet.shopMoney);
    const amount=Number(shopMoney.amount);
    return {
      provider:'shopify',
      externalId:String(order.id??index),
      name:order.name?String(order.name):undefined,
      createdAt:order.createdAt?String(order.createdAt):undefined,
      financialStatus:order.displayFinancialStatus?String(order.displayFinancialStatus):undefined,
      fulfillmentStatus:order.displayFulfillmentStatus?String(order.displayFulfillmentStatus):undefined,
      totalAmount:Number.isFinite(amount)?amount:undefined,
      currency:shopMoney.currencyCode?String(shopMoney.currencyCode):undefined,
      fulfillments:array(order.fulfillments).map((entry,fulfillmentIndex)=>{
        const fulfillment=object(entry);
        return {
          id:String(fulfillment.id??fulfillmentIndex),
          status:fulfillment.status?String(fulfillment.status):undefined,
          displayStatus:fulfillment.displayStatus?String(fulfillment.displayStatus):undefined,
          createdAt:fulfillment.createdAt?String(fulfillment.createdAt):undefined,
          updatedAt:fulfillment.updatedAt?String(fulfillment.updatedAt):undefined,
          deliveredAt:fulfillment.deliveredAt?String(fulfillment.deliveredAt):undefined,
          tracking:array(fulfillment.trackingInfo).map(item=>{
            const tracking=object(item);
            return {
              company:tracking.company?String(tracking.company):undefined,
              number:tracking.number?String(tracking.number):undefined,
              url:tracking.url?String(tracking.url):undefined
            };
          })
        };
      }),
      raw:order
    };
  });
}


export async function readWalmartOrders(args:{
  accessToken:string;
  fetchImpl?:typeof fetch;
  limit?:number;
}):Promise<NormalizedProviderOrder[]>{
  const request=args.fetchImpl??fetch;
  const url=new URL('https://marketplace.walmartapis.com/v3/orders');
  url.searchParams.set('limit',String(Math.min(50,Math.max(1,args.limit??25))));
  url.searchParams.set('productInfo','false');
  url.searchParams.set('replacementInfo','false');
  url.searchParams.set('incentiveInfo','false');
  const response=await request(url,{
    headers:{
      accept:'application/json',
      'content-type':'application/json',
      'wm-sec.access_token':args.accessToken,
      'wm-qos.correlation_id':randomUUID(),
      'wm-svc.name':'Walmart Marketplace'
    }
  });
  const body=await parseJsonResponse(response);
  const list=object(body.list);
  const elements=object(list.elements);
  return array(elements.order).map((value,index)=>{
    const order=object(value);
    const orderLines=object(order.orderLines);
    const lines=array(orderLines.orderLine).map(line=>object(line));
    const statuses=lines.flatMap(line=>{
      const orderLineStatuses=object(line.orderLineStatuses);
      return array(orderLineStatuses.orderLineStatus)
        .map(status=>object(status).status)
        .filter(Boolean)
        .map(String);
    });
    const fulfillmentStatus=statuses.length
      ? (statuses.every(status=>status==='Delivered')?'Delivered':
         statuses.every(status=>status==='Shipped'||status==='Delivered')?'Shipped':
         statuses.some(status=>status==='Acknowledged')?'Acknowledged':
         statuses[0])
      : undefined;
    return {
      provider:'walmart',
      externalId:String(order.purchaseOrderId??index),
      name:order.customerOrderId?String(order.customerOrderId):undefined,
      createdAt:order.orderDate?new Date(Number(order.orderDate)).toISOString():undefined,
      fulfillmentStatus,
      fulfillments:lines.map((line,lineIndex)=>{
        const fulfillment=object(line.fulfillment);
        const orderLineStatuses=object(line.orderLineStatuses);
        const lineStatuses=array(orderLineStatuses.orderLineStatus).map(item=>object(item).status).filter(Boolean).map(String);
        return {
          id:String(line.lineNumber??lineIndex),
          status:lineStatuses[0],
          displayStatus:lineStatuses[0],
          updatedAt:line.statusDate?new Date(Number(line.statusDate)).toISOString():undefined,
          tracking:[],
          raw:fulfillment
        } as NormalizedProviderFulfillment & {raw:Record<string,unknown>};
      }),
      raw:order
    };
  });
}
