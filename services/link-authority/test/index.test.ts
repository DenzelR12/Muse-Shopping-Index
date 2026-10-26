import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryReplayStore} from '../../../packages/zero-trust/src/index.js';
import {issueSignedLink,verifyAndConsumeSignedLink} from '../src/index.js';

test('signed links are single-use after verification',async()=>{
  const now=Math.floor(Date.now()/1000);
  const url=issueSignedLink('https://example.test/action',{purpose:'approve',eventId:'e1',capability:'view',exp:now+600,rev:1},'secret');
  const token=new URL(url).searchParams.get('t');
  const replay=new InMemoryReplayStore();
  const first=await verifyAndConsumeSignedLink(token,'secret',1,replay);
  const second=await verifyAndConsumeSignedLink(token,'secret',1,replay);
  assert.equal(first.ok,true);
  assert.equal(second.reason,'replayed');
});
