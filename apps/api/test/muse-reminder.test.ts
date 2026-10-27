import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryMuseReminderStore,
  MUSE_REMINDER_PAYLOAD,
  MUSE_REMINDER_TEXT,
  optInToReminder,
  optOutOfReminder,
  sendMuseReminder,
  type MuseReminderChannel,
  type MuseReminderDraftState,
} from '../src/muse-reminder.js';

// Mocked channel transport only: no real email/SMS API, no real
// consumer, no real draft, and no channel credentials are used here.
const NOW = '2026-10-27T12:00:00.000Z';
const FRESH_EXPIRY = '2026-10-28T12:00:00.000Z';
const PAST_EXPIRY = '2026-10-26T12:00:00.000Z';

function draft(overrides: Partial<MuseReminderDraftState> = {}): MuseReminderDraftState {
  return {
    draftId: 'draft-1',
    consumerSubject: 'consumer-1',
    companyId: 'company-1',
    expiresAt: FRESH_EXPIRY,
    approved: false,
    executed: false,
    ...overrides,
  };
}

function countingChannel(): {channel: MuseReminderChannel; calls: unknown[]} {
  const calls: unknown[] = [];
  return {
    calls,
    channel: {send: async (payload) => { calls.push(payload); }},
  };
}

async function optedInStore() {
  const store = new MemoryMuseReminderStore();
  const record = await optInToReminder({
    store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
    companyId: 'company-1', draftId: 'draft-1', now: NOW,
  });
  return {store, record};
}

test('opt-in creates a pending record; viewing alone creates none', async () => {
  const store = new MemoryMuseReminderStore();
  assert.equal(await store.get({consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1'}), null);
  const record = await optInToReminder({
    store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
    companyId: 'company-1', draftId: 'draft-1', now: NOW,
  });
  assert.equal(record.status, 'PENDING');
  assert.equal(record.sentCount, 0);
  assert.equal(record.sentAt, null);
  // Idempotent while pending: no duplicate record, still one pending row.
  const again = await optInToReminder({
    store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
    companyId: 'company-1', draftId: 'draft-1', now: NOW,
  });
  assert.equal(again.status, 'PENDING');
});

test('no opt-in means no reminder is sent', async () => {
  const store = new MemoryMuseReminderStore();
  const {channel, calls} = countingChannel();
  await assert.rejects(
    sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW}),
    /muse_reminder_not_opted_in/,
  );
  assert.equal(calls.length, 0);
});

test('opted-in reminder sends once with the fixed generic payload', async () => {
  const {store} = await optedInStore();
  const {channel, calls} = countingChannel();
  const sent = await sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW});
  assert.equal(sent.status, 'SENT');
  assert.equal(sent.sentCount, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], MUSE_REMINDER_PAYLOAD);
  assert.equal(MUSE_REMINDER_TEXT, 'Your review is waiting in Muse. Open Muse to return to your review.');
});

test('a second send for the same draft is refused', async () => {
  const {store} = await optedInStore();
  const {channel, calls} = countingChannel();
  await sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW});
  await assert.rejects(
    sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW}),
    /muse_reminder_not_pending/,
  );
  assert.equal(calls.length, 1);
});

test('opt-out and dismiss each prevent the reminder', async () => {
  for (const action of ['opt_out', 'dismiss'] as const) {
    const {store} = await optedInStore();
    const {channel, calls} = countingChannel();
    const out = await optOutOfReminder({
      store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
      companyId: 'company-1', draftId: 'draft-1', action, now: NOW,
    });
    assert.equal(out?.status, action === 'opt_out' ? 'OPTED_OUT' : 'DISMISSED');
    await assert.rejects(
      sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW}),
      /muse_reminder_not_pending/,
    );
    assert.equal(calls.length, 0);
  }
});

