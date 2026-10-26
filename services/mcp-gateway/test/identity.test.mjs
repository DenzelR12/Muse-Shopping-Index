import test from 'node:test';
import assert from 'node:assert/strict';
import {bearerToken} from '../dist/business-identity.js';

test('bearer token parser rejects non-bearer input',()=>{
  assert.equal(bearerToken(undefined),null);
  assert.equal(bearerToken('Basic abc'),null);
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
});
