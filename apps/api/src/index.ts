import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {randomUUID} from 'node:crypto';
import { z } from 'zod';
import { productContextFields } from './product-context-schema.js';
import { recommend } from '@gift-signal/gift-intelligence';
import type { GiftContext, ProductCandidate } from '@gift-signal/schemas';
import { buildBundles, recordBundleInteraction } from './bundles.js';
import { authenticateRequest,authenticateRequestWithAuthority,PostgresApiCredentialAuthority } from './auth.js';
import { evaluateRisk, type Capability } from '@gift-signal/signal-shield';
import {Pool} from 'pg';
import {PostgresRateLimiter} from './rate-limit.js';
import {apiSecurityHeaders,requestClientKey} from './security.js';
import {issueHumanApproval,verifyHumanIdentity,approvalErrorStatus} from './approval.js';
import {productionReadiness} from './readiness.js';
import {handleStripeWebhook,handleShopifyWebhook} from './provider-webhooks.js';
import {onboardingStatus} from './onboarding.js';
import {getDemoReelGrounding,isDemoReelId} from './muse-demo-grounding.js';
import {providerCatalog,providerConnectionPlan,PostgresTenantProviderCredentialVault,VaultBackedProviderRuntime,PostgresProviderOAuthTransactionStore,ProviderOAuthCoordinator,PostgresZeroTrustAuthority,ZeroTrustConnectorRegistry,ZeroTrustConnectorRuntime,landedQuoteTotalAmount,decimalPriceToMinorUnits,type OAuthProvider,type ShopifyShippingAddress} from '@gift-signal/mcp-gateway';
import {PostgresProviderConnectionStore} from './provider-connections.js';
import {ProviderRuntimeControlPlane} from './provider-runtime-control.js';
import {PostgresProviderReadinessEvidenceStore} from './provider-readiness-store.js';
import {PostgresProviderAgentPolicyStore} from './provider-agent-policy.js';
import {PostgresProviderAgentRegistry} from './provider-agent-registry.js';
import {ProviderReadinessService} from './provider-readiness-service.js';
import {ProviderSecurityAuditor} from './provider-security-audit.js';
import {ProviderTransactionExecutionService} from './provider-transaction-execution.js';
import {PostgresProviderTransactionIntentStore} from './provider-transaction-store.js';
import {PostgresProviderObservabilityStore} from './provider-observability.js';
import {PostgresProviderAlertStateStore} from './provider-alerts.js';
import {ProviderTransactionDraftService} from './provider-transaction-draft.js';
import {ProviderRefundCompensationService} from './provider-refund-compensation.js';
import {runRefundRecoveryWithAdvisoryLock} from './provider-refund-recovery.js';
import {verifyApproval} from '@gift-signal/zero-trust';
import {PostgresSecurityAuditSink} from '@gift-signal/mcp-gateway';
import {submitMuseConfirmation} from './muse-confirmation-submit.js';
import {resolvePaymentVehicle} from './shop-pay-vehicle.js';
import {createServerCompanyDisplayResolver,registerServerCompanyDisplayName,validateSellerDisplayName,validateItemTitle,validateOptionalReviewFact} from './muse-seller-display.js';
// Panel live wiring (see docs/muse-panel-live-wiring.md): draft registry,
// session issuance, and host adapter exist in code (muse-panel-live-wiring.ts).
// This server has no authenticated panel session and no bound host methods
// yet, so panel branches still refuse — now at session/host binding, not at
// a null draft lookup. See the live-wiring doc for the one remaining gap.
import {PostgresPanelSessionTokenStore} from './muse-panel-session-store.js';
import {createPanelSessionMount} from './muse-panel-session-mount.js';
import {MemoryPanelDraftRegistry,PostgresPanelDraftRegistry,panelDraftResolver,createPanelLiveHostDeps} from './muse-panel-live-wiring.js';
import {PostgresCompanySellerManifestStore,createPersistedSellerDisplayResolver} from './muse-seller-display-store.js';
import {AuthenticatedMuseCommerceHost,parseMuseAgentRequest} from './muse-agent-host.js';
import {PostgresCompanyGenericProfileStore,buildGenericProfileNextSteps,createGenericProfileResolver,createGenericReadiness,createGenericDraftResolver,createGenericSubmit,validateGenericProfileRegistration,SYNTHETIC_FIXTURE_COMPANY_ID} from './muse-generic-profile.js';
import {buildBiCsv,buildBiDashboardHtml,InMemoryBiEventStore,parseBiDemoEventsEnv,queryBiReport,type BiEventStore,type BiWatermarkStore} from './muse-bi.js';
import {PostgresBiEventStore} from './muse-bi-store.js';
import {getMetaAdsClient,getShopPayExecutionClient,ingestMetaAdEvents,parseGenericAdapterConfig,resolveLiveActivationConfig,validateMetaVerificationRecording,validateReelEntry} from './live-activation.js';
import {runMuseToolAgent} from '@gift-signal/competition-demo/muse-tool-agent';
import {PostgresConsumerCommerceIdentityStore} from './consumer-commerce-identity.js';
import {PostgresEnrollmentStore,startConsumerEnrollment,completeConsumerEnrollment,enrollmentRequest,enrollmentErrorStatus} from './consumer-enrollment.js';
import {verifyStripeSetupIntent,createStripeEnrollmentSetup,readStripeTransactionCheckout} from '@gift-signal/payments';

const giftContextSchema = z.object({
  recipient: z.string().min(1).optional(),
  relationship: z.string().min(1).optional(),
  occasion: z.string().min(1).optional(),
  interests: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
  budgetMin: z.number().nonnegative().optional(),
  budgetMax: z.number().positive().optional(),
  hardBudget: z.boolean().optional(),
  deliveryTier: z.enum(['10_MIN','TOMORROW','3_DAYS','THIS_WEEK','NO_RUSH']).optional(),
  destinationCountry: z.string().min(2).optional()
});

const productSchema = z.object({
  ...productContextFields,
  productId: z.string().min(1),
  title: z.string().min(1),
  price: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
  inStock: z.boolean(),
  semanticIntents: z.array(z.string()).default([]),
  useCases: z.array(z.string()).default([]),
  recipientFit: z.array(z.string()).default([]),
  occasionFit: z.array(z.string()).default([]),
  bundleRoles: z.array(z.string()).default([]),
  semanticSummary: z.string().optional(),
  deliveryConfidence: z.number().min(0).max(100).optional(),
  semanticCompleteness: z.number().min(0).max(100).optional()
});

const recommendationSchema = z.object({ context: giftContextSchema, candidates: z.array(productSchema).max(500) });
const send=(res:ServerResponse,status:number,payload:unknown,requestId?:string)=>{res.writeHead(status,{'content-type':'application/json',...(requestId?{'x-request-id':requestId}:{})});res.end(JSON.stringify(payload));};
const MAX_BODY_BYTES=256*1024;
const dbPool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined}):null;
const credentialAuthority=dbPool?new PostgresApiCredentialAuthority(dbPool):null;
const sharedLimiter=dbPool?new PostgresRateLimiter(dbPool,Math.max(10,Number(process.env.API_RATE_LIMIT_PER_MINUTE??120)),60):null;
const providerConnections=dbPool?new PostgresProviderConnectionStore(dbPool):null;
const providerCredentialVault=dbPool?new PostgresTenantProviderCredentialVault(dbPool):null;
const providerRuntime=providerCredentialVault?new VaultBackedProviderRuntime(providerCredentialVault):null;
const providerOAuthTransactions=dbPool?new PostgresProviderOAuthTransactionStore(dbPool):null;
const providerOAuth=providerOAuthTransactions&&providerRuntime
  ? new ProviderOAuthCoordinator(providerOAuthTransactions,providerRuntime)
  : null;
const providerAuditSink=dbPool&&process.env.AUDIT_SIGNING_SECRET
  ? new PostgresSecurityAuditSink(dbPool,process.env.AUDIT_SIGNING_SECRET)
  : null;
const providerAuditor=providerAuditSink?new ProviderSecurityAuditor(providerAuditSink):null;
const providerReadinessEvidence=dbPool?new PostgresProviderReadinessEvidenceStore(dbPool):null;
const companySellerManifests=dbPool?new PostgresCompanySellerManifestStore(dbPool):null;
const providerAgentPolicies=dbPool?new PostgresProviderAgentPolicyStore(dbPool):null;
const providerAgentRegistry=dbPool?new PostgresProviderAgentRegistry(dbPool):null;
const providerTransactionIntents=dbPool?new PostgresProviderTransactionIntentStore(dbPool):null;
const providerObservability=dbPool?new PostgresProviderObservabilityStore(dbPool):null;
const providerAlertState=dbPool?new PostgresProviderAlertStateStore(dbPool):null;
const providerZeroTrustAuthority=dbPool?new PostgresZeroTrustAuthority(dbPool):null;
const companyGenericProfiles=dbPool?new PostgresCompanyGenericProfileStore(dbPool):null;
// Panel session store + mount + live wiring (see docs/muse-panel-live-wiring.md):
// draft lookup is now live via PanelDraftRegistry (Postgres when a pool
// exists, memory otherwise — memory is single-process only and is
// populated server-internally, never from HTTP), session issuance is
// available via issuePanelSession() (server-internal, never HTTP, token
// from the authenticated session only), and host methods go through
// createPanelLiveHostDeps() (tenant checks + approve in-flight guard).
// No host methods are bound at startup in this branch: panel branches
// authenticate a company principal (orgId) and have no consumer
// identity, connectionId, or approval token from an authenticated panel
// session, and the approval flow needs all three. Binding a fake
// consumer, a guessed connectionId, or a body-derived token would
// violate the safety model, so unbound host methods fail closed with
// muse_panel_host_not_configured. That production host binding is the
// one remaining panel gap — see the live-wiring doc.
const panelSessionStore=dbPool?new PostgresPanelSessionTokenStore(dbPool):null;
const panelDraftRegistry=dbPool?new PostgresPanelDraftRegistry(dbPool):new MemoryPanelDraftRegistry();
const panelLiveHostDeps=createPanelLiveHostDeps({});
const panelSessionMount=createPanelSessionMount({
  store:panelSessionStore,
  resolveDraft:panelDraftResolver(panelDraftRegistry),
  hostDeps:panelLiveHostDeps,
});
// Server-operator connector registry for the generic profile. It
// starts empty and is populated only by server startup code, never
// over HTTP and never with the synthetic fixture: a registered
// generic profile without a registered adapter fails closed at
// submit time (muse_generic_connector_not_registered) instead of
// executing on a guessed provider. See muse-generic-profile.ts.
const genericConnectorRegistry=new ZeroTrustConnectorRegistry();
// Live activation (see live-activation.ts and docs/live-readiness.md):
// presence booleans only — secret values are never logged or read
// back. By default every client registry is empty, so every gated
// path fails closed until the operator supplies credentials/config
// AND a startup-registered client. Generic adapter config declares
// which adapter serves which company; it does not create an adapter.
const liveActivation=resolveLiveActivationConfig(process.env);
let genericAdapterConfig:Record<string,string>={};
try{
  genericAdapterConfig=parseGenericAdapterConfig(process.env.MUSE_GENERIC_ADAPTER_CONFIG_JSON);
}catch{
  console.log(JSON.stringify({event:'live_activation_generic_adapter_config_invalid'}));
}
console.log(JSON.stringify({
  event:'live_activation_config_present',
  shopPayReady:liveActivation.shopPay.ready,
  metaVerificationRecordingConfigured:liveActivation.metaVerificationRecording.secretConfigured,
  metaAdsReady:liveActivation.metaAds.ready,
  reelEntryConfigured:liveActivation.reelEntry.secretConfigured,
  genericAdapterCompanies:Object.keys(genericAdapterConfig),
}));
const biLiveEventStore:BiEventStore&BiWatermarkStore=(dbPool
  ? new PostgresBiEventStore(dbPool)
  : new InMemoryBiEventStore()) as BiEventStore&BiWatermarkStore;
