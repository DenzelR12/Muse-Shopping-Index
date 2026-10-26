import { z } from 'zod';
import { productContextFields } from './product-context-schema.js';
import { Pool } from 'pg';
import { captureBundleInteraction, executeBundles } from '@gift-signal/bundle-orchestrator';
import { PostgresTelemetrySink } from '@gift-signal/telemetry-store';
import type { BundleEvent, TelemetrySink } from '@gift-signal/telemetry';

const giftContext=z.object({recipient:z.string().optional(),relationship:z.string().optional(),occasion:z.string().optional(),interests:z.array(z.string()).default([]),avoid:z.array(z.string()).default([]),budgetMin:z.number().nonnegative().optional(),budgetMax:z.number().positive().optional(),hardBudget:z.boolean().optional(),deliveryTier:z.enum(['10_MIN','TOMORROW','3_DAYS','THIS_WEEK','NO_RUSH']).optional(),destinationCountry:z.string().optional()});
const product=z.object({...productContextFields,productId:z.string(),title:z.string(),price:z.number().nonnegative(),currency:z.string().length(3),inStock:z.boolean(),semanticIntents:z.array(z.string()).default([]),useCases:z.array(z.string()).default([]),recipientFit:z.array(z.string()).default([]),occasionFit:z.array(z.string()).default([]),bundleRoles:z.array(z.string()).default([]),semanticSummary:z.string().optional(),deliveryConfidence:z.number().min(0).max(100).optional(),semanticCompleteness:z.number().min(0).max(100).optional()});

export const bundleBuildSchema=z.object({context:giftContext,candidates:z.array(product).max(500),sessionId:z.string().min(1),requestId:z.string().min(1),source:z.enum(['storefront','business','api','mcp']).default('api')});
export const bundleInteractionSchema=z.object({name:z.enum(['bundle_viewed','bundle_item_removed','bundle_item_swapped','bundle_added_to_cart','bundle_checkout_started','bundle_purchased']),sessionId:z.string().min(1),requestId:z.string().min(1),bundleId:z.string().min(1),currency:z.string().length(3),productIds:z.array(z.string()),totalValue:z.number().nonnegative(),source:z.enum(['storefront','business','api','mcp']),targetBudget:z.number().nonnegative().optional(),hardBudget:z.boolean().optional(),attributes:z.record(z.union([z.string(),z.number(),z.boolean(),z.null()])).optional()});

class StdoutTelemetry implements TelemetrySink {
  async publish(event:BundleEvent):Promise<void>{
    process.stdout.write(`${JSON.stringify({type:'gift_signal_telemetry',...event})}\n`);
  }
}

class FanoutTelemetry implements TelemetrySink {
  constructor(private readonly sinks:TelemetrySink[]){}
  async publish(event:BundleEvent):Promise<void>{
    await Promise.all(this.sinks.map(sink=>sink.publish(event)));
  }
}

function createTelemetrySink():TelemetrySink{
  const stdout=new StdoutTelemetry();
  const databaseUrl=process.env.DATABASE_URL;
  if(!databaseUrl) return stdout;
  const pool=new Pool({connectionString:databaseUrl,max:5});
  return new FanoutTelemetry([new PostgresTelemetrySink(pool),stdout]);
}

const sink=createTelemetrySink();

export async function buildBundles(input:unknown){const p=bundleBuildSchema.parse(input);return executeBundles(p,sink);}
export async function recordBundleInteraction(input:unknown){const p=bundleInteractionSchema.parse(input);await captureBundleInteraction(p,sink);return {accepted:true};}
