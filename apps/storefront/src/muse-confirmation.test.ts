import test from 'node:test';
import assert from 'node:assert/strict';
import {museConfirmationSheet,renderMuseConfirmation} from './muse-confirmation.js';
import {mountMuseConfirmationPage,createMuseConfirmationServerHandlers} from './muse-confirmation-page.js';

const envelope={
  connectionId:'conn-1',
  draftId:'draft-1',
  displayedDraftHash:'a'.repeat(64),
  expiresAt:'2026-10-25T22:00:00Z',
  description:'Assassin’s Creed Black Flag',
  seller:{provider:'shopify' as const,externalAccountId:'sams-club.myshopify.com',displayName:'Demo Seller'},
  items:[{variantId:'gid://shopify/ProductVariant/123',quantity:1,unitPrice:'54.00',title:'Assassin’s Creed Black Flag'}],
  shippingAddress:{firstName:'Denzel',lastName:'R',address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
  shipping:{handle:'free',title:'Free shipping',amount:'0.00'},
  payment:{provider:'stripe' as const,externalAccountId:'acct-consumer-1'},
  terms:'Returns within 30 days of delivery.',
  paymentTiming:'Charged when you approve this exact transaction.',
  estimatedArrival:'October 28, 2026',
  subtotal:'54.00',tax:'4.32',total:'58.32',currency:'USD'
};

test('Muse confirmation is derived only from the signed approval envelope',()=>{
  const sheet=museConfirmationSheet(envelope);
  assert.equal(sheet.total,'58.32');
  assert.equal(sheet.seller,'Demo Seller');
  assert.equal(sheet.shipTo,'Denzel R, 123 Main St, Atlanta, GA, US 30303');
  assert.equal(sheet.payment,'Saved payment');
  assert.equal(sheet.terms,'Returns within 30 days of delivery.');
  assert.equal(sheet.paymentTiming,'Charged when you approve this exact transaction.');
  assert.equal(sheet.estimatedArrival,'October 28, 2026');
  assert.equal(sheet.items[0].label,'Assassin’s Creed Black Flag');
  const html=renderMuseConfirmation(sheet);
  assert.match(html,/data-connection-id="conn-1"/);
  assert.match(html,/data-draft-id="draft-1"/);
  assert.match(html,/data-draft-hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/);
  assert.match(html,/58\.32 USD/);
  assert.match(html,/Refund\/cancellation terms:/);
  assert.match(html,/Returns within 30 days of delivery\./);
  assert.match(html,/Payment timing:/);
  assert.match(html,/Estimated arrival:/);
  assert.match(html,/October 28, 2026/);
  assert.match(html,/Buy now/);
});

test('Muse confirmation never renders a raw shop domain, account ID, or variant ID',()=>{
  const sheet=museConfirmationSheet(envelope);
  const html=renderMuseConfirmation(sheet);
  assert.doesNotMatch(html,/myshopify\.com/);
  assert.doesNotMatch(html,/acct-consumer-1/);
  assert.doesNotMatch(html,/gid:\/\/shopify\/ProductVariant/);
  assert.doesNotMatch(html,/Stripe · /);
});

test('Muse confirmation fails closed without a resolved seller display name',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,seller:{provider:'shopify' as const,externalAccountId:'sams-club.myshopify.com'}}),/muse_confirmation_seller_display_required/);
  assert.throws(()=>museConfirmationSheet({...envelope,seller:{provider:'shopify' as const,externalAccountId:'sams-club.myshopify.com',displayName:'sams-club.myshopify.com'}}),/muse_confirmation_seller_display_required/);
});

test('Muse confirmation fails closed without a resolved item title',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,items:[{variantId:'gid://shopify/ProductVariant/123',quantity:1,unitPrice:'54.00'}]}),/muse_confirmation_item_title_required/);
});

test('Muse confirmation shows not available, never an invented date or term, when review facts are absent',()=>{
  const {terms,paymentTiming,estimatedArrival,...rest}=envelope as any;
  const sheet=museConfirmationSheet(rest);
  assert.equal(sheet.terms,'not available');
  assert.equal(sheet.paymentTiming,'not available');
  assert.equal(sheet.estimatedArrival,'not available');
  const html=renderMuseConfirmation(sheet);
  assert.match(html,/Estimated arrival:<\/strong> not available/);
  assert.match(html,/Refund\/cancellation terms:<\/strong> not available/);
});

test('Muse confirmation fails closed when a review fact contains a raw ID',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,estimatedArrival:'gid://shopify/ProductVariant/123'}),/muse_confirmation_unsafe_display/);
});

test('Muse confirmation fails closed when the signed hash is absent or malformed',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,displayedDraftHash:'bad'}),/muse_confirmation_invalid_identity/);
});

