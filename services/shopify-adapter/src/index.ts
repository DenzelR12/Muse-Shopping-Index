import type { ProductCandidate, ProductImage } from '@gift-signal/schemas';

export interface ShopifyVariantSnapshot {
  id:string;
  sku?:string;
  title?:string;
  price:number;
  currency:string;
  inventoryQuantity:number;
}

export interface ShopifyProductSnapshot {
  id:string;
  title:string;
  status:'ACTIVE'|'DRAFT'|'ARCHIVED';
  vendor?:string;
  description?:string;
  images?:ProductImage[];
  includedItems?:string[];
  attributes?:Record<string,string>;
  sourceUpdatedAt?:string;
  productType?:string;
  productCategory?:string;
  collectionHandles?:string[];
  tags:string[];
  variants:ShopifyVariantSnapshot[];
  semanticIntents?:string[];
  useCases?:string[];
  recipientFit?:string[];
  occasionFit?:string[];
  bundleRoles?:string[];
  semanticSummary?:string;
  deliveryConfidence?:number;
  semanticCompleteness?:number;
}

export interface ShopifyAdapterConfig {
  signalVerifiedCollectionHandle?: string;
}

export const DEFAULT_SIGNAL_VERIFIED_COLLECTION_HANDLE='signal-verified';

export function toProductCandidate(product:ShopifyProductSnapshot,config:ShopifyAdapterConfig={}):ProductCandidate|null {
  const sellable=product.variants.filter(v=>v.inventoryQuantity>0);
  if(product.status!=='ACTIVE'||sellable.length===0) return null;
  const lowest=sellable.reduce((a,b)=>a.price<=b.price?a:b);
  return {
    productId:product.id,
    variantId:lowest.id,
    variantTitle:lowest.title,
    sku:lowest.sku,
    brand:product.vendor,
    description:product.description,
    images:(product.images??[]).filter(image=>{
      try{return new URL(image.url).protocol==='https:' && (!image.variantId || image.variantId===lowest.id);}catch{return false;}
    }),
    includedItems:product.includedItems,
    attributes:product.attributes,
    sourceUpdatedAt:product.sourceUpdatedAt,
    productCategory:product.productCategory,
    productType:product.productType,
    evidenceVerified:Boolean(product.sourceUpdatedAt && product.productCategory && product.productType),
    signalVerified:(product.collectionHandles??[]).includes(config.signalVerifiedCollectionHandle??DEFAULT_SIGNAL_VERIFIED_COLLECTION_HANDLE),
    title:product.title,
    price:lowest.price,
    currency:lowest.currency,
    inStock:true,
    recipientFit:product.recipientFit??[],
    occasionFit:product.occasionFit??[],
    semanticIntents:product.semanticIntents??[],
    useCases:product.useCases??[],
    bundleRoles:product.bundleRoles??[],
    semanticSummary:product.semanticSummary,
    deliveryConfidence:product.deliveryConfidence,
    semanticCompleteness:product.semanticCompleteness
  };
}

export function shouldEnterRanking(product:ProductCandidate){
  return product.inStock && product.evidenceVerified===true && product.signalVerified===true && Boolean(product.productCategory) && Boolean(product.productType) && Boolean(product.variantId) && Boolean(product.images?.length) && (product.semanticCompleteness??0)>=80 && product.semanticIntents.length>0 && product.useCases.length>0;
}
