import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import type {ZeroTrustConnectorRuntime} from './business-zero-trust.js';

export function createCommerceConnectorMcp(runtime:ZeroTrustConnectorRuntime){
  const server=new McpServer({name:'the-gift-signal-connectivity',version:'0.2.0'});
  const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}]});
  const guarded=(run:()=>Promise<unknown>)=>run().then(result).catch(error=>({
    isError:true,
    content:[{type:'text' as const,text:error instanceof Error?error.message:'Unable to complete connector action.'}]
  }));

  server.registerTool('search_company_offers',{
    title:'Search connected company offers',
    description:'Search live company offers using an opaque server-resolved connection ID. Caller-supplied permissions are never trusted.',
    inputSchema:{
      companyId:z.string().min(1).max(200),
      connectionId:z.string().min(1).max(200),
      query:z.string().min(1).max(500),
      partySize:z.number().int().min(1).max(50).optional(),
      destination:z.string().max(200).optional(),
      startDate:z.string().max(40).optional(),
      endDate:z.string().max(40).optional(),
      maxTotal:z.number().nonnegative().optional(),
      currency:z.string().length(3).optional()
    },
    annotations:{readOnlyHint:true,openWorldHint:true}
  },input=>guarded(()=>runtime.search(input.companyId,input.connectionId,{
    query:input.query,partySize:input.partySize,destination:input.destination,startDate:input.startDate,endDate:input.endDate,maxTotal:input.maxTotal,currency:input.currency
  })));

  server.registerTool('create_company_action_draft',{
    title:'Prepare a connected purchase or booking',
    description:'Create a server-signed reviewable draft. The model receives an opaque draft ID and display fields, not authoritative mutable state.',
    inputSchema:{
      companyId:z.string().min(1).max(200),
      connectionId:z.string().min(1).max(200),
      offerIds:z.array(z.string().min(1).max(300)).min(1).max(50),
      quantity:z.number().int().min(1).max(1000).default(1),
      kind:z.enum(['PURCHASE','BOOKING'])
    },
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:true}
  },input=>guarded(()=>runtime.createDraft(input.companyId,input.connectionId,{
    offerIds:input.offerIds,quantity:input.quantity,kind:input.kind
  })));

  server.registerTool('execute_company_action',{
    title:'Complete an approved purchase or booking',
    description:'Execute only a server-stored signed draft with a one-time approval token cryptographically bound to the exact user, company, draft hash, amount and currency. Provider state is revalidated before commit.',
    inputSchema:{
      companyId:z.string().min(1).max(200),
      connectionId:z.string().min(1).max(200),
      draftId:z.string().min(1).max(300),
      approvalToken:z.string().min(32).max(8000)
    },
    annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true}
  },input=>guarded(()=>runtime.execute(input.companyId,input.connectionId,{
    draftId:input.draftId,approvalToken:input.approvalToken
  })));

  return server;
}
