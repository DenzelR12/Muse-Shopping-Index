/**
 * LEGACY — NOT THE PRODUCT SURFACE. This module is legacy demo code
 * from the source copy. It is NOT the product surface for Muse
 * Shopping Index and NOT a storefront checkout page: the product
 * surface is the Muse feature panel
 * (apps/demo/src/muse-feature-panel.ts), mounted by a Muse host
 * inside a Muse window/surface. This module is kept, with its
 * tests, so the legacy app still builds; the documented
 * presentation path for review, approval, resume, and reminder
 * is the panel, not this page.
 *
 * LIVE Muse confirmation page (not an example).
 *
 * This is the real confirmation surface for the Muse checkout flow. It is
 * deliberately NOT wired into apps/storefront/src/main.ts: main.ts is a
 * separate gifting-concierge surface and does not render a Muse
 * confirmation. The storefront has no page-entry system — there is a
 * single index.html entry that loads main.ts — so this page is a
 * standalone module: a host embeds it by calling
 * mountMuseConfirmationPage() on a container element and exporting it
 * from apps/storefront/src/index.ts. That export is the wiring; no
 * additional page-entry or router change exists to make.
 *
 * Trust boundaries (the guard never grants approval):
 * - The approval envelope MUST be supplied server-side by the host that
 *   embeds this page, from a signed approval envelope. It is never
 *   parsed from browser JSON, localStorage, a query string, or any other
 *   browser-derived state. museConfirmationSheet() fails closed when
 *   the envelope lacks a resolved seller display name or item titles,
 *   when the payment vehicle disagrees with the payment provider, or
 *   when any display value looks like a raw ID.
 * - The rendered sheet is the only source of display facts. The payment
 *   label comes from the signed envelope vehicle only: "Saved payment"
 *   for Stripe, "Shop Pay · Saved payment" only for shop_pay. Raw
 *   account, shop-domain, and variant IDs are never rendered.
 * - Buy is guarded by attachMuseBuyGuard(): the button disables on the
 *   first click, a second in-flight click is ignored, and progress is
 *   preserved until resume() resolves the owned status. Server
 *   consume-once approval, draft-hash revalidation, and provider
 *   idempotency remain authoritative; this page never approves, signs,
 *   or executes a payment itself.
 * - Submit delegates to the existing server endpoint POST
 *   {apiBase}/v1/muse/confirm with {connectionId, draftId,
 *   approvalToken}. If no live server is configured (no apiBase or no
 *   approvalToken), submit fails closed with
 *   muse_confirmation_server_not_configured — never a fake success —
 *   and the guard re-enables the button for a retry. An optional
 *   identityToken is sent as a Bearer header when the host supplies
 *   one; without it the server rejects the call (401) and the same
 *   fail-closed path applies.
 * - Reconnect status comes from the server only: GET
 *   {apiBase}/v1/muse/orders/{draftId} returns the owned transaction
 *   state for that draft ID. resume() / completed / reconciliation
 *   decisions need no new approval and make no new submission; only
 *   reapproval_required presents a fresh review first (via
 *   onReapprovalRequired). The orders endpoint carries no drift or
 *   expiry flags, so resume() alone is not a drift revalidation: a
 *   later submit still revalidates the draft server-side and fails
 *   with a reapproval error if the draft drifted or expired.
 * - No live Shop, Meta, or payment claim is made here, and the
 *   demo/default path (no server configured) executes no payment.
 */

import {museConfirmationSheet,renderMuseConfirmation} from './muse-confirmation.js';
import type {MuseApprovalEnvelope,MuseConfirmationSheet} from './muse-confirmation.js';
import {attachMuseBuyGuard} from './muse-buy-guard.js';
import type {MuseBuyButtonLike,MuseBuyGuard,MuseBuyGuardHandlers,MuseBuyRootLike,BuyResumeDecision} from './muse-buy-guard.js';

/** Minimal container shape. A real browser host passes an HTMLElement. */
export interface MuseConfirmationPageRoot {
  innerHTML:string;
  querySelectorAll:(selector:string)=>Iterable<MuseBuyButtonLike>;
}

export interface MuseConfirmationFetchResponse {
  ok:boolean;
  status:number;
  json:()=>Promise<unknown>;
}

export interface MuseConfirmationFetch {
  (url:string,init:{method:string;headers:Record<string,string>;body?:string}):Promise<MuseConfirmationFetchResponse>;
}

export interface MuseConfirmationServerConfig {
  /** Base URL of the Muse API server. Absent/empty means no live server: fail closed. */
  apiBase?:string;
  /** Signed approval token for this draft, supplied server-side with the envelope. */
  approvalToken?:string;
  /** Optional human identity token, sent as a Bearer header when supplied. */
  identityToken?:string;
  /** Defaults to the global fetch; tests inject a fake. */
  fetchImpl?:MuseConfirmationFetch;
}

