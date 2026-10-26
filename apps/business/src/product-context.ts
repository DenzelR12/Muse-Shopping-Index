import type { ProductCandidate } from '@gift-signal/schemas';

/** Catalog quality diagnostics, not a search-engine ranking prediction. */
export function productContextHealth(product:ProductCandidate){
 const missing:string[]=[];
 if(!product.evidenceVerified)missing.push('verified source evidence');
 if(!product.productCategory?.trim())missing.push('product category');
 if(!product.productType?.trim())missing.push('product type');
 if(!product.description?.trim() && !product.semanticSummary?.trim())missing.push('description');
 if(!product.images?.length)missing.push('product photographs');
 if(product.images?.some(image=>!image.alt.trim()))missing.push('image descriptions');
 if(!product.variantId)missing.push('variant identity');
 if(!product.includedItems?.length)missing.push('what is included');
 if(!product.useCases.length)missing.push('use cases');
 if(!product.occasionFit.length)missing.push('occasion context');
 if(!product.sourceUpdatedAt || !Number.isFinite(Date.parse(product.sourceUpdatedAt)))missing.push('source timestamp');
 return {productId:product.productId,ready:missing.length===0,missing};
}
