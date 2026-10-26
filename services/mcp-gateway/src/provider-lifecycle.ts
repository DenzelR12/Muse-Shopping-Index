import {providerConnectionPlan,type ProviderCapability} from './provider-adapters.js';

export type ProviderConnectionHealth='CONNECTED'|'TOKEN_EXPIRING'|'REAUTH_REQUIRED'|'SYNCING'|'HEALTHY'|'ERROR'|'REVOKED'|'PARTNERSHIP_REQUIRED';

export interface ProviderConnectionStatus {
  provider:string;
  externalAccountId:string;
  grantedCapabilities:ProviderCapability[];
  tokenExpiresAt?:string;
  lastSyncAt?:string;
  lastSyncError?:string;
  revokedAt?:string;
}

export function deriveProviderConnectionHealth(
  connection:ProviderConnectionStatus,
  now=new Date()
):ProviderConnectionHealth{
  if(connection.revokedAt) return 'REVOKED';
  const plan=providerConnectionPlan(connection.provider);
  if(connection.grantedCapabilities.some(cap=>plan.partnershipRequired.includes(cap))) return 'PARTNERSHIP_REQUIRED';
  if(connection.lastSyncError) return 'ERROR';
  if(connection.tokenExpiresAt){
    const remaining=new Date(connection.tokenExpiresAt).getTime()-now.getTime();
    if(remaining<=0) return 'REAUTH_REQUIRED';
    if(remaining<=10*60*1000) return 'TOKEN_EXPIRING';
  }
  if(!connection.lastSyncAt) return 'CONNECTED';
  const age=now.getTime()-new Date(connection.lastSyncAt).getTime();
  if(age<2*60*1000) return 'HEALTHY';
  return 'SYNCING';
}

export function providerConnectionSummary(connection:ProviderConnectionStatus,now=new Date()){
  const plan=providerConnectionPlan(connection.provider);
  return {
    provider:connection.provider,
    displayName:plan.displayName,
    externalAccountId:connection.externalAccountId,
    health:deriveProviderConnectionHealth(connection,now),
    grantedCapabilities:[...connection.grantedCapabilities],
    tokenExpiresAt:connection.tokenExpiresAt,
    lastSyncAt:connection.lastSyncAt,
    lastSyncError:connection.lastSyncError,
    partnershipRequired:plan.partnershipRequired
  };
}
