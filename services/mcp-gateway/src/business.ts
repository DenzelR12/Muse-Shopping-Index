import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';

export const purposes=['office_supplies','office_party','special_guest','gaming_event','corporate_gifts','business_travel','luggage','business_clothing'] as const;
export const catalogItemSchema=z.object({
 variantId:z.string().min(1),title:z.string().min(1).max(180),variantTitle:z.string().max(120),sku:z.string().max(100),
 priceCents:z.number().int().min(0).max(100000000),currency:z.literal('USD'),availableQuantity:z.number().int().min(0),
 verifiedAt:z.string().datetime({offset:true}),purposes:z.array(z.enum(purposes)),
 riskClass:z.enum(['ordinary','cash_equivalent','restricted','unknown']).default('unknown'),
 imageUrl:z.string().url().refine(value=>new URL(value).protocol==='https:').optional(),included:z.string().max(600)
});
export const quoteRequestSchema=z.object({
 purpose:z.enum(purposes),eventName:z.string().min(1).max(120),neededBy:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
 budgetCents:z.number().int().positive().max(100000000),
 items:z.array(z.object({variantId:z.string().min(1),quantity:z.number().int().min(1).max(10000)})).min(1).max(50)
});
export type CatalogItem=z.infer<typeof catalogItemSchema>;
export interface Quote {id:string;businessId:string;createdAt:string;purpose:typeof purposes[number];eventName:string;neededBy?:string;budgetCents:number;currency:'USD';lines:(CatalogItem&{quantity:number;lineTotalCents:number})[];subtotalCents:number;status:'REVIEW_REQUIRED';exclusions:string[]}
export const quoteDigest=(quote:Quote)=>createHash('sha256').update(JSON.stringify(quote)).digest('hex');
export class BusinessQuotes {
 constructor(readonly businessId:string,readonly directory:string,private readonly loadCatalog:()=>Promise<CatalogItem[]>,private readonly now:()=>Date=()=>new Date()){}
 async catalog(){return z.array(catalogItemSchema).max(5000).parse(await this.loadCatalog());}
 async search(purpose:typeof purposes[number],query='',quantity=1,maxUnitPriceCents=100000000){
  const now=this.now().getTime();const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return (await this.catalog()).filter(p=>p.riskClass==='ordinary'&&p.purposes.includes(purpose)&&p.availableQuantity>=quantity&&p.priceCents<=maxUnitPriceCents&&now-Date.parse(p.verifiedAt)>=0&&now-Date.parse(p.verifiedAt)<=86400000&&terms.every(t=>(p.title+' '+p.variantTitle+' '+p.included).toLowerCase().includes(t))).slice(0,20);
 }
 async create(input:unknown){
  const request=quoteRequestSchema.parse(input);const catalog=await this.catalog();const now=this.now();
  if(new Set(request.items.map(i=>i.variantId)).size!==request.items.length)throw new Error('Combine quantities for each variant into one line.');
  if(request.neededBy && (!Number.isFinite(Date.parse(request.neededBy+'T23:59:59Z')) || new Date(request.neededBy+'T00:00:00Z').toISOString().slice(0,10)!==request.neededBy || Date.parse(request.neededBy+'T23:59:59Z')<now.getTime()))throw new Error('Choose a valid upcoming date.');
  const lines=request.items.map(item=>{
   const product=catalog.find(p=>p.variantId===item.variantId);
   if(!product || product.availableQuantity<item.quantity)throw new Error('The requested variant or quantity is unavailable. Refresh the catalog.');
   if(product.riskClass!=='ordinary')throw new Error('This product requires specialist review and is not enabled for business quoting.');
   const age=now.getTime()-Date.parse(product.verifiedAt);if(age<0||age>86400000)throw new Error('Refresh catalog price and stock before preparing a quote.');
   return {...product,quantity:item.quantity,lineTotalCents:product.priceCents*item.quantity};
  });
  const subtotalCents=lines.reduce((sum,line)=>sum+line.lineTotalCents,0);
  if(subtotalCents>request.budgetCents)throw new Error('These items exceed the product budget. Reduce quantities or choose another item.');
  const quote:Quote={id:randomUUID(),businessId:this.businessId,createdAt:now.toISOString(),purpose:request.purpose,eventName:request.eventName,neededBy:request.neededBy,budgetCents:request.budgetCents,currency:'USD',lines,subtotalCents,status:'REVIEW_REQUIRED',exclusions:['Shipping and tax are not included.','Availability is not reserved. Delivery date is not confirmed.','This is a quote, not an order, invoice, or payment receipt.']};
  await mkdir(this.directory,{recursive:true,mode:0o700});await writeFile(join(this.directory,quote.id+'.json'),JSON.stringify(quote),{flag:'wx',mode:0o600});return {quote,digest:quoteDigest(quote)};
 }
 async get(id:string){
  z.string().uuid().parse(id);const quote=JSON.parse(await readFile(join(this.directory,id+'.json'),'utf8')) as Quote;
  if(quote.businessId!==this.businessId || quote.id!==id)throw new Error('Quote is not available for this business.');return {quote,digest:quoteDigest(quote)};
 }
}
