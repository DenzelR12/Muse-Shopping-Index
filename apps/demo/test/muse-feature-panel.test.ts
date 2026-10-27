import test from 'node:test';
import assert from 'node:assert/strict';
import {
  announceMuseFeatureStatus,
  mountMuseFeaturePanel,
  museFeatureDraftExpiryWarning,
  renderMuseFeatureReapprovalDiffText,
  renderMuseFeatureReviewText,
  type MuseFeaturePanelState,
  type MuseFeatureReviewSheet,
} from '../src/muse-feature-panel.js';

// ---------------------------------------------------------------------------
// Minimal in-repo DOM stub. No browser, no jsdom: jsdom is not a
// repo dependency, and no new production dependency is added for
// this panel. The stub implements only the standard DOM surface
// the panel uses (createElement, createTextNode, appendChild,
// removeChild, firstChild, setAttribute, textContent,
// addEventListener, focus, disabled, checked). It is a test
// double, not a browser: it does not parse HTML, lay out, or
// run a real event loop, and the panel never assigns innerHTML,
// so nothing here can hide an escaping bug — text is set with
// textContent in both the panel and the stub.
// ---------------------------------------------------------------------------

type Listener = () => void;

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  text = '';
  disabled = false;
  checked = false;
  ownerDocument: FakeDocument;
  constructor(tag: string, doc: FakeDocument) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
  }
  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((node) => node !== child);
    child.parent = null;
    return child;
  }
  setAttribute(key: string, value: string): void {
    this.attributes.set(key, String(value));
  }
  getAttribute(key: string): string | null {
    return this.attributes.get(key) ?? null;
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value: string | null) {
    this.children = [];
    this.text = value ?? '';
  }
  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  click(): void {
    for (const fn of this.listeners.get('click') ?? []) fn();
  }
  setChecked(value: boolean): void {
    this.checked = value;
    for (const fn of this.listeners.get('change') ?? []) fn();
  }
  focus(): void {
    this.ownerDocument.activeElement = this;
  }
  private matches(selector: string): boolean {
    // Simple selectors only: tag, .class, tag.class, [attr],
    // [attr="value"], tag[attr], tag[attr="value"].
    const bracket = selector.indexOf('[');
    let head = selector;
    let attr: string | null = null;
    let attrValue: string | null = null;
    if (bracket >= 0) {
      head = selector.slice(0, bracket);
      const inside = selector.slice(bracket + 1, selector.length - 1);
      const equals = inside.indexOf('=');
      if (equals >= 0) {
        attr = inside.slice(0, equals);
        attrValue = inside.slice(equals + 1).replace(/^"|"$/g, '');
      } else {
        attr = inside;
      }
    }
    if (head) {
      if (head.startsWith('.')) {
        const wanted = head.slice(1);
        if (!(this.attributes.get('class') ?? '').split(/\s+/).includes(wanted)) return false;
      } else {
        const dot = head.indexOf('.');
        if (dot >= 0) {
          if (this.tagName !== head.slice(0, dot).toUpperCase()) return false;
          const wanted = head.slice(dot + 1);
          if (!(this.attributes.get('class') ?? '').split(/\s+/).includes(wanted)) return false;
        } else if (this.tagName !== head.toUpperCase()) {
          return false;
        }
      }
    }
    if (attr) {
      const actual = this.attributes.get(attr);
      if (actual === undefined) return false;
      if (attrValue !== null && actual !== attrValue) return false;
    }
    return true;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
  createTextNode(text: string): FakeElement {
    const node = new FakeElement('#text', this);
    node.text = text;
    return node;
  }
}

function container(): FakeElement {
  return new FakeElement('div', new FakeDocument());
}

const sheet: MuseFeatureReviewSheet = {
  connectionId: 'conn-1',
  draftId: 'draft-1',
  seller: 'Demo Seller',
  items: [{label: 'Assassin’s Creed Black Flag', quantity: 1, unitPrice: '54.00'}],
  shipTo: 'Denzel R, 123 Main St, Atlanta, GA, US 30303',
  shipping: 'Free shipping · 0.00 USD',
  payment: 'Saved payment',
  terms: 'Returns within 30 days of delivery.',
  paymentTiming: 'Charged when you approve this exact transaction.',
  estimatedArrival: 'October 28, 2026',
  subtotal: '54.00',
  tax: '4.32',
  total: '58.32',
  currency: 'USD',
};

