import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProviderCapability,
  createRetailerProvider,
  providerCatalog,
  providerConnectionPlan,
  registerProviderDefinition
} from '../dist/provider-adapters.js';

test('large providers are first-class without claiming unauthorized access',()=>{
  for(const provider of ['walmart','amazon','ebay','target','pinterest']){
    assert.ok(providerCatalog[provider],provider);
  }
  assert.equal(providerCatalog.target.capabilities.find(x=>x.capability==='order.create').access,'PARTNERSHIP_REQUIRED');
  assert.equal(providerCatalog.amazon.capabilities.find(x=>x.capability==='order.create').access,'PARTNERSHIP_REQUIRED');
});

test('major retailer registry is broad and not limited to a short allowlist',()=>{
  for(const provider of ['best-buy','home-depot','lowes','costco','macys','wayfair','chewy','sephora','apple','ikea','kroger','cvs','walgreens','rei']){
    assert.ok(providerCatalog[provider],provider);
    assert.equal(providerCatalog[provider].providerClass,'RETAILER');
  }
  assert.ok(Object.keys(providerCatalog).length>=50);
});

test('new retailers can be registered without changing the core provider union',()=>{
  const provider='future-major-retailer';
  const definition=createRetailerProvider(provider,'Future Major Retailer');
  registerProviderDefinition(definition);
  assert.equal(providerConnectionPlan(provider).displayName,'Future Major Retailer');
  assert.ok(providerConnectionPlan(provider).partnershipRequired.includes('order.create'));
});

test('walmart and ebay expose seller connection paths while preserving approval gates',()=>{
  const walmart=providerConnectionPlan('walmart');
  const ebay=providerConnectionPlan('ebay');
  assert.equal(walmart.sellerConnectionSupported,true);
  assert.ok(walmart.approvalRequired.includes('catalog.read'));
  assert.equal(ebay.sellerConnectionSupported,true);
  assert.ok(ebay.approvalRequired.includes('offers.search'));
});

test('pinterest is modeled as discovery rather than an assumed payment rail',()=>{
  const pinterest=providerConnectionPlan('pinterest');
  assert.equal(pinterest.providerClass,'DISCOVERY_NETWORK');
  assert.ok(pinterest.partnershipRequired.includes('order.create'));
});

test('provider capability enforcement fails closed',()=>{
  const connection={
    connectionId:'conn-1',
    provider:'target',
    companyId:'company-1',
    externalAccountId:'acct-1',
    status:'CONNECTED',
    grantedCapabilities:['catalog.read'],
    createdAt:'2026-10-24T17:00:00.000Z'
  };
  assert.throws(()=>assertProviderCapability(connection,'catalog.read'),/provider_partnership_required/);
  assert.throws(()=>assertProviderCapability({...connection,provider:'walmart'},'order.create'),/provider_capability_not_granted/);
});
