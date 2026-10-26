import test from 'node:test';
import assert from 'node:assert/strict';
import {deterministicIntent,interpretWithMuse,museConfigurationStatus} from '../src/muse.js';

const clear=()=>{
 delete process.env.META_MODEL_API_KEY;
 delete process.env.META_MODEL_API_BASE_URL;
 delete process.env.META_MUSE_MODEL;
 delete process.env.META_MUSE_TIMEOUT_MS;
 delete process.env.META_MUSE_RETRIES;
};

test.afterEach(clear);

test('deterministic fallback extracts intent without credentials',()=>{
 clear();
 const intent=deterministicIntent('Find a carry-on under $350 for my trip');
 assert.equal(intent.maxPrice,350);
 assert.deepEqual(intent.preferredKinds,['TRAVEL']);
});

test('Muse mode parses OpenAI-compatible response when configured',async()=>{
 process.env.META_MODEL_API_KEY='test';
 process.env.META_MODEL_API_BASE_URL='https://meta.invalid/v1';
 process.env.META_MUSE_MODEL='muse-test';
 const fake=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"query":"carry-on","maxPrice":350,"currency":"USD","preferredKinds":["PRODUCT"]}'}}]}),{status:200,headers:{'content-type':'application/json'}});
 const out=await interpretWithMuse('carry-on',fake as typeof fetch);
 assert.equal(out.mode,'MUSE');
 assert.equal(out.intent.maxPrice,350);
 assert.equal(out.model,'muse-test');
});

test('Muse failure falls back safely instead of failing the shopping request',async()=>{
 process.env.META_MODEL_API_KEY='test';
 process.env.META_MODEL_API_BASE_URL='https://meta.invalid/v1';
 process.env.META_MUSE_MODEL='muse-test';
 process.env.META_MUSE_RETRIES='0';
 const fake=async()=>new Response('nope',{status:503});
 const out=await interpretWithMuse('carry-on under $300',fake as typeof fetch);
 assert.equal(out.mode,'DETERMINISTIC');
 assert.equal(out.intent.maxPrice,300);
 assert.equal(out.fallbackReason,'muse_request_failed:503');
});

test('configuration status never exposes the API key',()=>{
 process.env.META_MODEL_API_KEY='secret';
 process.env.META_MODEL_API_BASE_URL='https://meta.invalid/v1';
 process.env.META_MUSE_MODEL='muse-test';
 const status=museConfigurationStatus();
 assert.equal(status.configured,true);
 assert.equal(Object.values(status).includes('secret'),false);
});
