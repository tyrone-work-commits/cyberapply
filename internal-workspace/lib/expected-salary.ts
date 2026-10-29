import type { SalaryFacts } from './cyber-domain';

export type SalaryPeriod = 'month'|'year';
export function convertUsdSalary(salary:SalaryFacts|null|undefined,period:SalaryPeriod):number|null{
 if(!salary||salary.currency!=='USD'||!['month','year'].includes(salary.period)||!Number.isFinite(salary.amount)||salary.amount<=0)return null;
 const amount=salary.period===period?salary.amount:period==='year'?salary.amount*12:salary.amount/12;
 return Math.round((amount+Number.EPSILON)*100)/100;
}