test('re-opt-in after opt-out is allowed before any send, and still only one reminder total', async () => {
  const {store} = await optedInStore();
  await optOutOfReminder({
    store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
    companyId: 'company-1', draftId: 'draft-1', action: 'opt_out', now: NOW,
  });
  const again = await optInToReminder({
    store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
    companyId: 'company-1', draftId: 'draft-1', draftState: draft(), now: NOW,
  });
  assert.equal(again.status, 'PENDING');
  const {channel, calls} = countingChannel();
  await sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW});
  assert.equal(calls.length, 1);
  // After a send, no re-opt-in can create another reminder: no loops.
  await assert.rejects(
    optInToReminder({
      store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
      companyId: 'company-1', draftId: 'draft-1', draftState: draft(), now: NOW,
    }),
    /muse_reminder_already_sent/,
  );
});

test('approved or executed drafts never get a reminder', async () => {
  for (const state of [draft({approved: true}), draft({executed: true})]) {
    const {store} = await optedInStore();
    const {channel, calls} = countingChannel();
    await assert.rejects(
      sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: state, now: NOW}),
      /muse_reminder_draft_already_approved/,
    );
    assert.equal(calls.length, 0);
    const record = await store.get({consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1'});
    assert.equal(record?.status, 'PENDING');
  }
});

test('expired drafts never get a reminder', async () => {
  const {store} = await optedInStore();
  const {channel, calls} = countingChannel();
  await assert.rejects(
    sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft({expiresAt: PAST_EXPIRY}), now: NOW}),
    /muse_reminder_draft_expired/,
  );
  assert.equal(calls.length, 0);
});

test('tenant mismatch and draft-ownership mismatch are refused with no send', async () => {
  const {store} = await optedInStore();
  const {channel, calls} = countingChannel();
  await assert.rejects(
    optInToReminder({
      store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
      companyId: 'company-2', draftId: 'draft-1', now: NOW,
    }),
    /provider_readiness_company_mismatch/,
  );
  await assert.rejects(
    sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft({consumerSubject: 'consumer-2'}), now: NOW}),
    /provider_readiness_company_mismatch/,
  );
  await assert.rejects(
    sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-2', draft: draft(), now: NOW}),
    /provider_readiness_company_mismatch/,
  );
  assert.equal(calls.length, 0);
});

test('no registered channel blocks the send and leaves the record pending', async () => {
  const {store} = await optedInStore();
  await assert.rejects(
    sendMuseReminder({store, channel: null, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW}),
    /muse_reminder_channel_not_registered/,
  );
  const record = await store.get({consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1'});
  assert.equal(record?.status, 'PENDING');
  // Blocked, not consumed: once a channel exists, the same opt-in can send.
  const {channel, calls} = countingChannel();
  await sendMuseReminder({store, channel, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW});
  assert.equal(calls.length, 1);
});

test('a failing channel send is never recorded as sent', async () => {
  const {store} = await optedInStore();
  const failing: MuseReminderChannel = {send: async () => { throw new Error('channel_down'); }};
  await assert.rejects(
    sendMuseReminder({store, channel: failing, principalSubject: 'consumer-1', principalCompanyId: 'company-1', draft: draft(), now: NOW}),
    /channel_down/,
  );
  const record = await store.get({consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1'});
  assert.equal(record?.status, 'PENDING');
  assert.equal(record?.sentCount, 0);
});

test('reminder payload contains no price, title, token, or raw ID', async () => {
  const payloadJson = JSON.stringify(MUSE_REMINDER_PAYLOAD);
  for (const forbidden of ['$', '277', '249', 'Aurora', 'gid://', 'acct_', 'draft-1', 'consumer-1', 'company-1', 'Buy', 'purchase', 'approval']) {
    assert.ok(!payloadJson.includes(forbidden), `payload must not contain ${forbidden}`);
  }
  assert.deepEqual(Object.keys(MUSE_REMINDER_PAYLOAD).sort(), ['kind', 'text']);
});

test('opt-out with no record invents no record', async () => {
  const store = new MemoryMuseReminderStore();
  const out = await optOutOfReminder({
    store, principalSubject: 'consumer-1', principalCompanyId: 'company-1',
    companyId: 'company-1', draftId: 'draft-1', action: 'opt_out', now: NOW,
  });
  assert.equal(out, null);
  assert.equal(await store.get({consumerSubject: 'consumer-1', companyId: 'company-1', draftId: 'draft-1'}), null);
});
