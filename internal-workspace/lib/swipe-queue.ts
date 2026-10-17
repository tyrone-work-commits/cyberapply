import { reduceAction, decisionSignature, type Action, type State } from './cyber-domain';

export type SwipeAction=Extract<Action,{type:'decide_job'|'undo_decision'|'save_job'}>;
export type SwipeSnapshot={revision:number;updatedAt:string;state:State};
export type SyncState={pending:number;blocked:boolean};
type Pending={action:SwipeAction;at:string};

/** The card changes synchronously; writes run one at a time against confirmed revisions. */
export class SwipeQueue<T extends SwipeSnapshot>{
 private confirmed:T|null=null;
 private projected:T|null=null;
 private pending:Pending[]=[];
 private running=false;
 private blocked=false;
 constructor(private callbacks:{send:(packet:T,action:SwipeAction)=>Promise<T>;recover:()=>Promise<T>;change:(packet:T,status:SyncState)=>void;error:(message:string)=>void}){}
 get snapshot(){return this.projected;}
 get status():SyncState{return {pending:this.pending.length,blocked:this.blocked};}
 replace(packet:T){if(this.pending.length||this.running)throw Error('Wait for your choices to finish saving.');this.confirmed=packet;this.blocked=false;this.publish();}
 enqueue(input:SwipeAction){
  if(!this.confirmed||!this.projected||this.blocked)throw Error('Reload your saved workspace before making another choice.');
  if(this.pending.length>=20)throw Error('Your choices are still saving. Wait a moment before swiping again.');
  const action={...input,operationId:input.operationId||crypto.randomUUID()} as SwipeAction;
  const at=new Date().toISOString();
  const job=this.projected.state.jobs.find(job=>job.id===action.jobId);
  if(action.type==='save_job'&&job?.saved===action.saved)return;
  if(action.type==='decide_job'&&((action.decision==='pass'&&job?.disposition==='passed')||(action.decision==='apply'&&this.projected.state.applications?.some(item=>item.jobId===action.jobId))))return;
  // Validate before removing a card; reviewed facts and original source gates still apply.
  const result=reduceAction(this.projected.state,action,'interface',at);
  this.pending.push({action,at});this.projected={...this.projected,state:result.state};this.callbacks.change(this.projected,this.status);void this.drain();
 }
 private publish(){
  if(!this.confirmed)return;
  let packet=this.confirmed;
  try{for(const item of this.pending)packet={...packet,state:reduceAction(packet.state,item.action,'interface',item.at).state};}
  catch{this.pending=[];this.blocked=true;packet=this.confirmed;this.callbacks.error('Your saved workspace changed. Reload before making another choice.');}
  this.projected=packet;this.callbacks.change(packet,this.status);
 }
 private async drain(){
  if(this.running)return;this.running=true;
  try{
   while(this.pending.length&&this.confirmed&&!this.blocked){
    const item=this.pending[0];
    try{this.confirmed=await this.callbacks.send(this.confirmed,item.action);}
    catch(error){
     // Never blindly retry an uncertain write. Read the owner's operation record first.
     try{
      this.confirmed=await this.callbacks.recover();
      const recorded=this.confirmed.state.decisionOperations?.some(op=>op.id===item.action.operationId&&op.signature===decisionSignature(item.action));
      if(!recorded){this.pending=[];this.callbacks.error(`${error instanceof Error?error.message:'The choice could not be saved.'} Your cards now show the latest saved state.`);this.publish();break;}
     }catch{this.pending=[];this.blocked=true;this.callbacks.error('The save could not be confirmed. Reload your saved workspace before swiping again.');this.publish();break;}
    }
    this.pending.shift();this.publish();
   }
  }finally{this.running=false;}
 }
}
