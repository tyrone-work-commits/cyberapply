import {env} from 'cloudflare:workers';
import type {Identity} from './cyber-store';
import {DomainError} from './cyber-domain';
import {getCareer,createCareer,updateCareer} from './career-store';
import {billingConfiguration,type CreditLedger} from './billing-scaffold';
export async function ownerCreditLedger(user:Identity){try{return await getCareer<CreditLedger>(user,'creditLedger','ledger');}catch(e){if(!(e instanceof DomainError&&e.status===404))throw e;try{return await createCareer<CreditLedger>(user,'creditLedger',{entries:[]},'ledger');}catch{return getCareer<CreditLedger>(user,'creditLedger','ledger');}}}
// Future verified server events use this owner-scoped CAS boundary. No client endpoint grants credits.
export async function changeCredits(user:Identity,change:(ledger:CreditLedger)=>CreditLedger){if(!billingConfiguration(env as unknown as Record<string,unknown>).enabled)throw new DomainError('Commercial credits are disabled for this internal workspace.',409);for(let attempt=0;attempt<3;attempt++){const old=await ownerCreditLedger(user),data=change(old.data);if(JSON.stringify(data)===JSON.stringify(old.data))return old;try{return await updateCareer(user,old,old.version,data);}catch(e){if(!(e instanceof DomainError&&e.status===409))throw e;}}throw new DomainError('Credit ledger changed concurrently. No duplicate spend was made.',409);}
