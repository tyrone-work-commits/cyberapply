import { authorizeAgent, eligibleJob, agentResponse, saveAgent } from '@/lib/agent-bridge';
import { failure } from '@/lib/cyber-store';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 const {user,current}=await authorizeAgent(request),now=new Date(),at=now.toISOString();
 const expired=(current.state.applications||[]).find(item=>item.status==='processing'&&item.claim?.expiresAt&&item.claim.expiresAt<at);
 if(expired){expired.status='uncertain';expired.result={at,message:'Agent lease expired. Check the employer before trying again; submission outcome is unknown.'};delete expired.claim;await saveAgent(user,current,'agent_lease_expired');return agentResponse({job:null});}
 const application=(current.state.applications||[]).find(item=>eligibleJob(current,item));if(!application)return agentResponse({job:null});
 const job=eligibleJob(current,application)!;const claimId=crypto.randomUUID();application.status='processing';application.claim={id:claimId,at,expiresAt:new Date(now.getTime()+5*60000).toISOString()};
 await saveAgent(user,current,'agent_claim_application');
 return agentResponse({job:{id:job.id,title:job.title,company:job.company,url:job.url,applyUrl:job.applyUrl||job.url,source:job.source},application:{id:application.id,claimId,coverLetter:application.text,candidate:application.candidate,cv:application.cv,employerConsent:application.employerConsent===true}});
 }catch(error){return failure(error);}}