function reviewState(overrides: Partial<MuseFeaturePanelState> = {}): MuseFeaturePanelState {
  return {view: 'review', sheet, ...overrides};
}

test('Muse feature panel renders the exact review as real DOM in reading order with an amount-labelled approval', () => {
  const root = container();
  mountMuseFeaturePanel(root as unknown as Element, reviewState(), {});
  const paragraphs = root.querySelectorAll('p').map((node) => node.textContent);
  const order = [
    'Seller: Demo Seller',
    'Item: 1 × Assassin’s Creed Black Flag',
    'Ship to: Denzel R',
    'Shipping: Free shipping',
    'Tax: 4.32 USD',
    'Total: 54.00 USD + 0.00 USD + 4.32 USD = 58.32 USD',
    'Payment timing:',
    'Refund and cancellation terms: Returns within 30 days',
    'Estimated arrival: October 28, 2026',
    'Payment: Saved payment',
    'One reminder only.',
  ];
  let last = -1;
  for (const fragment of order) {
    const at = paragraphs.findIndex((text) => text.includes(fragment));
    assert.ok(at > last, `expected ${fragment} after position ${last}, got ${at} in ${JSON.stringify(paragraphs)}`);
    last = at;
  }
  const buttons = root.querySelectorAll('[data-muse-review-approve]');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].tagName, 'BUTTON');
  assert.equal(buttons[0].textContent, 'Approve $58.32 USD');
  assert.doesNotMatch(root.textContent, /myshopify\.com|acct-consumer-1|gid:\/\/shopify/);
  // The panel sets text, never markup, from seller data: a
  // seller name containing markup characters is shown as text.
  const hostile = container();
  mountMuseFeaturePanel(hostile as unknown as Element, reviewState({sheet: {...sheet, seller: '<b>Not bold</b>'}}), {});
  assert.match(hostile.textContent, /<b>Not bold<\/b>/);
  assert.equal(hostile.querySelectorAll('b').length, 0);
});

test('Muse feature panel refuses a raw provider ID instead of rendering it', () => {
  const root = container();
  assert.throws(
    () => mountMuseFeaturePanel(root as unknown as Element, reviewState({sheet: {...sheet, seller: 'sams-club.myshopify.com'}}), {}),
    /muse_feature_panel_unsafe_display/,
  );
  const lines = renderMuseFeatureReviewText({...sheet, payment: 'Shop Pay · Saved payment'});
  assert.match(lines.join('\n'), /Payment: Shop Pay · Saved payment/);
});

test('Muse feature panel reapproval diff strikes the old total through AND describes it in words, with focus on the banner', () => {
  const doc = new FakeDocument();
  const root = new FakeElement('div', doc);
  const newSheet = {...sheet, total: '285', shipping: 'Standard · 16.00 USD', tax: '20'};
  const panel = mountMuseFeaturePanel(root as unknown as Element, reviewState({
    view: 'reapproval',
    sheet: newSheet,
    previousReview: {total: '277', currency: 'USD', shippingAmount: '8', taxAmount: '20'},
  }), {});
  const banner = root.querySelector('.muse-feature-reapproval');
  assert.ok(banner);
  assert.match(banner!.textContent, /It was \$277 USD, now it is \$285 USD/);
  assert.match(banner!.textContent, /Shipping changed from \$8 USD to \$16\.00 USD/);
  assert.match(banner!.textContent, /old approval no longer applies/);
  const struck = banner!.querySelectorAll('s');
  assert.equal(struck.length, 1);
  assert.equal(struck[0].textContent, '$277 USD');
  const approve = root.querySelector('[data-muse-review-approve]');
  assert.equal(approve?.textContent, 'Approve $285 USD');
  // Focus moved to the banner when it appeared.
  assert.equal(doc.activeElement, banner);
  // Announcement region is assertive for reapproval.
  const live = root.querySelector('[role="status"]');
  assert.equal(live?.getAttribute('aria-live'), 'assertive');
  assert.match(live?.textContent ?? '', /old approval no longer applies/);
  panel.unmount();
  assert.equal(root.children.length, 0);
  assert.deepEqual(renderMuseFeatureReapprovalDiffText({oldReview: {total: '277', currency: 'USD'}, newReview: {total: '277', currency: 'USD'}}), []);
});