const genericConnectorRuntime=providerZeroTrustAuthority&&process.env.DRAFT_SIGNING_SECRET&&process.env.APPROVAL_SIGNING_SECRET
  ? new ZeroTrustConnectorRuntime(genericConnectorRegistry,providerZeroTrustAuthority,providerZeroTrustAuthority,providerZeroTrustAuthority,
      {draftSigningSecret:process.env.DRAFT_SIGNING_SECRET,approvalSigningSecret:process.env.APPROVAL_SIGNING_SECRET},
      providerAuditSink??undefined)
  : null;
const consumerCommerceIdentities=dbPool?new PostgresConsumerCommerceIdentityStore(dbPool):null;
const consumerEnrollments=dbPool?new PostgresEnrollmentStore(dbPool):null;
const providerTransactionDrafts=providerZeroTrustAuthority&&process.env.DRAFT_SIGNING_SECRET
  ? new ProviderTransactionDraftService(providerZeroTrustAuthority,process.env.DRAFT_SIGNING_SECRET)
  : null;
const providerRuntimeControl=providerRuntime&&providerConnections
  ? new ProviderRuntimeControlPlane(providerRuntime,providerConnections,providerAuditor??undefined,providerReadinessEvidence??undefined)
  : null;
const providerAuditReady=process.env.NODE_ENV!=='production'||Boolean(providerAuditor);
const providerReadiness=providerConnections&&providerReadinessEvidence
  ? new ProviderReadinessService(providerConnections,providerReadinessEvidence,providerAgentPolicies??undefined,providerAgentRegistry??undefined,companySellerManifests??undefined)
  : null;
const providerTransactionExecution=providerConnections&&providerAgentPolicies&&providerAgentRegistry&&providerTransactionIntents
  ? new ProviderTransactionExecutionService(providerConnections,providerAgentPolicies,providerAgentRegistry,providerTransactionIntents,providerRuntimeControl??undefined,providerAuditor??undefined)
  : null;
const providerRefundCompensation=providerTransactionIntents
  ? new ProviderRefundCompensationService(providerTransactionIntents,providerAuditor??undefined)
  : null;

