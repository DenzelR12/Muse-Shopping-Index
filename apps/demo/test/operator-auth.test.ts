import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authorizeOperatorConsole,isOperatorConsolePath} from '../dist/operator-auth.js';

const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const basic=(username:string,password:string)=>'Basic '+Buffer.from(username+':'+password,'utf8').toString('base64');

test('operator console paths include assets and privileged API routes',()=>{
  assert.equal(isOperatorConsolePath('/provider-console.html'),true);
  assert.equal(isOperatorConsolePath('/provider-console.js?v=1'),true);
  assert.equal(isOperatorConsolePath('/provider-console.css'),true);
  assert.equal(isOperatorConsolePath('/operator/status'),true);
  assert.equal(isOperatorConsolePath('/operator/runtime/ebay/seller/revoke'),true);
  assert.equal(isOperatorConsolePath('/api/search'),false);
});

test('operator console is hidden when not explicitly enabled',()=>{
  assert.deepEqual(authorizeOperatorConsole(undefined,{}),{
    ok:false,status:404,error:'not_found',challenge:false
  });
});

test('operator console fails closed when enabled without password digest',()=>{
  assert.deepEqual(authorizeOperatorConsole(undefined,{OPERATOR_CONSOLE_ENABLED:'true'}),{
    ok:false,status:503,error:'operator_console_auth_not_configured',challenge:false
  });
});

test('operator console rejects missing and invalid credentials',()=>{
  const env={
    OPERATOR_CONSOLE_ENABLED:'true',
    OPERATOR_CONSOLE_USERNAME:'operator',
    OPERATOR_CONSOLE_PASSWORD_SHA256:digest('correct horse battery staple')
  };
  assert.equal(authorizeOperatorConsole(undefined,env).ok,false);
  assert.equal(authorizeOperatorConsole(basic('operator','wrong'),env).ok,false);
  assert.equal(authorizeOperatorConsole(basic('other','correct horse battery staple'),env).ok,false);
});

test('operator console accepts valid credentials without exposing the configured digest',()=>{
  const env={
    OPERATOR_CONSOLE_ENABLED:'true',
    OPERATOR_CONSOLE_USERNAME:'operator',
    OPERATOR_CONSOLE_PASSWORD_SHA256:digest('correct horse battery staple')
  };
  assert.deepEqual(
    authorizeOperatorConsole(basic('operator','correct horse battery staple'),env),
    {ok:true}
  );
});
