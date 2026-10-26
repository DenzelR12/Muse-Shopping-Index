import { createHmac, timingSafeEqual } from 'node:crypto';
import {consumeWebhookOnce,type ReplayStore} from '@gift-signal/zero-trust';

export interface VerifiedWebhook<T=unknown>{
  topic:string;
  shopDomain:string;
  webhookId:string;
  triggeredAt?:string;
  payload:T;
}

export function canonicalShopifyShopDomain(value:string){
  return value.trim().toLowerCase();
}

function safeEqual(a:string,b:string){
  const left=Buffer.from(a,'utf8');
  const right=Buffer.from(b,'utf8');
  return left.length===right.length && timingSafeEqual(left,right);
}

export function verifyShopifyWebhook(args:{
  rawBody:Buffer;
  hmacHeader:string|undefined;
  secret:string;
}){
  if(!args.hmacHeader||!args.secret) return false;
  const digest=createHmac('sha256',args.secret).update(args.rawBody).digest('base64');
  return safeEqual(digest,args.hmacHeader);
}

export function parseVerifiedWebhook<T>(args:{
  rawBody:Buffer;
  headers:Record<string,string|undefined>;
  secret:string;
}):VerifiedWebhook<T>{
  if(!verifyShopifyWebhook({rawBody:args.rawBody,hmacHeader:args.headers['x-shopify-hmac-sha256'],secret:args.secret})){
    throw new Error('invalid_shopify_webhook_signature');
  }
  const topic=args.headers['x-shopify-topic'];
  const shopDomain=args.headers['x-shopify-shop-domain'];
  const webhookId=args.headers['x-shopify-webhook-id'];
  if(!topic||!shopDomain||!webhookId) throw new Error('missing_shopify_webhook_headers');
  const canonicalShopDomain=canonicalShopifyShopDomain(shopDomain);
  if(!canonicalShopDomain) throw new Error('missing_shopify_webhook_headers');
  return {
    topic,
    shopDomain:canonicalShopDomain,
    webhookId,
    triggeredAt:args.headers['x-shopify-triggered-at'],
    payload:JSON.parse(args.rawBody.toString('utf8')) as T
  };
}

export const supportedTopics=[
  'products/create','products/update','products/delete',
  'inventory_levels/update',
  'orders/create','orders/updated','orders/cancelled',
  'fulfillments/create','fulfillments/update',
  'refunds/create'
] as const;

export async function parseVerifiedWebhookOnce<T>(args:{
  rawBody:Buffer;
  headers:Record<string,string|undefined>;
  secret:string;
  replay:ReplayStore;
  now?:Date;
}){
  const parsed=parseVerifiedWebhook<T>(args);
  if(!(supportedTopics as readonly string[]).includes(parsed.topic)) throw new Error('unsupported_shopify_webhook_topic');
  const now=args.now??new Date();
  const expiresAt=new Date(now.getTime()+24*60*60*1000).toISOString();
  if(!await consumeWebhookOnce({provider:'shopify',eventId:parsed.webhookId,expiresAt,replay:args.replay})) throw new Error('shopify_webhook_replayed');
  return parsed;
}
