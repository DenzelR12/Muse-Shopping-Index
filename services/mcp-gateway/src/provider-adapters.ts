export type ProviderId=string;
export type ProviderClass='COMMERCE_SYSTEM'|'MARKETPLACE'|'DISCOVERY_NETWORK'|'ENTERPRISE_SYSTEM'|'RETAILER';
export type AccessState='AVAILABLE'|'APP_APPROVAL_REQUIRED'|'PARTNERSHIP_REQUIRED'|'NOT_CONFIGURED';
export type ProviderCapability=
  | 'catalog.read'
  | 'inventory.read'
  | 'pricing.read'
  | 'offers.search'
  | 'quote.create'
  | 'order.create'
  | 'order.read'
  | 'order.cancel'
  | 'refund.create'
  | 'fulfillment.read'
  | 'returns.read'
  | 'analytics.read'
  | 'attribution.write'
  | 'intent.read';

export interface ProviderCapabilityState {
  capability:ProviderCapability;
  access:AccessState;
  reason?:string;
}

export interface ProviderDefinition {
  provider:ProviderId;
  displayName:string;
  providerClass:ProviderClass;
  oauthPreferred:boolean;
  sellerConnectionSupported:boolean;
  platformConnectionSupported:boolean;
  capabilities:ProviderCapabilityState[];
  notes:string[];
}

export interface ProviderConnection {
  connectionId:string;
  provider:ProviderId;
  companyId:string;
  externalAccountId:string;
  status:'CONNECTED'|'REAUTH_REQUIRED'|'REVOKED';
  grantedCapabilities:ProviderCapability[];
  createdAt:string;
  expiresAt?:string;
}

export interface ProviderAdapter {
  definition:ProviderDefinition;
  authenticate(args:{companyId:string;redirectUri:string}):Promise<{authorizationUrl:string;state:string}>;
  discoverCapabilities(connection:ProviderConnection):Promise<ProviderCapabilityState[]>;
  syncCatalog?(connection:ProviderConnection):Promise<unknown[]>;
  syncInventory?(connection:ProviderConnection):Promise<unknown[]>;
  searchOffers?(connection:ProviderConnection,query:Record<string,unknown>):Promise<unknown[]>;
  createQuote?(connection:ProviderConnection,input:Record<string,unknown>):Promise<unknown>;
  createOrder?(connection:ProviderConnection,input:Record<string,unknown>):Promise<unknown>;
  cancelOrder?(connection:ProviderConnection,providerOrderId:string):Promise<unknown>;
  createRefund?(connection:ProviderConnection,providerOrderId:string,input?:Record<string,unknown>):Promise<unknown>;
  trackFulfillment?(connection:ProviderConnection,providerOrderId:string):Promise<unknown>;
}

const caps=(entries:Array<[ProviderCapability,AccessState,string?]>):ProviderCapabilityState[] =>
  entries.map(([capability,access,reason])=>({capability,access,reason}));

const restrictedRetailCapabilities=():ProviderCapabilityState[]=>
  caps([
    ['catalog.read','PARTNERSHIP_REQUIRED','Retailer authorization or an approved commercial data path is required.'],
    ['inventory.read','PARTNERSHIP_REQUIRED'],
    ['pricing.read','PARTNERSHIP_REQUIRED'],
    ['offers.search','PARTNERSHIP_REQUIRED'],
    ['quote.create','PARTNERSHIP_REQUIRED'],
    ['order.create','PARTNERSHIP_REQUIRED'],
    ['order.read','PARTNERSHIP_REQUIRED'],
    ['order.cancel','PARTNERSHIP_REQUIRED'],
    ['refund.create','PARTNERSHIP_REQUIRED'],
    ['fulfillment.read','PARTNERSHIP_REQUIRED'],
    ['returns.read','PARTNERSHIP_REQUIRED']
  ]);

export function createRetailerProvider(provider:string,displayName:string,notes:string[]=[]):ProviderDefinition{
  if(!provider.trim()||!displayName.trim()) throw new Error('provider_id_and_name_required');
  return {
    provider,
    displayName,
    providerClass:'RETAILER',
    oauthPreferred:true,
    sellerConnectionSupported:false,
    platformConnectionSupported:true,
    capabilities:restrictedRetailCapabilities(),
    notes:[
      'Provider is represented in THE GIFT SIGNAL without assuming unaffiliated production API access.',
      'Capabilities can be promoted from PARTNERSHIP_REQUIRED only after documented authorization and verification.',
      ...notes
    ]
  };
}

