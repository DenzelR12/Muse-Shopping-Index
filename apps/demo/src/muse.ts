export interface MuseIntent {
  query:string;
  maxPrice?:number;
  currency?:string;
  destinationOrRegion?:string;
  neededBy?:string;
  interests?:string[];
  preferredKinds?:Array<'PRODUCT'|'TRAVEL'|'TICKET'|'SERVICE'|'RESERVATION'|'DIGITAL'>;
}

export interface MuseInterpretation {
  intent:MuseIntent;
  mode:'MUSE'|'DETERMINISTIC';
  fallbackReason?:string;
  model?:string;
  latencyMs?:number;
}

const jsonObject=(text:string)=>{
  const trimmed=text.trim();
  const fenced=trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  return JSON.parse(fenced??trimmed) as MuseIntent;
};

export function deterministicIntent(message:string):MuseIntent{
  const lower=message.toLowerCase();
  const numbers=[...message.matchAll(/\$?([0-9][0-9,]*(?:\.\d{1,2})?)/g)]
    .map(match=>Number(match[1]?.replaceAll(',','')))
    .filter(Number.isFinite);
  const maxPrice=/under|up to|max|budget|less than/.test(lower)?numbers.at(-1):undefined;
  const preferredKinds:MuseIntent['preferredKinds']=[];
  if(/hotel|flight|trip|travel|park|vacation/.test(lower)) preferredKinds.push('TRAVEL');
  if(/ticket|concert|game|event/.test(lower)) preferredKinds.push('TICKET');
  if(/reserve|reservation|restaurant/.test(lower)) preferredKinds.push('RESERVATION');
  if(!preferredKinds.length) preferredKinds.push('PRODUCT');
  const destination=lower.match(/\b(?:in|near|to)\s+([a-z][a-z\s]{2,30})(?:,| under| for| with| by|$)/i)?.[1]?.trim();
  return {query:message.trim(),maxPrice,currency:'USD',destinationOrRegion:destination,preferredKinds};
}

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function interpretWithMuse(message:string,fetchImpl:typeof fetch=fetch):Promise<MuseInterpretation>{
  const apiKey=process.env.META_MODEL_API_KEY;
  const baseUrl=process.env.META_MODEL_API_BASE_URL;
  const model=process.env.META_MUSE_MODEL;
  if(!apiKey||!baseUrl||!model) {
    return {intent:deterministicIntent(message),mode:'DETERMINISTIC',fallbackReason:'muse_not_configured'};
  }

  const retries=Math.max(0,Math.min(Number(process.env.META_MUSE_RETRIES??2),3));
  const timeoutMs=Math.max(500,Math.min(Number(process.env.META_MUSE_TIMEOUT_MS??8000),30000));
  const started=Date.now();
  let lastReason='muse_request_failed';

  for(let attempt=0;attempt<=retries;attempt++){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetchImpl(`${baseUrl.replace(/\/$/,'')}/chat/completions`,{
        method:'POST',
        signal:controller.signal,
        headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},
        body:JSON.stringify({
          model,
          temperature:0,
          messages:[
            {role:'system',content:'Extract shopping intent. Return only JSON with query, optional maxPrice, currency, destinationOrRegion, neededBy, interests, preferredKinds. preferredKinds values: PRODUCT, TRAVEL, TICKET, SERVICE, RESERVATION, DIGITAL. Never invent price or destination.'},
            {role:'user',content:message}
          ]
        })
      });

      if(!response.ok){
        lastReason=`muse_request_failed:${response.status}`;
        if(response.status<500&&response.status!==429) break;
        if(attempt<retries) await sleep(Math.min(250*(2**attempt),1000));
        continue;
      }

      const payload=await response.json() as {choices?:Array<{message?:{content?:string}}>} ;
      const text=payload.choices?.[0]?.message?.content;
      if(!text){lastReason='muse_empty_response';break;}
      try{
        return {intent:jsonObject(text),mode:'MUSE',model,latencyMs:Date.now()-started};
      }catch{
        lastReason='muse_invalid_json';
        break;
      }
    }catch(error){
      lastReason=error instanceof Error&&error.name==='AbortError'?'muse_timeout':'muse_network_error';
      if(attempt<retries) await sleep(Math.min(250*(2**attempt),1000));
    }finally{
      clearTimeout(timeout);
    }
  }

  return {
    intent:deterministicIntent(message),
    mode:'DETERMINISTIC',
    fallbackReason:lastReason,
    model,
    latencyMs:Date.now()-started
  };
}

export function museConfigurationStatus(){
  const configured=Boolean(process.env.META_MODEL_API_KEY&&process.env.META_MODEL_API_BASE_URL&&process.env.META_MUSE_MODEL);
  return {
    configured,
    model:process.env.META_MUSE_MODEL??null,
    baseUrlConfigured:Boolean(process.env.META_MODEL_API_BASE_URL),
    timeoutMs:Number(process.env.META_MUSE_TIMEOUT_MS??8000),
    retries:Number(process.env.META_MUSE_RETRIES??2)
  };
}
