import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresRateLimiter} from '../src/rate-limit.js';

class FakePool {
  count=0;
  async query(sql){
    if(sql.startsWith('CREATE TABLE')||sql.startsWith('DELETE')) return {rows:[],rowCount:0};
    this.count++;
    return {rows:[{count:this.count}],rowCount:1};
  }
}

test('shared limiter permits within limit and rejects excess',async()=>{
  const limiter=new PostgresRateLimiter(new FakePool(),2,60);
  assert.equal((await limiter.check('client',new Date('2026-10-24T16:00:01Z'))).allowed,true);
  assert.equal((await limiter.check('client',new Date('2026-10-24T16:00:02Z'))).allowed,true);
  assert.equal((await limiter.check('client',new Date('2026-10-24T16:00:03Z'))).allowed,false);
});