const specialProviders:Record<string,ProviderDefinition>={
  shopify:{
    provider:'shopify',displayName:'Shopify',providerClass:'COMMERCE_SYSTEM',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:false,
    capabilities:caps([
      ['catalog.read','AVAILABLE'],['inventory.read','AVAILABLE'],['pricing.read','AVAILABLE'],['quote.create','AVAILABLE'],
      ['order.create','AVAILABLE'],['order.read','AVAILABLE'],['order.cancel','AVAILABLE'],
      ['fulfillment.read','AVAILABLE'],['returns.read','AVAILABLE']
    ]),
    notes:['Merchant-owned commerce connection.']
  },
  stripe:{
    provider:'stripe',displayName:'Stripe',providerClass:'COMMERCE_SYSTEM',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:false,
    capabilities:caps([
      ['quote.create','AVAILABLE'],['order.create','AVAILABLE'],['refund.create','AVAILABLE'],
      ['analytics.read','AVAILABLE']
    ]),
    notes:['Payment rail; product and fulfillment truth should come from the merchant or commerce provider.']
  },
  walmart:{
    provider:'walmart',displayName:'Walmart Marketplace',providerClass:'MARKETPLACE',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:true,
    capabilities:caps([
      ['catalog.read','APP_APPROVAL_REQUIRED','Seller/app authorization required.'],
      ['inventory.read','APP_APPROVAL_REQUIRED','Seller/app authorization required.'],
      ['pricing.read','APP_APPROVAL_REQUIRED','Seller/app authorization required.'],
      ['order.read','APP_APPROVAL_REQUIRED','Seller/app authorization required.'],
      ['order.create','APP_APPROVAL_REQUIRED','Only where Walmart program/API permissions allow the action.'],
      ['fulfillment.read','APP_APPROVAL_REQUIRED','Seller/app authorization required.'],
      ['returns.read','APP_APPROVAL_REQUIRED','Seller/app authorization required.']
    ]),
    notes:['Seller connectivity and first-party Walmart platform access are separate authorization paths.']
  },
  amazon:{
    provider:'amazon',displayName:'Amazon',providerClass:'MARKETPLACE',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:true,
    capabilities:caps([
      ['catalog.read','APP_APPROVAL_REQUIRED','Seller/vendor authorization and applicable Amazon API program access required.'],
      ['inventory.read','APP_APPROVAL_REQUIRED','Seller/vendor authorization required.'],
      ['pricing.read','APP_APPROVAL_REQUIRED','Seller/vendor authorization required.'],
      ['order.read','APP_APPROVAL_REQUIRED','Seller/vendor authorization required.'],
      ['order.create','PARTNERSHIP_REQUIRED','Consumer checkout/order placement requires explicit Amazon program approval.'],
      ['fulfillment.read','APP_APPROVAL_REQUIRED','Seller/vendor authorization required.']
    ]),
    notes:['Seller APIs and consumer/platform commerce access remain distinct.']
  },
  ebay:{
    provider:'ebay',displayName:'eBay',providerClass:'MARKETPLACE',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:true,
    capabilities:caps([
      ['catalog.read','APP_APPROVAL_REQUIRED','OAuth/app access required.'],
      ['inventory.read','APP_APPROVAL_REQUIRED','Seller OAuth/app access required.'],
      ['pricing.read','APP_APPROVAL_REQUIRED','OAuth/app access required.'],
      ['offers.search','APP_APPROVAL_REQUIRED','Production Buy API eligibility may be required.'],
      ['order.create','APP_APPROVAL_REQUIRED','Production checkout access depends on eBay approval and API eligibility.'],
      ['order.read','APP_APPROVAL_REQUIRED','Authorized API access required.'],
      ['fulfillment.read','APP_APPROVAL_REQUIRED','Authorized API access required.']
    ]),
    notes:['Seller integration and network-level Buy API access are tracked separately.']
  },
  target:{
    provider:'target',displayName:'Target / Target Plus',providerClass:'MARKETPLACE',oauthPreferred:true,
    sellerConnectionSupported:false,platformConnectionSupported:true,
    capabilities:restrictedRetailCapabilities(),
    notes:['Target/Target Plus production access requires an approved commercial integration path.']
  },
  etsy:{
    provider:'etsy',displayName:'Etsy',providerClass:'MARKETPLACE',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:true,
    capabilities:caps([
      ['catalog.read','APP_APPROVAL_REQUIRED'],['inventory.read','APP_APPROVAL_REQUIRED'],
      ['pricing.read','APP_APPROVAL_REQUIRED'],['order.read','APP_APPROVAL_REQUIRED'],
      ['fulfillment.read','APP_APPROVAL_REQUIRED'],['order.create','PARTNERSHIP_REQUIRED']
    ]),
    notes:['Seller connectivity and buyer-side transaction authority are separate.']
  },
  pinterest:{
    provider:'pinterest',displayName:'Pinterest',providerClass:'DISCOVERY_NETWORK',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:true,
    capabilities:caps([
      ['catalog.read','APP_APPROVAL_REQUIRED','Business account/app authorization required.'],
      ['intent.read','APP_APPROVAL_REQUIRED','Only authorized, policy-permitted signals may be used.'],
      ['analytics.read','APP_APPROVAL_REQUIRED'],['attribution.write','APP_APPROVAL_REQUIRED'],
      ['order.create','PARTNERSHIP_REQUIRED','Pinterest is treated primarily as discovery/catalog/attribution unless an approved commerce path exists.']
    ]),
    notes:['Discovery and intent source; not assumed to be the payment or fulfillment rail.']
  },
  meta:{
    provider:'meta',displayName:'Meta',providerClass:'DISCOVERY_NETWORK',oauthPreferred:true,
    sellerConnectionSupported:true,platformConnectionSupported:true,
    capabilities:caps([
      ['catalog.read','APP_APPROVAL_REQUIRED'],['analytics.read','APP_APPROVAL_REQUIRED'],
      ['attribution.write','APP_APPROVAL_REQUIRED'],['intent.read','APP_APPROVAL_REQUIRED']
    ]),
    notes:['Optional distribution/discovery surface; not required for Gift Signal participation.']
  },
  custom:{
    provider:'custom',displayName:'Custom API / ERP',providerClass:'ENTERPRISE_SYSTEM',oauthPreferred:false,
    sellerConnectionSupported:true,platformConnectionSupported:false,
    capabilities:caps([
      ['catalog.read','NOT_CONFIGURED'],['inventory.read','NOT_CONFIGURED'],['pricing.read','NOT_CONFIGURED'],
      ['quote.create','NOT_CONFIGURED'],['order.create','NOT_CONFIGURED'],['order.read','NOT_CONFIGURED'],
      ['order.cancel','NOT_CONFIGURED'],['refund.create','NOT_CONFIGURED'],['fulfillment.read','NOT_CONFIGURED']
    ]),
    notes:['Capabilities are enabled only after the custom adapter passes verification.']
  }
};

