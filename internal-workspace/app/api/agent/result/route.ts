import { z } from 'zod';
import { authorizeAgent, agentResponse, saveAgent } from '@/lib/agent-bridge';
import { failure } from '@/lib/cyber-store';
import { DomainError, record } from '@/lib/cyber-domain';
export const dynamic='force-dynamic';
const bodySchema=z.object({applicationId:z.string().min(1).max(300),claimId:z.string().uuid(),status:z.enum(['applied','needs_attention','uncertain','failed']),message:z.string().trim().min(1).max(500),receipt:z.string().trim().min(1).max(200).optional()}).strict();
export async function POST(request:Request){try{
 const {user,current}=await authorizeAgent(request),body=bodySchema.parse(await request.json()),item=current.state.applications?.find(row=>row.id===body.applicationId);
 if(!item||item.status!=='processing'||item.claim?.id!==body.claimId)throw new DomainError('This claim is no longer active. Check the application history.',409);
 if(body.status==='applied'&&!body.receipt)throw new DomainError('A verified employer receipt is required before marking Applied.',409);
 item.status=body.status;item.result={at:new Date().toISOString(),message:body.message,...(body.receipt?{receipt:body.receipt}:{})};delete item.claim;
 record(current.state,'agent_'+body.status,body.message,'agent');const saved=await saveAgent(user,current,'agent_'+body.status);
 return agentResponse({status:item.status,revision:saved.revision});
 }catch(error){return failure(error);}}
