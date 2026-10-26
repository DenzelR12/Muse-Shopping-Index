/**
 * EXAMPLE INTEGRATION — NOT A LIVE PAGE.
 *
 * The live page is now muse-confirmation-page.ts (mounted via
 * mountMuseConfirmationPage() and exported from index.ts). This file
 * remains only an example of the wiring pattern: the storefront's
 * main.ts is a separate gifting-concierge surface and does not render
 * that button, so this file is not imported by main.ts or index.ts,
 * and it must not be presented as a live confirmation page.
 *
 * How a real page should use it:
 *  1. Build the sheet server-side from a signed approval envelope
 *     with museConfirmationSheet() — never from browser JSON.
 *  2. Render it with renderMuseConfirmation() into a page container.
 *  3. Call attachMuseBuyGuard() on that container with a submit
 *     handler that calls the trusted approval/execution flow, and a
 *     readOwnedStatus handler that reads owned order status by
 *     draft ID from the server. The guard itself never grants
 *     approval; server consume-once approval remains authoritative.
 *  4. On reconnect, call resume() on every guard. A resume /
 *     completed / reconciliation decision needs no new approval and
 *     no new submission. Only reapproval_required means presenting a
 *     fresh review before any new Buy is accepted.
 */

import {museConfirmationSheet,renderMuseConfirmation} from './muse-confirmation.js';
import type {MuseApprovalEnvelope} from './muse-confirmation.js';
import {attachMuseBuyGuard} from './muse-buy-guard.js';
import type {MuseBuyButtonLike,MuseBuyGuard,MuseBuyGuardHandlers,MuseBuyRootLike} from './muse-buy-guard.js';

export interface MuseConfirmationPageRoot {
  innerHTML:string;
  querySelectorAll:(selector:string)=>Iterable<MuseBuyButtonLike>;
}

export interface MuseConfirmationPageResult {
  guards:MuseBuyGuard[];
  resume:()=>Promise<unknown>;
}

/**
 * Render a Muse confirmation sheet into `root` and attach the
 * one-click Buy guard to every [data-muse-buy] button it contains.
 * `handlers.submit` must perform the trusted server submission;
 * `handlers.readOwnedStatus` must return the server-owned status
 * for the draft ID, never a browser-derived state.
 */
export function renderMuseConfirmationPage(
  root:MuseConfirmationPageRoot,
  envelope:MuseApprovalEnvelope,
  handlers:MuseBuyGuardHandlers,
):MuseConfirmationPageResult{
  const sheet=museConfirmationSheet(envelope);
  root.innerHTML=renderMuseConfirmation(sheet);
  const guards=attachMuseBuyGuard(root as unknown as MuseBuyRootLike,handlers);
  return {
    guards,
    resume:()=>Promise.all(guards.map((guard)=>guard.resume())),
  };
}
