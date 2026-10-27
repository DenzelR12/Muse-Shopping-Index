/**
 * Pure tests for the Meta lead callback webhook handler.
 *
 * TEST fixtures only. The phone number below is the conventional
 * TEST range (+15555550199-style), labelled TEST, and is not a real
 * consumer, lead, or callback. No secret, token, or real lead data
 * appears in this file. No live Graph call is made: fetchLead is
 * always an injected fake, and its call count proves fail-closed
 * deliveries never reach a fetch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  META_GRAPH_API_VERSION,
  buildLeadGraphPath,
  createLeadCallbackMemoryStore,
  handleLeadWebhook,
  parseLeadWebhookEvent,
  toConsumerCallbackSummary,
  verifyLeadWebhookSignature,
  verifyWebhookSubscription,
  type LeadApiRecord,
  type ParsedLeadEvent,
} from '../src/muse-lead-webhook.js';

const SECRET = 'test-app-secret-only';
const RAW_BODY = '{"object":"page"}';
const GOOD_SIGNATURE = `sha256=${createHmac('sha256', SECRET).update(RAW_BODY).digest('hex')}`;

const EVENT: ParsedLeadEvent = {
  leadgenId: 'test-leadgen-1',
  pageId: 'test-page-1',
  formId: 'test-form-1',
  adId: 'test-ad-1',
};

const TEST_LEAD: LeadApiRecord = {
  id: 'test-leadgen-1',
  field_data: [
    { name: 'full_name', values: ['Test Person'] },
    { name: 'phone_number', values: ['+15555550199'] },
    { name: 'preferred_callback_date_time', values: ['2026-10-28T14:30:00-0400'] },
  ],
};

function handlerArgs(overrides: Record<string, unknown> = {}) {
  let fetches = 0;
  const store = createLeadCallbackMemoryStore();
  const overriddenFetch = overrides['fetchLead'] as ((leadgenId: string) => Promise<LeadApiRecord>) | undefined;
  const fetchLead = async (leadgenId: string): Promise<LeadApiRecord> => {
    fetches += 1;
    return overriddenFetch !== undefined ? overriddenFetch(leadgenId) : TEST_LEAD;
  };
  const args = {
    event: EVENT,
    rawBody: RAW_BODY,
    signature: GOOD_SIGNATURE,
    secret: SECRET,
    pageToCompany: (pageId: string) => (pageId === 'test-page-1' ? 'company-1' : undefined),
    store,
    now: '2026-10-27T12:00:00.000Z',
    ...overrides,
    // The counted wrapper must win over any raw override.
    fetchLead,
  };
  return {
    args,
    store,
    fetchCount: () => fetches,
  };
}

test('webhook subscription handshake returns the challenge only on exact subscribe + verify-token match', () => {
  assert.deepEqual(verifyWebhookSubscription(
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-test', 'hub.challenge': 'challenge-123' },
    'verify-test',
  ), { status: 200, challenge: 'challenge-123' });
  assert.deepEqual(verifyWebhookSubscription(
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'challenge-123' },
    'verify-test',
  ), { status: 403, error: 'muse_lead_webhook_forbidden' });
  assert.deepEqual(verifyWebhookSubscription(
    { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-test', 'hub.challenge': 'challenge-123' },
    'verify-test',
  ), { status: 403, error: 'muse_lead_webhook_forbidden' });
  assert.deepEqual(verifyWebhookSubscription(
    { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-test', 'hub.challenge': 'challenge-123' },
    undefined,
  ), { status: 403, error: 'muse_lead_webhook_forbidden' });
});

test('signature verification accepts a valid sha256 HMAC and rejects invalid, malformed, and missing-secret cases', () => {
  assert.deepEqual(verifyLeadWebhookSignature(RAW_BODY, GOOD_SIGNATURE, SECRET), { ok: true });
  assert.deepEqual(verifyLeadWebhookSignature(RAW_BODY, 'sha256=00', SECRET), {
    ok: false, error: 'muse_lead_webhook_bad_signature',
  });
  assert.deepEqual(verifyLeadWebhookSignature(RAW_BODY, 'not-a-signature', SECRET), {
    ok: false, error: 'muse_lead_webhook_bad_signature',
  });
  assert.deepEqual(verifyLeadWebhookSignature(RAW_BODY, undefined, SECRET), {
    ok: false, error: 'muse_lead_webhook_bad_signature',
  });
  assert.deepEqual(verifyLeadWebhookSignature(RAW_BODY, GOOD_SIGNATURE, undefined), {
    ok: false, error: 'muse_lead_webhook_secret_not_configured',
  });
  assert.deepEqual(verifyLeadWebhookSignature(RAW_BODY, GOOD_SIGNATURE, ''), {
    ok: false, error: 'muse_lead_webhook_secret_not_configured',
  });
});

test('parseLeadWebhookEvent extracts leadgen/page/form/ad and rejects missing leadgen_id or page_id', () => {
  const parsed = parseLeadWebhookEvent({
    object: 'page',
    entry: [{ id: 'test-page-1', changes: [{ field: 'leadgen', value: { leadgen_id: 'test-leadgen-1', form_id: 'test-form-1', ad_id: 'test-ad-1' } }] }],
  });
  assert.deepEqual(parsed, { ok: true, event: EVENT });
  assert.deepEqual(parseLeadWebhookEvent({
    entry: [{ id: 'test-page-1', changes: [{ field: 'leadgen', value: { form_id: 'test-form-1' } }] }],
  }), { ok: false, error: 'muse_lead_webhook_invalid_event' });
  assert.deepEqual(parseLeadWebhookEvent({
    entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 'test-leadgen-1' } }] }],
  }), { ok: false, error: 'muse_lead_webhook_invalid_event' });
  assert.deepEqual(parseLeadWebhookEvent({}), { ok: false, error: 'muse_lead_webhook_invalid_event' });
  assert.deepEqual(parseLeadWebhookEvent(null), { ok: false, error: 'muse_lead_webhook_invalid_event' });
});

test('handleLeadWebhook stores a valid lead with only the allowed fields', async () => {
  const { args, fetchCount } = handlerArgs();
  const result = await handleLeadWebhook(args);
  assert.equal(result.status, 'stored');
  assert.equal(fetchCount(), 1);
  if (result.status === 'stored') {
    assert.deepEqual(Object.keys(result.record).sort(), [
      'companyId', 'fullName', 'leadgenId', 'phoneNumber',
      'preferredCallbackDateTime', 'receivedAt',
    ]);
    assert.equal(result.record.companyId, 'company-1');
    assert.equal(result.record.receivedAt, '2026-10-27T12:00:00.000Z');
    assert.equal(result.record.phoneNumber, '+15555550199');
  }
});

test('handleLeadWebhook fails closed without fetch on missing secret, bad signature, and unmapped page', async () => {
  const missingSecret = handlerArgs({ secret: undefined });
  assert.deepEqual(await handleLeadWebhook(missingSecret.args), {
    status: 'rejected', error: 'muse_lead_webhook_secret_not_configured',
  });
  assert.equal(missingSecret.fetchCount(), 0);

  const badSignature = handlerArgs({ signature: 'sha256=00' });
  assert.deepEqual(await handleLeadWebhook(badSignature.args), {
    status: 'rejected', error: 'muse_lead_webhook_bad_signature',
  });
  assert.equal(badSignature.fetchCount(), 0);

  const unmapped = handlerArgs({ event: { ...EVENT, pageId: 'unknown-page' } });
  assert.deepEqual(await handleLeadWebhook(unmapped.args), {
    status: 'rejected', error: 'muse_lead_webhook_page_not_mapped',
  });
  assert.equal(unmapped.fetchCount(), 0);
});

test('handleLeadWebhook rejects an incomplete fetched lead and stores nothing', async () => {
  const { args, store, fetchCount } = handlerArgs({
    fetchLead: async () => ({
      field_data: [{ name: 'full_name', values: ['Test Person'] }],
    }),
  });
  assert.deepEqual(await handleLeadWebhook(args), {
    status: 'rejected', error: 'muse_lead_webhook_incomplete_lead',
  });
  assert.equal(fetchCount(), 1);
  assert.equal(store.get('test-leadgen-1', 'company-1'), undefined);
});

test('duplicate leadgen_id for the same company is idempotent and never creates a second record', async () => {
  const { args, store, fetchCount } = handlerArgs();
  const first = await handleLeadWebhook(args);
  const second = await handleLeadWebhook(args);
  assert.equal(first.status, 'stored');
  assert.equal(second.status, 'duplicate');
  assert.equal(fetchCount(), 1, 'duplicate delivery must not re-fetch');
  if (second.status === 'duplicate' && first.status === 'stored') {
    assert.deepEqual(second.record, first.record);
  }
  // Same leadgen_id under a different company is a different tenant's record.
  const otherCompany = handlerArgs({
    event: EVENT,
    pageToCompany: (pageId: string) => (pageId === 'test-page-1' ? 'company-2' : undefined),
    store,
  });
  assert.equal((await handleLeadWebhook(otherCompany.args)).status, 'stored');
});

test('error messages contain no phone number, and consumer output strips raw IDs and PII', async () => {
  const { args } = handlerArgs({ secret: undefined });
  const rejected = await handleLeadWebhook(args);
  assert.equal(JSON.stringify(rejected).includes('+15555550199'), false);
  assert.equal(JSON.stringify(rejected).includes('Test Person'), false);

  const stored = handlerArgs();
  const result = await handleLeadWebhook(stored.args);
  assert.equal(result.status, 'stored');
  if (result.status === 'stored') {
    const summary = toConsumerCallbackSummary(result.record);
    assert.deepEqual(summary, {
      companyId: 'company-1',
      status: 'callback_requested',
      receivedAt: '2026-10-27T12:00:00.000Z',
    });
    assert.equal(JSON.stringify(summary).includes('test-leadgen-1'), false);
    assert.equal(JSON.stringify(summary).includes('+15555550199'), false);
  }
});

test('Graph path uses the v26.0 constant and contains no token', () => {
  assert.equal(META_GRAPH_API_VERSION, 'v26.0');
  assert.equal(buildLeadGraphPath('test-leadgen-1'), '/v26.0/test-leadgen-1');
});
