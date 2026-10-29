"use client";
import { useRef, useState } from 'react';
import type { SalaryFacts } from '@/lib/cyber-domain';
import { convertUsdSalary, type SalaryPeriod } from '@/lib/expected-salary';

const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
export default function ExpectedSalaryFields({salary,onChange}:{salary?:SalaryFacts|null;onChange:(salary:SalaryFacts|null)=>void}){
 const usable=salary?.currency==='USD'&&['month','year'].includes(salary.period)?salary:null;
 const [period,setPeriod]=useState<SalaryPeriod>(usable?.period as SalaryPeriod||'year');
 const [error,setError]=useState('');
 // Convert from the last entered amount so repeated toggles cannot accumulate rounding.
 const original=useRef(usable);
 const equivalentPeriod=period==='month'?'year':'month';
 const equivalent=convertUsdSalary(original.current,equivalentPeriod);
 function changePeriod(next:SalaryPeriod){
  const amount=convertUsdSalary(original.current,next);
  if(amount!==null&&(amount<0.01||amount>1_000_000_000_000)){setError('The converted amount is outside the supported salary range. Keep this pay period or enter another amount.');return;}
  setError('');setPeriod(next);
  if(amount!==null)onChange({amount,currency:'USD',period:next});
 }
 return <>
  {salary&&!usable&&<div className="info-strip"><span>Previously saved: {salary.currency} {salary.amount.toLocaleString('en-US')} per {salary.period}. Enter a salary in US dollars below to replace it. <button type="button" className="text-button" onClick={()=>{original.current=null;onChange(null);}}>Clear saved salary</button></span></div>}
  <label htmlFor="setup-salary">Expected salary (USD)<input id="setup-salary" type="number" min="0.01" max="1000000000000" step="0.01" placeholder="Your expected amount in US dollars" value={usable?.amount??''} onChange={event=>{setError('');const amount=event.target.value===''?null:Number(event.target.value);const next=amount===null?null:{amount,currency:'USD' as const,period};original.current=next;onChange(next);}}/></label>
  <div className="form-pair"><label htmlFor="setup-currency">Currency<input id="setup-currency" value="USD — US dollars" readOnly/></label><label htmlFor="setup-period">Pay period<select id="setup-period" value={period} onChange={event=>changePeriod(event.target.value as SalaryPeriod)}><option value="year">Per year</option><option value="month">Per month</option></select></label></div>
  <p className="subtle" aria-live="polite">{equivalent!==null?<>Equivalent: <strong>{dollars.format(equivalent)} per {equivalentPeriod}</strong>. </>:null}Monthly × 12 = yearly. Switching the pay period converts your amount. Values are rounded to the nearest cent.</p>
  {error&&<p className="inline-error" role="alert">{error}</p>}
 </>;
}
