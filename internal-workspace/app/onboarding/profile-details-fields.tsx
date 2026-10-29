"use client";
import type { AccountDetails } from '@/lib/cyber-domain';
import ExpectedSalaryFields from './expected-salary-fields';

export default function ProfileDetailsFields({value,onChange}:{value:AccountDetails;onChange:(patch:Partial<AccountDetails>)=>void}){
 return <div className="account-profile-details">
  <section aria-labelledby="profile-contact-title"><h2 id="profile-contact-title">Location & contact</h2><p className="subtle">Fill in your own details. These fields are optional, and you can update them later.</p>
   <label htmlFor="setup-location">Location<input id="setup-location" maxLength={200} value={value.location||''} onChange={e=>onChange({location:e.target.value})} placeholder="For example: Lagos, Nigeria"/></label>
   <label htmlFor="setup-address">Address<input id="setup-address" maxLength={500} autoComplete="street-address" value={value.address||''} onChange={e=>onChange({address:e.target.value})} placeholder="Street address"/></label>
   <div className="form-pair"><label htmlFor="setup-city">City<input id="setup-city" maxLength={200} autoComplete="address-level2" value={value.city||''} onChange={e=>onChange({city:e.target.value})}/></label><label htmlFor="setup-country">Country<input id="setup-country" maxLength={200} autoComplete="country-name" value={value.country||''} onChange={e=>onChange({country:e.target.value})}/></label></div>
   <div className="form-pair"><label htmlFor="setup-zip">Zip code / postal code<input id="setup-zip" maxLength={30} autoComplete="postal-code" value={value.zipCode||''} onChange={e=>onChange({zipCode:e.target.value})}/></label><label htmlFor="setup-phone">Phone number<input id="setup-phone" type="tel" autoComplete="tel" maxLength={35} title="Include your country calling code, for example +2348012345678, +447700900123 or +12025550123." placeholder="+2348012345678" value={value.phone||''} onChange={e=>onChange({phone:e.target.value})}/></label></div>
   <p className="subtle">Include the international calling code: +234, +44, +1, or your country’s code.</p>
  </section>
  <section aria-labelledby="profile-experience-title"><h2 id="profile-experience-title">Experience & salary</h2>
   <label htmlFor="setup-experience">Years of experience<input id="setup-experience" type="number" min="0" max="80" step="0.1" value={value.yearsExperience??''} onChange={e=>onChange({yearsExperience:e.target.value===''?null:Number(e.target.value)})}/><span className="label-hint">Your total professional experience. This is not automatically treated as cybersecurity experience.</span></label>
   <ExpectedSalaryFields salary={value.expectedSalary} onChange={expectedSalary=>onChange({expectedSalary})}/>
  </section>
  <section aria-labelledby="profile-visa-title"><h2 id="profile-visa-title">Visa requirements</h2><p className="subtle">Would you require a work visa or employer visa sponsorship to work in each country? Choose Yes or No for each. Leave unanswered if you are unsure.</p>
   {([{key:'ukVisaRequired',label:'UK'},{key:'usaVisaRequired',label:'USA'},{key:'canadaVisaRequired',label:'Canada'}] as const).map(({key,label})=><fieldset className="profile-visa" key={key}><legend>Do you require a work visa for {label}?</legend><div>{([true,false] as const).map(answer=><label className="check-label" key={String(answer)}><input type="checkbox" checked={value[key]===answer} onChange={e=>onChange({[key]:e.target.checked?answer:null})}/><span>{answer?'Yes':'No'}</span></label>)}<span className="label-hint">{value[key]==null?'Not answered':''}</span></div></fieldset>)}
  </section>
  <section aria-labelledby="profile-work-rights-title"><h2 id="profile-work-rights-title">Current right to work</h2><p className="subtle">Do you currently have legal permission to work in each country? Answer this separately from whether you need a visa or sponsorship. Leave unanswered if you are unsure.</p>
   {([{key:'ukRightToWork',label:'UK'},{key:'usaRightToWork',label:'USA'},{key:'canadaRightToWork',label:'Canada'}] as const).map(({key,label})=><fieldset className="profile-visa" key={key}><legend>Do you currently have the right to work in {label}?</legend><div>{([true,false] as const).map(answer=><label className="check-label" key={String(answer)}><input type="checkbox" checked={value[key]===answer} onChange={e=>onChange({[key]:e.target.checked?answer:null})}/><span>{answer?'Yes':'No'}</span></label>)}<span className="label-hint">{value[key]==null?'Not answered':''}</span></div></fieldset>)}
  </section>
 </div>;
}