if(process.env.NODE_ENV==='production'){
  const readiness=productionReadiness();
  console.log(JSON.stringify({
    event:'production_configuration_readiness',
    ready:readiness.ready,
    missing:readiness.missing,
    gates:readiness.gates,
    refundRecoveryConfigured:Boolean(dbPool&&providerTransactionIntents&&process.env.STRIPE_SECRET_KEY)
  }));
}
const readRaw=async(req:IncomingMessage)=>{
  const chunks:Buffer[]=[]; let total=0;
  for await(const chunk of req){
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    total+=buffer.length;
    if(total>MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};
const readJson=async(req:IncomingMessage)=>JSON.parse((await readRaw(req)).toString('utf8')||'{}');

const normalizeProviderAccountId=(provider:string,value:string)=>
  provider==='shopify'?value.trim().toLowerCase():value;

const supportedCurrencyCodes=new Set(Intl.supportedValuesOf('currency'));

const requireCapability=(principal:{orgId:string;capabilities:Capability[];roles?:string[]},capability:Capability)=>{
  const result=evaluateRisk({actor:{actorId:principal.orgId,actorType:'service',roles:principal.roles??[],capabilities:principal.capabilities},capability});
  return result.decision==='ALLOW';
};

createServer(async(req,res)=>{
  const requestId=randomUUID();
  for(const [name,value] of Object.entries(apiSecurityHeaders(requestId))) res.setHeader(name,value);
  if(req.method==='GET'&&req.url==='/health') return send(res,200,{ok:true,service:'gift-signal-api'});
  if(req.method==='GET'&&req.url==='/v1/onboarding/status') return send(res,200,onboardingStatus(),requestId);
  if(req.method==='GET'&&req.url==='/v1/providers'){
    const providers=Object.keys(providerCatalog).map(provider=>providerConnectionPlan(provider as keyof typeof providerCatalog));
    return send(res,200,{providers},requestId);
  }
  if(req.method==='GET'&&req.url){
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/v1/provider-oauth/callback'){
    try{
      if(!providerOAuth) return send(res,503,{error:'provider_oauth_not_configured'},requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},requestId);
      const state=url.searchParams.get('state');
      const code=url.searchParams.get('code');
      if(!state||!code) return send(res,400,{error:'provider_oauth_callback_invalid'},requestId);
      const authorization=await providerOAuth.complete({state,code,callbackUrl:url});
      const connection=providerRuntimeControl
        ? await providerRuntimeControl.reconcileAuthorization({...authorization,scope:authorization.scope})
        : null;
      if(providerAuditor){
        await providerAuditor.record('provider.oauth.completed',{
          companyId:authorization.companyId,
          provider:authorization.provider,
          externalAccountId:authorization.externalAccountId,
          requestId
        });
        await providerReadinessEvidence?.markTrusted(
          {
            companyId:authorization.companyId,
            provider:authorization.provider,
            externalAccountId:authorization.externalAccountId
          },
          {auditTrail:true}
        );
      }
      return send(res,200,{authorization,connection},requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'provider_oauth_callback_failed';
      const status=/not_configured/.test(message)?503:/invalid|expired|replayed|mismatch|required|missing/.test(message)?400:502;
      return send(res,status,{error:message},requestId);
    }
    }
  }
  if(req.method==='GET'&&req.url==='/ready'){
    const readiness=productionReadiness();
    return send(res,readiness.ready?200:503,readiness,requestId);
  }
  if(req.method==='POST'&&req.url==='/v1/webhooks/stripe'){
    try{
      const raw=await readRaw(req);
      const header=req.headers['stripe-signature'];
      const signature=Array.isArray(header)?header[0]:header;
      return send(res,200,await handleStripeWebhook(raw,signature),requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'stripe_webhook_failed';
      await providerObservability?.record({provider:'stripe',eventType:'webhook.failed',errorCode:message});
      const status=/not_configured|database/.test(message)?503:/signature|replayed|timestamp|json|missing/.test(message)?400:500;
      return send(res,status,{error:message},requestId);
    }
  }
  if(req.method==='POST'&&req.url==='/v1/webhooks/shopify'){
    try{
      const raw=await readRaw(req);
      const header=(name:string)=>{
        const value=req.headers[name];
        return Array.isArray(value)?value[0]:value;
      };
      return send(res,200,await handleShopifyWebhook(raw,{
        'x-shopify-hmac-sha256':header('x-shopify-hmac-sha256'),
        'x-shopify-topic':header('x-shopify-topic'),
        'x-shopify-shop-domain':header('x-shopify-shop-domain'),
        'x-shopify-webhook-id':header('x-shopify-webhook-id'),
        'x-shopify-triggered-at':header('x-shopify-triggered-at')
      }),requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'shopify_webhook_failed';
      await providerObservability?.record({provider:'shopify',eventType:'webhook.failed',errorCode:message});
      const status=/not_configured|database/.test(message)?503:/signature|replayed|headers|json/.test(message)?400:500;
      return send(res,status,{error:message},requestId);
    }
  }
  // Trusted Reel entry callback (live-activation point). Like the
  // Stripe/Shopify webhooks above, this sits before the company
  // principal block because its authentication is the HMAC
  // signature, not an API key — and it is safe to do so because it
  // creates NOTHING: no draft, no approval, no execution, no state
  // change. It only normalizes a signature-verified intent. Without
  // META_REEL_CALLBACK_SIGNING_SECRET it is 410; with a bad
  // signature it is 401. Meta actually sending Reels to this
  // endpoint (distribution approval) remains an external Meta
  // decision, not something this route grants.
  if(req.method==='POST'&&req.url==='/v1/muse/reel-entry'){
    try{
      const secret=process.env.META_REEL_CALLBACK_SIGNING_SECRET??'';
      const raw=await readRaw(req);
      const header=req.headers['x-meta-reel-signature'];
      const signature=Array.isArray(header)?header[0]:header;
      const intent=validateReelEntry({secret,rawBody:raw,signatureHeader:signature});
      return send(res,200,{intent,note:'reel_intent_received_no_draft_no_approval_no_execution'},requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'reel_entry_failed';
      const status=/not_configured/.test(message)?410:/signature/.test(message)?401:/payload|invalid/.test(message)?400:500;
      return send(res,status,{error:message},requestId);
    }
  }
  // Public demo grounding (read-only): the demo page sends a reel id
  // and Muse Spark's verdict returns through the fail-closed grounding
  // module. Unauthenticated by design: the input surface is an enum of
  // demo reels, frames and catalog are server-side demo data, results
  // are cached 24h with a fresh-call budget, and the route cannot
  // approve, sign, or execute anything. CORS is scoped to this path and
  // the public demo origin only.
  if(req.method==='OPTIONS'&&req.url==='/v1/demo/reel-grounding'){
    res.writeHead(204,{'access-control-allow-origin':'https://denzelr12.github.io','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'86400'});
    return res.end();
  }
  if(req.method==='POST'&&req.url==='/v1/demo/reel-grounding'){
    res.setHeader('access-control-allow-origin','https://denzelr12.github.io');
    res.setHeader('cache-control','no-store');
    const demoModelKey=process.env.META_MODEL_API_KEY,demoModelBase=process.env.META_MODEL_API_BASE_URL,demoModelName=process.env.META_MUSE_MODEL;
    if(!demoModelKey||!demoModelBase||!demoModelName) return send(res,503,{error:'muse_not_configured'},requestId);
    try{
      const payload=await readJson(req) as Record<string,unknown>;
      if(!isDemoReelId(payload.reelId)) return send(res,400,{error:'demo_reel_unknown'},requestId);
      const result=await getDemoReelGrounding(payload.reelId,{apiKey:<redacted>,baseUrl:demoModelBase,model:demoModelName});
      return send(res,200,result,requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'demo_grounding_failed';
      return send(res,/budget/.test(message)?429:502,{error:message},requestId);
    }
  }
  if(process.env.NODE_ENV==='production'&&!sharedLimiter) return send(res,503,{error:'persistent_rate_limit_not_configured'},requestId);
  if(req.method==='POST'&&req.url==='/v1/approvals/issue'){
    try{
      const payload=await readJson(req) as Record<string,unknown>;
      return send(res,200,await issueHumanApproval(req,payload),requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'approval_failed';
      return send(res,approvalErrorStatus(message),{error:message},requestId);
    }
  }
  if(req.method==='POST'&&req.url==='/v1/muse/approvals/issue'){
    try{
      if(!consumerCommerceIdentities) return send(res,503,{error:'consumer_commerce_identity_store_not_configured'},requestId);
      const payload=await readJson(req) as Record<string,unknown>;
      return send(res,200,await issueHumanApproval(req,payload,{
        // Either enrolled rail may authorize: the approval's payment
        // reference is matched exactly at submit time against the
        // signed draft's vehicle, so a Shop Pay enrollment cannot
        // authorize a Stripe draft or vice versa.
        resolveSavedPayment:async(subjectId)=>(
          await consumerCommerceIdentities.resolveStripeSavedPayment(subjectId)
          ?? await consumerCommerceIdentities.resolveShopPaySavedPayment(subjectId)
        )
      }),requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'approval_failed';
      return send(res,approvalErrorStatus(message),{error:message},requestId);
    }
  }
  if(sharedLimiter){
    const key=requestClientKey(req.headers as Record<string,string|string[]|undefined>,req.socket.remoteAddress);
    const rate=await sharedLimiter.check('api:'+key);
    res.setHeader('x-ratelimit-remaining',String(rate.remaining));
    res.setHeader('x-ratelimit-reset',rate.resetAt);
    if(!rate.allowed) return send(res,429,{error:'rate_limited'},requestId);
  }
  if(req.method==='POST'&&req.url==='/v1/consumer-commerce/enroll'){
    return send(res,410,{error:'use_subject_bound_enrollment'},requestId);
  }
  if(req.method==='POST'&&(req.url==='/v1/consumer-commerce/enrollment/start'||req.url==='/v1/consumer-commerce/enrollment/complete')){
    res.setHeader('cache-control','no-store');
    try{
      if(!consumerCommerceIdentities||!consumerEnrollments||!process.env.STRIPE_SECRET_KEY){
        return send(res,503,{error:'consumer_commerce_enrollment_not_configured'},requestId);
      }
      const identity=await verifyHumanIdentity(req);
      const operation=req.url.endsWith('/start')?'start':'complete';
      const payload=enrollmentRequest(operation,await readJson(req));
      await consumerCommerceIdentities.ensureReady();
      if(operation==='start'){
        return send(res,201,await startConsumerEnrollment({identity,store:consumerEnrollments,
          createSetup:(enrollmentId)=>createStripeEnrollmentSetup({enrollmentId,secretKey:process.env.STRIPE_SECRET_KEY!})
        }),requestId);
      }
      return send(res,201,await completeConsumerEnrollment({identity,enrollmentId:payload.enrollmentId!,store:consumerEnrollments,
        verifySetup:(setupIntentId)=>verifyStripeSetupIntent({setupIntentId,secretKey:process.env.STRIPE_SECRET_KEY!})
      }),requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'consumer_commerce_enrollment_failed';
      return send(res,enrollmentErrorStatus(message),{error:message},requestId);
    }
  }
  if(req.method==='POST'&&req.url==='/v1/muse/agent'){
    res.setHeader('cache-control','no-store');
    if(process.env.MUSE_AGENT_ENABLED!=='true') return send(res,404,{error:'not_found'},requestId);
    try{
      if(process.env.NODE_ENV==='production'&&!productionReadiness().ready) return send(res,503,{error:'production_commerce_not_ready'},requestId);
      const identity=await verifyHumanIdentity(req);
      const payload=parseMuseAgentRequest(await readJson(req));
      if(!providerZeroTrustAuthority||!providerTransactionDrafts||!consumerCommerceIdentities||!providerTransactionIntents||!providerReadiness||!providerTransactionExecution||!providerRuntimeControl||!process.env.APPROVAL_SIGNING_SECRET||!process.env.MUSE_TRANSACTION_AGENT_ID){
        return send(res,503,{error:'muse_agent_host_not_configured'},requestId);
      }
      if(!process.env.META_MODEL_API_KEY||!process.env.META_MODEL_API_BASE_URL||!process.env.META_MUSE_MODEL) return send(res,503,{error:'muse_not_configured'},requestId);
      const host=new AuthenticatedMuseCommerceHost(identity,payload,{
        authority:providerZeroTrustAuthority,drafts:providerTransactionDrafts,identities:consumerCommerceIdentities,
        // Server-owned manifest resolver: persisted seller-manifest
        // store first (names registered by authenticated company
        // callers at draft creation, see
        // muse-seller-display-store.ts), process-local registry as
        // fallback only, then the signed draft state in the host.
        // It never derives a name from a shop domain, and it returns
        // null when no registered name exists, so the host then fails
        // closed unless the signed draft state itself carries a valid
        // name.
        resolveSellerDisplayName:createPersistedSellerDisplayResolver(companySellerManifests,createServerCompanyDisplayResolver()),
        transactions:providerTransactionIntents,approvalSecret:process.env.APPROVAL_SIGNING_SECRET,
        // Generic execution profile, wired in production: a company
        // is generic only if it explicitly registered a profile
        // (see POST /v1/muse/generic-profiles); otherwise it stays
        // on the reference path. No classification is inferred from
        // a name, domain, or model output, and the synthetic
        // fixture is never registered as an adapter here.
        resolveExecutionProfile:createGenericProfileResolver(companyGenericProfiles),
        genericReadiness:createGenericReadiness(companyGenericProfiles),
        submitGeneric:createGenericSubmit(genericConnectorRuntime,genericAdapterConfig),
        genericDraft:createGenericDraftResolver(providerZeroTrustAuthority,process.env.DRAFT_SIGNING_SECRET??''),
        businessReady:async(companyId,shopDomain)=>{
          try{return (await providerReadiness.evaluate({companyId,provider:'shopify',externalAccountId:shopDomain})).readiness==='AUTONOMOUS_READY';}
          catch{return false;}
        },
        submit:async(args)=>{
          const savedStripeAuthorization=await consumerCommerceIdentities.resolveStripeSavedPayment(args.subjectId);
          const savedShopPayAuthorization=await consumerCommerceIdentities.resolveShopPaySavedPayment(args.subjectId);
          if(!savedStripeAuthorization&&!savedShopPayAuthorization) throw Error('consumer_commerce_enrollment_required');
          const checkout=await submitMuseConfirmation({...args,agentId:process.env.MUSE_TRANSACTION_AGENT_ID!,
            approvalSecret:process.env.APPROVAL_SIGNING_SECRET!,authority:providerZeroTrustAuthority,drafts:providerTransactionDrafts,
            runtime:providerRuntimeControl,execution:providerTransactionExecution,
            ...(savedStripeAuthorization?{savedStripeAuthorization}:{}),
            ...(savedShopPayAuthorization?{savedShopPayAuthorization}:{}),
            ...(getShopPayExecutionClient()?{shopPayClient:getShopPayExecutionClient()!}:{}),
            shopPayExecutionReady:liveActivation.shopPay.ready,requestId});
          return {handoff:checkout.handoff,...('checkoutUrl' in checkout?{checkoutUrl:checkout.checkoutUrl}:{})};
        },
        readPaymentAuthentication:(transaction)=>readStripeTransactionCheckout({checkoutSessionId:transaction.paymentReference!,companyId:transaction.companyId,
          draftId:transaction.draftId,amount:transaction.amount,currency:transaction.currency,secretKey:process.env.STRIPE_SECRET_KEY??''}),
        readTracking:async(transaction)=>{
          const result=await providerRuntimeControl.readOrders({companyId:transaction.companyId,provider:transaction.fulfillmentProvider,externalAccountId:transaction.fulfillmentExternalAccountId},{limit:50});
          return result.orders.find(order=>order.externalId===transaction.providerOrderId)?.fulfillments.flatMap(item=>item.tracking)??[];
        }
      });
      // Prove ownership before sending any context or consuming model credits.
      await host.readContext();
      const result=await runMuseToolAgent({userMessage:payload.message,host});
      return send(res,200,{...result,events:host.events},requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'muse_agent_failed';
      return send(res,message==='consumer_agent_not_found'?404:approvalErrorStatus(message),{error:message},requestId);
    }
  }
  if(req.method==='POST'&&req.url==='/v1/muse/confirm'){
    try{
      if(process.env.NODE_ENV==='production'&&!productionReadiness().ready) return send(res,503,{error:'production_commerce_not_ready'},requestId);
      if(!providerTransactionExecution||!providerTransactionDrafts||!providerZeroTrustAuthority||!providerRuntimeControl||!process.env.APPROVAL_SIGNING_SECRET){
        return send(res,503,{error:'muse_confirmation_not_configured'},requestId);
      }
      const agentId=process.env.MUSE_TRANSACTION_AGENT_ID?.trim();
      if(!agentId) return send(res,503,{error:'muse_transaction_agent_not_configured'},requestId);
      const identity=await verifyHumanIdentity(req);
      const payload=await readJson(req) as {connectionId?:unknown;draftId?:unknown;approvalToken?:unknown};
      if(typeof payload.connectionId!=='string'||!payload.connectionId.trim()||payload.connectionId.length>160){
        return send(res,400,{error:'muse_connection_id_invalid'},requestId);
      }
      if(typeof payload.draftId!=='string'||!payload.draftId.trim()||payload.draftId.length>160){
        return send(res,400,{error:'muse_draft_id_invalid'},requestId);
      }
      if(typeof payload.approvalToken!=='string'||!payload.approvalToken.trim()){
        return send(res,400,{error:'muse_approval_token_required'},requestId);
      }
      if(!consumerCommerceIdentities) return send(res,503,{error:'consumer_commerce_identity_store_not_configured'},requestId);
      const savedStripeAuthorization=await consumerCommerceIdentities.resolveStripeSavedPayment(identity.subjectId);
      const savedShopPayAuthorization=await consumerCommerceIdentities.resolveShopPaySavedPayment(identity.subjectId);
      if(!savedStripeAuthorization&&!savedShopPayAuthorization){
        return send(res,409,{error:'consumer_commerce_enrollment_required'},requestId);
      }
      const checkout=await submitMuseConfirmation({
        connectionId:payload.connectionId.trim(),
        draftId:payload.draftId.trim(),
        approvalToken:payload.approvalToken.trim(),
        agentId,
        subjectId:identity.subjectId,
        ...(identity.email?{consumerEmail:identity.email}:{}),
        approvalSecret:process.env.APPROVAL_SIGNING_SECRET,
        authority:providerZeroTrustAuthority,
        drafts:providerTransactionDrafts,
        runtime:providerRuntimeControl,
        execution:providerTransactionExecution,
        ...(savedStripeAuthorization?{savedStripeAuthorization}:{}),
        ...(savedShopPayAuthorization?{savedShopPayAuthorization}:{}),
        ...(getShopPayExecutionClient()?{shopPayClient:getShopPayExecutionClient()!}:{}),
        shopPayExecutionReady:liveActivation.shopPay.ready,
        requestId
      });
      return send(res,201,{checkout},requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'muse_confirmation_failed';
      return send(res,approvalErrorStatus(message),{error:message},requestId);
    }
  }
  const museOrderMatch=req.url?.match(/^\/v1\/muse\/orders\/([^/?]+)$/);
  if(req.method==='GET'&&museOrderMatch){
    try{
      if(!providerTransactionIntents) return send(res,503,{error:'consumer_order_store_not_configured'},requestId);
      const identity=await verifyHumanIdentity(req);
      const draftId=decodeURIComponent(museOrderMatch[1]??'').trim();
      if(!draftId||draftId.length>160) return send(res,400,{error:'muse_draft_id_invalid'},requestId);
      const transaction=await providerTransactionIntents.getForConsumer(identity.subjectId,draftId);
      if(!transaction) return send(res,404,{error:'consumer_order_not_found'},requestId);

      let order:null|Record<string,unknown>=null;
      let trackingStatus:'PENDING'|'AVAILABLE'|'UNAVAILABLE'=transaction.providerOrderId?'UNAVAILABLE':'PENDING';
      if(transaction.providerOrderId&&providerRuntimeControl){
        try{
          const live=await providerRuntimeControl.readOrders(
            {
              companyId:transaction.companyId,
              provider:transaction.fulfillmentProvider,
              externalAccountId:transaction.fulfillmentExternalAccountId
            },
            {limit:50}
          );
          const matched=live.orders.find(item=>item.externalId===transaction.providerOrderId);
          if(matched){
            trackingStatus='AVAILABLE';
            order={
              id:matched.externalId,
              ...(matched.name?{name:matched.name}:{}),
              ...(matched.createdAt?{createdAt:matched.createdAt}:{}),
              ...(matched.financialStatus?{financialStatus:matched.financialStatus}:{}),
              ...(matched.fulfillmentStatus?{fulfillmentStatus:matched.fulfillmentStatus}:{}),
              fulfillments:matched.fulfillments.map(fulfillment=>({
                id:fulfillment.id,
                ...(fulfillment.status?{status:fulfillment.status}:{}),
                ...(fulfillment.displayStatus?{displayStatus:fulfillment.displayStatus}:{}),
                ...(fulfillment.updatedAt?{updatedAt:fulfillment.updatedAt}:{}),
                ...(fulfillment.deliveredAt?{deliveredAt:fulfillment.deliveredAt}:{}),
                tracking:fulfillment.tracking
              }))
            };
          }
        }catch{
          trackingStatus='UNAVAILABLE';
        }
      }
      return send(res,200,{
        draftId:transaction.draftId,
        state:transaction.state,
        amount:transaction.amount,
        currency:transaction.currency,
        paymentStatus:['ORDER_EXECUTING','ORDER_CREATED','RECONCILE_REQUIRED','REFUND_REQUIRED','REFUND_EXECUTING','REFUND_SUBMITTED','REFUNDED'].includes(transaction.state)?'PAID':'PENDING',
        orderStatus:transaction.state==='ORDER_CREATED'?'CREATED':transaction.state,
        trackingStatus,
        ...(transaction.providerOrderId?{providerOrderId:transaction.providerOrderId}:{}),
        ...(order?{order}:{})
      },requestId);
    }catch(error){
      const message=error instanceof Error?error.message:'consumer_order_read_failed';
      const status=/identity_token|required|reauthentication/.test(message)?401:/not_configured/.test(message)?503:400;
      return send(res,status,{error:message},requestId);
    }
  }
  const principal=process.env.NODE_ENV==='production'
    ? (credentialAuthority?await authenticateRequestWithAuthority(req,credentialAuthority):null)
    : authenticateRequest(req);
  if(!principal) return send(res,401,{error:'unauthorized'});
  try {
    // Muse feature panel routes (wired in code, host binding still open —
    // NOT live panel traffic yet). Principal comes from server
    // authentication above (principal.orgId = companyId, never a body
    // field). The body carries only { draftId }; a token, price, title,
    // payment method, or company ID in the body is ignored, never read.
    // Draft lookup is live via panelDraftRegistry and host methods go
    // through the live adapter, but session ID is still null here:
    // index.ts has no authenticated panel session, so the mount
    // refuses (400 muse_panel_session_id_required after the 503 store
    // check). No handler is called on any refusal path. A success path
    // needs a Muse host to register a draft, issue a session via
    // issuePanelSession(), and bind its host methods — see
    // docs/muse-panel-live-wiring.md.
    const panelActionByPath:Record<string,string>={
      '/v1/muse/panel/approve':'approve',
      '/v1/muse/panel/resume':'resume',
      '/v1/muse/panel/reminder-opt-in':'reminder-opt-in',
      '/v1/muse/panel/reminder-opt-out':'reminder-opt-out',
    };
    if(req.method==='POST'&&req.url&&panelActionByPath[req.url]!==undefined){
      const panelPayload=await readJson(req) as {draftId?:unknown};
      if(typeof panelPayload.draftId!=='string'||!panelPayload.draftId.trim()||panelPayload.draftId.length>160){
        return send(res,400,{error:'muse_draft_id_invalid'},principal.requestId);
      }
      const panelResult=await panelSessionMount.handlePanelSessionRequest({
        principal:{subject:principal.orgId,companyId:principal.orgId},
        sessionId:null,
        draftId:panelPayload.draftId.trim(),
        action:panelActionByPath[req.url]!,
      });
      return send(res,panelResult.status,panelResult.body,principal.requestId);
    }
    // Muse BI secondary demo — read-only, company-scoped, authenticated.
    // Company ID is principal.orgId ONLY: a ?companyId= query value that
    // differs from the principal fails closed (bi_tenant_mismatch in
    // queryBiReport), and one that matches is ignored in favour of the
    // principal. Data is SUPPLIED/DEMO events only, configured via
    // MUSE_BI_DEMO_EVENTS_JSON; with no such configuration the routes
    // return 503 instead of inventing live data. These routes never
    // change campaigns, budgets, routing, ranking, or policy, and they
    // never claim live Shop, Meta, or payment data. Stale reports are
    // returned labeled stale in provenance, never as current claims.
    if(req.method==='GET'&&req.url?.startsWith('/v1/muse/bi/')){
      const biUrl=new URL(req.url,'http://localhost');
      const biPath=biUrl.pathname;
      if(biPath!=='/v1/muse/bi/report'&&biPath!=='/v1/muse/bi/dashboard'&&biPath!=='/v1/muse/bi/export'){
        return send(res,404,{error:'not_found'},principal.requestId);
      }
      try{
        const metric=biUrl.searchParams.get('metric')??'funnel_counts';
        const dimensionsRaw=biUrl.searchParams.get('dimensions');
        const dimensions=dimensionsRaw?dimensionsRaw.split(',').map(value=>value.trim()).filter(Boolean):[];
        const attemptedCompanyId=biUrl.searchParams.has('companyId')?biUrl.searchParams.get('companyId')??'':undefined;
        let report;
        if(biUrl.searchParams.get('source')==='live'){
          // Live ad ingestion (read-only, live-activation point):
          // token + account must be configured AND an operator
          // Meta Ads client must be startup-registered. Without
          // either, 503 — the demo-events path is never silently
          // substituted for live data, and a live report is never
          // labeled demo (or vice versa).
          if(!liveActivation.metaAds.ready) return send(res,503,{error:'muse_bi_live_ads_not_configured'},principal.requestId);
          const liveClient=getMetaAdsClient();
          if(!liveClient) return send(res,503,{error:'muse_bi_live_ads_client_not_registered'},principal.requestId);
          const ingestion=await ingestMetaAdEvents({
            client:liveClient,
            companyId:principal.orgId,
            store:biLiveEventStore,
            watermarkStore:biLiveEventStore,
          });
          if(!ingestion.ok) return send(res,502,{error:'muse_bi_live_ads_ingestion_failed',ingestion},principal.requestId);
          const liveEvents=await biLiveEventStore.list(principal.orgId);
          report=queryBiReport({
            principalCompanyId:principal.orgId,
            ...(attemptedCompanyId!==undefined?{attemptedCompanyId}:{}),
            metric,dimensions,events:liveEvents,
            sourceLabel:'LIVE AD INGESTION',sourceVersion:'live-ads-1',
          });
        }else{
          const events=parseBiDemoEventsEnv(process.env.MUSE_BI_DEMO_EVENTS_JSON);
          report=queryBiReport({
            principalCompanyId:principal.orgId,
            ...(attemptedCompanyId!==undefined?{attemptedCompanyId}:{}),
            metric,dimensions,events
          });
        }
        if(biPath==='/v1/muse/bi/dashboard'){
          res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
          res.end(buildBiDashboardHtml(report));
          return;
        }
        if(biPath==='/v1/muse/bi/export'){
          const format=biUrl.searchParams.get('format')??'csv';
          if(format!=='csv') return send(res,400,{error:'bi_export_format_invalid'},principal.requestId);
          res.writeHead(200,{'content-type':'text/csv; charset=utf-8'});
          res.end(buildBiCsv(report));
          return;
        }
        return send(res,200,report,principal.requestId);
      }catch(error){
        const message=error instanceof Error?error.message:'muse_bi_failed';
        const status=message==='bi_tenant_mismatch'?403:message==='muse_bi_demo_events_not_configured'?503:400;
        return send(res,status,{error:message},principal.requestId);
      }
    }
    // Generic execution profile registration — explicit only.
    // A company registers its own profile (companyId is
    // principal.orgId, never a body-supplied other company, never
    // inferred from a name/domain). Registration alone does not
    // commit anything: execution additionally requires a
    // connector adapter registered in-process by the server
    // operator; without one, generic submit fails closed with
    // muse_generic_connector_not_registered. The synthetic
    // fixture companyId is rejected here and is never registered
    // as an adapter in this server. This route registers a
    // profile, not an adapter and not a provider connection.
    if(req.method==='POST'&&req.url==='/v1/muse/generic-profiles'){
      if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!companyGenericProfiles) return send(res,503,{error:'generic_profile_store_not_configured'},principal.requestId);
      try{
        const payload=await readJson(req) as Record<string,unknown>;
        if(payload.companyId!==undefined&&payload.companyId!==principal.orgId){
          return send(res,403,{error:'generic_profile_company_mismatch'},principal.requestId);
        }
        const validated=validateGenericProfileRegistration({
          companyId:principal.orgId,
          evidenceRef:payload.evidenceRef,
          registeredBy:principal.orgId,
          principalOrgId:principal.orgId,
        });
        const profile=await companyGenericProfiles.register(validated);
        // Next steps are status only (see buildGenericProfileNextSteps):
        // they do not register an adapter, a manifest, or a connection.
        // The manifest check is best-effort and never fails registration.
        let manifestPresent=false;
        try{manifestPresent=Boolean(companySellerManifests&&await companySellerManifests.get(principal.orgId));}catch{manifestPresent=false;}
        return send(res,201,{profile,note:'profile_registered_adapter_still_required_for_execution',nextSteps:buildGenericProfileNextSteps({profileRegistered:true,adapterConfigured:principal.orgId in genericAdapterConfig,manifestPresent})},principal.requestId);
      }catch(error){
        const message=error instanceof Error?error.message:'generic_profile_registration_failed';
        const status=/not_configured/.test(message)?503:/mismatch|synthetic|invalid/.test(message)?400:500;
        return send(res,status,{error:message},principal.requestId);
      }
    }
    if(req.method==='GET'&&req.url==='/v1/muse/generic-profiles/me'){
      if(!companyGenericProfiles) return send(res,503,{error:'generic_profile_store_not_configured'},principal.requestId);
      const profile=await companyGenericProfiles.get(principal.orgId);
      if(!profile) return send(res,404,{error:'generic_profile_not_found'},principal.requestId);
      let manifestPresent=false;
      try{manifestPresent=Boolean(companySellerManifests&&await companySellerManifests.get(principal.orgId));}catch{manifestPresent=false;}
      return send(res,200,{profile,nextSteps:buildGenericProfileNextSteps({profileRegistered:true,adapterConfigured:principal.orgId in genericAdapterConfig,manifestPresent})},principal.requestId);
    }
    if(req.method==='DELETE'&&req.url==='/v1/muse/generic-profiles/me'){
      if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!companyGenericProfiles) return send(res,503,{error:'generic_profile_store_not_configured'},principal.requestId);
      const removed=await companyGenericProfiles.deactivate(principal.orgId);
      return send(res,removed?200:404,removed?{deactivated:true}:{error:'generic_profile_not_found'},principal.requestId);
    }
    if(req.method==='GET'&&req.url){
      const runtimeUrl=new URL(req.url,'http://localhost');
      const orderMatch=runtimeUrl.pathname.match(/^\/v1\/provider-orders\/([^/]+)\/([^/]+)$/);
      if(orderMatch){
        if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
        if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
        if(!providerRuntimeControl) return send(res,503,{error:'provider_runtime_not_configured'},principal.requestId);
        const provider=decodeURIComponent(orderMatch[1]);
        const externalAccountId=normalizeProviderAccountId(provider,decodeURIComponent(orderMatch[2]));
        if(!providerCatalog[provider]) return send(res,404,{error:'unknown_provider'},principal.requestId);
        const rawLimit=runtimeUrl.searchParams.get('limit');
        const limit=rawLimit===null?25:Number(rawLimit);
        if(!Number.isInteger(limit)||limit<1||limit>50) return send(res,400,{error:'provider_order_limit_invalid'},principal.requestId);
        const result=await providerRuntimeControl.readOrders(
          {companyId:principal.orgId,provider,externalAccountId},
          {limit}
        );
        return send(res,200,{count:result.orders.length,orders:result.orders},principal.requestId);
      }
    }
    if(req.method==='POST'&&req.url==='/v1/provider-oauth/start'){
      if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      if(!providerOAuth) return send(res,503,{error:'provider_oauth_not_configured'},principal.requestId);
      const payload=await readJson(req) as {provider?:string;shopDomain?:string};
      const provider=payload.provider;
      if(!provider||!['walmart','ebay','etsy','shopify'].includes(provider)){
        return send(res,400,{error:'unsupported_oauth_provider'},principal.requestId);
      }
      const definition=providerCatalog[provider];
      if(!definition?.sellerConnectionSupported){
        return send(res,409,{error:'provider_self_service_not_supported'},principal.requestId);
      }
      const redirectUri=process.env.PROVIDER_OAUTH_CALLBACK_URL;
      if(!redirectUri) return send(res,503,{error:'provider_oauth_callback_not_configured'},principal.requestId);
      if(provider==='shopify'&&(!payload.shopDomain||!payload.shopDomain.trim())){
        return send(res,400,{error:'shopify_shop_domain_required'},principal.requestId);
      }
      const authorization=await providerOAuth.begin({
        companyId:principal.orgId,
        provider:provider as OAuthProvider,
        redirectUri,
        shopDomain:provider==='shopify'?payload.shopDomain?.trim():undefined
      });
      await providerAuditor?.record('provider.oauth.started',{
        companyId:principal.orgId,
        provider,
        requestId:principal.requestId
      });
      return send(res,201,{
        authorization:{
          provider:authorization.provider,
          authorizationUrl:authorization.authorizationUrl,
          expiresAt:authorization.expiresAt
        }
      },principal.requestId);
    }
    if(req.method==='POST'&&req.url==='/v1/provider-credentials/rekey-batch'){
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      if(!providerRuntimeControl) return send(res,503,{error:'provider_runtime_not_configured'},principal.requestId);
      const payload=await readJson(req) as {limit?:number};
      const limit=payload.limit??100;
      if(!Number.isInteger(limit)||limit<1||limit>100){
        return send(res,400,{error:'provider_rekey_batch_limit_invalid'},principal.requestId);
      }
      const result=await providerRuntimeControl.rekeyBatch(principal.orgId,limit);
      return send(res,200,result,principal.requestId);
    }
    const providerRuntimeMatch=req.url?.match(/^\/v1\/provider-runtime\/([^/]+)\/([^/]+)\/(refresh|sync|rekey|revoke)$/);
    if(req.method==='POST'&&providerRuntimeMatch){
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      if(!providerRuntimeControl) return send(res,503,{error:'provider_runtime_not_configured'},principal.requestId);
      const [,providerRaw,accountRaw,action]=providerRuntimeMatch;
      const provider=decodeURIComponent(providerRaw);
      const externalAccountId=normalizeProviderAccountId(provider,decodeURIComponent(accountRaw));
      if(!providerCatalog[provider]) return send(res,404,{error:'unknown_provider'},principal.requestId);
      const key={companyId:principal.orgId,provider,externalAccountId};
      if(action==='refresh'){
        if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
        const result=await providerRuntimeControl.refresh(key);
        return send(res,200,result,principal.requestId);
      }
      if(action==='rekey'){
        if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
        const result=await providerRuntimeControl.rekey(key);
        return send(res,200,result,principal.requestId);
      }
      if(action==='sync'){
        if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
        const payload=await readJson(req) as {kind?:'catalog'|'inventory'|'listings';limit?:number};
        if(!payload.kind) return send(res,400,{error:'provider_sync_kind_required'},principal.requestId);
        const result=await providerRuntimeControl.sync(key,{
          kind:payload.kind,
          limit:payload.limit,
          apiKey:provider==='etsy'?process.env.ETSY_CLIENT_ID:undefined
        });
        return send(res,200,{count:result.items.length,items:result.items,connection:result.connection},principal.requestId);
      }
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      const result=await providerRuntimeControl.revoke(key);
      return send(res,200,result,principal.requestId);
    }
    if(req.method==='GET'&&req.url==='/v1/provider-observability'){
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerObservability) return send(res,503,{error:'provider_observability_not_configured'},principal.requestId);
      const summary=await providerObservability.summary(principal.orgId);
      const alertState=await providerAlertState?.get(principal.orgId)??null;
      return send(res,summary.level==='CRITICAL'?503:200,{summary,alertState},principal.requestId);
    }
    if(req.method==='GET'&&req.url?.startsWith('/v1/provider-transactions/refunds')){
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerTransactionIntents) return send(res,503,{error:'provider_transaction_store_not_configured'},principal.requestId);
      const url=new URL(req.url,'http://localhost');
      const rawLimit=url.searchParams.get('limit');
      const limit=rawLimit===null?50:Number(rawLimit);
      if(!Number.isInteger(limit)||limit<1||limit>100) return send(res,400,{error:'provider_refund_limit_invalid'},principal.requestId);
      const transactions=await providerTransactionIntents.listRefundRequired(principal.orgId,limit);
      return send(res,200,{transactions},principal.requestId);
    }
    const refundMatch=req.url?.match(/^\/v1\/provider-transactions\/([^/]+)\/refund$/);
    if(req.method==='POST'&&refundMatch){
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      if(!providerRefundCompensation) return send(res,503,{error:'provider_refund_not_configured'},principal.requestId);
      const draftId=decodeURIComponent(refundMatch[1]).trim();
      if(!draftId||draftId.length>160) return send(res,400,{error:'provider_refund_draft_id_invalid'},principal.requestId);
      try{
        const result=await providerRefundCompensation.refund({
          companyId:principal.orgId,
          draftId,
          requestId:principal.requestId
        });
        return send(res,200,result,principal.requestId);
      }catch(error){
        const message=error instanceof Error?error.message:'provider_refund_failed';
        const status=/not_required/.test(message)?409:/not_configured|secret_required/.test(message)?503:/checkout_session_missing|payment_provider_not_supported/.test(message)?409:502;
        return send(res,status,{error:message},principal.requestId);
      }
    }
    if(req.method==='GET'&&req.url?.startsWith('/v1/provider-transactions/reconcile')){
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerTransactionIntents) return send(res,503,{error:'provider_transaction_store_not_configured'},principal.requestId);
      const url=new URL(req.url,'http://localhost');
      const rawLimit=url.searchParams.get('limit');
      const limit=rawLimit===null?50:Number(rawLimit);
      if(!Number.isInteger(limit)||limit<1||limit>100) return send(res,400,{error:'provider_reconciliation_limit_invalid'},principal.requestId);
      const transactions=await providerTransactionIntents.listReconcileRequired(principal.orgId,limit);
      return send(res,200,{transactions},principal.requestId);
    }
    const reconciliationMatch=req.url?.match(/^\/v1\/provider-transactions\/([^/]+)\/reconcile$/);
    if(req.method==='POST'&&reconciliationMatch){
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      if(!providerTransactionIntents) return send(res,503,{error:'provider_transaction_store_not_configured'},principal.requestId);
      const draftId=decodeURIComponent(reconciliationMatch[1]).trim();
      if(!draftId||draftId.length>160) return send(res,400,{error:'provider_reconciliation_draft_id_invalid'},principal.requestId);
      const payload=await readJson(req) as {resolution?:unknown;providerOrderId?:unknown;note?:unknown};
      if(payload.resolution!=='CONFIRM_ORDER'&&payload.resolution!=='NO_ORDER'){
        return send(res,400,{error:'provider_reconciliation_resolution_invalid'},principal.requestId);
      }
      if(typeof payload.note!=='string'||!payload.note.trim()||payload.note.length>1000){
        return send(res,400,{error:'provider_reconciliation_note_invalid'},principal.requestId);
      }
      let providerOrderId:string|undefined;
      if(payload.resolution==='CONFIRM_ORDER'){
        if(typeof payload.providerOrderId!=='string'||!payload.providerOrderId.trim()||payload.providerOrderId.length>240){
          return send(res,400,{error:'provider_reconciliation_order_id_invalid'},principal.requestId);
        }
        providerOrderId=payload.providerOrderId.trim();
      }
      const transaction=await providerTransactionIntents.resolveReconciliation({
        companyId:principal.orgId,
        draftId,
        resolution:payload.resolution,
        providerOrderId,
        note:payload.note.trim()
      });
      if(!transaction) return send(res,409,{error:'provider_reconciliation_not_pending'},principal.requestId);
      await providerAuditor?.record('provider.transaction.reconciliation_resolved',{
        companyId:principal.orgId,
        provider:transaction.fulfillmentProvider,
        externalAccountId:transaction.fulfillmentExternalAccountId,
        draftId:transaction.draftId,
        reconciliationResolution:payload.resolution,
        requestId:principal.requestId
      });
      return send(res,200,{transaction},principal.requestId);
    }
    if(req.method==='POST'&&req.url==='/v1/provider-transaction-drafts'){
      if(!requireCapability(principal,'request_payment')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerTransactionDrafts) return send(res,503,{error:'provider_transaction_draft_not_configured'},principal.requestId);
      const payload=await readJson(req) as {
        connectionId?:unknown;
        payment?:unknown;
        paymentVehicle?:unknown;
        fulfillment?:unknown;
        description?:unknown;
        successUrl?:unknown;
        cancelUrl?:unknown;
        sellerDisplayName?:unknown;
        itemTitles?:unknown;
        terms?:unknown;
        paymentTiming?:unknown;
        estimatedArrival?:unknown;
      };
      if(typeof payload.connectionId!=='string'||!payload.connectionId.trim()||payload.connectionId.length>160){
        return send(res,400,{error:'provider_transaction_connection_id_invalid'},principal.requestId);
      }
      if(typeof payload.description!=='string'||!payload.description.trim()||payload.description.length>500){
        return send(res,400,{error:'provider_checkout_description_invalid'},principal.requestId);
      }
      if(typeof payload.successUrl!=='string'||typeof payload.cancelUrl!=='string'){
        return send(res,400,{error:'provider_checkout_url_invalid'},principal.requestId);
      }
      let successUrl:URL; let cancelUrl:URL;
      try{successUrl=new URL(payload.successUrl);cancelUrl=new URL(payload.cancelUrl);}catch{
        return send(res,400,{error:'provider_checkout_url_invalid'},principal.requestId);
      }
      if(successUrl.protocol!=='https:'||cancelUrl.protocol!=='https:'||successUrl.username||successUrl.password||cancelUrl.username||cancelUrl.password){
        return send(res,400,{error:'provider_checkout_url_invalid'},principal.requestId);
      }
      if(!payload.payment||typeof payload.payment!=='object'||Array.isArray(payload.payment)){
        return send(res,400,{error:'provider_checkout_payment_invalid'},principal.requestId);
      }
      const payment=payload.payment as Record<string,unknown>;
      // Shop Pay is an additional vehicle, not a Stripe relabel: the
      // provider may be 'stripe' or 'shop_pay', and an optional
      // paymentVehicle must agree with it. Execution of a shop_pay
      // draft is still blocked (shop_pay_execution_blocked) — this
      // only lets the signed draft/approval envelope carry the
      // vehicle, with Stripe unchanged as the default for legacy
      // callers that omit both fields.
      let paymentVehicle:'stripe'|'shop_pay';
      try{
        paymentVehicle=resolvePaymentVehicle({paymentProvider:payment.provider,paymentVehicle:payload.paymentVehicle});
      }catch{
        return send(res,400,{error:'provider_checkout_payment_invalid'},principal.requestId);
      }
      if(typeof payment.externalAccountId!=='string'||!payment.externalAccountId.trim()){
        return send(res,400,{error:'provider_checkout_payment_invalid'},principal.requestId);
      }
      if(!payload.fulfillment||typeof payload.fulfillment!=='object'||Array.isArray(payload.fulfillment)){
        return send(res,400,{error:'provider_checkout_fulfillment_invalid'},principal.requestId);
      }
      const fulfillment=payload.fulfillment as Record<string,unknown>;
      if(fulfillment.provider!=='shopify'||typeof fulfillment.externalAccountId!=='string'){
        return send(res,400,{error:'provider_checkout_fulfillment_invalid'},principal.requestId);
      }
      const fulfillmentExternalAccountId=normalizeProviderAccountId('shopify',fulfillment.externalAccountId);
      if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(fulfillmentExternalAccountId)){
        return send(res,400,{error:'provider_checkout_fulfillment_invalid'},principal.requestId);
      }
      if(!Array.isArray(fulfillment.lineItems)||fulfillment.lineItems.length<1||fulfillment.lineItems.length>100){
        return send(res,400,{error:'provider_checkout_line_items_invalid'},principal.requestId);
      }
      const lineItems=fulfillment.lineItems.map(value=>{
        if(!value||typeof value!=='object'||Array.isArray(value)) return null;
        const item=value as Record<string,unknown>;
        if(typeof item.variantId!=='string'||!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variantId)) return null;
        if(typeof item.quantity!=='number'||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100) return null;
        return {variantId:item.variantId,quantity:item.quantity};
      });
      if(lineItems.some(value=>value===null)) return send(res,400,{error:'provider_checkout_line_items_invalid'},principal.requestId);

      if(!providerRuntimeControl) return send(res,503,{error:'provider_runtime_not_configured'},principal.requestId);
      if(!fulfillment.shippingAddress||typeof fulfillment.shippingAddress!=='object'||Array.isArray(fulfillment.shippingAddress)){
        return send(res,400,{error:'provider_checkout_shipping_address_invalid'},principal.requestId);
      }
      const address=fulfillment.shippingAddress as Record<string,unknown>;
      if(
        typeof address.address1!=='string'||!address.address1.trim()||
        typeof address.city!=='string'||!address.city.trim()||
        typeof address.countryCode!=='string'||!/^[A-Za-z]{2}$/.test(address.countryCode)||
        typeof address.zip!=='string'||!address.zip.trim()
      ) return send(res,400,{error:'provider_checkout_shipping_address_invalid'},principal.requestId);
      for(const key of ['firstName','lastName','address2','provinceCode','phone'] as const){
        if(address[key]!==undefined&&typeof address[key]!=='string') return send(res,400,{error:'provider_checkout_shipping_address_invalid'},principal.requestId);
      }
      const shippingAddress:ShopifyShippingAddress={
        ...(typeof address.firstName==='string'&&address.firstName.trim()?{firstName:address.firstName.trim()}:{}),
        ...(typeof address.lastName==='string'&&address.lastName.trim()?{lastName:address.lastName.trim()}:{}),
        address1:address.address1.trim(),
        ...(typeof address.address2==='string'&&address.address2.trim()?{address2:address.address2.trim()}:{}),
        city:address.city.trim(),
        ...(typeof address.provinceCode==='string'&&address.provinceCode.trim()?{provinceCode:address.provinceCode.trim().toUpperCase()}:{}),
        countryCode:address.countryCode.toUpperCase(),
        zip:address.zip.trim(),
        ...(typeof address.phone==='string'&&address.phone.trim()?{phone:address.phone.trim()}:{}),
      };

      const normalizedLineItems=lineItems as Array<{variantId:string;quantity:number}>;
      let quoteResult; let landedResult;
      try{
        const key={companyId:principal.orgId,provider:'shopify',externalAccountId:fulfillmentExternalAccountId};
        quoteResult=await providerRuntimeControl.quoteVariants(key,{lineItems:normalizedLineItems});
        landedResult=await providerRuntimeControl.quoteLandedTotal(key,{lineItems:normalizedLineItems,shippingAddress});
      }catch(error){
        const message=error instanceof Error?error.message:'provider_pricing_failed';
        const status=/not_found/.test(message)?404:/capability|not_active/.test(message)?409:502;
        return send(res,status,{error:message},principal.requestId);
      }
      const amount=landedQuoteTotalAmount(landedResult.quote);
      if(amount<=0||amount>10000000) return send(res,409,{error:'provider_pricing_amount_out_of_bounds'},principal.requestId);
      const currency=landedResult.quote.currency.toUpperCase();
      if(quoteResult.quote.currency.toUpperCase()!==currency) return send(res,409,{error:'provider_pricing_currency_mismatch'},principal.requestId);
      if(!supportedCurrencyCodes.has(currency)) return send(res,409,{error:'provider_pricing_currency_unsupported'},principal.requestId);

      // Server-owned display data, supplied only by the authenticated
      // company caller (principal.orgId), never by a consumer browser or
      // model. A name is never derived from the shop domain, and a title
      // is never a variant ID. If the caller does not supply them, the
      // draft is created without them and a later review fails closed
      // instead of showing a raw ID.
      let sellerDisplayName: string | undefined;
      let itemTitles: Record<string, string> | undefined;
      let terms: string | undefined;
      let paymentTiming: string | undefined;
      let estimatedArrival: string | undefined;
      try {
        if (payload.sellerDisplayName !== undefined) {
          sellerDisplayName = validateSellerDisplayName(payload.sellerDisplayName, fulfillmentExternalAccountId);
          registerServerCompanyDisplayName(principal.orgId, sellerDisplayName, fulfillmentExternalAccountId);
        }
        if (payload.terms !== undefined) terms = validateOptionalReviewFact(payload.terms);
        if (payload.paymentTiming !== undefined) paymentTiming = validateOptionalReviewFact(payload.paymentTiming);
        if (payload.estimatedArrival !== undefined) estimatedArrival = validateOptionalReviewFact(payload.estimatedArrival);
        if (payload.itemTitles !== undefined) {
          if (!payload.itemTitles || typeof payload.itemTitles !== 'object' || Array.isArray(payload.itemTitles)) {
            return send(res, 400, {error: 'provider_checkout_item_titles_invalid'}, principal.requestId);
          }
          itemTitles = {};
          for (const [variantId, title] of Object.entries(payload.itemTitles as Record<string, unknown>)) {
            itemTitles[variantId] = validateItemTitle(title, variantId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'provider_checkout_display_invalid';
        return send(res, 400, {error: message}, principal.requestId);
      }

      // Persist the validated name so a later review survives a
      // restart without depending on the signed draft alone. A store
      // failure fails closed here (503) rather than silently falling
      // back to process-local-only state for this draft.
      if (sellerDisplayName && companySellerManifests) {
        try {
          await companySellerManifests.upsertDisplayName({
            companyId: principal.orgId,
            displayName: sellerDisplayName,
            externalAccountId: fulfillmentExternalAccountId,
          });
        } catch {
          return send(res, 503, {error: 'seller_manifest_store_unavailable'}, principal.requestId);
        }
      }

      const result=await providerTransactionDrafts.create({
        companyId:principal.orgId,
        connectionId:payload.connectionId.trim(),
        ...(sellerDisplayName ? {sellerDisplayName} : {}),
        ...(itemTitles ? {itemTitles} : {}),
        ...(terms ? {terms} : {}),
        ...(paymentTiming ? {paymentTiming} : {}),
        ...(estimatedArrival ? {estimatedArrival} : {}),
        payment:{provider:paymentVehicle,externalAccountId:payment.externalAccountId.trim()},
        paymentVehicle,
        fulfillment:{
          provider:'shopify',
          externalAccountId:fulfillmentExternalAccountId,
          lineItems:normalizedLineItems,
          shippingAddress,
          landedQuote:landedResult.quote
        },
        amount,
        currency,
        pricing:quoteResult.quote,
        description:payload.description.trim(),
        successUrl:successUrl.toString(),
        cancelUrl:cancelUrl.toString()
      });
      return send(res,201,result,principal.requestId);
    }

    const providerCheckoutMatch=req.url?.match(/^\/v1\/provider-checkout\/([^/]+)\/([^/]+)$/);
    if(req.method==='POST'&&providerCheckoutMatch){
      if(!requireCapability(principal,'request_payment')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      if(!providerTransactionExecution||!providerTransactionDrafts||!providerZeroTrustAuthority||!process.env.APPROVAL_SIGNING_SECRET){
        return send(res,503,{error:'provider_transaction_not_configured'},principal.requestId);
      }
      const provider=decodeURIComponent(providerCheckoutMatch[1]);
      const externalAccountId=normalizeProviderAccountId(provider,decodeURIComponent(providerCheckoutMatch[2]));
      if(provider!=='stripe') return send(res,404,{error:'unknown_provider'},principal.requestId);
      const payload=await readJson(req) as {connectionId?:unknown;draftId?:unknown;approvalToken?:unknown};
      if(typeof payload.connectionId!=='string'||!payload.connectionId.trim()||payload.connectionId.length>160){
        return send(res,400,{error:'provider_transaction_connection_id_invalid'},principal.requestId);
      }
      if(typeof payload.draftId!=='string'||!payload.draftId.trim()||payload.draftId.length>160){
        return send(res,400,{error:'provider_checkout_draft_id_invalid'},principal.requestId);
      }
      if(typeof payload.approvalToken!=='string'||!payload.approvalToken.trim()){
        return send(res,400,{error:'provider_checkout_approval_token_required'},principal.requestId);
      }

      const verified=await providerTransactionDrafts.verifyForExecution({
        companyId:principal.orgId,
        connectionId:payload.connectionId.trim(),
        draftId:payload.draftId.trim()
      });
      const state=verified.state;
      if(state.payment.provider!==provider||state.payment.externalAccountId!==externalAccountId){
        return send(res,409,{error:'provider_checkout_payment_scope_mismatch'},principal.requestId);
      }
      if(!providerRuntimeControl) return send(res,503,{error:'provider_runtime_not_configured'},principal.requestId);
      if(!state.fulfillment.shippingAddress||!state.fulfillment.landedQuote){
        return send(res,409,{error:'provider_checkout_reapproval_required'},principal.requestId);
      }
      let liveQuote; let liveLandedQuote;
      try{
        const key={companyId:principal.orgId,provider:'shopify',externalAccountId:state.fulfillment.externalAccountId};
        liveQuote=(await providerRuntimeControl.quoteVariants(key,{lineItems:state.fulfillment.lineItems})).quote;
        liveLandedQuote=(await providerRuntimeControl.quoteLandedTotal(key,{
          lineItems:state.fulfillment.lineItems,
          shippingAddress:state.fulfillment.shippingAddress
        })).quote;
      }catch(error){
        const message=error instanceof Error?error.message:'provider_pricing_failed';
        return send(res,409,{error:message},principal.requestId);
      }
      const liveAmount=landedQuoteTotalAmount(liveLandedQuote);
      const approvedLanded=state.fulfillment.landedQuote;
      const sameMoney=(left:string,right:string,currency:string)=>
        decimalPriceToMinorUnits(left,currency)===decimalPriceToMinorUnits(right,currency);
      const quoteChanged=
        liveQuote.currency!==state.pricing.currency||
        liveLandedQuote.currency!==approvedLanded.currency||
        liveAmount!==verified.draft.total||
        liveLandedQuote.shipping.handle!==approvedLanded.shipping.handle||
        !sameMoney(liveLandedQuote.subtotal,approvedLanded.subtotal,approvedLanded.currency)||
        !sameMoney(liveLandedQuote.tax,approvedLanded.tax,approvedLanded.currency)||
        !sameMoney(liveLandedQuote.shipping.amount,approvedLanded.shipping.amount,approvedLanded.currency)||
        !sameMoney(liveLandedQuote.total,approvedLanded.total,approvedLanded.currency)||
        liveQuote.lines.length!==state.pricing.lines.length||
        liveQuote.lines.some((line,index)=>{
          const approved=state.pricing.lines[index];
          return !approved||
            line.variantId!==approved.variantId||
            line.quantity!==approved.quantity||
            decimalPriceToMinorUnits(line.unitPrice,liveQuote.currency)!==decimalPriceToMinorUnits(approved.unitPrice,state.pricing.currency)||
            line.availableForSale!==true;
        });
      if(quoteChanged){
        return send(res,409,{error:'provider_checkout_reapproval_required'},principal.requestId);
      }
      const approval=verifyApproval({
        token:payload.approvalToken.trim(),
        secret:process.env.APPROVAL_SIGNING_SECRET,
        expected:{
          subjectId:verified.connection.subjectId,
          companyId:principal.orgId,
          connectionId:verified.connection.connectionId,
          draftId:verified.draft.draftId,
          draftHash:verified.draftHash,
          amount:verified.draft.total,
          currency:verified.draft.currency
        }
      });
      if(!approval.ok) return send(res,409,{error:approval.reason},principal.requestId);

      const checkout=await providerTransactionExecution.createCheckout({
        companyId:principal.orgId,
        provider:state.payment.provider,
        externalAccountId:state.payment.externalAccountId,
        agentId:principal.credentialId,
        requestId:principal.requestId,
        draftId:verified.draft.draftId,
        amount:verified.draft.total,
        currency:verified.draft.currency,
        description:state.description,
        successUrl:state.successUrl,
        cancelUrl:state.cancelUrl,
        fulfillment:state.fulfillment,
        approval:{
          jti:approval.claims.jti,
          consume:()=>providerZeroTrustAuthority.consumeOnce('approval:'+approval.claims.jti,approval.claims.expiresAt)
        }
      });
      return send(res,201,{checkout},principal.requestId);
    }
    const providerAgentMatch=req.url?.match(/^\/v1\/provider-agents\/([^/]+)$/);
    if(providerAgentMatch){
      if(!providerAgentRegistry) return send(res,503,{error:'provider_agent_registry_not_configured'},principal.requestId);
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      const agentId=decodeURIComponent(providerAgentMatch[1]).trim();
      if(!agentId||agentId.length>120) return send(res,400,{error:'provider_agent_id_invalid'},principal.requestId);
      if(req.method==='PUT'){
        const registration=await providerAgentRegistry.authorize(principal.orgId,agentId);
        await providerAuditor?.record('provider.agent_authorized',{
          companyId:principal.orgId,provider:'all',agentId,requestId:principal.requestId
        });
        return send(res,200,{registration},principal.requestId);
      }
      if(req.method==='DELETE'){
        const registration=await providerAgentRegistry.revoke(principal.orgId,agentId);
        if(!registration) return send(res,404,{error:'provider_agent_not_found'},principal.requestId);
        await providerAuditor?.record('provider.agent_revoked',{
          companyId:principal.orgId,provider:'all',agentId,requestId:principal.requestId
        });
        return send(res,200,{registration},principal.requestId);
      }
    }
    const policyMatch=req.url?.match(/^\/v1\/provider-agent-policy\/([^/]+)\/([^/]+)$/);
    if(policyMatch){
      if(!providerAgentPolicies||!providerConnections) return send(res,503,{error:'provider_agent_policy_not_configured'},principal.requestId);
      const provider=decodeURIComponent(policyMatch[1]);
      const externalAccountId=normalizeProviderAccountId(provider,decodeURIComponent(policyMatch[2]));
      if(!providerCatalog[provider]) return send(res,404,{error:'unknown_provider'},principal.requestId);
      const connection=await providerConnections.get(principal.orgId,provider,externalAccountId);
      if(!connection) return send(res,404,{error:'provider_connection_not_found'},principal.requestId);
      if(req.method==='GET'){
        if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
        const policy=await providerAgentPolicies.get(principal.orgId,provider,externalAccountId);
        if(!policy) return send(res,404,{error:'provider_agent_policy_not_found'},principal.requestId);
        return send(res,200,{policy},principal.requestId);
      }
      if(req.method==='PUT'){
        if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
        if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
        const payload=await readJson(req) as {allowedAgents?:unknown;maxOrderAmount?:unknown;currency?:unknown};
        if(!Array.isArray(payload.allowedAgents)||payload.allowedAgents.length<1||payload.allowedAgents.length>100){
          return send(res,400,{error:'provider_agent_policy_allowed_agents_invalid'},principal.requestId);
        }
        if(payload.allowedAgents.some(value=>typeof value!=='string')){
          return send(res,400,{error:'provider_agent_policy_allowed_agents_invalid'},principal.requestId);
        }
        const allowedAgents=[...new Set(payload.allowedAgents.map(value=>value.trim()).filter(Boolean))];
        if(allowedAgents.length<1||allowedAgents.length!==payload.allowedAgents.length||allowedAgents.some(value=>value.length>120)){
          return send(res,400,{error:'provider_agent_policy_allowed_agents_invalid'},principal.requestId);
        }
        if(!providerAgentRegistry) return send(res,503,{error:'provider_agent_registry_not_configured'},principal.requestId);
        const unauthorizedAgents=await providerAgentRegistry.requireActive(principal.orgId,allowedAgents);
        if(unauthorizedAgents.length) return send(res,409,{error:'provider_agent_policy_agent_not_authorized'},principal.requestId);
        if(typeof payload.maxOrderAmount!=='number'||!Number.isFinite(payload.maxOrderAmount)||payload.maxOrderAmount<=0||payload.maxOrderAmount>10000000){
          return send(res,400,{error:'provider_agent_policy_max_order_amount_invalid'},principal.requestId);
        }
        const maxOrderAmount=payload.maxOrderAmount;
        if(typeof payload.currency!=='string') return send(res,400,{error:'provider_agent_policy_currency_invalid'},principal.requestId);
        const currency=payload.currency.trim().toUpperCase();
        if(!/^[A-Z]{3}$/.test(currency)||!supportedCurrencyCodes.has(currency)) return send(res,400,{error:'provider_agent_policy_currency_invalid'},principal.requestId);
        const policy=await providerAgentPolicies.upsert({
          companyId:principal.orgId,
          provider,
          externalAccountId,
          allowedAgents,
          maxOrderAmount,
          currency
        });
        await providerAuditor?.record('provider.agent_policy.updated',{
          companyId:principal.orgId,
          provider,
          externalAccountId,
          allowedAgentCount:allowedAgents.length,
          maxOrderAmount,
          currency,
          requestId:principal.requestId
        });
        return send(res,200,{policy},principal.requestId);
      }
    }
    // Trusted Meta business-verification recording (live-activation
    // point). This is the ONLY recording route for Meta evidence:
    // it requires an authenticated company principal, a configured
    // META_VERIFICATION_WEBHOOK_SECRET, and a valid HMAC signature
    // over the raw body. Without the secret it is 410 — the generic
    // readiness POST below stays 410 for self-attestation, and this
    // route does not reopen it. Evidence is validated with the
    // existing rules (missing/placeholder/self-attested/future/
    // expired rejected, flag AND evidence must agree) and stored
    // in the seller-manifest store, which the readiness service
    // reads as its Meta-evidence fallback. This records evidence;
    // it is not a Meta API call, and Meta accepting this channel
    // remains an external decision.
    const metaVerificationMatch=req.url?.match(/^\/v1\/provider-readiness\/([^/]+)\/([^/]+)\/meta-verification$/);
    if(req.method==='POST'&&metaVerificationMatch){
      if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!companySellerManifests) return send(res,503,{error:'seller_manifest_store_not_configured'},principal.requestId);
      try{
        const secret=process.env.META_VERIFICATION_WEBHOOK_SECRET??'';
        const raw=await readRaw(req);
        const header=req.headers['x-meta-verification-signature'];
        const signature=Array.isArray(header)?header[0]:header;
        const recorded=validateMetaVerificationRecording({secret,rawBody:raw,signatureHeader:signature});
        if(recorded.companyId!==principal.orgId) return send(res,403,{error:'meta_verification_company_mismatch'},principal.requestId);
        await companySellerManifests.upsertMetaVerification({
          companyId:principal.orgId,
          origin:'meta',
          metaVerification:recorded.metaVerification,
        });
        return send(res,201,{recorded:true,companyId:principal.orgId,verified:true},principal.requestId);
      }catch(error){
        const message=error instanceof Error?error.message:'meta_verification_recording_failed';
        const status=/recording_disabled/.test(message)?410:/signature/.test(message)?401:/mismatch/.test(message)?403:/meta_verification_/.test(message)?400:500;
        return send(res,status,{error:message},principal.requestId);
      }
    }
    const readinessMatch=req.url?.match(/^\/v1\/provider-readiness\/([^/]+)\/([^/]+)$/);
    if(readinessMatch){
      if(!providerReadiness||!providerReadinessEvidence) return send(res,503,{error:'provider_readiness_not_configured'},principal.requestId);
      const provider=decodeURIComponent(readinessMatch[1]);
      const externalAccountId=normalizeProviderAccountId(provider,decodeURIComponent(readinessMatch[2]));
      if(req.method==='POST'){
        return send(res,410,{error:'provider_readiness_self_attestation_disabled'},principal.requestId);
      }
      if(req.method==='GET'){
        if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
        const evidence=await providerReadinessEvidence.get(principal.orgId,provider,externalAccountId);
        if(!evidence) return send(res,404,{error:'provider_readiness_evidence_not_found'},principal.requestId);
        const manifest=await providerReadiness.evaluate({
          companyId:principal.orgId,
          provider,
          externalAccountId
        });
        return send(res,200,{evidence,manifest},principal.requestId);
      }
    }
    if(req.method==='GET'&&req.url==='/v1/provider-connections'){
      if(!requireCapability(principal,'manage_provider_connections')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerConnections) return send(res,503,{error:'provider_connection_store_not_configured'},principal.requestId);
      return send(res,200,{connections:await providerConnections.summaries(principal.orgId)},principal.requestId);
    }
    if(req.method==='POST'&&req.url==='/v1/provider-connections'){
      if(!requireCapability(principal,'admin_override')) return send(res,403,{error:'forbidden'},principal.requestId);
      if(!providerAuditReady) return send(res,503,{error:'provider_audit_not_configured'},principal.requestId);
      if(!providerConnections) return send(res,503,{error:'provider_connection_store_not_configured'},principal.requestId);
      const payload=await readJson(req) as {
        provider?:string;
        externalAccountId?:string;
        grantedCapabilities?:unknown;
        tokenExpiresAt?:string;
      };
      if(!payload.provider||!providerCatalog[payload.provider]||!payload.externalAccountId||!Array.isArray(payload.grantedCapabilities)){
        return send(res,400,{error:'invalid_provider_connection'},principal.requestId);
      }
      const declared=new Set(providerCatalog[payload.provider].capabilities.map(item=>item.capability));
      const granted=payload.grantedCapabilities.filter((value):value is any=>typeof value==='string'&&declared.has(value as any));
      if(granted.length!==payload.grantedCapabilities.length) return send(res,400,{error:'invalid_provider_capability'},principal.requestId);
      const connection=await providerConnections.upsert({
        companyId:principal.orgId,
        provider:payload.provider,
        externalAccountId:payload.externalAccountId,
        grantedCapabilities:granted,
        tokenExpiresAt:payload.tokenExpiresAt
      });
      await providerAuditor?.record('provider.connection.capabilities_updated',{
        companyId:principal.orgId,
        provider:payload.provider,
        externalAccountId:connection?.externalAccountId??normalizeProviderAccountId(payload.provider,payload.externalAccountId),
        capabilityCount:granted.length,
        requestId:principal.requestId
      });
      return send(res,201,{connection},principal.requestId);
    }
    const providerConnectionMatch=req.url?.match(/^\/v1\/provider-connections\/([^/]+)\/([^/]+)\/(sync-success|sync-error|revoke)$/);
    if(req.method==='POST'&&providerConnectionMatch){
      return send(res,410,{
        error:'provider_connection_mutation_disabled',
        use:'/v1/provider-runtime/:provider/:externalAccountId/{sync|revoke}'
      },principal.requestId);
    }
    if(req.method==='POST'&&req.url==='/v1/gifts/recommend'){
      if(!requireCapability(principal,'recommend_gifts')) return send(res,403,{error:'forbidden'},principal.requestId);
      const parsed=recommendationSchema.parse(await readJson(req));
      const context:GiftContext=parsed.context;
      const candidates:ProductCandidate[]=parsed.candidates;
      return send(res,200,{orgId:principal.orgId,recommendations:recommend(context,candidates)},principal.requestId);
    }
    if(req.method==='POST'&&req.url==='/v1/bundles/build') {
      if(!requireCapability(principal,'build_bundle')) return send(res,403,{error:'forbidden'},principal.requestId);
      const payload=await readJson(req) as Record<string,unknown>;
      return send(res,200,await buildBundles({...payload,requestId:principal.requestId}),principal.requestId);
    }
    if(req.method==='POST'&&req.url==='/v1/bundles/interactions') {
      if(!requireCapability(principal,'record_telemetry')) return send(res,403,{error:'forbidden'},principal.requestId);
      const payload=await readJson(req) as Record<string,unknown>;
      return send(res,202,await recordBundleInteraction({...payload,requestId:principal.requestId}),principal.requestId);
    }
  } catch(error:unknown){
    if(error instanceof Error&&error.message==='payload_too_large') return send(res,413,{error:'payload_too_large'},principal.requestId);
    return send(res,400,{error:'invalid_request'},principal.requestId);
  }
  return send(res,404,{error:'not_found'},principal.requestId);
}).listen(Number(process.env.PORT??3000));

const refundRecoveryIntervalMinutes=Math.max(
  1,
  Math.min(60,Math.trunc(Number(process.env.PROVIDER_REFUND_RECOVERY_INTERVAL_MINUTES??5))||5)
);
const refundRecoveryStaleMinutes=Math.max(
  1,
  Math.min(24*60,Math.trunc(Number(process.env.PROVIDER_REFUND_RECOVERY_STALE_MINUTES??10))||10)
);
const refundRecoveryLimit=Math.max(
  1,
  Math.min(500,Math.trunc(Number(process.env.PROVIDER_REFUND_RECOVERY_LIMIT??100))||100)
);

async function runRefundRecoveryTick(){
  if(!dbPool||!providerTransactionIntents||!process.env.STRIPE_SECRET_KEY) return;
  try{
    const result=await runRefundRecoveryWithAdvisoryLock({
      pool:dbPool,
      intents:providerTransactionIntents,
      auditor:providerAuditor??undefined,
      stripeSecret:process.env.STRIPE_SECRET_KEY,
      staleMinutes:refundRecoveryStaleMinutes,
      limit:refundRecoveryLimit
    });
    console.log(JSON.stringify({
      event:'provider_refund_recovery_tick',
      locked:result.locked,
      skipped:result.skipped,
      ...(!result.skipped?{
        checked:result.checked,
        refunded:result.refunded,
        reopened:result.reopened,
        pending:result.pending,
        failed:result.failed
      }:{})
    }));
  }catch{
    console.error(JSON.stringify({event:'provider_refund_recovery_tick_failed'}));
  }
}

if(dbPool&&providerTransactionIntents&&process.env.STRIPE_SECRET_KEY){
  setTimeout(()=>void runRefundRecoveryTick(),30_000).unref();
  setInterval(()=>void runRefundRecoveryTick(),refundRecoveryIntervalMinutes*60_000).unref();
}


