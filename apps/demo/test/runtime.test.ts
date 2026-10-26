import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FixedWindowRateLimiter,
  assertDraftMayApprove,
  draftExpiry,
  runtimeReadiness,
  securityHeaders
} from '../src/runtime.js';

test('production readiness requires persistent state, Muse and payment config',()=>{
  const ready=runtimeReadiness({
    APP_MODE:'production',
    DATABASE_URL:'postgres://x',
    META_MODEL_API_KEY:'m',
    META_MODEL_API_BASE_URL:'https://meta.test',
    META_MUSE_MODEL:'muse',
    STRIPE_SECRET_KEY:'sk_test_x',
    STRIPE_WEBHOOK_SECRET:'whsec_x',
    DRAFT_SIGNING_SECRET:'draft-secret',
    APPROVAL_SIGNING_SECRET:'approval-secret',
    AUDIT_HASH_SECRET:'audit-secret',
    OIDC_ISSUER:'https://id.example',
    OIDC_AUDIENCE:'gift-signal',
    OIDC_JWKS_URL:'https://id.example/.well-known/jwks.json'
  });
  assert.equal(ready.productionReady,true);

  const missing=runtimeReadiness({APP_MODE:'production'});
  assert.equal(missing.productionReady,false);
  assert.deepEqual(missing.missing,['persistent_state','muse','payment','zero_trust_secrets','identity_provider']);
});

test('security headers disable framing and sensitive browser capabilities',()=>{
  const headers=securityHeaders('req-1');
  assert.equal(headers['x-request-id'],'req-1');
  assert.equal(headers['x-frame-options'],'DENY');
  assert.match(headers['content-security-policy'],/frame-ancestors 'none'/);
});

test('rate limiter blocks after the configured fixed-window limit',()=>{
  const limiter=new FixedWindowRateLimiter(2,1000);
  assert.equal(limiter.check('a',0).allowed,true);
  assert.equal(limiter.check('a',1).allowed,true);
  assert.equal(limiter.check('a',2).allowed,false);
  assert.equal(limiter.check('a',1001).allowed,true);
});

test('draft approval is one-time and expires',()=>{
  const created='2026-10-24T16:00:00.000Z';
  const expiresAt=draftExpiry(created,15*60*1000);
  assert.equal(assertDraftMayApprove({status:'REVIEW',createdAt:created,expiresAt},new Date('2026-10-24T16:10:00.000Z')),true);
  assert.throws(()=>assertDraftMayApprove({status:'CONFIRMED',createdAt:created,expiresAt},new Date('2026-10-24T16:10:00.000Z')),/already_confirmed/);
  assert.throws(()=>assertDraftMayApprove({status:'REVIEW',createdAt:created,expiresAt},new Date('2026-10-24T16:20:00.000Z')),/draft_expired/);
});
