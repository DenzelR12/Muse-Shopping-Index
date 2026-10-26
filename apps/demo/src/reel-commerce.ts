import {randomUUID} from 'node:crypto';
import {searchShoppingIndex,type IndexedResult,type ShoppingOffer} from '@gift-signal/shopping-index';
import {interpretWithMuse,type MuseInterpretation} from './muse.js';

export interface ReelCommerceSource {
  platform:'meta';
  reelId:string;
  reelUrl?:string;
  creatorId?:string;
  caption?:string;
  productHints?:string[];
}

export interface ReelCommerceIntent {
  intentId:string;
  source:ReelCommerceSource;
  message:string;
  interpretation:MuseInterpretation;
  results:IndexedResult[];
  next:'MUSE_REVIEW';
  merchantHandoffRequired:false;
}

export function reelCommerceMessage(source:ReelCommerceSource){
  const parts=[
    source.caption?.trim(),
    ...(source.productHints??[]).map(value=>value.trim()).filter(Boolean)
  ].filter(Boolean);
  if(!source.reelId.trim()) throw new Error('reel_id_required');
  if(!parts.length) throw new Error('reel_product_context_required');
  return parts.join(' · ');
}

export async function createReelCommerceIntent(args:{
  source:ReelCommerceSource;
  offers:ShoppingOffer[];
  now?:Date;
  fetchImpl?:typeof fetch;
}):Promise<ReelCommerceIntent>{
  const message=reelCommerceMessage(args.source);
  const interpreted=await interpretWithMuse(message,args.fetchImpl);
  const interpretation:MuseInterpretation={
    ...interpreted,
    intent:{...interpreted.intent,preferredKinds:['PRODUCT']}
  };
  const results=searchShoppingIndex(interpretation.intent,args.offers,5,args.now??new Date());
  return {
    intentId:randomUUID(),
    source:{
      platform:'meta',
      reelId:args.source.reelId,
      ...(args.source.reelUrl?{reelUrl:args.source.reelUrl}:{}),
      ...(args.source.creatorId?{creatorId:args.source.creatorId}:{}),
      ...(args.source.caption?{caption:args.source.caption}:{}),
      ...(args.source.productHints?.length?{productHints:[...args.source.productHints]}:{})
    },
    message,
    interpretation,
    results,
    next:'MUSE_REVIEW',
    merchantHandoffRequired:false
  };
}
