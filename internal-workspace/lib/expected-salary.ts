import type { SalaryFacts } from './cyber-domain';

export type SalaryPeriod = 'month'|'year';
export function formatSalaryInput(text:string):string|null{
 const plain=text.replace(/,/g,'');
 if(!/^\d*(?:\.\d{0,2})?$/.test(plain))return null;
 if(!plain)return '';
 const [whole,fraction]=plain.split('.');
 const grouped=(whole||'0').replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return grouped+(fraction!==undefined?'.'+fraction:'');
}
export function convertUsdSalary(salary:SalaryFacts|null|undefined,period:SalaryPeriod):number|null{
 if(!salary||salary.currency!=='USD'||!['month','year'].includes(salary.period)||!Number.isFinite(salary.amount)||salary.amount<=0)return null;
 const amount=salary.period===period?salary.amount:period==='year'?salary.amount*12:salary.amount/12;
 return Math.round((amount+Number.EPSILON)*100)/100;
}
