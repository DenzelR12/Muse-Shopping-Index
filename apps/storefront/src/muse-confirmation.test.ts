import test from 'node:test';
import assert from 'node:assert/strict';
import {museConfirmationSheet,renderMuseConfirmation} from './muse-confirmation.js';

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
  subtotal:'54.00',tax:'4.32',total:'58.32',currency:'USD'
};

test('Muse confirmation is derived only from the signed approval envelope',()=>{
  const sheet=museConfirmationSheet(envelope);
  assert.equal(sheet.total,'58.32');
  assert.equal(sheet.seller,'Demo Seller');
  assert.equal(sheet.shipTo,'Denzel R, 123 Main St, Atlanta, GA, US 30303');
  assert.equal(sheet.payment,'Saved payment');
  assert.equal(sheet.items[0].label,'Assassin’s Creed Black Flag');
  const html=renderMuseConfirmation(sheet);
  assert.match(html,/data-connection-id="conn-1"/);
  assert.match(html,/data-draft-id="draft-1"/);
  assert.match(html,/data-draft-hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/);
  assert.match(html,/58\.32 USD/);
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

test('Muse confirmation fails closed when the signed hash is absent or malformed',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,displayedDraftHash:'bad'}),/muse_confirmation_invalid_identity/);
});

test('Muse confirmation fails closed when any monetary fact is malformed',()=>{
  assert.throws(()=>museConfirmationSheet({...envelope,total:'58.32 USD'}),/muse_confirmation_money_invalid/);
});