test('Muse confirmation fails closed when any monetary fact is malformed',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,total:'58.32 USD'}),/muse_confirmation_money_invalid/);
});

test('Shop Pay confirmation sheet shows Shop Pay label and never a raw account ID',()=>{
  const sheet=museConfirmationSheet({...envelope,paymentVehicle:'shop_pay',payment:{provider:'shop_pay' as const,externalAccountId:'acct-consumer-1'}});
  assert.equal(sheet.payment,'Shop Pay · Saved payment');
  const html=renderMuseConfirmation(sheet);
  assert.match(html,/Shop Pay · Saved payment/);
  assert.doesNotMatch(html,/acct-consumer-1/);
  assert.doesNotMatch(html,/myshopify\.com/);
});

test('Shop Pay confirmation fails closed when vehicle and provider disagree',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,paymentVehicle:'shop_pay'}),/muse_confirmation_unsafe_display/);
});

// --- Live confirmation page (muse-confirmation-page.ts) ---

function pageRoot(){
  const listeners:Array<()=>void>=[];
  const button={
    disabled:false,
    textContent:'Buy now',
    dataset:{draftId:'draft-1',connectionId:'conn-1',draftHash:'a'.repeat(64)},
    addEventListener:(_type:string,listener:()=>void)=>{listeners.push(listener);},
  };
  let html='';
  const root={
    get innerHTML(){return html;},
    set innerHTML(value:string){html=value;},
    querySelectorAll:(_selector:string)=>html.includes('data-muse-buy')?[button]:[],
  };
  return {root,button,listeners,html:()=>html};
}

function recordingFetch(state:()=>string,calls:Array<{url:string;method:string;body?:string;headers:Record<string,string>}>){
  return async (url:string,init:{method:string;headers:Record<string,string>;body?:string})=>{
    calls.push({url,method:init.method,body:init.body,headers:init.headers});
    if(init.method==='POST') return {ok:true,status:201,json:async ()=>({checkout:{}})};
    return {ok:true,status:200,json:async ()=>({draftId:'draft-1',state:state()})};
  };
}

const sleep=(ms:number)=>new Promise((resolve)=>setTimeout(resolve,ms));

test('Live confirmation page renders sheet and attaches exactly one guard with a data-muse-buy button',()=>{
  const {root,button}=pageRoot();
  const calls:Array<{url:string;method:string;body?:string;headers:Record<string,string>}>=[];
  const page=mountMuseConfirmationPage(root,envelope,{
    apiBase:'https://api.example.test',
    approvalToken:'approval-token-1',
    fetchImpl:recordingFetch(()=> 'ORDER_CREATED',calls),
  });
  assert.equal(page.guards.length,1);
  assert.equal(page.guards[0].draftId,'draft-1');
  assert.equal(page.sheet.payment,'Saved payment');
  assert.match(root.innerHTML,/data-muse-buy/);
  assert.match(root.innerHTML,/Buy now/);
  assert.match(root.innerHTML,/Demo Seller/);
  assert.match(root.innerHTML,/Assassin’s Creed Black Flag/);
  assert.doesNotMatch(root.innerHTML,/myshopify\.com/);
  assert.doesNotMatch(root.innerHTML,/acct-consumer-1/);
  assert.doesNotMatch(root.innerHTML,/gid:\/\/shopify\/ProductVariant/);
  assert.equal(button.dataset.draftId,'draft-1');
});

test('Live confirmation page shows Shop Pay label only for shop_pay sheets',()=>{
  const stripe=pageRoot();
  mountMuseConfirmationPage(stripe.root,envelope,{apiBase:'https://api.example.test',approvalToken:'t'});
  assert.match(stripe.html(),/Saved payment/);
  assert.doesNotMatch(stripe.html(),/Shop Pay/);
  const shopPay=pageRoot();
  mountMuseConfirmationPage(shopPay.root,
    {...envelope,paymentVehicle:'shop_pay',payment:{provider:'shop_pay' as const,externalAccountId:'acct-consumer-1'}},
    {apiBase:'https://api.example.test',approvalToken:'t'});
  assert.match(shopPay.html(),/Shop Pay · Saved payment/);
  assert.doesNotMatch(shopPay.html(),/acct-consumer-1/);
});