export interface MuseConfirmationPageOptions extends MuseConfirmationServerConfig {
  /** Receives guard status strings: submitting, processing, failed, completed, resume, reconciliation, reapproval_required. */
  onStatus?:(status:string)=>void;
  /** Called when resume() returns reapproval_required for any guard: present a fresh review before any new Buy. */
  onReapprovalRequired?:()=>void;
  /** Optional reconnect source (for example window): an 'online' event calls resume(). */
  reconnectTarget?:{addEventListener:(type:string,listener:()=>void)=>void};
}

export interface MuseConfirmationPageResult {
  guards:MuseBuyGuard[];
  sheet:MuseConfirmationSheet;
  /** Re-read owned status by draft ID. Call on reconnect and after a submit settles. */
  resume:()=>Promise<BuyResumeDecision[]>;
}

function defaultFetch():MuseConfirmationFetch{
  return async (url,init)=>{
    const impl=(globalThis as {fetch?:unknown}).fetch;
    if(typeof impl!=='function') throw new Error('muse_confirmation_server_not_configured');
    const response=await (impl as typeof fetch)(url,init);
    return {ok:response.ok,status:response.status,json:async ()=>response.json() as Promise<unknown>};
  };
}

function normalizedApiBase(apiBase:string|undefined):string{
  return (apiBase??'').trim().replace(/\/+$/,'');
}

function authHeaders(config:MuseConfirmationServerConfig):Record<string,string>{
  const headers:Record<string,string>={'content-type':'application/json'};
  if(config.identityToken?.trim()) headers.authorization=`Bearer ${config.identityToken.trim()}`;
  return headers;
}

/**
 * Server handlers for one signed sheet. connectionId/draftId come from
 * the server-built sheet, never from browser state. Submit posts to the
 * existing /v1/muse/confirm endpoint; status reads the existing owned
 * /v1/muse/orders/{draftId} endpoint and returns its state verbatim for
 * the guard to decide — unknown states fail closed to reapproval.
 */
export function createMuseConfirmationServerHandlers(
  args:{connectionId:string;draftId:string}&MuseConfirmationServerConfig,
):MuseBuyGuardHandlers{
  const fetchImpl=args.fetchImpl??defaultFetch();
  return {
    submit:async ()=>{
      const base=normalizedApiBase(args.apiBase);
      if(!base||!args.approvalToken?.trim()) throw new Error('muse_confirmation_server_not_configured');
      const response=await fetchImpl(`${base}/v1/muse/confirm`,{
        method:'POST',
        headers:authHeaders(args),
        body:JSON.stringify({connectionId:args.connectionId,draftId:args.draftId,approvalToken:args.approvalToken.trim()}),
      });
      if(!response.ok) throw new Error(`muse_confirmation_submit_failed:${response.status}`);
    },
    readOwnedStatus:async (draftId)=>{
      const base=normalizedApiBase(args.apiBase);
      if(!base) throw new Error('muse_confirmation_server_not_configured');
      const response=await fetchImpl(`${base}/v1/muse/orders/${encodeURIComponent(draftId)}`,{
        method:'GET',
        headers:authHeaders(args),
      });
      if(!response.ok) throw new Error(`muse_confirmation_status_failed:${response.status}`);
      const payload=await response.json() as {state?:unknown}|null;
      if(!payload||typeof payload!=='object'||typeof payload.state!=='string'||!payload.state.trim()){
        throw new Error('muse_confirmation_status_invalid');
      }
      return {state:payload.state};
    },
  };
}

/**
 * Render a server-supplied signed envelope as a live confirmation page
 * and attach exactly one Buy guard. Throws (before any guard exists)
 * when the sheet cannot be built safely, or when the rendered markup
 * does not contain exactly one [data-muse-buy] button.
 */
export function mountMuseConfirmationPage(
  root:MuseConfirmationPageRoot,
  envelope:MuseApprovalEnvelope,
  options:MuseConfirmationPageOptions={},
):MuseConfirmationPageResult{
  const sheet=museConfirmationSheet(envelope);
  root.innerHTML=renderMuseConfirmation(sheet);
  const handlers:MuseBuyGuardHandlers={
    ...createMuseConfirmationServerHandlers({
      connectionId:sheet.connectionId,
      draftId:sheet.draftId,
      apiBase:options.apiBase,
      approvalToken:options.approvalToken,
      identityToken:options.identityToken,
      fetchImpl:options.fetchImpl,
    }),
    ...(options.onStatus?{onStatus:options.onStatus}:{}),
  };
  const guards=attachMuseBuyGuard(root as unknown as MuseBuyRootLike,handlers);
  if(guards.length!==1) throw new Error('muse_confirmation_page_button_required');
  const resume=async ()=>{
    const decisions=await Promise.all(guards.map((guard)=>guard.resume()));
    if(decisions.some((decision)=>decision.action==='reapproval_required')) options.onReapprovalRequired?.();
    return decisions;
  };
  if(options.reconnectTarget){
    options.reconnectTarget.addEventListener('online',()=>{void resume().catch(()=>{});});
  }
  return {guards,sheet,resume};
}
