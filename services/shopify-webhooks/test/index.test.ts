import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {InMemoryReplayStore} from '../../../packages/zero-trust/src/index.js';
import {parseVerifiedWebhookOnce} from '../src/index.js';

test('Shopify webhook ID is consumed once after HMAC verification',async()=>{
  const rawBody=Buffer.from('{"id":1}');
  const secret='shop-secret';
  const hmac=createHmac('sha256',secret).update(rawBody).digest('base64');
  const headers={
    'x-shopify-hmac-sha256':hmac,
    'x-shopify-topic':'products/update',
    'x-shopify-shop-domain':'example.myshopify.com',
    'x-shopify-webhook-id':'wh_1'
  };
  const replay=new InMemoryReplayStore();
  const first=await parseVerifiedWebhookOnce({rawBody,headers,secret,replay,now:new Date('2026-10-24T16:00:00Z')});
  assert.equal(first.webhookId,'wh_1');
  await assert.rejects(()=>parseVerifiedWebhookOnce({rawBody,headers,secret,replay,now:new Date('2026-10-24T16:01:00Z')}),/shopify_webhook_replayed/);
});

test('unsupported Shopify webhook topics are rejected before replay consumption',async()=>{
  const rawBody=Buffer.from('{"id":2}');
  const secret='shop-secret';
  const hmac=createHmac('sha256',secret).update(rawBody).digest('base64');
  const headers={
    'x-shopify-hmac-sha256':hmac,
    'x-shopify-topic':'customers/update',
    'x-shopify-shop-domain':'example.myshopify.com',
    'x-shopify-webhook-id':'wh_unsupported'
  };
  const replay=new InMemoryReplayStore();
  await assert.rejects(
    ()=>parseVerifiedWebhookOnce({rawBody,headers,secret,replay,now:new Date('2026-10-24T16:00:00Z')}),
    /unsupported_shopify_webhook_topic/
  );
  await assert.rejects(
    ()=>parseVerifiedWebhookOnce({rawBody,headers,secret,replay,now:new Date('2026-10-24T16:01:00Z')}),
    /unsupported_shopify_webhook_topic/
  );
});

test('Shopify shop domain is canonicalized after signature verification',async()=>{
  const rawBody=Buffer.from('{"id":3}');
  const secret='shop-secret';
  const hmac=createHmac('sha256',secret).update(rawBody).digest('base64');
  const parsed=await parseVerifiedWebhookOnce({
    rawBody,
    headers:{
      'x-shopify-hmac-sha256':hmac,
      'x-shopify-topic':'products/update',
      'x-shopify-shop-domain':'  Example.MyShopify.Com  ',
      'x-shopify-webhook-id':'wh_domain'
    },
    secret,
    replay:new InMemoryReplayStore()
  });
  assert.equal(parsed.shopDomain,'example.myshopify.com');
});
