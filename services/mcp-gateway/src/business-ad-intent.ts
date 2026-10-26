import {createHmac,timingSafeEqual} from 'node:crypto';

export interface CommerceIntentSignal {
  signalId:string;
  companyId:string;
  source:'AD_CLICK'|'PRODUCT_VIEW'|'CREATOR_LINK'|'DIRECT'|'CONNECTED_APP';
  campaignId?:string;
  creativeId?:string;
  productRefs?:string[];
  intentTags:string[];
  occurredAt:string;
  expiresAt:string;
  consent:'USER_INITIATED';
}

export interface SignedIntentSignal {
  payload:string;
  signature:string;
}

const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');

export function signIntentSignal(signal:CommerceIntentSignal,secret:string):SignedIntentSignal{
  if(!secret) throw new Error('intent_signing_secret_required');
  const payload=encode(signal);
  const signature=createHmac('sha256',secret).update(payload).digest('base64url');
  return {payload,signature};
}

export function verifyIntentSignal(
  signed:SignedIntentSignal,
  secret:string,
  now=new Date()
):{ok:true;signal:CommerceIntentSignal}|{ok:false;reason:string}{
  if(!secret||!signed.payload||!signed.signature) return {ok:false,reason:'missing_intent_signature'};
  const expected=createHmac('sha256',secret).update(signed.payload).digest('base64url');
  const left=Buffer.from(expected);
  const right=Buffer.from(signed.signature);
  if(left.length!==right.length||!timingSafeEqual(left,right)) return {ok:false,reason:'invalid_intent_signature'};
  let signal:CommerceIntentSignal;
  try{signal=JSON.parse(Buffer.from(signed.payload,'base64url').toString('utf8')) as CommerceIntentSignal;}
  catch{return {ok:false,reason:'invalid_intent_payload'};}
  if(signal.consent!=='USER_INITIATED') return {ok:false,reason:'intent_not_user_initiated'};
  if(new Date(signal.expiresAt).getTime()<=now.getTime()) return {ok:false,reason:'intent_expired'};
  if(new Date(signal.occurredAt).getTime()>now.getTime()+60_000) return {ok:false,reason:'intent_timestamp_in_future'};
  return {ok:true,signal};
}

export function intentSearchQuery(signal:CommerceIntentSignal,userMessage:string){
  const parts=[
    userMessage.trim(),
    ...(signal.productRefs??[]),
    ...signal.intentTags
  ].filter(Boolean);
  return parts.join(' ').slice(0,1000);
}