const majorRetailerPresets:Array<[string,string]>=[
  ['best-buy','Best Buy'],
  ['home-depot','The Home Depot'],
  ['lowes',"Lowe's"],
  ['costco','Costco'],
  ['sams-club',"Sam's Club"],
  ['macys',"Macy's"],
  ['nordstrom','Nordstrom'],
  ['kohls',"Kohl's"],
  ['wayfair','Wayfair'],
  ['chewy','Chewy'],
  ['cvs','CVS'],
  ['walgreens','Walgreens'],
  ['kroger','Kroger'],
  ['albertsons','Albertsons'],
  ['instacart','Instacart'],
  ['sephora','Sephora'],
  ['ulta','Ulta Beauty'],
  ['nike','Nike'],
  ['adidas','Adidas'],
  ['apple','Apple'],
  ['samsung','Samsung'],
  ['dell','Dell'],
  ['ikea','IKEA'],
  ['staples','Staples'],
  ['office-depot','Office Depot'],
  ['newegg','Newegg'],
  ['gamestop','GameStop'],
  ['rei','REI'],
  ['dicks-sporting-goods',"Dick's Sporting Goods"],
  ['petco','Petco'],
  ['petsmart','PetSmart'],
  ['tractor-supply','Tractor Supply Co.'],
  ['autozone','AutoZone'],
  ['advance-auto-parts','Advance Auto Parts'],
  ['oreilly-auto-parts',"O'Reilly Auto Parts"],
  ['williams-sonoma','Williams Sonoma'],
  ['pottery-barn','Pottery Barn'],
  ['crate-and-barrel','Crate & Barrel'],
  ['gap','Gap'],
  ['old-navy','Old Navy'],
  ['zara','Zara'],
  ['hm','H&M'],
  ['bath-and-body-works','Bath & Body Works'],
  ['lululemon','lululemon'],
  ['academy-sports','Academy Sports + Outdoors'],
  ['bass-pro-shops','Bass Pro Shops'],
  ['cabelas',"Cabela's"],
  ['ace-hardware','Ace Hardware'],
  ['menards','Menards'],
  ['meijer','Meijer'],
  ['publix','Publix'],
  ['whole-foods','Whole Foods Market'],
  ['aldi','ALDI'],
  ['heb','H-E-B'],
  ['wegmans','Wegmans'],
  ['dollar-general','Dollar General'],
  ['dollar-tree','Dollar Tree'],
  ['five-below','Five Below'],
  ['tj-maxx','TJ Maxx'],
  ['marshalls','Marshalls'],
  ['ross','Ross Dress for Less'],
  ['bloomingdales',"Bloomingdale's"],
  ['saks','Saks Fifth Avenue'],
  ['jcpenney','JCPenney'],
  ['belk','Belk'],
  ['foot-locker','Foot Locker'],
  ['finish-line','Finish Line'],
  ['ulta','Ulta Beauty'],
  ['lego','LEGO'],
  ['michaels','Michaels'],
  ['hobby-lobby','Hobby Lobby'],
  ['barnes-and-noble','Barnes & Noble'],
  ['staples','Staples'],
  ['office-depot','Office Depot'],
  ['bjs','BJ’s Wholesale Club']
];