test('Muse feature panel status timeline states every stage in words, never colour alone, and never offers a fresh Buy', () => {
  const root = container();
  const panel = mountMuseFeaturePanel(root as unknown as Element, {view: 'status', sheet: null, executionState: 'ORDER_CREATED'}, {});
  const items = root.querySelectorAll('li').map((node) => node.textContent);
  assert.deepEqual(items, ['Approved — done', 'Payment verified — done', 'Shipped — not yet', 'Delivered — not yet']);
  assert.match(root.textContent, /Tracking is not available yet/);
  assert.equal(root.querySelectorAll('[data-muse-review-approve]').length, 0);
  assert.equal(root.querySelectorAll('button').length, 0);
  panel.update({view: 'status', sheet: null, executionState: 'shipped'});
  assert.deepEqual(root.querySelectorAll('li').map((node) => node.textContent), ['Approved — done', 'Payment verified — done', 'Shipped — in progress', 'Delivered — not yet']);
  panel.update({view: 'status', sheet: null, executionState: 'RECONCILE_REQUIRED'});
  assert.match(root.textContent, /No second charge will be made/);
  assert.equal(root.querySelector('[role="status"]')?.getAttribute('aria-live'), 'assertive');
  assert.equal(root.querySelectorAll('[data-muse-review-approve]').length, 0);
  // Announced text for each state, in words.
  assert.match(announceMuseFeatureStatus('approved'), /approved/);
  assert.match(announceMuseFeatureStatus('payment_verified'), /Payment is verified/);
  assert.match(announceMuseFeatureStatus('shipped'), /has shipped/);
  assert.match(announceMuseFeatureStatus('delivered'), /has been delivered/);
  assert.match(announceMuseFeatureStatus('ORDER_CREATED'), /Tracking is not available yet/);
  assert.doesNotMatch(announceMuseFeatureStatus('ORDER_CREATED'), /2026|carrier|tracking number/i);
});

test('Muse feature panel pre-expiry warning shows only inside the final 2 minutes, factually, and takes focus when it appears', () => {
  const doc = new FakeDocument();
  const root = new FakeElement('div', doc);
  const panel = mountMuseFeaturePanel(root as unknown as Element, reviewState({
    expiry: {expiresAt: '2026-10-27T12:09:00.000Z', total: '58.32', currency: 'USD', now: '2026-10-27T12:00:00.000Z'},
  }), {});
  assert.equal(root.querySelectorAll('.muse-feature-expiry-warning').length, 0);
  panel.update(reviewState({
    expiry: {expiresAt: '2026-10-27T12:01:30.000Z', total: '58.32', currency: 'USD', now: '2026-10-27T12:00:00.000Z'},
  }));
  const warnings = root.querySelectorAll('.muse-feature-expiry-warning');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].textContent, /expires at 2026-10-27T12:01:30\.000Z/);
  assert.match(warnings[0].textContent, /\$58\.32 USD/);
  assert.match(warnings[0].textContent, /review the updated total and approve again/);
  assert.match(warnings[0].textContent, /Nothing will be charged automatically/);
  assert.doesNotMatch(warnings[0].textContent, /hurry|countdown|last chance/i);
  assert.equal(doc.activeElement, warnings[0]);
  // Expired: no warning (the draft is dead, not "near expiry").
  panel.update(reviewState({
    expiry: {expiresAt: '2026-10-27T11:00:00.000Z', total: '58.32', currency: 'USD', now: '2026-10-27T12:00:00.000Z'},
  }));
  assert.equal(root.querySelectorAll('.muse-feature-expiry-warning').length, 0);
  assert.equal(museFeatureDraftExpiryWarning({draftId: 'draft-1', expiresAt: '2026-10-27T12:09:00.000Z', total: '58.32', currency: 'USD', now: '2026-10-27T12:00:00.000Z'}), null);
});

