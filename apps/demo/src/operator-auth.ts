import {createHash,timingSafeEqual} from 'node:crypto';

export interface OperatorConsoleAccess {
  ok:boolean;
  status:401|404|503;
  error:'unauthorized'|'not_found'|'operator_console_auth_not_configured';
  challenge:boolean;
}

export function isOperatorConsolePath(url:string|undefined){
  const path=String(url??'').split('?')[0];
  return path==='/provider-console.html'
    || path==='/provider-console.js'
    || path==='/provider-console.css'
    || path==='/provider-console'
    || path.startsWith('/operator/');
}

function safeHexEqual(left:string,right:string){
  if(!/^[a-f0-9]{64}$/i.test(left)||!/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));
}

export function authorizeOperatorConsole(
  authorizationHeader:string|undefined,
  env:NodeJS.ProcessEnv=process.env
):OperatorConsoleAccess|{ok:true}{
  if(env.OPERATOR_CONSOLE_ENABLED!=='true'){
    return {ok:false,status:404,error:'not_found',challenge:false};
  }
  const configuredHash=String(env.OPERATOR_CONSOLE_PASSWORD_SHA256??'').trim().toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(configuredHash)){
    return {ok:false,status:503,error:'operator_console_auth_not_configured',challenge:false};
  }
  if(!authorizationHeader?.startsWith('Basic ')){
    return {ok:false,status:401,error:'unauthorized',challenge:true};
  }
  let decoded='';
  try{decoded=Buffer.from(authorizationHeader.slice(6),'base64').toString('utf8');}
  catch{return {ok:false,status:401,error:'unauthorized',challenge:true};}
  const separator=decoded.indexOf(':');
  if(separator<0) return {ok:false,status:401,error:'unauthorized',challenge:true};
  const username=decoded.slice(0,separator);
  const password=decoded.slice(separator+1);
  const expectedUser=String(env.OPERATOR_CONSOLE_USERNAME??'operator');
  const passwordHash=createHash('sha256').update(password,'utf8').digest('hex');
  if(username!==expectedUser||!safeHexEqual(passwordHash,configuredHash)){
    return {ok:false,status:401,error:'unauthorized',challenge:true};
  }
  return {ok:true};
}
