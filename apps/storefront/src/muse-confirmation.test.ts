import test from 'node:test';
import assert from 'node:assert/strict';
import {museConfirmationSheet,renderMuseConfirmation} from './muse-confirmation.js';

const envelope={
  connectionId:'conn-1',
  draftId:'draft-1',
  displayedDraftHash:'a'.repeat(64),
  expiresAt:'2026-10-25T22:00:00Z',
  description:'Assassin’s Creed Black Flag',
  seller:{provider:'shopify' as const,externalAccountId:'sams-club.myshopify.com'},
  items:[{variantId:'gid://shopify/ProductVariant/123',quantity:1,unitPrice:'54.00'}],
  shippingAddress:{firstName:'Denzel',lastName:'R',address1:'123 Main St',city:'Atlanta',provinceCode:'GA',countryCode:'US',zip:'30303'},
  shipping:{handle:'free',title:'Free shipping',amount:'0.00'},
  payment:{provider:'stripe' as const,externalAccountId:'acct-consumer-1'},
  subtotal:'54.00',tax:'4.32',total:'58.32',currency:'USD'
};

test('Muse confirmation is derived only from the signed approval envelope',()=>{
  const sheet=museConfirmationSheet(envelope);
  assert.equal(sheet.total,'58.32');
  assert.equal(sheet.seller,'sams-club.myshopify.com');
  assert.equal(sheet.shipTo,'Denzel R');
  assert.equal(sheet.approvalLabel,'Buy now');
  const html=renderMuseConfirmation(sheet);
  assert.match(html,/data-connection-id="conn-1"/);
  assert.match(html,/data-draft-id="draft-1"/);
  assert.match(html,/data-draft-hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/);
  assert.match(html,/58\.32 USD/);
  assert.match(html,/Buy now/);
});

test('Muse confirmation fails closed when the signed hash is absent or malformed',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,displayedDraftHash:'bad'}),/muse_confirmation_invalid_identity/);
});

test('Muse confirmation fails closed when any monetary fact is malformed',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,total:'58.32 USD'}),/muse_confirmation_money_invalid/);
});
