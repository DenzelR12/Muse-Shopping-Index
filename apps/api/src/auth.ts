import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';
import type { Capability } from '@gift-signal/signal-shield';

export interface ApiPrincipal {
  orgId:string;
  requestId:string;
  credentialId:string;
  capabilities:Capability[];
  roles?:string[];
}

const hashHex=(value:string)=>createHash('sha256').update(value).digest('hex');

function equalHashHex(candidateSecret:string,expectedHex:string){
  const actual=Buffer.from(hashHex(candidateSecret),'hex');
  const expected=Buffer.from(expectedHex,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}

export interface ApiCredential {
  credentialId:string;
  secretHash:string;
  capabilities:Capability[];
  roles?:string[];
  expiresAt?:string;
  revokedAt?:string;
}

const supportedCapabilities=new Set<Capability>([
  'search_gifts','recommend_gifts','build_bundle','check_delivery',
  'create_gift_draft','create_group_gift_draft','invite_participant',
  'record_telemetry','request_payment','refund_payment','issue_gift_value','manage_provider_connections','admin_override'
]);

export function parseApiKeyRegistry(
  raw:string|undefined,
  options:{allowPlaintext?:boolean}={}
):Map<string,ApiCredential>{
  const allowPlaintext=options.allowPlaintext ?? process.env.NODE_ENV!=='production';
  const registry=new Map<string,ApiCredential>();
  for(const entry of (raw??'').split(',').map(value=>value.trim()).filter(Boolean)){
    const parts=entry.split(':');
    if(parts.length>=4){
      const [orgIdRaw,credentialIdRaw,hashRaw,...scopeParts]=parts;
      const orgId=orgIdRaw?.trim();
      const credentialId=credentialIdRaw?.trim();
      const secretHash=hashRaw?.trim().toLowerCase();
      const scopeRaw=scopeParts.join(':');
      if(!orgId||!credentialId||!/^[a-f0-9]{64}$/.test(secretHash)) continue;
      const capabilities=scopeRaw.split('|').map(value=>value.trim()).filter((value):value is Capability=>supportedCapabilities.has(value as Capability));
      registry.set(orgId,{credentialId,secretHash,capabilities});
      continue;
    }
    if(parts.length===3&&allowPlaintext){
      const [orgIdRaw,secretRaw,scopeRaw='']=parts;
      const orgId=orgIdRaw?.trim(); const secret=secretRaw?.trim();
      if(!orgId||!secret) continue;
      const capabilities=scopeRaw.split('|').map(value=>value.trim()).filter((value):value is Capability=>supportedCapabilities.has(value as Capability));
      registry.set(orgId,{credentialId:'legacy-dev',secretHash:hashHex(secret),capabilities});
    }
  }
  return registry;
}

export interface ApiCredentialAuthority {
  resolve(orgId:string,credentialId:string):Promise<ApiCredential|null>;
}

export class PostgresApiCredentialAuthority implements ApiCredentialAuthority {
  private initialized=false;
  constructor(private readonly pool:Pool){}
  private async init(){
    if(this.initialized) return;
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS api_credentials (org_id TEXT NOT NULL, credential_id TEXT NOT NULL, secret_hash TEXT NOT NULL, capabilities JSONB NOT NULL, roles JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, PRIMARY KEY(org_id,credential_id)); ALTER TABLE api_credentials ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '[]'::jsonb; CREATE INDEX IF NOT EXISTS idx_api_credentials_active ON api_credentials(org_id,credential_id) WHERE revoked_at IS NULL;"
    );
    this.initialized=true;
  }
  async resolve(orgId:string,credentialId:string):Promise<ApiCredential|null>{
    await this.init();
    const result=await this.pool.query(
      'SELECT credential_id,secret_hash,capabilities,roles,expires_at,revoked_at FROM api_credentials WHERE org_id=$1 AND credential_id=$2',
      [orgId,credentialId]
    );
    const row=result.rows[0];
    if(!row) return null;
    return {
      credentialId:String(row.credential_id),
      secretHash:String(row.secret_hash),
      capabilities:Array.isArray(row.capabilities)?row.capabilities.filter((v:string)=>supportedCapabilities.has(v as Capability)) as Capability[]:[],
      roles:Array.isArray(row.roles)?row.roles.filter((v:string)=>v==='owner'):[],
      expiresAt:row.expires_at?new Date(row.expires_at).toISOString():undefined,
      revokedAt:row.revoked_at?new Date(row.revoked_at).toISOString():undefined
    };
  }
}

function requestParts(req:Pick<IncomingMessage,'headers'>){
  const orgHeader=req.headers['x-org-id'];
  const apiKeyHeader=req.headers['x-api-key'];
  const credentialHeader=req.headers['x-credential-id'];
  const orgId=Array.isArray(orgHeader)?orgHeader[0]:orgHeader;
  const apiKey=Array.isArray(apiKeyHeader)?apiKeyHeader[0]:apiKeyHeader;
  const credentialId=(Array.isArray(credentialHeader)?credentialHeader[0]:credentialHeader)?.trim();
  const requestHeader=req.headers['x-request-id'];
  const provided=Array.isArray(requestHeader)?requestHeader[0]:requestHeader;
  return {orgId,apiKey,credentialId,requestId:provided?.trim().slice(0,128)||randomUUID()};
}

function credentialValid(credential:ApiCredential,apiKey:string,now=new Date()){
  if(credential.revokedAt) return false;
  if(credential.expiresAt&&new Date(credential.expiresAt).getTime()<=now.getTime()) return false;
  return equalHashHex(apiKey,credential.secretHash);
}

export function authenticateRequest(
  req:Pick<IncomingMessage,'headers'>,
  rawRegistry=process.env.GIFT_SIGNAL_API_KEY_HASHES??process.env.GIFT_SIGNAL_API_KEYS,
  options:{allowPlaintext?:boolean}={}
):ApiPrincipal|null {
  const {orgId,apiKey,credentialId,requestId}=requestParts(req);
  if(!orgId||!apiKey) return null;
  const credential=parseApiKeyRegistry(rawRegistry,options).get(orgId);
  if(!credential) return null;
  if(credentialId&&credential.credentialId!==credentialId) return null;
  if(!credentialValid(credential,apiKey)) return null;
  return {orgId,requestId,credentialId:credential.credentialId,capabilities:credential.capabilities};
}

export async function authenticateRequestWithAuthority(
  req:Pick<IncomingMessage,'headers'>,
  authority:ApiCredentialAuthority,
  now=new Date()
):Promise<ApiPrincipal|null>{
  const {orgId,apiKey,credentialId,requestId}=requestParts(req);
  if(!orgId||!apiKey||!credentialId) return null;
  const credential=await authority.resolve(orgId,credentialId);
  if(!credential||!credentialValid(credential,apiKey,now)) return null;
  return {orgId,requestId,credentialId:credential.credentialId,capabilities:credential.capabilities,roles:credential.roles??[]};
}
