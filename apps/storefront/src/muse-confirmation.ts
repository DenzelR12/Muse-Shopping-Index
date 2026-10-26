export interface MuseApprovalEnvelope {
  connectionId:string;
  draftId:string;
  displayedDraftHash:string;
  expiresAt:string;
  description:string;
  seller:{provider:'shopify';externalAccountId:string;displayName?:string};
  items:Array<{variantId:string;quantity:number;unitPrice:string;title?:string;configuration?:string}>;
  shippingAddress:{
    firstName?:string;lastName?:string;address1:string;address2?:string;city:string;
    provinceCode?:string;countryCode:string;zip:string;phone?:string;
  };
  shipping:{handle:string;title:string;amount:string};
  payment:{provider:'stripe';externalAccountId:string};
  // Optional, server-owned review facts only. Terms come from the
  // company/draft, payment timing from the payment plan, and an
  // estimated arrival only from a fulfillment estimate. If a field is
  // absent, the sheet shows "not available" — it never invents a date,
  // a term, or a payment time, and it never derives one from a raw ID.
  terms?:string;
  paymentTiming?:string;
  estimatedArrival?:string;
  subtotal:string;
  tax:string;
  total:string;
  currency:string;
}

export interface MuseConfirmationSheet {
  connectionId:string;
  draftId:string;
  displayedDraftHash:string;
  expiresAt:string;
  title:string;
  seller:string;
  items:Array<{label:string;quantity:number;unitPrice:string}>;
  shipTo:string;
  shipping:string;
  payment:'Saved payment';
  terms:string;
  paymentTiming:string;
  estimatedArrival:string;
  subtotal:string;
  tax:string;
  total:string;
  currency:string;
  approvalLabel:'Buy now';
}

const money=/^\d+(?:\.\d+)?$/;
const hash=/^[a-f0-9]{64}$/i;
const rawIdPattern=/gid:\/\/|myshopify\.com|acct_/i;

function resolvedSellerName(envelope:MuseApprovalEnvelope):string{
  const displayName=envelope.seller.displayName?.trim();
  if(!displayName) throw new Error('muse_confirmation_seller_display_required');
  if(displayName===envelope.seller.externalAccountId||rawIdPattern.test(displayName)){
    throw new Error('muse_confirmation_seller_display_required');
  }
  return displayName;
}

function optionalReviewText(value:string|undefined):string{
  if(value===undefined) return 'not available';
  const trimmed=value.trim();
  if(!trimmed) return 'not available';
  if(trimmed.length>1000||rawIdPattern.test(trimmed)) throw new Error('muse_confirmation_unsafe_display');
  return trimmed;
}

function resolvedItemLabel(item:MuseApprovalEnvelope['items'][number]):string{
  const title=item.title?.trim();
  if(!title||title===item.variantId||rawIdPattern.test(title)){
    throw new Error('muse_confirmation_item_title_required');
  }
  const configuration=item.configuration?.trim();
  if(configuration&&configuration!==title&&!rawIdPattern.test(configuration)){
    return `${title} — ${configuration}`;
  }
  return title;
}

