import test from 'node:test';
import assert from 'node:assert/strict';
import {productionReadiness} from '../src/readiness.js';

test('production readiness fails closed until every external authority is configured',()=>{
  const partial=productionReadiness({NODE_ENV:'production',DATABASE_URL:'postgres://x'});
  assert.equal(partial.ready,false);
  assert.ok(partial.missing.includes('oidcIdentity'));
  assert.ok(partial.missing.includes('stripe'));
  assert.ok(partial.missing.includes('museTransactionAgent'));
  assert.ok(partial.missing.includes('providerAuditSigning'));
  assert.ok(partial.missing.includes('providerTokenEncryption'));
  assert.ok(partial.missing.includes('shopifyOAuth'));
  assert.ok(partial.missing.includes('shopifyWebhook'));
});

test('production readiness becomes true only with all gates',()=>{
  const ready=productionReadiness({
    NODE_ENV:'production',
    DATABASE_URL:'postgres://x',
    OIDC_ISSUER:'https://id.example',
    OIDC_AUDIENCE:'gift-signal',
    OIDC_JWKS_URL:'https://id.example/jwks',
    SHOP_OIDC_USER_ID_CLAIM:'shop_user_public_id',
    META_MODEL_API_KEY:'meta',
    META_MODEL_API_BASE_URL:'https://meta.example/v1',
    META_MUSE_MODEL:'muse',
    MUSE_TRANSACTION_AGENT_ID:'muse-agent',
    STRIPE_SECRET_KEY:'sk_test_x',
    STRIPE_WEBHOOK_SECRET:'whsec_x',
    DRAFT_SIGNING_SECRET:'d',
    APPROVAL_SIGNING_SECRET:'a',
    AUDIT_HASH_SECRET:'h',
    LINK_AUTHORITY_SIGNING_KEY:'l',
    AUDIT_SIGNING_SECRET:'audit-signing',
    PROVIDER_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),
    PROVIDER_OAUTH_STATE_SECRET:'x'.repeat(32),
    PROVIDER_OAUTH_CALLBACK_URL:'https://api.example.test/v1/provider-oauth/callback',
    SHOPIFY_CLIENT_ID:'shopify-client',
    SHOPIFY_CLIENT_SECRET:'shopify-secret',
    SHOPIFY_OAUTH_SCOPES:'read_products,write_draft_orders',
    SHOPIFY_WEBHOOK_SECRET:'shopify-webhook',
    MERCHANT_PROVIDER_CREDENTIALS_CONFIGURED:'true'
  });
  assert.equal(ready.ready,true);
  assert.deepEqual(ready.missing,[]);
});

test('demo merchant configuration cannot satisfy production readiness',()=>{
  const result=productionReadiness({NODE_ENV:'production',MERCHANT_PROVIDER_MODE:'demo'});
  assert.equal(result.gates.merchantProvider,false);
  assert.equal(result.gates.shopConsumerIdentity,false);
});

