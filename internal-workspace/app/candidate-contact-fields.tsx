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
  </>;
}
