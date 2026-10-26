// SYNTHETIC / DEMO ONLY — NOT A REAL COMPANY.
// This adapter exists only so the generic (rail-independent) execution
// profile can be exercised end to end without a real provider, real money,
// or a real booking. It never presents itself as a real company: every
// display string, offer title, summary, and provider reference carries the
// SYNTHETIC DEMO ONLY label, and it must never be registered for a real
// companyId or wired into a production company registry.
import {defaultConnectorActions,type CompanyConnectorManifest,type ConnectorActionDraft,type CustomerConnection,type NormalizedOffer,type OfferSearchRequest} from './business-connectors.js';
import type {ZeroTrustConnectorAdapter} from './business-zero-trust.js';

export const SYNTHETIC_FIXTURE_COMPANY_ID='synthetic-fixture-demo-only';
export const syntheticFixtureManifest:CompanyConnectorManifest={
  companyId:SYNTHETIC_FIXTURE_COMPANY_ID,
  slug:'synthetic-fixture-demo-only',
  displayName:'SYNTHETIC DEMO ONLY — Not a real company',
  vertical:'services',
  status:'ACTIVE',
  actions:defaultConnectorActions,
};

export interface SyntheticFixtureOffer{offerId:string;title:string;price:number;kind:'PURCHASE'|'BOOKING'}
export const syntheticFixtureOffers:SyntheticFixtureOffer[]=[
  {offerId:'synthetic-booking-1',title:'SYNTHETIC DEMO ONLY — Fixture booking',price:120,kind:'BOOKING'},
  {offerId:'synthetic-digital-1',title:'SYNTHETIC DEMO ONLY — Fixture digital item',price:25,kind:'PURCHASE'},
];

export interface SyntheticFixtureOptions{
  // Deterministic clock for tests; defaults to the real clock.
  now?:()=>Date;
  // Draft lifetime; defaults to one hour.
  expiresInMs?:number;
  // When set, revalidate() returns this total instead of the draft total,
  // so ZeroTrustConnectorRuntime rejects execution as drifted and the
  // adapter's execute() is never reached.
  driftTotal?:number;
  // When set, execute() throws execution_uncertain_reconciliation_required
  // instead of confirming, so callers must reconcile, never blindly retry.
  uncertain?:boolean;
  // When set, execute() returns FAILED instead of CONFIRMED.
  failCommit?:boolean;
}

export class SyntheticFixtureConnectorAdapter implements ZeroTrustConnectorAdapter {
  readonly idempotentCommit:true=true;
  private readonly executed=new Map<string, {executionId:string;draftId:string;status:'CONFIRMED'|'FAILED';providerReference?:string;committedAt:string;message:string}>();
  private calls=0;
  constructor(private readonly options:SyntheticFixtureOptions={}){}
  private clock():Date{return this.options.now?.()??new Date();}
  get executeCallCount(){return this.calls;}
  async search(request:OfferSearchRequest,connection:CustomerConnection):Promise<NormalizedOffer[]>{
    void request; void connection;
    const at=this.clock().toISOString();
    return syntheticFixtureOffers.map((offer)=>({offerId:offer.offerId,title:offer.title,provider:'SYNTHETIC DEMO ONLY — Not a real company',
      price:offer.price,currency:'USD',availability:'AVAILABLE',evidenceAt:at}));
  }
  async createDraft(args:{offerIds:string[];quantity:number;kind:'PURCHASE'|'BOOKING';connection:CustomerConnection}):Promise<ConnectorActionDraft>{
    const now=this.clock();
    const offers=args.offerIds.map((offerId)=>{
      const found=syntheticFixtureOffers.find((offer)=>offer.offerId===offerId);
      if(!found) throw new Error('synthetic_offer_not_found');
      return found;
    });
    if(!offers.length) throw new Error('at_least_one_offer_required');
    const total=offers.reduce((sum,offer)=>sum+offer.price,0)*args.quantity;
    return {draftId:`synthetic-${args.kind.toLowerCase()}-${args.offerIds.join('_')}`,companyId:SYNTHETIC_FIXTURE_COMPANY_ID,
      connectionId:args.connection.connectionId,kind:args.kind,offerIds:[...args.offerIds],quantity:args.quantity,
      total,currency:'USD',summary:'SYNTHETIC DEMO ONLY — Fixture draft, not a real booking or purchase',
      createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+(this.options.expiresInMs??3600000)).toISOString(),
      approvalRequired:true,liveRevalidationRequired:true};
  }
  async revalidate(draft:ConnectorActionDraft,connection:CustomerConnection):Promise<ConnectorActionDraft>{
    void connection;
    if(this.options.driftTotal!==undefined) return {...draft,total:this.options.driftTotal};
    return structuredClone(draft);
  }
  async execute(args:{draft:ConnectorActionDraft;connection:CustomerConnection;approval:{approved:true;approvedAt:string;approvalId:string}}){
    this.calls++;
    void args.connection; void args.approval;
    if(this.options.uncertain) throw new Error('execution_uncertain_reconciliation_required');
    const existing=this.executed.get(args.draft.draftId);
    if(existing) return {...existing};
    const execution={executionId:`synthetic-exec-${args.draft.draftId}`,draftId:args.draft.draftId,
      status:(this.options.failCommit?'FAILED':'CONFIRMED') as 'CONFIRMED'|'FAILED',
      providerReference:'SYNTHETIC-DEMO-ONLY-1',committedAt:this.clock().toISOString(),
      message:'SYNTHETIC DEMO ONLY — Fixture execution, not a real booking or purchase'};
    this.executed.set(args.draft.draftId,execution);
    return {...execution};
  }
}
