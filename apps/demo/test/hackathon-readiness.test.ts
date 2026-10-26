import test from 'node:test';
import assert from 'node:assert/strict';
import {hackathonReadiness,HACKATHON_REQUIRED_ENV,STRIPE_SHOPIFY_ADAPTER_ENV} from '../src/hackathon-readiness.js';

function fixture(){return {...Object.fromEntries([...HACKATHON_REQUIRED_ENV,...STRIPE_SHOPIFY_ADAPTER_ENV].map(name=>[name,'configured'])),
  META_MODEL_API_KEY:'do-not-print',META_MODEL_API_BASE_URL:'https://api.meta.ai/v1',META_MUSE_MODEL:'account-model',
  OIDC_ISSUER:'https://id.example',OIDC_JWKS_URL:'https://id.example/jwks',PROVIDER_OAUTH_CALLBACK_URL:'https://api.example/callback',
  STRIPE_SECRET_KEY:'sk_test_fixture',PROVIDER_TOKEN_ENCRYPTION_KEY:'do-not-print',MERCHANT_PROVIDER_CREDENTIALS_CONFIGURED:'true',SHOPIFY_TEST_STORE_CONFIRMED:'true',SHOPIFY_TEST_SHOP_DOMAIN:'sandbox.myshopify.com'};}
test('preflight reports names/booleans, never secret values',()=>{
  const result=hackathonReadiness(fixture(),'stripe-shopify');assert.equal(result.sandboxReady,true);
  assert.doesNotMatch(JSON.stringify(result),/do-not-print|sk_test_fixture/);assert.equal(result.accountVerification,'NOT_PERFORMED');
});
test('live Stripe keys and unattested Shopify stores cannot pass the sandbox gate',()=>{
  assert.equal(hackathonReadiness({...fixture(),STRIPE_SECRET_KEY:'sk_live_fixture'},'stripe-shopify').sandboxReady,false);
  assert.equal(hackathonReadiness({...fixture(),SHOPIFY_TEST_STORE_CONFIRMED:'false'},'stripe-shopify').sandboxReady,false);
  assert.equal(hackathonReadiness({...fixture(),SHOPIFY_TEST_SHOP_DOMAIN:'merchant.example'},'stripe-shopify').sandboxReady,false);
});
test('missing configuration and insecure model/identity URLs fail closed',()=>{
  assert.equal(hackathonReadiness({}).sandboxReady,false);
  assert.equal(hackathonReadiness({...fixture(),META_MODEL_API_BASE_URL:'http://example.test'}).modelReady,false);
  assert.equal(hackathonReadiness({...fixture(),OIDC_JWKS_URL:'http://example.test'}).sandboxReady,false);
});


test('universal core configuration never requires the Shopify/Stripe adapter',()=>{
  const env=fixture();
  for(const key of STRIPE_SHOPIFY_ADAPTER_ENV) delete env[key];
  const result=hackathonReadiness(env);
  assert.equal(result.profile,'core');assert.equal(result.coreConfigured,true);assert.equal(result.sandboxReady,false);
  assert.equal(result.missing.some(key=>key.startsWith('SHOPIFY_')||key.startsWith('STRIPE_')),false);
});
