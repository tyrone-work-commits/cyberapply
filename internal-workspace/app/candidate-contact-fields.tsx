import type { Profile } from '@/lib/cyber-domain';

export function CandidateContactFields({ profile, onChange }: { profile: Profile; onChange: (update: Partial<Profile>) => void }) {
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
  </>;
}
