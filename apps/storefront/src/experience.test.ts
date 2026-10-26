import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBrief, validStep, curate, readSaved, briefText, isBrief } from './experience.js';
const brief={...emptyBrief(),recipient:'Alex',relationship:'Partner',occasion:'Birthday',interests:['Quiet rituals']};
test('each step validates required and bounded input',()=>{
 assert.equal(validStep(emptyBrief(),0),false);
 assert.equal(isBrief(brief),true);
 for(const budget of [NaN,Infinity,-1,0,5001]) assert.equal(isBrief({...brief,budget}),false);
 assert.equal(isBrief({...brief,interests:['made up']}),false);
 assert.equal(isBrief({...brief,note:'x'.repeat(281)}),false);
});
test('every selection respects the hard budget without empty sets',()=>{
 for(const budget of [25,30,45,75,100,150,250,5000]){
  const results=curate({...brief,budget});
  assert.ok(results.every(c=>c.total<=budget && c.items.length>0 && c.total===c.items.reduce((s,i)=>s+i.estimate,0)));
 }
 assert.equal(curate({...brief,budget:25}).length,0);
});
test('matched interests determine priority',()=>{
 assert.equal(curate({...brief,interests:['Food & hosting']})[0]?.id,'after-hours');
});
test('saved storage rejects malformed and stale input',()=>{
 for(const raw of ['bad','null','{}','[{"brief":null}]']) assert.deepEqual(readSaved(raw),[]);
 const saved={id:'1',savedAt:new Date().toISOString(),brief,conceptId:'slow-sunday'};
 assert.equal(readSaved(JSON.stringify([saved])).length,1);
 assert.deepEqual(readSaved(JSON.stringify([{...saved,conceptId:'removed'}])),[]);
});
test('export is a brief and never a transaction or delivery promise',()=>{
 const text=briefText(brief,'slow-sunday');
 assert.match(text,/Not an order/); assert.match(text,/delivery unconfirmed/); assert.match(text,/Alex/);
 assert.throws(()=>briefText({...brief,budget:25},'slow-sunday'));
});
import { storyState, chapterProgress } from './scroll-story.js';
import { readFileSync } from 'node:fs';
import { chatChoices } from './chat.js';
import { catalogExamples, directCatalog } from './catalog.js';
test('scroll composition is bounded, deterministic and reversible',()=>{
 assert.equal(storyState(-1).chapter,0);assert.equal(storyState(2).chapter,4);
 assert.equal(storyState(0).seal,0);assert.equal(storyState(1).seal,1);
 const midpoint=storyState(.5);storyState(.9);assert.deepEqual(storyState(.5),midpoint);
 for(let p=0;p<=1;p+=.01){const s=storyState(p);for(const v of [s.material,s.objects,s.note,s.settle,s.seal])assert.ok(v>=0&&v<=1);}
});

test('chapter navigation ends with a fully closed gift',()=>{
 assert.equal(storyState(chapterProgress[4]).seal,1);
 assert.equal(storyState(chapterProgress[4]).settle,1);
 chapterProgress.forEach((progress, chapter)=>assert.equal(storyState(progress).chapter,chapter));
});

test('the document exposes crawlable gifting context and structured data',()=>{
 const document = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
 for (const expected of [
  'rel="canonical" href="https://thegiftsignal.com/"',
  'name="robots" content="index,follow',
  'application/ld+json',
  'name="twitter:card" content="summary_large_image"',
  'property="og:image" content="https://thegiftsignal.com/images/gift-editorial.webp"',
  '"@type":"WebSite"',
  '"@type":"Service"',
  'recipient, occasion, interests, budget, and timing',
  'aria-labelledby="edits-heading"'
 ]) assert.match(document, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the concierge returns three real, budget-safe products',()=>{
 const choices=chatChoices('A client under $100 for a holiday thank-you');
 assert.equal(choices.length,3);
 assert.ok(choices.every(choice=>catalogExamples[choice.key]!.priceValue<=100));
 assert.ok(choices.every(choice=>Boolean(catalogExamples[choice.key]!.cartUrl)));
});

test('every concierge product answers the core buyer questions',()=>{
 for(const [,product] of directCatalog){
  assert.equal(product.signalVerified,true);
  assert.ok(product.recipientFit.length>0);
  assert.ok(product.context.length>0);
  assert.ok(product.brand&&product.price&&product.images.length&&product.shipping&&product.returns);
  assert.ok(product.options.includes('available')||product.options.includes('Available')||product.options.includes('Black or White'));
 }
});

test('six crawlable buyer-intent guides are present',()=>{
 const document=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 for(const id of ['gifts-for-clients-under-100','gifts-for-coworkers','luxury-gifts','travel-gifts-and-luggage','gifts-for-gamers','holiday-gift-ideas'])assert.match(document,new RegExp(`id="${id}"`));
});
