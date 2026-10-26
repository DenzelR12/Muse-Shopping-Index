import { z } from 'zod';

export const productContextFields = {
 variantId:z.string().min(1).optional(),
 variantTitle:z.string().optional(),
 sku:z.string().optional(),
 brand:z.string().optional(),
 description:z.string().max(10000).optional(),
 images:z.array(z.object({url:z.string().url().refine(url=>new URL(url).protocol==='https:','Product images require HTTPS'),alt:z.string().max(500),variantId:z.string().optional()})).max(30).optional(),
 includedItems:z.array(z.string().max(500)).max(50).optional(),
 attributes:z.record(z.string().max(1000)).optional(),
 sourceUpdatedAt:z.string().datetime({offset:true}).optional()
 ,productCategory:z.string().min(1).max(500).optional()
 ,productType:z.string().min(1).max(500).optional()
 ,evidenceVerified:z.boolean().optional()
 ,signalVerified:z.boolean().optional()
};
