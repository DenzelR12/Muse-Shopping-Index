import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {authorizeOperatorConsole,isOperatorConsolePath} from './operator-auth.js';
import {FixedWindowRateLimiter,assertDraftMayApprove,clientKey,draftExpiry,runtimeReadiness,securityHeaders} from './runtime.js';
import {searchShoppingIndex,type ShoppingOffer} from '@gift-signal/shopping-index';
import {interpretWithMuse,museConfigurationStatus} from './muse.js';
import {demoOffers} from './offers.js';
import {createReelCommerceIntent} from './reel-commerce.js';
import {buildMuseCheckoutPlan} from './checkout-plan.js';

const port=Number(process.env.PORT??process.env.DEMO_PORT??3100);
const draftTtlMs=Math.max(60_000,Math.min(Number(process.env.DRAFT_TTL_MS??900_000),3_600_000));
const limiter=new FixedWindowRateLimiter(Math.max(10,Number(process.env.RATE_LIMIT_PER_MINUTE??120)),60_000);
const root=join(fileURLToPath(new URL('../public/',import.meta.url)));
const drafts=new Map<string,{draftId:string;offer:ShoppingOffer;quantity:number;total:number;status:'REVIEW'|'APPROVED'|'CONFIRMED';createdAt:string;expiresAt:string}>();
const metrics={searches:0,drafts:0,approvals:0,baselineClicks:12,connectorClicks:3};
const startedAt=new Date().toISOString();
const buildSha=process.env.RENDER_GIT_COMMIT??process.env.GIT_SHA??'unknown';
const businessApiBase=(process.env.BUSINESS_API_BASE_URL??'').replace(/\/$/,'');
const businessApiConfigured=Boolean(
  businessApiBase&&
  process.env.BUSINESS_API_ORG_ID&&
  process.env.BUSINESS_API_CREDENTIAL_ID&&
  process.env.BUSINESS_API_KEY
);

async function operatorApi(path:string,init:RequestInit={}){
  if(!businessApiConfigured) throw new Error('business_api_not_configured');
  const response=await fetch(businessApiBase+path,{
    ...init,
    headers:{
      'content-type':'application/json',
      'x-org-id':String(process.env.BUSINESS_API_ORG_ID),
      'x-credential-id':String(process.env.BUSINESS_API_CREDENTIAL_ID),
      'x-api-key':String(process.env.BUSINESS_API_KEY),
      ...(init.headers??{})
    }
  });
  const text=await response.text();
  let payload:any={};
  try{payload=text?JSON.parse(text):{};}catch{payload={error:'business_api_invalid_json'};}
  return {status:response.status,payload};
}

const send=(res:any,status:number,payload:unknown)=>{
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(payload));
};

const readJson=async(req:any)=>{
  const chunks:Buffer[]=[];
  let size=0;
  for await(const chunk of req){
    const buf=Buffer.from(chunk);size+=buf.length;
    if(size>256*1024) throw new Error('payload_too_large');
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}') as any;
};

const mime=(path:string)=>({
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'
}[extname(path)]??'application/octet-stream');