export const providerCatalog:Record<string,ProviderDefinition>={...specialProviders};
for(const [provider,displayName] of majorRetailerPresets){
  if(!providerCatalog[provider]) providerCatalog[provider]=createRetailerProvider(provider,displayName);
}

export function registerProviderDefinition(definition:ProviderDefinition){
  if(!definition.provider.trim()||!definition.displayName.trim()) throw new Error('provider_id_and_name_required');
  if(providerCatalog[definition.provider]) throw new Error('provider_definition_already_registered');
  providerCatalog[definition.provider]=structuredClone(definition);
  return providerDefinition(definition.provider);
}

export function providerDefinition(provider:ProviderId):ProviderDefinition{
  const definition=providerCatalog[provider];
  if(!definition) throw new Error('unknown_provider');
  return structuredClone(definition);
}

export function providerConnectionPlan(provider:ProviderId){
  const definition=providerDefinition(provider);
  const available=definition.capabilities.filter(c=>c.access==='AVAILABLE').map(c=>c.capability);
  const approvalRequired=definition.capabilities.filter(c=>c.access==='APP_APPROVAL_REQUIRED').map(c=>c.capability);
  const partnershipRequired=definition.capabilities.filter(c=>c.access==='PARTNERSHIP_REQUIRED').map(c=>c.capability);
  const notConfigured=definition.capabilities.filter(c=>c.access==='NOT_CONFIGURED').map(c=>c.capability);
  return {
    provider,
    displayName:definition.displayName,
    providerClass:definition.providerClass,
    oauthPreferred:definition.oauthPreferred,
    sellerConnectionSupported:definition.sellerConnectionSupported,
    platformConnectionSupported:definition.platformConnectionSupported,
    available,
    approvalRequired,
    partnershipRequired,
    notConfigured,
    canSelfServe:definition.sellerConnectionSupported && partnershipRequired.length===0
  };
}

export function assertProviderCapability(
  connection:ProviderConnection,
  capability:ProviderCapability,
  definition:ProviderDefinition=providerDefinition(connection.provider)
){
  if(connection.status!=='CONNECTED') throw new Error('provider_connection_not_active');
  if(!connection.grantedCapabilities.includes(capability)) throw new Error('provider_capability_not_granted');
  const state=definition.capabilities.find(item=>item.capability===capability);
  if(!state) throw new Error('provider_capability_not_declared');
  if(state.access==='PARTNERSHIP_REQUIRED') throw new Error('provider_partnership_required');
  if(state.access==='NOT_CONFIGURED') throw new Error('provider_capability_not_configured');
  return {allowed:true,access:state.access};
}

export class ProviderAdapterRegistry{
  private readonly adapters=new Map<ProviderId,ProviderAdapter>();

  register(adapter:ProviderAdapter){
    if(this.adapters.has(adapter.definition.provider)) throw new Error('provider_adapter_already_registered');
    this.adapters.set(adapter.definition.provider,adapter);
  }

  get(provider:ProviderId){
    const adapter=this.adapters.get(provider);
    if(!adapter) throw new Error('provider_adapter_not_registered');
    return adapter;
  }

  list(){
    return [...this.adapters.values()].map(adapter=>structuredClone(adapter.definition));
  }
}
