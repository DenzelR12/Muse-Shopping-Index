import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSellerDisplayName,
  resolveSellerDisplayNameFromManifest,
  registerServerCompanyDisplayName,
  resolveServerCompanyDisplayName,
  resolveDraftItemTitles,
} from '../dist/muse-seller-display.js';

test('seller display names are never derived from a raw shop domain or account ID', () => {
  assert.equal(isValidSellerDisplayName('Demo Seller', 'demo.myshopify.com'), true);
  assert.equal(isValidSellerDisplayName('demo.myshopify.com', 'demo.myshopify.com'), false);
  assert.equal(isValidSellerDisplayName('acct_123', 'acct_123'), false);
  assert.equal(isValidSellerDisplayName('gid://shopify/Shop/1', 'shop.myshopify.com'), false);
  assert.equal(isValidSellerDisplayName('', 'shop.myshopify.com'), false);
});

test('manifest resolver requires an ACTIVE manifest for the same company', () => {
  assert.equal(
    resolveSellerDisplayNameFromManifest(
      {companyId: 'company', displayName: 'Demo Seller', status: 'ACTIVE'},
      'company',
      'demo.myshopify.com'
    ),
    'Demo Seller'
  );
  assert.throws(
    () => resolveSellerDisplayNameFromManifest(
      {companyId: 'other', displayName: 'Demo Seller', status: 'ACTIVE'},
      'company',
      'demo.myshopify.com'
    ),
    /muse_review_seller_display_required/
  );
  assert.throws(
    () => resolveSellerDisplayNameFromManifest(
      {companyId: 'company', displayName: 'Demo Seller', status: 'PAUSED'},
      'company',
      'demo.myshopify.com'
    ),
    /muse_review_seller_display_required/
  );
  assert.throws(
    () => resolveSellerDisplayNameFromManifest(null, 'company', 'demo.myshopify.com'),
    /muse_review_seller_display_required/
  );
});

test('server company registry only stores validated names and returns null otherwise', () => {
  assert.equal(resolveServerCompanyDisplayName('unregistered-company-xyz'), null);
  assert.equal(
    registerServerCompanyDisplayName('company-xyz', 'Demo Seller', 'demo.myshopify.com'),
    'Demo Seller'
  );
  assert.equal(resolveServerCompanyDisplayName('company-xyz'), 'Demo Seller');
  assert.throws(
    () => registerServerCompanyDisplayName('company-bad', 'demo.myshopify.com', 'demo.myshopify.com'),
    /muse_review_seller_display_required/
  );
});

test('item titles fail closed instead of falling back to a variant ID', () => {
  const line = {variantId: 'gid://shopify/ProductVariant/123', quantity: 1, unitPrice: '54.00'};
  assert.deepEqual(
    resolveDraftItemTitles([line], {'gid://shopify/ProductVariant/123': 'Assassin’s Creed Black Flag'}),
    [{...line, title: 'Assassin’s Creed Black Flag'}]
  );
  assert.throws(() => resolveDraftItemTitles([line], {}), /muse_review_item_title_required/);
  assert.throws(
    () => resolveDraftItemTitles([line], {'gid://shopify/ProductVariant/123': 'gid://shopify/ProductVariant/123'}),
    /muse_review_item_title_required/
  );
});