const server=createServer(async(req,res)=>{
  const requestId=randomUUID();
  for(const [name,value] of Object.entries(securityHeaders(requestId))) res.setHeader(name,value);
  const key=clientKey(req.headers as Record<string,string|string[]|undefined>,req.socket.remoteAddress);
  const rate=limiter.check(key);
  res.setHeader('x-ratelimit-remaining',String(rate.remaining));
  if(!rate.allowed) return send(res,429,{error:'rate_limited',requestId});
  if(isOperatorConsolePath(req.url)){
    const header=req.headers.authorization;
    const authorization=Array.isArray(header)?header[0]:header;
    const access=authorizeOperatorConsole(authorization);
    if(!access.ok){
      if(access.challenge) res.setHeader('www-authenticate','Basic realm="Gift Signal Operator Console", charset="UTF-8"');
      return send(res,access.status,{error:access.error,requestId});
    }
  }
  try{
    if(req.method==='GET'&&req.url==='/health') return send(res,200,{
      ok:true,
      service:'gift-signal-competition-demo',
      startedAt,
      buildSha
    });
    if(req.method==='GET'&&req.url==='/ready'){
      const muse=museConfigurationStatus();
      const runtime=runtimeReadiness();
      return send(res,runtime.mode==='production'&&!runtime.productionReady?503:200,{
        ok:true,
        service:'gift-signal-competition-demo',
        buildSha,
        demoMode:runtime.mode!=='production',
        runtime,
        muse,
        capabilities:{
          deterministicFallback:true,
          shoppingIndex:true,
          retailDemo:true,
          travelDemo:true,
          explicitApproval:true,
          paymentAdapter:true,
          learningLayer:true
        }
      });
    }
    if(req.method==='GET'&&req.url==='/operator/status'){
      return send(res,200,{configured:businessApiConfigured});
    }
    if(req.method==='GET'&&req.url==='/operator/providers'){
      const upstream=await operatorApi('/v1/providers');
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='GET'&&req.url==='/operator/connections'){
      const upstream=await operatorApi('/v1/provider-connections');
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='GET'&&req.url?.startsWith('/operator/readiness/')){
      const match=req.url.match(/^\/operator\/readiness\/([^/]+)\/([^/?]+)$/);
      if(!match) return send(res,400,{error:'invalid_operator_path'});
      const upstream=await operatorApi('/v1/provider-readiness/'+encodeURIComponent(decodeURIComponent(match[1]))+'/'+encodeURIComponent(decodeURIComponent(match[2])));
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='GET'&&req.url==='/operator/observability'){
      const upstream=await operatorApi('/v1/provider-observability');
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='GET'&&req.url?.startsWith('/operator/refunds')){
      const url=new URL(req.url,'http://localhost');
      const limit=url.searchParams.get('limit')??'50';
      const upstream=await operatorApi('/v1/provider-transactions/refunds?limit='+encodeURIComponent(limit));
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='POST'&&req.url?.startsWith('/operator/refunds/')){
      const match=req.url.match(/^\/operator\/refunds\/([^/?]+)$/);
      if(!match) return send(res,400,{error:'invalid_operator_path'});
      const upstream=await operatorApi('/v1/provider-transactions/'+encodeURIComponent(decodeURIComponent(match[1]))+'/refund',{
        method:'POST',
        body:'{}'
      });
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='GET'&&req.url?.startsWith('/operator/reconciliation')){
      const url=new URL(req.url,'http://localhost');
      const limit=url.searchParams.get('limit')??'50';
      const upstream=await operatorApi('/v1/provider-transactions/reconcile?limit='+encodeURIComponent(limit));
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='POST'&&req.url?.startsWith('/operator/reconciliation/')){
      const match=req.url.match(/^\/operator\/reconciliation\/([^/?]+)$/);
      if(!match) return send(res,400,{error:'invalid_operator_path'});
      const body=await readJson(req);
      const upstream=await operatorApi('/v1/provider-transactions/'+encodeURIComponent(decodeURIComponent(match[1]))+'/reconcile',{
        method:'POST',
        body:JSON.stringify({
          resolution:body.resolution,
          providerOrderId:body.providerOrderId,
          note:body.note
        })
      });
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='POST'&&req.url==='/operator/rekey-batch'){
      const body=await readJson(req);
      const upstream=await operatorApi('/v1/provider-credentials/rekey-batch',{
        method:'POST',
        body:JSON.stringify({limit:body.limit??100})
      });
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='POST'&&req.url?.startsWith('/operator/runtime/')){
      const match=req.url.match(/^\/operator\/runtime\/([^/]+)\/([^/]+)\/(sync|rekey|revoke)$/);
      if(!match) return send(res,400,{error:'invalid_operator_path'});
      const provider=encodeURIComponent(decodeURIComponent(match[1]));
      const account=encodeURIComponent(decodeURIComponent(match[2]));
      const action=match[3];
      const body=await readJson(req);
      const upstream=await operatorApi('/v1/provider-runtime/'+provider+'/'+account+'/'+action,{
        method:'POST',
        body:JSON.stringify(action==='sync'?{kind:body.kind}: {})
      });
      return send(res,upstream.status,upstream.payload);
    }
    if(req.method==='GET'&&req.url==='/api/metrics'){
      const removed=metrics.baselineClicks-metrics.connectorClicks;
      return send(res,200,{...metrics,removedClicks:removed,reductionPercent:Math.round(removed/metrics.baselineClicks*100)});
    }
    if(req.method==='POST'&&req.url==='/api/search'){
      const body=await readJson(req);
      const message=String(body.message??'').trim();
      if(!message) return send(res,400,{error:'message_required'});
      const interpreted=await interpretWithMuse(message);
      metrics.searches++;
      const results=searchShoppingIndex(interpreted.intent,demoOffers,5,new Date('2026-10-24T15:10:00.000Z'));
      return send(res,200,{mode:interpreted.mode,fallbackReason:interpreted.fallbackReason,model:interpreted.model,latencyMs:interpreted.latencyMs,intent:interpreted.intent,results});
    }
    if(req.method==='POST'&&req.url==='/api/reel-intent'){
      const body=await readJson(req);
      const reelId=String(body.reelId??'').trim();
      const caption=typeof body.caption==='string'?body.caption:undefined;
      const productHints=Array.isArray(body.productHints)?body.productHints.map((value:any)=>String(value)).filter(Boolean):undefined;
      if(!reelId) return send(res,400,{error:'reel_id_required'});
      try{
        const intent=await createReelCommerceIntent({
          source:{
            platform:'meta',
            reelId,
            ...(typeof body.reelUrl==='string'&&body.reelUrl.trim()?{reelUrl:body.reelUrl.trim()}:{}),
            ...(typeof body.creatorId==='string'&&body.creatorId.trim()?{creatorId:body.creatorId.trim()}:{}),
            ...(caption?.trim()?{caption:caption.trim()}:{}),
            ...(productHints?.length?{productHints}:{})
          },
          offers:demoOffers,
          now:new Date('2026-10-24T15:10:00.000Z')
        });
        metrics.searches++;
        return send(res,201,intent);
      }catch(error){
        const message=error instanceof Error?error.message:'reel_intent_failed';
        return send(res,message==='reel_product_context_required'?400:500,{error:message});
      }
    }
    if(req.method==='POST'&&req.url==='/api/checkout-plan'){
      const body=await readJson(req);
      const intentId=String(body.intentId??'').trim();
      const offer=demoOffers.find(item=>item.offerId===body.offerId);
      if(!intentId) return send(res,400,{error:'intent_id_required'});
      if(!offer) return send(res,404,{error:'offer_not_found'});
      const plan=buildMuseCheckoutPlan({
        intentId,
        offer,
        quantity:body.quantity===undefined?undefined:Number(body.quantity),
        consumer:{
          ...(typeof body.subjectId==='string'?{subjectId:body.subjectId}:{}),
          ...(typeof body.shopUserPublicId==='string'?{shopUserPublicId:body.shopUserPublicId}:{}),
          ...(typeof body.shopIdentityVerifiedAt==='string'?{shopIdentityVerifiedAt:body.shopIdentityVerifiedAt}:{}),
          ...(body.paymentAuthorization&&typeof body.paymentAuthorization==='object'?{
            paymentAuthorization:{
              rail:body.paymentAuthorization.rail,
              reference:String(body.paymentAuthorization.reference??''),
              verifiedAt:String(body.paymentAuthorization.verifiedAt??'')
            }
          }:{}),
          ...(body.shippingAddress&&typeof body.shippingAddress==='object'?{shippingAddress:body.shippingAddress}:{}),
          ...(typeof body.confirmationEmail==='string'?{confirmationEmail:body.confirmationEmail}:{})
        }
      });
      return send(res,200,plan);
    }
    if(req.method==='POST'&&req.url==='/api/draft'){
      const body=await readJson(req);
      const offer=demoOffers.find(item=>item.offerId===body.offerId);
      if(!offer) return send(res,404,{error:'offer_not_found'});
      const quantity=Number(body.quantity??1);
      if(!Number.isInteger(quantity)||quantity<1||quantity>10) return send(res,400,{error:'invalid_quantity'});
      const draftId=randomUUID();
      const createdAt=new Date().toISOString();
      const draft={draftId,offer,quantity,total:Number((offer.price*quantity).toFixed(2)),status:'REVIEW' as const,createdAt,expiresAt:draftExpiry(createdAt,draftTtlMs)};
      drafts.set(draftId,draft);metrics.drafts++;
      return send(res,201,{draft,approvalRequired:true,liveRevalidationRequired:true});
    }
    if(req.method==='POST'&&req.url==='/api/approve'){
      const body=await readJson(req);
      const draft=drafts.get(String(body.draftId??''));
      if(!draft) return send(res,404,{error:'draft_not_found'});
      if(body.approved!==true) return send(res,400,{error:'explicit_approval_required'});
      try{assertDraftMayApprove(draft);}catch(error){return send(res,409,{error:error instanceof Error?error.message:'draft_not_approvable'});}
      draft.status='CONFIRMED';metrics.approvals++;
      return send(res,200,{
        draft,
        transaction:{
          mode:'DEMO',
          rail:draft.offer.kind==='PRODUCT'?'SHOP_OR_STRIPE':'PROVIDER_NATIVE_OR_STRIPE',
          providerReference:`DEMO-${draft.draftId.slice(0,8).toUpperCase()}`,
          message:'Demo transaction confirmed. No real charge or booking was made.'
        },
        fulfillment:draft.offer.kind==='PRODUCT'
          ?{state:'PROCESSING',next:'SHIP',message:'Demo merchant accepted the order for fulfillment.'}
          :{state:'CONFIRMED',next:'TRIP_READY',message:'Demo provider accepted the booking.'}
      });
    }

    if(req.method==='GET'){
      const requested=req.url==='/'?'/index.html':String(req.url??'/index.html').split('?')[0];
      const clean=normalize(requested).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/,'');
      const path=join(root,clean);
      if(!path.startsWith(root)) return send(res,403,{error:'forbidden'});
      try{
        const file=await readFile(path);
        res.writeHead(200,{'content-type':mime(path),'cache-control':'no-store'});res.end(file);return;
      }catch{}
    }
    return send(res,404,{error:'not_found'});
  }catch(error){
    return send(res,error instanceof Error&&error.message==='payload_too_large'?413:500,{error:error instanceof Error?error.message:'internal_error'});
  }
});

server.listen(port,()=>console.log(`Gift Signal service listening on http://localhost:${port}`));
const shutdown=(signal:string)=>{
  console.log(`Received ${signal}; shutting down.`);
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(1),10_000).unref();
};
process.once('SIGTERM',()=>shutdown('SIGTERM'));
process.once('SIGINT',()=>shutdown('SIGINT'));
setInterval(()=>limiter.cleanup(),60_000).unref();
