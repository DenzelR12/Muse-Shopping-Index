import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {BusinessQuotes} from '../dist/business.js';
import {quotePdf} from '../dist/quote-pdf.js';
import {emailQuote} from '../dist/quote-email.js';
import {checkSourceLink,purchasingReadiness} from '../dist/business-policy.js';
import {createBusinessMcp} from '../dist/business-server.js';
const item={variantId:'demo-bag',title:'SAMPLE Travel Bag',variantTitle:'Black',sku:'DEMO-1',priceCents:12500,currency:'USD',availableQuantity:30,verifiedAt:'2026-09-13T10:00:00Z',purposes:['business_travel','luggage'],included:'One bag',riskClass:'ordinary'};
const request={purpose:'business_travel',eventName:'SAMPLE Team Offsite',budgetCents:50000,items:[{variantId:'demo-bag',quantity:3}]};
async function fixture(run,catalog=[item]){const directory=await mkdtemp(join(tmpdir(),'gift-business-'));try{await run(new BusinessQuotes('DEMO COMPANY',directory,async()=>catalog,()=>new Date('2026-09-13T12:00:00Z')));}finally{await rm(directory,{recursive:true,force:true});}}
test('quotes use catalog cents and reject duplicate lines, excess quantity, stale stock and budget violations',async()=>{
 await fixture(async store=>{const {quote}=await store.create(request);assert.equal(quote.subtotalCents,37500);assert.equal((await store.get(quote.id)).quote.businessId,'DEMO COMPANY');
 await assert.rejects(()=>store.create({...request,budgetCents:1}));await assert.rejects(()=>store.create({...request,items:[...request.items,...request.items]}));await assert.rejects(()=>store.create({...request,items:[{variantId:'demo-bag',quantity:31}]}));await assert.rejects(()=>store.get('../../private'));});
 await fixture(store=>assert.rejects(()=>store.create(request)),[{...item,verifiedAt:'2020-01-01T00:00:00Z'}]);
 await fixture(store=>assert.rejects(()=>store.create(request)),[{...item,riskClass:'cash_equivalent'}]);
});
test('PDF is generated and email requires exact approval, allowed recipient and idempotent delivery',async()=>fixture(async store=>{
 const {quote,digest}=await store.create(request);const pdf=await quotePdf(quote);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1500);
 let calls=0;const mailer={async send(to,subject,text,attachment){calls++;assert.equal(to,'buyer@example.com');assert.equal(attachment.subarray(0,5).toString(),'%PDF-');return 'test-message';}};
 const input={quoteId:quote.id,digest,to:'buyer@example.com',approved:true};
 await assert.rejects(()=>emailQuote(store,mailer,['buyer@example.com'],{...input,approved:false}));
 await assert.rejects(()=>emailQuote(store,mailer,[],input));await assert.rejects(()=>emailQuote(store,mailer,['buyer@example.com'],{...input,digest:'wrong'}));
 assert.equal((await emailQuote(store,mailer,['buyer@example.com'],input)).status,'sent');assert.equal((await emailQuote(store,mailer,['buyer@example.com'],input)).status,'sent');assert.equal(calls,1);
}));
test('an uncertain SMTP attempt is not silently sent a second time',async()=>fixture(async store=>{
 const {quote,digest}=await store.create(request);let calls=0;const mailer={async send(){calls++;throw new Error('lost connection');}};const input={quoteId:quote.id,digest,to:'buyer@example.com',approved:true};
 assert.equal((await emailQuote(store,mailer,['buyer@example.com'],input)).status,'delivery_unknown');await emailQuote(store,mailer,['buyer@example.com'],input);assert.equal(calls,1);
}));
test('source checks reject unapproved origins and purchase readiness fails closed',async()=>fixture(async store=>{
 for(const url of ['http://thegiftsignal.com','https://thegiftsignal.com.evil.test','https://user:pass@thegiftsignal.com','https://127.0.0.1','file:///secret'])assert.equal(checkSourceLink(url).allowed,false);
 assert.equal(checkSourceLink('https://thegiftsignal.com/products/example').allowed,true);assert.equal(checkSourceLink('https://thegiftsignal.com').reachable,'NOT_CHECKED');assert.equal(purchasingReadiness((await store.create(request)).quote).decision,'BLOCKED');
}));
test('MCP client can discover tools, retrieve evidence, prepare a quote and obtain its PDF',async()=>fixture(async store=>{
 const server=createBusinessMcp(store);const client=new Client({name:'test-client',version:'1.0.0'});const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 await server.connect(serverTransport);await client.connect(clientTransport);
 try{assert.equal((await client.listTools()).tools.length,7);const response=await client.callTool({name:'create_business_quote',arguments:request});assert.equal(response.isError,undefined);const {quote}=JSON.parse(response.content[0].text);const document=await client.callTool({name:'get_itemized_pdf',arguments:{quoteId:quote.id}});assert.equal(document.content[0].resource.mimeType,'application/pdf');const review=await client.callTool({name:'prepare_business_purchase',arguments:{quoteId:quote.id}});assert.equal(JSON.parse(review.content[0].text).controls.decision,'BLOCKED');}
 finally{await client.close();await server.close();}
}));