test('Live confirmation page submit calls server confirm endpoint and resume reads owned order status',async ()=>{
  const {root,button,listeners}=pageRoot();
  const calls:Array<{url:string;method:string;body?:string;headers:Record<string,string>}>=[];
  const page=mountMuseConfirmationPage(root,envelope,{
    apiBase:'https://api.example.test/',
    approvalToken:'approval-token-1',
    identityToken:'identity-token-1',
    fetchImpl:recordingFetch(()=> 'ORDER_CREATED',calls),
  });
  listeners[0]!();
  listeners[0]!();
  await sleep(20);
  assert.equal(calls.filter((call)=>call.method==='POST').length,1);
  assert.equal(calls[0].url,'https://api.example.test/v1/muse/confirm');
  assert.deepEqual(JSON.parse(calls[0].body!),{connectionId:'conn-1',draftId:'draft-1',approvalToken:'approval-token-1'});
  assert.equal(calls[0].headers.authorization,'Bearer identity-token-1');
  assert.equal(button.disabled,true);
  assert.equal(button.textContent,'Checking status…');
  const decisions=await page.resume();
  assert.deepEqual(decisions,[{action:'completed',requiresNewApproval:false}]);
  assert.equal(button.textContent,'Done');
  assert.equal(calls.filter((call)=>call.method==='GET').length,1);
  assert.equal(calls.find((call)=>call.method==='GET')!.url,'https://api.example.test/v1/muse/orders/draft-1');
  assert.equal(calls.filter((call)=>call.method==='POST').length,1);
});

test('Live confirmation page resume needs no new approval for processing or reconciliation, only for reapproval',async ()=>{
  let state='IN_PROGRESS';
  const calls:Array<{url:string;method:string;body?:string;headers:Record<string,string>}>=[];
  const {root}=pageRoot();
  let reapprovalCalls=0;
  const page=mountMuseConfirmationPage(root,envelope,{
    apiBase:'https://api.example.test',
    approvalToken:'t',
    fetchImpl:recordingFetch(()=>state,calls),
    onReapprovalRequired:()=>{reapprovalCalls++;},
  });
  assert.deepEqual(await page.resume(),[{action:'resume',requiresNewApproval:false}]);
  state='RECONCILE_REQUIRED';
  assert.deepEqual(await page.resume(),[{action:'reconciliation',requiresNewApproval:false}]);
  assert.equal(calls.filter((call)=>call.method==='POST').length,0);
  state='SOMETHING_NEW';
  assert.deepEqual(await page.resume(),[{action:'reapproval_required',requiresNewApproval:true}]);
  assert.equal(reapprovalCalls,1);
  assert.equal(calls.filter((call)=>call.method==='POST').length,0);
});

test('Live confirmation page calls resume on reconnect',async ()=>{
  const onlineListeners:Array<()=>void>=[];
  const {root,button}=pageRoot();
  const calls:Array<{url:string;method:string;body?:string;headers:Record<string,string>}>=[];
  const page=mountMuseConfirmationPage(root,envelope,{
    apiBase:'https://api.example.test',
    approvalToken:'t',
    fetchImpl:recordingFetch(()=> 'ORDER_CREATED',calls),
    reconnectTarget:{addEventListener:(type,listener)=>{if(type==='online') onlineListeners.push(listener);}},
  });
  assert.equal(onlineListeners.length,1);
  onlineListeners[0]!();
  await sleep(20);
  assert.equal(button.textContent,'Done');
  assert.deepEqual(await page.resume(),[{action:'completed',requiresNewApproval:false}]);
});

test('Live confirmation page fails closed with no live server configured and never fakes success',async ()=>{
  let fetchCalls=0;
  const {root,button}=pageRoot();
  const page=mountMuseConfirmationPage(root,envelope,{
    fetchImpl:async ()=>{fetchCalls++;return {ok:true,status:200,json:async ()=>({})};},
  });
  assert.equal(page.guards.length,1);
  await assert.rejects(page.guards[0].click(),/muse_confirmation_server_not_configured/);
  assert.equal(fetchCalls,0);
  assert.equal(button.disabled,false);
  assert.equal(button.textContent,'Buy now');
  await assert.rejects(page.resume(),/muse_confirmation_server_not_configured/);
});

test('Live confirmation page fails closed when the sheet cannot be built safely',()=>{
  const {root}=pageRoot();
  assert.throws(()=>mountMuseConfirmationPage(root,
    {...envelope,seller:{provider:'shopify' as const,externalAccountId:'sams-club.myshopify.com'}},
    {apiBase:'https://api.example.test',approvalToken:'t'}),
    /muse_confirmation_seller_display_required/);
  assert.equal(root.innerHTML,'');
});

test('Server handlers reject a malformed owned-status payload instead of inventing a state',async ()=>{
  const handlers=createMuseConfirmationServerHandlers({
    connectionId:'conn-1',
    draftId:'draft-1',
    apiBase:'https://api.example.test',
    fetchImpl:async ()=>({ok:true,status:200,json:async ()=>({draftId:'draft-1'})}),
  });
  await assert.rejects(handlers.readOwnedStatus('draft-1'),/muse_confirmation_status_invalid/);
});