test('Muse feature panel resume prompt shows "Your review is waiting", revalidates via the handler, and only then shows the review', () => {
  const doc = new FakeDocument();
  const root = new FakeElement('div', doc);
  let resumes = 0;
  const panel = mountMuseFeaturePanel(root as unknown as Element, {view: 'resume', sheet: null}, {
    onResume: () => { resumes++; },
  });
  assert.match(root.textContent, /Your review is waiting in Muse/);
  assert.equal(root.querySelectorAll('[data-muse-review-approve]').length, 0);
  assert.equal(root.querySelectorAll('[data-muse-resume]').length, 1);
  assert.equal(doc.activeElement?.getAttribute('class'), 'muse-feature-resume');
  root.querySelector('[data-muse-resume]')!.click();
  assert.equal(resumes, 1);
  // The host revalidates, then updates: only now does the review appear.
  panel.update(reviewState());
  assert.equal(root.querySelectorAll('[data-muse-review-approve]').length, 1);
  assert.equal(resumes, 1);
});

test('Muse feature panel reminder opt-in defaults OFF, calls the host handler only on explicit action, and offers one-tap dismiss', () => {
  const root = container();
  let optIns = 0;
  let optOuts = 0;
  const panel = mountMuseFeaturePanel(root as unknown as Element, reviewState(), {
    onReminderOptIn: () => { optIns++; },
    onReminderOptOut: () => { optOuts++; },
  });
  const checkbox = root.querySelector('[data-muse-reminder-opt-in]')!;
  assert.equal(checkbox.checked, false);
  assert.equal(optIns, 0);
  // The reminder section itself carries no price (the review
  // totals elsewhere in the panel are the exact review, not
  // a reminder pitch, so the check is scoped to the section).
  const reminderSection = root.querySelector('.muse-feature-reminder')!;
  assert.match(reminderSection.textContent, /One reminder only\. It will not include a price\./);
  assert.doesNotMatch(reminderSection.textContent, /\$\d/);
  checkbox.setChecked(true);
  assert.equal(optIns, 1);
  assert.equal(optOuts, 0);
  panel.update(reviewState({reminder: 'opted_in'}));
  const dismiss = root.querySelector('[data-muse-reminder-dismiss]');
  assert.ok(dismiss);
  dismiss!.click();
  assert.equal(optOuts, 1);
  // No reminder section in a status view, and no opt-in from viewing.
  panel.update({view: 'status', sheet: null, executionState: 'ORDER_CREATED'});
  assert.equal(root.querySelectorAll('[data-muse-reminder-opt-in]').length, 0);
  assert.equal(optIns, 1);
});

test('Muse feature panel buy guard disables on click, ignores a second in-flight click, and re-enables on failure', async () => {
  const root = container();
  let approvals = 0;
  let reject: (() => void) | null = null;
  const gate = new Promise<void>((_resolve, rejectFn) => { reject = () => rejectFn(new Error('provider declined')); });
  mountMuseFeaturePanel(root as unknown as Element, reviewState(), {
    onApprove: () => { approvals++; return gate; },
  });
  const button = root.querySelector('[data-muse-review-approve]')!;
  button.click();
  assert.equal(approvals, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Processing…');
  button.click();
  assert.equal(approvals, 1);
  reject!();
  await gate.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Approve $58.32 USD');
  assert.equal(approvals, 1);
});

test('Muse feature panel re-render never duplicates nodes, listeners, or the announcement region', () => {
  const root = container();
  let approvals = 0;
  const panel = mountMuseFeaturePanel(root as unknown as Element, reviewState(), {
    onApprove: () => { approvals++; },
  });
  panel.update(reviewState());
  panel.update(reviewState());
  assert.equal(root.querySelectorAll('.muse-feature-panel').length, 1);
  assert.equal(root.querySelectorAll('[role="status"]').length, 1);
  assert.equal(root.querySelectorAll('[data-muse-review-approve]').length, 1);
  assert.equal(root.querySelectorAll('[data-muse-reminder-opt-in]').length, 1);
  root.querySelector('[data-muse-review-approve]')!.click();
  assert.equal(approvals, 1);
  // Moving to a status view removes the approval button entirely: never a fresh Buy after approval.
  panel.update({view: 'status', sheet: null, executionState: 'processing'});
  assert.equal(root.querySelectorAll('[data-muse-review-approve]').length, 0);
  assert.equal(root.querySelectorAll('.muse-feature-panel').length, 1);
  // Polite for ordinary status, asserted in the reapproval test for warnings.
  assert.equal(root.querySelector('[role="status"]')?.getAttribute('aria-live'), 'polite');
});
