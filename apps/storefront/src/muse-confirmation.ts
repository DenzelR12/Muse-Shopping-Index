export interface MuseApprovalEnvelope {
  connectionId:string;
  draftId:string;
  displayedDraftHash:string;
  expiresAt:string;
  description:string;
  seller:{provider:'shopify';externalAccountId:string};
  items:Array<{variantId:string;quantity:number;unitPrice:string}>;
  shippingAddress:{
    firstName?:string;lastName?:string;address1:string;address2?:string;city:string;
    provinceCode?:string;countryCode:string;zip:string;phone?:string;
  };
  shipping:{handle:string;title:string;amount:string};
  payment:{provider:'stripe';externalAccountId:string};
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
  payment:string;
  subtotal:string;
  tax:string;
  total:string;
  currency:string;
  approvalLabel:'Buy now';
}

const money=/^\d+(?:\.\d+)?$/;
const hash=/^[a-f0-9]{64}$/i;

export function museConfirmationSheet(envelope:MuseApprovalEnvelope):MuseConfirmationSheet{
  if(!envelope.connectionId.trim()||!envelope.draftId.trim()||!hash.test(envelope.displayedDraftHash)) throw new Error('muse_confirmation_invalid_identity');
  if(!envelope.description.trim()||!envelope.seller.externalAccountId.trim()) throw new Error('muse_confirmation_invalid_seller');
  if(!Array.isArray(envelope.items)||envelope.items.length<1) throw new Error('muse_confirmation_items_required');
  for(const item of envelope.items){
    if(!item.variantId.trim()||!Number.isInteger(item.quantity)||item.quantity<1||!money.test(item.unitPrice)) throw new Error('muse_confirmation_item_invalid');
  }
  const a=envelope.shippingAddress;
  if(!a.address1?.trim()||!a.city?.trim()||!a.countryCode?.trim()||!a.zip?.trim()) throw new Error('muse_confirmation_shipping_invalid');
  for(const amount of [envelope.subtotal,envelope.tax,envelope.shipping.amount,envelope.total]){
    if(!money.test(amount)) throw new Error('muse_confirmation_money_invalid');
  }
  if(!/^[A-Z]{3}$/.test(envelope.currency)) throw new Error('muse_confirmation_currency_invalid');
  return {
    connectionId:envelope.connectionId,
    draftId:envelope.draftId,
    displayedDraftHash:envelope.displayedDraftHash,
    expiresAt:envelope.expiresAt,
    title:envelope.description,
    seller:envelope.seller.externalAccountId,
    items:envelope.items.map(item=>({label:item.variantId,quantity:item.quantity,unitPrice:item.unitPrice})),
    shipTo:[a.firstName,a.lastName].filter(Boolean).join(' ')||[a.city,a.provinceCode].filter(Boolean).join(', '),
    shipping:`${envelope.shipping.title} · ${envelope.shipping.amount} ${envelope.currency}`,
    payment:`Stripe · ${envelope.payment.externalAccountId}`,
    subtotal:envelope.subtotal,
    tax:envelope.tax,
    total:envelope.total,
    currency:envelope.currency,
    approvalLabel:'Buy now'
  };
}

export function renderMuseConfirmation(sheet:MuseConfirmationSheet):string{
  const esc=(value:string)=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
  return `<section class="muse-confirmation" data-connection-id="${esc(sheet.connectionId)}" data-draft-id="${esc(sheet.draftId)}" data-draft-hash="${esc(sheet.displayedDraftHash)}">
  <p class="eyebrow">MUSE · REVIEW PURCHASE</p>
  <h2>${esc(sheet.title)}</h2>
  <p><strong>Seller:</strong> ${esc(sheet.seller)}</p>
  <ul>${sheet.items.map(item=>`<li>${item.quantity} × ${esc(item.label)} · ${esc(item.unitPrice)} ${esc(sheet.currency)}</li>`).join('')}</ul>
  <p><strong>Ship to:</strong> ${esc(sheet.shipTo)}</p>
  <p><strong>Shipping:</strong> ${esc(sheet.shipping)}</p>
  <p><strong>Payment:</strong> ${esc(sheet.payment)}</p>
  <dl><div><dt>Subtotal</dt><dd>${esc(sheet.subtotal)} ${esc(sheet.currency)}</dd></div><div><dt>Tax</dt><dd>${esc(sheet.tax)} ${esc(sheet.currency)}</dd></div><div><dt>Total</dt><dd><strong>${esc(sheet.total)} ${esc(sheet.currency)}</strong></dd></div></dl>
  <button type="button" data-muse-buy data-connection-id="${esc(sheet.connectionId)}" data-draft-id="${esc(sheet.draftId)}" data-draft-hash="${esc(sheet.displayedDraftHash)}">${sheet.approvalLabel}</button>
</section>`;
}