export function museConfirmationSheet(envelope:MuseApprovalEnvelope):MuseConfirmationSheet{
  if(!envelope.connectionId.trim()||!envelope.draftId.trim()||!hash.test(envelope.displayedDraftHash)) throw new Error('muse_confirmation_invalid_identity');
  if(!envelope.description.trim()||!envelope.seller.externalAccountId.trim()) throw new Error('muse_confirmation_invalid_seller');
  const seller=resolvedSellerName(envelope);
  if(!Array.isArray(envelope.items)||envelope.items.length<1) throw new Error('muse_confirmation_items_required');
  for(const item of envelope.items){
    if(!item.variantId.trim()||!Number.isInteger(item.quantity)||item.quantity<1||!money.test(item.unitPrice)) throw new Error('muse_confirmation_item_invalid');
    // Fail closed here: a resolved title is required, a raw variant ID is never a label.
    resolvedItemLabel(item);
  }
  const a=envelope.shippingAddress;
  if(!a.address1?.trim()||!a.city?.trim()||!a.countryCode?.trim()||!a.zip?.trim()) throw new Error('muse_confirmation_shipping_invalid');
  for(const amount of [envelope.subtotal,envelope.tax,envelope.shipping.amount,envelope.total]){
    if(!money.test(amount)) throw new Error('muse_confirmation_money_invalid');
  }
  if(!/^[A-Z]{3}$/.test(envelope.currency)) throw new Error('muse_confirmation_currency_invalid');
  const shipTo=[ [a.firstName,a.lastName].filter(Boolean).join(' '), a.address1, a.address2,
    [a.city,a.provinceCode].filter(Boolean).join(', '), [a.countryCode,a.zip].filter(Boolean).join(' ') ]
    .filter(Boolean).join(', ');
  return {
    connectionId:envelope.connectionId,
    draftId:envelope.draftId,
    displayedDraftHash:envelope.displayedDraftHash,
    expiresAt:envelope.expiresAt,
    title:envelope.description,
    seller,
    items:envelope.items.map(item=>({label:resolvedItemLabel(item),quantity:item.quantity,unitPrice:item.unitPrice})),
    shipTo,
    shipping:`${envelope.shipping.title} · ${envelope.shipping.amount} ${envelope.currency}`,
    payment:'Saved payment',
    terms:optionalReviewText(envelope.terms),
    paymentTiming:optionalReviewText(envelope.paymentTiming),
    estimatedArrival:optionalReviewText(envelope.estimatedArrival),
    subtotal:envelope.subtotal,
    tax:envelope.tax,
    total:envelope.total,
    currency:envelope.currency,
    approvalLabel:'Buy now'
  };
}

export function renderMuseConfirmation(sheet:MuseConfirmationSheet):string{
  if(sheet.payment!=='Saved payment') throw new Error('muse_confirmation_unsafe_display');
  if(rawIdPattern.test(sheet.seller)||sheet.items.some(item=>rawIdPattern.test(item.label))){
    throw new Error('muse_confirmation_unsafe_display');
  }
  for(const value of [sheet.terms,sheet.paymentTiming,sheet.estimatedArrival]){
    if(typeof value!=='string'||!value.trim()||value.length>1000||rawIdPattern.test(value)){
      throw new Error('muse_confirmation_unsafe_display');
    }
  }
  const esc=(value:string)=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
  return `<section class="muse-confirmation" data-connection-id="${esc(sheet.connectionId)}" data-draft-id="${esc(sheet.draftId)}" data-draft-hash="${esc(sheet.displayedDraftHash)}">
  <p class="eyebrow">MUSE · REVIEW PURCHASE</p>
  <h2>${esc(sheet.title)}</h2>
  <p><strong>Seller:</strong> ${esc(sheet.seller)}</p>
  <ul>${sheet.items.map(item=>`<li>${item.quantity} × ${esc(item.label)} · ${esc(item.unitPrice)} ${esc(sheet.currency)}</li>`).join('')}</ul>
  <p><strong>Ship to:</strong> ${esc(sheet.shipTo)}</p>
  <p><strong>Shipping:</strong> ${esc(sheet.shipping)}</p>
  <p><strong>Payment:</strong> ${esc(sheet.payment)}</p>
  <p><strong>Refund/cancellation terms:</strong> ${esc(sheet.terms)}</p>
  <p><strong>Payment timing:</strong> ${esc(sheet.paymentTiming)}</p>
  <p><strong>Estimated arrival:</strong> ${esc(sheet.estimatedArrival)}</p>
  <dl><div><dt>Subtotal</dt><dd>${esc(sheet.subtotal)} ${esc(sheet.currency)}</dd></div><div><dt>Tax</dt><dd>${esc(sheet.tax)} ${esc(sheet.currency)}</dd></div><div><dt>Total</dt><dd><strong>${esc(sheet.total)} ${esc(sheet.currency)}</strong></dd></div></dl>
  <button type="button" data-muse-buy data-connection-id="${esc(sheet.connectionId)}" data-draft-id="${esc(sheet.draftId)}" data-draft-hash="${esc(sheet.displayedDraftHash)}">${sheet.approvalLabel}</button>
</section>`;
}
