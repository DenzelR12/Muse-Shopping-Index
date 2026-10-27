import test from 'node:test';
import assert from 'node:assert/strict';
import { runMultiCompanyDemo } from '../src/muse-multi-company-demo.js';

const COMPANY_1 = 'Company 1 — THEENRG.COM (test, Shopify)';
const COMPANY_2 = 'Company 2 — ClutchAgent (test, Muse Meta)';

// Expected order: Company 1 (Shopify) flow, then Company 2 (Meta)
// flow, then Company 1 drift, then Company 2 unaffected, then
// per-company BI.
const EXPECTED_ORDER: Array<[string, string]> = [
  [COMPANY_1, 'reel'],
  [COMPANY_1, 'exact_review'],
  [COMPANY_1, 'approval'],
  [COMPANY_1, 'status'],
  [COMPANY_2, 'reel_entry'],
  [COMPANY_2, 'exact_review'],
  [COMPANY_2, 'approval'],
  [COMPANY_2, 'status'],
  [COMPANY_1, 'drift'],
  [COMPANY_2, 'unaffected'],
  [COMPANY_1, 'bi'],
  [COMPANY_2, 'bi'],
];

test('step order is Shopify flow then Meta flow then drift then unaffected then BI', () => {
  const steps = runMultiCompanyDemo();
  assert.equal(steps.length, EXPECTED_ORDER.length);
  assert.deepEqual(
    steps.map((s) => [s.tenant, s.step]),
    EXPECTED_ORDER,
  );
});

test('Company 1 drift requires reapproval and the old approval is gone', () => {
  const steps = runMultiCompanyDemo();
  const drift = steps.find((s) => s.tenant === COMPANY_1 && s.step === 'drift');
  assert.ok(drift);
  assert.match(drift.outcome, /reapproval_required/);
  assert.match(drift.outcome, /Item changed from \$58 to \$64/);
  assert.match(drift.outcome, /tax unchanged at \$5/);
  assert.match(drift.outcome, /shipping unchanged at \$9/);
  assert.match(drift.outcome, /total changed from \$72 to \$78/);
  assert.match(drift.outcome, /old approval is gone/i);
  assert.match(drift.outcome, /fresh exact review and a fresh approval are required/i);
  // No second approval for Company 1 appears after the drift step.
  const driftIndex = steps.indexOf(drift);
  const laterApprovals = steps
    .slice(driftIndex + 1)
    .filter((s) => s.tenant === COMPANY_1 && s.step === 'approval');
  assert.equal(laterApprovals.length, 0);
});

test('Company 1 drift leaves Company 2 (ClutchAgent Meta) unchanged', () => {
  const steps = runMultiCompanyDemo();
  const unaffected = steps.find(
    (s) => s.tenant === COMPANY_2 && s.step === 'unaffected',
  );
  assert.ok(unaffected);
  // Company 2 still stands at its own exact terms.
  assert.match(unaffected.outcome, /Total \$49/);
  assert.match(unaffected.outcome, /Saved payment/);
  assert.match(unaffected.outcome, /test product only/);
  // No Company 1 drift amounts leak into the Company 2 outcome.
  assert.doesNotMatch(unaffected.outcome, /\$64/);
  assert.doesNotMatch(unaffected.outcome, /\$78/);
  assert.doesNotMatch(unaffected.outcome, /THEENRG/);
  // Company 2 has no step after the drift other than unaffected + BI.
  const driftIndex = steps.findIndex(
    (s) => s.tenant === COMPANY_1 && s.step === 'drift',
  );
  const laterCompany2 = steps.slice(driftIndex + 1).filter((s) => s.tenant === COMPANY_2);
  assert.deepEqual(
    laterCompany2.map((s) => s.step),
    ['unaffected', 'bi'],
  );
});

test('BI for Company 1 excludes Company 2 outcomes and vice versa', () => {
  const steps = runMultiCompanyDemo();
  const bi1 = steps.find((s) => s.tenant === COMPANY_1 && s.step === 'bi');
  const bi2 = steps.find((s) => s.tenant === COMPANY_2 && s.step === 'bi');
  assert.ok(bi1);
  assert.ok(bi2);
  assert.match(bi1.outcome, /Tenant-trimmed BI/);
  assert.match(bi1.outcome, /verified only/);
  assert.match(bi1.outcome, /draft 1/);
  assert.match(bi1.outcome, /\$72/);
  assert.match(bi1.outcome, /No Company 2 outcomes are included/);
  assert.doesNotMatch(bi1.outcome, /draft 2/);
  assert.doesNotMatch(bi1.outcome, /\$49/);
  assert.match(bi2.outcome, /Tenant-trimmed BI/);
  assert.match(bi2.outcome, /verified only/);
  assert.match(bi2.outcome, /draft 2/);
  assert.match(bi2.outcome, /\$49/);
  assert.match(bi2.outcome, /No Company 1 outcomes are included/);
  assert.doesNotMatch(bi2.outcome, /draft 1/);
  assert.doesNotMatch(bi2.outcome, /\$72/);
  // One outcome per draft: each BI step counts its draft exactly once.
  assert.match(bi1.outcome, /counted exactly once/);
  assert.match(bi2.outcome, /counted exactly once/);
});

