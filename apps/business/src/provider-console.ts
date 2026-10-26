export type ProviderHealth =
  | 'CONNECTED'
  | 'TOKEN_EXPIRING'
  | 'REAUTH_REQUIRED'
  | 'SYNCING'
  | 'HEALTHY'
  | 'ERROR'
  | 'REVOKED'
  | 'PARTNERSHIP_REQUIRED';

export interface ProviderCatalogEntry {
  provider:string;
  displayName:string;
  providerClass:string;
  sellerConnectionSupported:boolean;
  platformConnectionSupported:boolean;
  available:string[];
  approvalRequired:string[];
  partnershipRequired:string[];
  notConfigured?:string[];
  canSelfServe:boolean;
}

export interface ProviderConnectionSummary {
  provider:string;
  displayName:string;
  externalAccountId:string;
  health:ProviderHealth;
  grantedCapabilities:string[];
  tokenExpiresAt?:string;
  lastSyncAt?:string;
  lastSyncError?:string;
  partnershipRequired:string[];
}

export interface ProviderConsoleCard {
  provider:string;
  displayName:string;
  providerClass:string;
  connected:boolean;
  health:'NOT_CONNECTED'|ProviderHealth;
  externalAccountId?:string;
  primaryAction:'CONNECT'|'REAUTHENTICATE'|'VIEW_STATUS'|'CONTACT_PARTNERSHIPS';
  secondaryActions:Array<'SYNC_NOW'|'REVOKE'|'VIEW_CAPABILITIES'>;
  grantedCapabilities:string[];
  blockedCapabilities:string[];
  statusDetail:string;
}

export function buildProviderConsoleCards(args:{
  providers:ProviderCatalogEntry[];
  connections:ProviderConnectionSummary[];
}):ProviderConsoleCard[]{
  const connectionByProvider=new Map(args.connections.map(connection=>[connection.provider,connection]));
  return args.providers.map(provider=>{
    const connection=connectionByProvider.get(provider.provider);
    if(!connection){
      const partnershipOnly=
        !provider.sellerConnectionSupported &&
        provider.partnershipRequired.length>0 &&
        provider.available.length===0 &&
        provider.approvalRequired.length===0;
      return {
        provider:provider.provider,
        displayName:provider.displayName,
        providerClass:provider.providerClass,
        connected:false,
        health:'NOT_CONNECTED',
        primaryAction:partnershipOnly?'CONTACT_PARTNERSHIPS':'CONNECT',
        secondaryActions:['VIEW_CAPABILITIES'],
        grantedCapabilities:[],
        blockedCapabilities:[...provider.partnershipRequired],
        statusDetail:partnershipOnly
          ? 'Direct production access requires an approved commercial integration.'
          : 'Ready to connect when provider authorization is available.'
      };
    }

    const reauth=connection.health==='TOKEN_EXPIRING'||connection.health==='REAUTH_REQUIRED';
    const blocked=[...new Set([...provider.partnershipRequired,...connection.partnershipRequired])];
    return {
      provider:provider.provider,
      displayName:provider.displayName,
      providerClass:provider.providerClass,
      connected:connection.health!=='REVOKED',
      health:connection.health,
      externalAccountId:connection.externalAccountId,
      primaryAction:reauth?'REAUTHENTICATE':'VIEW_STATUS',
      secondaryActions:connection.health==='REVOKED'
        ? ['VIEW_CAPABILITIES']
        : ['SYNC_NOW','REVOKE','VIEW_CAPABILITIES'],
      grantedCapabilities:[...connection.grantedCapabilities],
      blockedCapabilities:blocked,
      statusDetail:connection.lastSyncError
        ? 'Sync needs attention: '+connection.lastSyncError
        : connection.lastSyncAt
          ? 'Last synchronized '+connection.lastSyncAt
          : 'Connected; initial synchronization has not completed.'
    };
  });
}

export function summarizeProviderConsole(cards:ProviderConsoleCard[]){
  return {
    total:cards.length,
    connected:cards.filter(card=>card.connected).length,
    healthy:cards.filter(card=>card.health==='HEALTHY').length,
    attention:cards.filter(card=>['TOKEN_EXPIRING','REAUTH_REQUIRED','ERROR'].includes(card.health)).length,
    partnershipRequired:cards.filter(card=>card.health==='PARTNERSHIP_REQUIRED'||card.primaryAction==='CONTACT_PARTNERSHIPS').length,
    notConnected:cards.filter(card=>card.health==='NOT_CONNECTED').length
  };
}

export interface BusinessConsoleTransport {
  get<T>(path:string):Promise<T>;
  post<T>(path:string,body?:unknown):Promise<T>;
}

export class BusinessConsoleProviderClient {
  constructor(private readonly transport:BusinessConsoleTransport){}

  async load(){
    const [{providers},{connections}]=await Promise.all([
      this.transport.get<{providers:ProviderCatalogEntry[]}>('/v1/providers'),
      this.transport.get<{connections:ProviderConnectionSummary[]}>('/v1/provider-connections')
    ]);
    const cards=buildProviderConsoleCards({providers,connections});
    return {cards,summary:summarizeProviderConsole(cards)};
  }

  async sync(provider:string,externalAccountId:string,kind:'catalog'|'inventory'|'listings'){
    return this.transport.post(
      '/v1/provider-runtime/'+encodeURIComponent(provider)+'/'+encodeURIComponent(externalAccountId)+'/sync',
      {kind}
    );
  }

  async rekey(provider:string,externalAccountId:string){
    return this.transport.post(
      '/v1/provider-runtime/'+encodeURIComponent(provider)+'/'+encodeURIComponent(externalAccountId)+'/rekey'
    );
  }

  async rekeyBatch(limit=100){
    return this.transport.post('/v1/provider-credentials/rekey-batch',{limit});
  }

  async revoke(provider:string,externalAccountId:string){
    return this.transport.post(
      '/v1/provider-runtime/'+encodeURIComponent(provider)+'/'+encodeURIComponent(externalAccountId)+'/revoke'
    );
  }
}
