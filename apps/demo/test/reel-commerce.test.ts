import test from 'node:test';
import assert from 'node:assert/strict';
import {createReelCommerceIntent,reelCommerceMessage} from '../src/reel-commerce.js';

const offers=[{
  offerId:'offer-1',
  companyId:'merchant-1',
  entityId:'product-1',
  kind:'PRODUCT',
  title:'Black gaming headset',
  summary:'Wireless headset',
  price:79.99,
  currency:'USD',
  availability:'AVAILABLE',
  fulfillmentMode:'SHIP',
  attributes:{category:'gaming'},
  intents:['gaming','headset'],
  actions:['BUY'],
  evidence:[{sourceId:'catalog-1',observedAt:'2026-10-24T15:00:00.000Z',sourceType:'CATALOG',fields:['title','price','availability']}]
}] as any;

test('Reel commerce intent opens Muse review without merchant handoff',async()=>{
  const result=await createReelCommerceIntent({
    source:{
      platform:'meta',
      reelId:'reel-123',
      reelUrl:'https://www.instagram.com/reel/example',
      creatorId:'creator-1',
      caption:'Best gaming headset for travel',
      productHints:['black wireless headset']
    },
    offers,
    now:new Date('2026-10-24T15:10:00.000Z'),
    fetchImpl:async()=>{throw new Error('model_should_not_be_called_without_config');}
  });
  assert.equal(result.source.reelId,'reel-123');
  assert.equal(result.next,'MUSE_REVIEW');
  assert.equal(result.merchantHandoffRequired,false);
  assert.equal(result.interpretation.intent.preferredKinds?.[0],'PRODUCT');
  assert.equal(result.results[0]?.offer.offerId,'offer-1');
});

test('Reel commerce intent requires actual product context',()=>{
  assert.throws(
    ()=>reelCommerceMessage({platform:'meta',reelId:'reel-1'}),
    /reel_product_context_required/
  );
});

test('Reel commerce intent preserves reel and creator provenance',async()=>{
  const result=await createReelCommerceIntent({
    source:{
      platform:'meta',
      reelId:'reel-999',
      creatorId:'creator-77',
      caption:'Black gaming headset'
    },
    offers,
    now:new Date('2026-10-24T15:10:00.000Z')
  });
  assert.deepEqual(result.source,{
    platform:'meta',
    reelId:'reel-999',
    creatorId:'creator-77',
    caption:'Black gaming headset'
  });
});
