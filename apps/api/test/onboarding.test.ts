import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingStatus} from '../src/onboarding.js';

test('onboarding status exposes only booleans and labels',()=>{
  const status=onboardingStatus({
    DATABASE_URL:'postgres://example',
    OIDC_ISSUER:'https://id.example',
    OIDC_AUDIENCE:'gift-signal',
    OIDC_JWKS_URL:'https://id.example/jwks',
    META_MODEL_API_KEY:'configured-value',
    META_MODEL_API_BASE_URL:'https://meta.example/v1',
    META_MUSE_MODEL:'muse',
    STRIPE_SECRET_KEY:'configured-value',
    STRIPE_WEBHOOK_SECRET:'configured-value',
    MERCHANT_PROVIDER_CREDENTIALS_CONFIGURED:'true'
  });
  assert.equal(status.ready,true);
  assert.deepEqual(status.next,[]);
  const serialized=JSON.stringify(status);
  assert.equal(serialized.includes('configured-value'),false);
});
