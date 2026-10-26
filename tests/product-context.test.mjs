import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toProductCandidate} from '../services/shopify-adapter/dist/index.js';
import {recommend,buildBundle} from '../services/gift-intelligence/dist/index.js';
import {productContextHealth} from '../apps/business/dist/product-context.js';
import {signalStandardReadiness,signalStandardDashboard} from '../apps/business/dist/signal-standard.js';
import {agentAdmissionReadiness,agentAdmissionDashboard} from '../apps/business/dist/agent-admission.js';
import {productContextFields} from '../apps/api/dist/product-context-schema.js';

const source={id:'product-1',title:'A gift',status:'ACTIVE',tags:[],collectionHandles:['signal-verified'],vendor:'A maker',productCategory:'Kitchen & Dining',productType:'Cup',description:'One ceramic cup.',includedItems:['One cup'],sourceUpdatedAt:'2026-09-13T12:00:00Z',occasionFit:['Christmas'],useCases:['Coffee'],variants:[{id:'sold-out',title:'Blue',price:10,currency:'USD',inventoryQuantity:0},{id:'available',title:'Green',sku:'GREEN',price:20,currency:'USD',inventoryQuantity:2}],images:[{url:'https://example.com/green.jpg',alt:'Green cup',variantId:'available'},{url:'https://example.com/blue.jpg',alt:'Blue cup',variantId:'sold-out'},{url:'javascript:alert(1)',alt:'Unsafe'}]};
test('API product media validation preserves identity and rejects unsafe URLs',()=>{
 const photo=source.images[0];assert.deepEqual(productContextFields.images.parse([photo]),[photo]);
 assert.throws(()=>productContextFields.images.parse([source.images[2]]));
 assert.throws(()=>productContextFields.sourceUpdatedAt.parse('yesterday'));
});
test('catalog adapter keeps price, identity and photo on the same available variant',()=>{
 const p=toProductCandidate(source);assert.equal(p.variantId,'available');assert.equal(p.price,20);assert.equal(p.sku,'GREEN');assert.equal(p.images.length,1);assert.equal(p.images[0].alt,'Green cup');assert.deepEqual(p.includedItems,['One cup']);
 assert.equal(toProductCandidate({...source,status:'DRAFT'}),null);
});
test('business diagnostics flag incomplete product context without predicting search rank',()=>{
 const p=toProductCandidate(source);assert.equal(productContextHealth(p).ready,true);
 const report=productContextHealth({...p,images:[],includedItems:[],sourceUpdatedAt:undefined,evidenceVerified:false,productCategory:undefined,productType:undefined});
 assert.equal(report.ready,false);assert.deepEqual(report.missing,['verified source evidence','product category','product type','product photographs','what is included','source timestamp']);
});
test('gift recommendations preserve images and do not invent delivery confidence or holiday relevance',()=>{
 const p=toProductCandidate(source);const result=recommend({occasion:'Hanukkah'},[p])[0];
 assert.deepEqual(result.product.images,p.images);assert.ok(result.why.includes('Delivery has not been verified'));assert.ok(!result.why.some(x=>x.includes('Strong semantic fit')));
 assert.ok(recommend({occasion:'Christmas'},[p])[0].why.includes('Why this fits: catalog occasion match for Christmas'));
});

test('the agent boundary requires Signal Verified collection membership',()=>{
 const verified=toProductCandidate(source);
 assert.equal(verified.signalVerified,true);
 assert.equal(recommend({occasion:'Christmas'},[verified]).length,1);
 assert.equal(recommend({occasion:'Christmas'},[{...verified,signalVerified:false}]).length,0);
 assert.ok(buildBundle({budgetMax:100},[{...verified,signalVerified:false}]).every(bundle=>bundle.items.length===0));
 const other=toProductCandidate({...source,collectionHandles:['new-arrivals']});
 assert.equal(other.signalVerified,false);
 assert.equal(recommend({occasion:'Christmas'},[other]).length,0);
});

test('the concierge excludes incomplete or unverified products',()=>{
 const p=toProductCandidate(source);
 assert.equal(recommend({occasion:'Christmas'},[{...p,evidenceVerified:false}]).length,0);
 assert.equal(recommend({occasion:'Christmas'},[{...p,productCategory:undefined}]).length,0);
 assert.equal(recommend({occasion:'Christmas'},[{...p,images:[]}]).length,0);
});
test('Signal Standard sends expensive verified products to private acquisition and holds price outliers',()=>{
 const p=toProductCandidate(source);
 assert.equal(signalStandardReadiness(p).route,'DIRECT_CHECKOUT');
 assert.equal(signalStandardReadiness({...p,price:39999}).route,'PRIVATE_ACQUISITION');
 assert.deepEqual(signalStandardReadiness({...p,price:6322122.41}),{eligible:false,route:'HOLD_FOR_REVIEW',reasons:['price outlier requires merchant review']});
 assert.equal(signalStandardReadiness({...p,evidenceVerified:false}).route,'HOLD_FOR_REVIEW');
});
test('Signal Standard produces a concise review queue for the business dashboard',()=>{
 const p=toProductCandidate(source);
 const dashboard=signalStandardDashboard([p,{...p,productId:'private',price:39999},{...p,productId:'hold',price:6322122.41}]);
 assert.deepEqual(dashboard,{total:3,directCheckout:1,privateAcquisition:1,heldForReview:1,reviewQueue:[{productId:'hold',title:'A gift',reasons:['price outlier requires merchant review']}]});
});

test('agent admission continuously holds stale, non-Signal-Verified, or semantically incomplete products',()=>{
 const base=toProductCandidate({...source,semanticCompleteness:90,semanticIntents:['coffee']});
 const now=new Date('2026-09-14T12:00:00Z');
 assert.equal(agentAdmissionReadiness(base,{now}).eligible,true);
 assert.deepEqual(agentAdmissionReadiness({...base,signalVerified:false},{now}).reasons,['Signal Verified collection membership required']);
 assert.ok(agentAdmissionReadiness({...base,sourceUpdatedAt:'2026-09-10T00:00:00Z'},{now,maxSourceAgeHours:48}).reasons.includes('catalog evidence older than 48 hours'));
 assert.ok(agentAdmissionReadiness({...base,semanticCompleteness:70},{now}).reasons.includes('semantic completeness below 80'));
 const dashboard=agentAdmissionDashboard([base,{...base,productId:'stale',sourceUpdatedAt:'2026-09-10T00:00:00Z'}],{now,maxSourceAgeHours:48});
 assert.equal(dashboard.total,2);assert.equal(dashboard.eligible,1);assert.equal(dashboard.held,1);assert.equal(dashboard.reviewQueue[0].productId,'stale');
});