test('no step grants approval without an exact review first', () => {
  const steps = runMultiCompanyDemo();
  for (const tenant of [COMPANY_1, COMPANY_2]) {
    const reviewIndex = steps.findIndex(
      (s) => s.tenant === tenant && s.step === 'exact_review',
    );
    const approvalIndex = steps.findIndex(
      (s) => s.tenant === tenant && s.step === 'approval',
    );
    assert.ok(reviewIndex >= 0, `${tenant} has an exact review`);
    assert.ok(approvalIndex > reviewIndex, `${tenant} approval follows its exact review`);
    const approval = steps[approvalIndex];
    assert.match(approval.outcome, /exact terms above only/);
    assert.match(approval.outcome, /consume-once/);
  }
  // A Reel / Reel entry never grants approval: it supplies no terms.
  const reel = steps.find((s) => s.tenant === COMPANY_1 && s.step === 'reel');
  const reelEntry = steps.find((s) => s.tenant === COMPANY_2 && s.step === 'reel_entry');
  assert.ok(reel);
  assert.ok(reelEntry);
  assert.match(reel.outcome, /supplies no title, price, or terms/);
  assert.match(reelEntry.outcome, /supplies no title, price, or terms/);
});

test('ClutchAgent is the Muse Meta context, not a Shopify seller or service product', () => {
  const steps = runMultiCompanyDemo();
  const company2Outcomes = steps
    .filter((s) => s.tenant === COMPANY_2)
    .map((s) => s.outcome)
    .join(' ');
  assert.match(company2Outcomes, /Muse Meta/);
  assert.match(company2Outcomes, /Meta catalog read-only path/);
  assert.match(company2Outcomes, /not a Shopify seller/);
  assert.match(company2Outcomes, /not a service checkout product/);
  assert.match(company2Outcomes, /no ClutchAgent service price, term, or entitlement is created/);
  // No ClutchAgent service offering appears anywhere in the demo.
  const serialized = JSON.stringify(steps);
  assert.doesNotMatch(serialized, /service access/);
  assert.doesNotMatch(serialized, /nothing shipped/);
});

test('no raw IDs, payment digits, or order numbers appear in the serialized demo output', () => {
  const serialized = JSON.stringify(runMultiCompanyDemo());
  // Raw identifiers from real systems must never appear.
  assert.doesNotMatch(serialized, /gid:\/\//);
  assert.doesNotMatch(serialized, /\.myshopify\.com/);
  assert.doesNotMatch(serialized, /acct_/);
  assert.doesNotMatch(serialized, /sk-/);
  assert.doesNotMatch(serialized, /tok_/);
  // No order number: no "order #" with digits, no synthetic order code.
  assert.doesNotMatch(serialized, /order\s*#\s*\d/i);
  assert.doesNotMatch(serialized, /MS-\d+/);
  assert.doesNotMatch(serialized, /order number \d/i);
  // No payment digits: no "last digits", no card ending, and no
  // digits directly after either permitted payment label.
  assert.doesNotMatch(serialized, /last digits/i);
  assert.doesNotMatch(serialized, /card ending/i);
  assert.doesNotMatch(serialized, /Saved payment \d/);
  assert.doesNotMatch(serialized, /Shop Pay · Saved payment \d/);
  // The permitted labels themselves are present, digit-free.
  assert.ok(serialized.includes('Saved payment'));
  assert.ok(serialized.includes('Shop Pay · Saved payment'));
  // The only dates in the output are the fixed TEST timestamp date.
  const dates = serialized.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  assert.ok(dates.length > 0);
  for (const date of dates) assert.equal(date, '2026-10-27');
});

test('totals are internally consistent across review, approval, status, and drift', () => {
  const steps = runMultiCompanyDemo();
  const by = (tenant: string, step: string) =>
    steps.find((s) => s.tenant === tenant && s.step === step)?.outcome ?? '';
  // Company 1: 58 + 5 + 9 = 72, in both review and approval.
  assert.match(by(COMPANY_1, 'exact_review'), /Item \$58 \+ Tax \$5 \+ Shipping \$9 = Total \$72/);
  assert.match(by(COMPANY_1, 'approval'), /Total \$72/);
  // Company 1 drift: 64 + 5 + 9 = 78, a $6 rise from $72.
  assert.equal(64 + 5 + 9, 78);
  assert.equal(78 - 72, 6);
  assert.match(by(COMPANY_1, 'drift'), /total changed from \$72 to \$78/);
  // Company 2: 40 + 3 + 6 = 49, in both review and approval.
  assert.match(by(COMPANY_2, 'exact_review'), /Item \$40 \+ Tax \$3 \+ Shipping \$6 = Total \$49/);
  assert.match(by(COMPANY_2, 'approval'), /Total \$49/);
});

test('the demo is pure and deterministic: repeated runs are identical', () => {
  assert.deepEqual(runMultiCompanyDemo(), runMultiCompanyDemo());
  // Every step carries exactly the specified shape: tenant, step, outcome.
  for (const step of runMultiCompanyDemo()) {
    assert.deepEqual(Object.keys(step).sort(), ['outcome', 'step', 'tenant']);
    assert.equal(typeof step.outcome, 'string');
    assert.ok(step.outcome.length > 0);
  }
});
