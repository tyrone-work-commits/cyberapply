"use client";
import { useRef, useState } from 'react';
import type { SalaryFacts } from '@/lib/cyber-domain';
import { convertUsdSalary, formatSalaryInput, type SalaryPeriod } from '@/lib/expected-salary';

const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
export default function ExpectedSalaryFields({salary,onChange}:{salary?:SalaryFacts|null;onChange:(salary:SalaryFacts|null)=>void}){
 const usable=salary?.currency==='USD'&&['month','year'].includes(salary.period)?salary:null;
 const [period,setPeriod]=useState<SalaryPeriod>(usable?.period as SalaryPeriod||'year');
 const [error,setError]=useState('');
 const [salaryText,setSalaryText]=useState(usable?formatSalaryInput(String(usable.amount))??usable.amount.toLocaleString('en-US',{maximumFractionDigits:2}):'');
 const amountInput=useRef<HTMLInputElement>(null);
 // Convert from the last entered amount so repeated toggles cannot accumulate rounding.
 const original=useRef(usable);
 const equivalentPeriod=period==='month'?'year':'month';
 const equivalent=convertUsdSalary(original.current,equivalentPeriod);
 function changePeriod(next:SalaryPeriod){
  const amount=convertUsdSalary(original.current,next);
  if(amount!==null&&(amount<0.01||amount>1_000_000_000_000)){setError('The converted amount is outside the supported salary range. Keep this pay period or enter another amount.');return;}
  setError('');setPeriod(next);
  if(amount!==null){setSalaryText(formatSalaryInput(String(amount))!);amountInput.current?.setCustomValidity('');onChange({amount,currency:'USD',period:next});}
 }
 function changeAmount(event:React.ChangeEvent<HTMLInputElement>){
  const input=event.target,raw=input.value,caret=input.selectionStart??raw.length;
  const formatted=formatSalaryInput(raw);
  if(formatted===null)return;
  const digitsBefore=raw.slice(0,caret).replace(/,/g,'').length;
  setSalaryText(formatted);setError('');
  const amount=formatted===''?null:Number(formatted.replace(/,/g,''));
  input.setCustomValidity(amount!==null&&(amount<0.01||amount>1_000_000_000_000)?'Enter a salary from 0.01 to 1,000,000,000,000 US dollars.':'');
  const next=amount===null?null:{amount,currency:'USD' as const,period};
  original.current=next;onChange(next);
  requestAnimationFrame(()=>{if(document.activeElement!==input)return;let position=0,count=0;while(position<formatted.length&&count<digitsBefore){if(formatted[position]!==',')count++;position++;}input.setSelectionRange(position,position);});
 }
 return <>
  {salary&&!usable&&<div className="info-strip"><span>Previously saved: {salary.currency} {salary.amount.toLocaleString('en-US')} per {salary.period}. Enter a salary in US dollars below to replace it. <button type="button" className="text-button" onClick={()=>{original.current=null;onChange(null);}}>Clear saved salary</button></span></div>}
  <label htmlFor="setup-salary">Expected salary (USD)<input ref={amountInput} id="setup-salary" type="text" inputMode="decimal" maxLength={24} placeholder="For example: 50,000" value={salaryText} onChange={changeAmount}/></label>
  <div className="form-pair"><label htmlFor="setup-currency">Currency<input id="setup-currency" value="USD — US dollars" readOnly/></label><label htmlFor="setup-period">Pay period<select id="setup-period" value={period} onChange={event=>changePeriod(event.target.value as SalaryPeriod)}><option value="year">Per year</option><option value="month">Per month</option></select></label></div>
  <p className="subtle" aria-live="polite">{equivalent!==null?<>Equivalent: <strong>{dollars.format(equivalent)} per {equivalentPeriod}</strong>. </>:null}Monthly × 12 = yearly. Switching the pay period converts your amount. Values are rounded to the nearest cent.</p>
  {error&&<p className="inline-error" role="alert">{error}</p>}
 </>;
}
