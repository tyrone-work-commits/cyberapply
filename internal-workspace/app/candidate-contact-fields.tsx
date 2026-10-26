"use client";
import { useEffect, useState } from 'react';
import type { Profile, SalaryFacts } from '@/lib/cyber-domain';

const currencies:SalaryFacts['currency'][]=['USD','NGN','GBP','EUR','CAD','AUD','GHS','KES','ZAR','AED','INR','SGD'];

export function CandidateContactFields({ profile, onChange }: { profile: Profile; onChange: (update: Partial<Profile>) => void }) {
  const [salaryText,setSalaryText]=useState(profile.currentSalary?.amount.toString()??'');
  const [currency,setCurrency]=useState<SalaryFacts['currency']>(profile.currentSalary?.currency??'USD');
  const [period,setPeriod]=useState<SalaryFacts['period']>(profile.currentSalary?.period??'year');
  useEffect(()=>setSalaryText(profile.currentSalary?.amount.toString()??''),[profile.currentSalary?.amount]);
  useEffect(()=>{if(profile.currentSalary){setCurrency(profile.currentSalary.currency);setPeriod(profile.currentSalary.period);}},[profile.currentSalary?.currency,profile.currentSalary?.period]);
  const salary=profile.currentSalary;
  return <>
    <div className="form-pair">
      <label>GitHub repository
        <input type="url" inputMode="url" value={profile.githubRepositoryUrl ?? ''} maxLength={2000} placeholder="https://github.com/you/repository" onChange={event => onChange({ githubRepositoryUrl: event.target.value })}/>
      </label>
      <label>LinkedIn link
        <input type="url" inputMode="url" value={profile.linkedInUrl ?? ''} maxLength={2000} placeholder="https://www.linkedin.com/in/you" onChange={event => onChange({ linkedInUrl: event.target.value })}/>
      </label>
    </div>
    <div className="form-pair">
      <label>Portfolio website
        <input type="url" inputMode="url" value={profile.portfolioWebsiteUrl ?? ''} maxLength={2000} placeholder="https://your-portfolio.example" onChange={event => onChange({ portfolioWebsiteUrl: event.target.value })}/>
      </label>
      <label>Location
        <input value={profile.location ?? ''} maxLength={200} autoComplete="address-level2" placeholder="City, country or Remote" onChange={event => onChange({ location: event.target.value })}/>
      </label>
    </div>
    <div className="form-pair">
      <label>Total years of work experience
        <input type="number" inputMode="decimal" min="0" max="60" step="0.5" value={profile.totalExperienceYears ?? ''} placeholder="For example: 3" onChange={event => onChange({ totalExperienceYears: event.target.value === '' ? undefined : Number(event.target.value) })}/>
      </label>
      <label>Years in cybersecurity
        <input type="number" inputMode="decimal" min="0" max="60" step="0.5" value={profile.cybersecurityExperienceYears ?? ''} placeholder="Enter only cybersecurity experience" onChange={event => onChange({ cybersecurityExperienceYears: event.target.value === '' ? undefined : Number(event.target.value) })}/>
      </label>
    </div>
    <p className="subtle">Keep total work experience separate from cybersecurity experience. The agent may use these reviewed facts to position a salary suggestion within a vacancy’s published pay range; it will not claim that all your experience is in cybersecurity.</p>
    <div className="form-pair">
      <label>Current salary amount <span className="label-hint">Optional</span>
        <input type="number" inputMode="decimal" min="0.01" max="1000000000000" step="0.01" value={salaryText} placeholder="For example: 50000" onChange={event=>{const value=event.target.value;setSalaryText(value);const valid=/^\d+(?:\.\d{1,2})?$/.test(value);event.target.setCustomValidity(value&&!valid?'Enter an amount with up to two decimal places.':'');if(!value)onChange({currentSalary:undefined});else if(valid)onChange({currentSalary:{amount:Number(value),currency,period}});}}/>
      </label>
      <label>Currency
        <select value={currency} onChange={event=>{const next=event.target.value as SalaryFacts['currency'];setCurrency(next);if(salary)onChange({currentSalary:{...salary,currency:next}});}}>{currencies.map(option=><option key={option} value={option}>{option}</option>)}</select>
      </label>
    </div>
    <label>Current salary pay period
      <select value={period} onChange={event=>{const next=event.target.value as SalaryFacts['period'];setPeriod(next);if(salary)onChange({currentSalary:{...salary,period:next}});}}><option value="year">Per year</option><option value="month">Per month</option><option value="hour">Per hour</option></select>
    </label>
    <p className="subtle">Current salary is a fact you enter and review; it is not taken from your CV or estimated online. The agent uses it only if an employer form explicitly asks for current pay. Changing it makes unsent application materials need review again.</p>
  </>;
}
