'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { Badge, Button, EmptyState, ErrorNotice, Field, Icon, Modal, Spinner } from '@/components/ui';
import { ExploreDeck } from '@/components/explore-deck';
import { CompanyMark, JobDetail, label, salaryLabel, type Job } from '@/components/job-detail';

interface SavedEntry { id: string; decision: 'saved' | 'passed'; job: Job }
interface JobList { items: (Job | SavedEntry)[]; total: number; limit: number; offset: number }
interface CompanyList { items: { company: string; open_jobs: number; following: boolean }[] }
interface SourceResult { created: number; updated: number; items: Job[] }
type BrowseMode = 'all' | 'saved' | 'passed';

export function JobsView({ search = false }: { search?: boolean }) {
  const { request, notify, navigate, refresh, demo } = useWorkspace();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [mode, setMode] = useState<BrowseMode>('all');
  const [remote, setRemote] = useState('');
  const [level, setLevel] = useState('');
  const [location, setLocation] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [followed, setFollowed] = useState<string[]>([]);
  const filtersCount = [remote, level, location].filter(Boolean).length;

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(query.trim()); setPage(0); }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const path = useMemo(() => {
    const params = new URLSearchParams({ limit: '12', offset: String(page * 12) });
    if (mode !== 'all') { params.set('decision', mode); return `/jobs/saved?${params}`; }
    if (!search) params.set('exclude_handled', 'true');
    if (debounced) params.set('q', debounced);
    if (remote) params.set('remote', remote);
    if (level) params.set('level', level);
    if (location.trim()) params.set('location', location.trim());
    return `/jobs?${params}`;
  }, [search, mode, page, debounced, remote, level, location]);
  const jobs = useLoad<JobList>(path);
  const companies = useLoad<CompanyList>('/companies?limit=6');
  const items = jobs.data?.items.map(item => 'job' in item ? { ...item.job, decision: item.decision } : item) ?? [];

  function changeMode(next: BrowseMode) { setMode(next); setPage(0); setError(null); }
  function resetFilters() { setQuery(''); setRemote(''); setLevel(''); setLocation(''); setPage(0); }
  function changed() { jobs.reload(); companies.reload(); refresh(); }

  async function decide(job: Job, decision: 'saved' | 'passed') {
    setBusy(`${job.id}-${decision}`); setError(null);
    try {
      if (job.decision === decision) {
        await request(`/jobs/${job.id}/decision`, { method: 'DELETE' });
        notify(decision === 'saved' ? 'Job removed from saved.' : 'Job returned to your opportunities.');
      } else {
        await request(`/jobs/${job.id}/${decision === 'saved' ? 'save' : 'pass'}`, { method: 'POST' });
        notify(decision === 'saved' ? 'Saved for your next move.' : 'Job moved to passed.');
      }
      changed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your job decision could not be saved.'); }
    finally { setBusy(''); }
  }

  async function follow(company: string) {
    setBusy(`follow-${company}`); setError(null);
    try {
      await request('/companies/following', { method: 'POST', body: JSON.stringify({ company }) });
      setFollowed(current => [...current, company]); companies.reload(); refresh();
      notify(`You’re now following ${company}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This company could not be followed.'); }
    finally { setBusy(''); }
  }

  return <div className={`jobs-view ${!search && mode === 'all' ? 'swipe-explore' : ''}`}>
    <header className="page-intro"><div><p className="eyebrow">{search ? 'FIND YOUR FIT' : 'YOUR NEXT CHAPTER'}</p><h1>{search ? <>Good opportunities.<br /><span>A better fit.</span></> : <>Explore your <span>next role.</span></>}</h1><p className="intro-description">{search ? 'Find cybersecurity roles that match your skills and the way you want to work.' : 'Swipe left to pass. Swipe right to start applying.'}</p></div><div className="intro-action">{!search && mode === 'all' && <Button variant="ghost" className="explore-filter" aria-label="Filter Explore jobs" onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="sliders" size={17} /></Button>}<Button variant="secondary" onClick={() => setImportOpen(true)}><Icon name="plus" size={16} />Add a job</Button></div></header>

    {(search || mode !== 'all' || filtersOpen || query) && <section className="search-section" aria-label="Search and filter jobs"><div className="search-row"><div className="search-input-wrap"><Icon name="search" size={19} /><input value={query} onChange={event => { setQuery(event.target.value); if (mode !== 'all') changeMode('all'); }} maxLength={200} aria-label="Search job title, company or skill" placeholder="Job title, company, or skill" />{query ? <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={15} /></button> : <span className="search-hint">Find your next role</span>}</div><button type="button" className={`filter-button ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen} aria-controls="job-filters"><Icon name="sliders" size={17} /><span>Filters</span>{filtersCount ? <b>{filtersCount}</b> : null}</button></div>
      {filtersOpen ? <div id="job-filters" className="filter-panel"><Field label="Work mode"><select className="field-input" aria-label="Work mode" value={remote} onChange={event => { setRemote(event.target.value); changeMode('all'); }}><option value="">Any work mode</option><option value="true">Remote</option><option value="false">In person or hybrid</option></select></Field><Field label="Experience level"><select className="field-input" aria-label="Experience level" value={level} onChange={event => { setLevel(event.target.value); changeMode('all'); }}><option value="">Any level</option>{['intern', 'entry', 'mid', 'senior', 'lead', 'manager', 'director', 'executive'].map(value => <option key={value} value={value}>{label(value)}</option>)}</select></Field><Field label="Location"><input className="field-input" placeholder="City or country" value={location} maxLength={200} onChange={event => { setLocation(event.target.value); changeMode('all'); }} /></Field><button type="button" className="clear-filters" onClick={resetFilters}>Reset filters</button></div> : null}
    </section>}

    <div className="browse-toolbar"><div className="browse-tabs" role="tablist" aria-label="Browse jobs">{([['all', search ? 'All jobs' : 'For you'], ['saved', 'Saved'], ['passed', 'Passed']] as const).map(([value, title]) => <button type="button" key={value} role="tab" aria-selected={mode === value} className={mode === value ? 'active' : ''} onClick={() => changeMode(value)}>{value === 'saved' ? <Icon name="bookmark" size={14} /> : null}{title}</button>)}</div><span className="results-count" aria-live="polite">{jobs.loading ? 'Finding opportunities…' : jobs.data ? `${jobs.data.total} ${mode === 'all' ? 'opportunities' : `${mode} jobs`}` : ''}</span></div>
    <ErrorNotice error={error || jobs.error} />

    {!search && mode === 'all' ? <><ExploreDeck jobs={items} loading={jobs.loading} filterKey={path} onChanged={changed} onDetails={setSelectedJob} onReset={() => { resetFilters(); setPage(0); jobs.reload(); }} />{(jobs.data?.total ?? 0) > 12 && <nav className="jobs-pagination" aria-label="Job result pages"><Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page + 1}</span><Button variant="ghost" disabled={(page + 1) * 12 >= (jobs.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button></nav>}</> : jobs.loading ? <div className="jobs-grid" aria-busy="true" aria-label="Loading jobs">{[0, 1, 2, 3].map(index => <div className="job-skeleton" key={index}><div className="skeleton-top"><span /><div><i /><i /></div></div><i className="skeleton-title" /><i className="skeleton-description" /><div className="skeleton-chips"><i /><i /><i /></div><div className="skeleton-footer"><i /><i /></div></div>)}</div> : !items.length ? <EmptyState icon="search" title={mode === 'saved' ? 'Your next move starts with a save.' : mode === 'passed' ? 'No passed jobs yet.' : debounced || filtersCount ? 'No roles match this search yet.' : 'Your opportunities belong here.'} description={mode === 'saved' ? 'Save a role that catches your eye and come back when you’re ready.' : mode === 'passed' ? 'Roles you pass on will stay here, so you can revisit them later.' : debounced || filtersCount ? 'Try a broader title, a different location, or fewer filters.' : 'Add a job description or import a public employer board to start exploring.'} action={<Button variant="secondary" onClick={() => mode !== 'all' ? changeMode('all') : debounced || filtersCount ? resetFilters() : setImportOpen(true)}>{mode !== 'all' ? 'Explore roles' : debounced || filtersCount ? 'Clear filters' : 'Add your first job'}<Icon name="arrow-right" size={16} /></Button>} /> : <>
      <div className="jobs-grid">{items.map(job => <article className="job-card" key={job.id}><div className="job-card-top"><div className="company-identity"><CompanyMark company={job.company} /><div><span className="company-title">{job.company}</span><span className="company-location"><Icon name="map-pin" size={11} />{job.location || 'Location not listed'}</span></div></div>{job.match ? <span className={`fit-badge ${job.match.score >= 80 ? 'high' : ''}`} title="Heuristic fit estimate"><span className="fit-dot" />{job.match.score}<small>fit</small></span> : job.decision === 'saved' ? <Badge tone="info">Saved</Badge> : null}</div><button type="button" className="job-title" onClick={() => setSelectedJob(job)}>{job.title}</button><div className="job-tags">{job.remote ? <span className="job-tag remote"><Icon name="globe" size={11} />Remote</span> : job.attributes?.workplace_type && job.attributes.workplace_type !== 'unspecified' ? <span className="job-tag">{label(job.attributes.workplace_type)}</span> : null}{job.employment_type && job.employment_type !== 'unspecified' ? <span className="job-tag">{label(job.employment_type)}</span> : null}{job.level && job.level !== 'unspecified' ? <span className="job-tag">{label(job.level)}</span> : null}{job.is_demo ? <span className="job-tag demo">Demo</span> : null}{job.decision === 'passed' ? <span className="job-tag passed">Passed</span> : null}</div><p className="job-salary">{salaryLabel(job)}</p><div className="card-skills">{job.required_skills?.slice(0, 3).map(skill => <span key={skill}>{skill}</span>)}{(job.required_skills?.length ?? 0) > 3 ? <span>+{job.required_skills!.length - 3}</span> : null}{!job.required_skills?.length ? <span className="skills-unspecified">Explore the full role details</span> : null}</div><footer className="job-card-footer"><button type="button" className="view-role" onClick={() => setSelectedJob(job)}>View role <Icon name="arrow-right" size={15} /></button><div className="card-actions"><button type="button" className={`pass-button ${job.decision === 'passed' ? 'passed' : ''}`} aria-label={`${job.decision === 'passed' ? 'Return' : 'Pass on'} ${job.title} at ${job.company}`} aria-pressed={job.decision === 'passed'} title={job.decision === 'passed' ? 'Return to opportunities' : 'Pass on this role'} disabled={!!busy} onClick={() => decide(job, 'passed')}>{busy === `${job.id}-passed` ? <Spinner /> : <Icon name={job.decision === 'passed' ? 'refresh' : 'x'} size={16} />}</button><button type="button" className={`save-button ${job.decision === 'saved' ? 'saved' : ''}`} aria-label={`${job.decision === 'saved' ? 'Unsave' : 'Save'} ${job.title} at ${job.company}`} aria-pressed={job.decision === 'saved'} title={job.decision === 'saved' ? 'Remove from saved' : 'Save for later'} disabled={!!busy} onClick={() => decide(job, 'saved')}>{busy === `${job.id}-saved` ? <Spinner /> : <Icon name={job.decision === 'saved' ? 'check' : 'bookmark'} size={16} />}</button></div></footer></article>)}</div>
      {(jobs.data?.total ?? 0) > 12 ? <nav className="jobs-pagination" aria-label="Job result pages"><Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevron-left" size={16} />Previous</Button><span>Page {page + 1} of {Math.ceil((jobs.data?.total ?? 0) / 12)}</span><Button variant="ghost" disabled={(page + 1) * 12 >= (jobs.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next<Icon name="chevron-right" size={16} /></Button></nav> : null}
    </>}

    {!search && mode === 'all' && !query && !!companies.data?.items.length ? <section className="companies-section"><div className="section-heading"><div><h2>Follow your future.</h2><p>Keep the companies you’re interested in close.</p></div><Icon name="building" size={22} /></div><div className="company-strip">{companies.data.items.map(company => { const following = company.following || followed.includes(company.company); return <div className="company-card" key={company.company}><CompanyMark company={company.company} /><h3>{company.company}</h3><p>{company.open_jobs} open {company.open_jobs === 1 ? 'role' : 'roles'}</p><Button variant={following ? 'ghost' : 'secondary'} size="sm" fullWidth disabled={following || !!busy} loading={busy === `follow-${company.company}`} onClick={() => follow(company.company)}>{following ? <><Icon name="check" size={13} />Following</> : 'Follow company'}</Button></div>; })}</div></section> : null}
    {selectedJob ? <JobDetail key={selectedJob.id} job={selectedJob} onClose={() => setSelectedJob(null)} onChanged={changed} /> : null}
    <ImportJob open={importOpen} onClose={() => setImportOpen(false)} onImported={changed} demo={demo} />
    <style jsx>{`
      .jobs-view { max-width: 1120px; margin: 0 auto; }
      .swipe-explore .page-intro { margin-bottom: 16px; align-items: center; }
      .swipe-explore h1 { font-size: 29px; margin-bottom: 7px; }
      .swipe-explore .eyebrow { margin-bottom: 8px; }
      .intro-action { display:flex; align-items:center; gap:7px; }
      .swipe-explore .browse-toolbar { margin-bottom: 16px; }
      @media(max-width:730px) { .swipe-explore .eyebrow, .swipe-explore .intro-description { display:none; } .swipe-explore .page-intro { margin-bottom:15px; gap:8px; } .swipe-explore h1 { font-size:23px; margin:0; } .swipe-explore .intro-action { padding:0; gap:2px; } .swipe-explore .intro-action :global(.btn) { padding:7px 9px; font-size:10px; } .swipe-explore .browse-toolbar { margin-bottom:11px; } }
      .page-intro { display: flex; justify-content: space-between; gap: 22px; align-items: flex-start; margin-bottom: 26px; }
      .eyebrow { font-size: 10px; letter-spacing: .15em; font-weight: 700; color: #9a91a7; margin: 0 0 14px; }
      h1 { font-size: clamp(28px, 3.2vw, 39px); line-height: 1.15; letter-spacing: -.06em; font-weight: 650; color: #2b293b; margin: 0 0 14px; }
      h1 span { color: #8c80b0; }
      .intro-description { font-size: 13px; line-height: 1.8; color: #958b9f; max-width: 510px; margin: 0; }
      .intro-action { padding-top: 12px; }
      .discovery-banner { background: linear-gradient(112deg, #ebe7f7, #f3f0fa 64%, #ece8f7); border: 1px solid #e7e1f3; border-radius: 20px; padding: 26px 30px; display: flex; align-items: center; justify-content: space-between; position: relative; overflow: hidden; margin-bottom: 26px; }
      .banner-eyebrow { display: flex; align-items: center; gap: 6px; font-size: 9px; letter-spacing: .12em; color: #9d8dc0; font-weight: 750; }
      .discovery-banner h2 { font-size: 23px; font-weight: 600; letter-spacing: -.045em; color: #6e6090; margin: 12px 0 8px; }
      .discovery-banner p { font-size: 12px; color: #a293b4; margin: 0; line-height: 1.7; }
      .discovery-banner button { display: flex; gap: 7px; align-items: center; border: 0; background: transparent; padding: 0; color: #806fa6; font-size: 11px; font-weight: 650; margin-top: 17px; cursor: pointer; }
      .banner-graphic { width: 180px; height: 150px; position: relative; margin: -10px 18px -10px 0; flex-shrink: 0; }
      .graphic-orbit { position: absolute; border: 1px solid #dbd3ec; border-radius: 50%; left: 50%; top: 50%; transform: translate(-50%, -50%); }
      .orbit-one { width: 115px; height: 115px; } .orbit-two { width: 165px; height: 165px; border-style: dashed; opacity: .6; }
      .graphic-shield { position: absolute; top: 38px; left: 54px; width: 72px; height: 72px; border-radius: 25px; background: linear-gradient(150deg, #fff, #e7dff2); box-shadow: 0 9px 24px #b9a7d324, inset 0 1px 0 white; color: #a28bc4; display: flex; align-items: center; justify-content: center; transform: rotate(-8deg); }
      .graphic-dot { position: absolute; width: 9px; height: 9px; border-radius: 50%; background: #bdaed4; box-shadow: 0 0 0 5px #ffffff88; }
      .dot-one { top: 25px; left: 44px; } .dot-two { bottom: 23px; right: 39px; width: 6px; height: 6px; background: #acbbad; }
      .search-section { margin-bottom: 26px; }
      .search-row { display: flex; gap: 10px; }
      .search-input-wrap { border: 1px solid #e8e3ec; background: white; border-radius: 12px; height: 51px; display: flex; gap: 11px; align-items: center; padding: 0 16px; flex: 1; min-width: 0; color: #a096ad; box-shadow: 0 2px 4px #31244802; }
      .search-input-wrap:focus-within { border-color: #a69bc4; box-shadow: 0 0 0 3px #9782bc12; }
      .search-input-wrap input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; font-size: 12px; color: #6f647e; }
      .search-input-wrap input::placeholder { color: #a79eaf; }
      .search-input-wrap button { display: flex; padding: 3px; border: 0; background: transparent; color: #aaa0b4; cursor: pointer; }
      .search-hint { font-size: 10px; color: #b9b0c1; white-space: nowrap; }
      .filter-button { height: 51px; padding: 0 18px; display: flex; gap: 8px; align-items: center; border: 1px solid #e8e3ec; border-radius: 12px; color: #8a7a9c; background: white; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
      .filter-button.active { background: #f0ecf7; border-color: #d7cce9; color: #8771ae; }
      .filter-button b { background: #e8e0f3; font-size: 10px; width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }
      .filter-panel { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; background: #fdfcff; border: 1px solid #ede8f2; padding: 20px; margin-top: 10px; border-radius: 14px; }
      .clear-filters { border: 0; background: transparent; color: #9884b0; font-size: 11px; padding: 0; justify-self: start; cursor: pointer; }
      .browse-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 20px; }
      .browse-tabs { display: flex; gap: 5px; }
      .browse-tabs button { display: flex; align-items: center; gap: 5px; border: 0; background: transparent; padding: 8px 14px; border-radius: 8px; font: inherit; font-size: 11px; font-weight: 600; color: #a69aac; cursor: pointer; }
      .browse-tabs button.active { background: #eee8f5; color: #8a76a7; }
      .results-count { font-size: 10px; color: #aaa0b3; white-space: nowrap; }
      .jobs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .job-card { background: white; border: 1px solid #e9e3ee; border-radius: 18px; padding: 23px 24px 0; min-width: 0; box-shadow: 0 2px 3px #33234602; transition: border-color .15s, box-shadow .15s; }
      .job-card:hover { border-color: #cdbedc; box-shadow: 0 7px 23px #7e66950a; }
      .job-card-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
      .company-identity { display: flex; align-items: center; gap: 11px; min-width: 0; }
      .company-identity > div { min-width: 0; }
      .company-title { font-size: 11px; font-weight: 600; color: #8e819b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 235px; }
      .company-location { display: flex; align-items: center; gap: 3px; margin-top: 6px; font-size: 10px; color: #b3a7be; }
      .fit-badge { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; padding: 5px 8px; border: 1px solid #eee7f3; border-radius: 8px; font-size: 12px; font-weight: 650; color: #a288b7; background: #fcf9ff; flex-shrink: 0; }
      .fit-badge.high { color: #86a48d; background: #f5faf5; border-color: #e4eee4; }
      .fit-badge small { font-size: 9px; font-weight: 500; }
      .fit-dot { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
      .job-title { border: 0; padding: 0; background: transparent; color: #6a587b; font: inherit; font-size: 20px; font-weight: 650; letter-spacing: -.045em; line-height: 1.3; text-align: left; margin: 20px 0 12px; cursor: pointer; min-height: 26px; }
      .job-title:hover { color: #9274af; }
      .job-tags { display: flex; flex-wrap: wrap; gap: 6px; min-height: 24px; }
      .job-tag { display: inline-flex; align-items: center; gap: 4px; background: #f7f3fa; color: #aa97b8; border-radius: 6px; padding: 4px 7px; font-size: 9px; line-height: 1.4; }
      .job-tag.remote { background: #f0f6f2; color: #95ad9b; }
      .job-tag.demo { background: #faf4e9; color: #b6a377; }
      .job-salary { color: #9b88ae; font-size: 12px; font-weight: 600; margin: 16px 0 12px; }
      .card-skills { display: flex; gap: 6px; flex-wrap: wrap; min-height: 23px; margin-bottom: 19px; }
      .card-skills span { font-size: 9px; color: #b0a0bd; border: 1px solid #eee6f3; border-radius: 6px; padding: 4px 7px; }
      .card-skills .skills-unspecified { border: 0; padding: 4px 0; color: #bbaac7; }
      .job-card-footer { border-top: 1px solid #f0e9f5; display: flex; justify-content: space-between; align-items: center; padding: 13px 0; }
      .view-role { border: 0; display: flex; align-items: center; gap: 6px; font: inherit; background: transparent; color: #a48bb7; font-size: 10px; font-weight: 650; padding: 5px 0; cursor: pointer; }
      .card-actions { display: flex; gap: 7px; }
      .card-actions button { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 11px; cursor: pointer; transition: background .15s; }
      .pass-button { border: 1px solid #f0e6ed; background: #fff; color: #c0a5b7; }
      .pass-button:hover { background: #fcf1f5; }
      .save-button { border: 1px solid #e9e0f0; background: #f8f3fc; color: #b2a0c4; }
      .save-button:hover, .save-button.saved { background: #eee5f5; color: #a18ab8; }
      .card-actions button:disabled { cursor: wait; opacity: .5; }
      .jobs-pagination { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 24px; }
      .jobs-pagination > span { font-size: 10px; color: #ac9bbb; }
      .companies-section { margin-top: 42px; }
      .section-heading { display: flex; align-items: center; justify-content: space-between; color: #c0accd; margin-bottom: 19px; }
      .section-heading h2 { font-size: 21px; letter-spacing: -.05em; font-weight: 600; color: #947ca8; margin: 0 0 7px; }
      .section-heading p { font-size: 11px; color: #b4a0c5; margin: 0; }
      .company-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; }
      .company-card { border: 1px solid #eee5f4; background: #fff; border-radius: 16px; padding: 20px; }
      .company-card h3 { font-size: 13px; color: #a08aad; font-weight: 600; margin: 14px 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .company-card p { font-size: 10px; color: #bba8c7; margin: 0 0 17px; }
      .job-skeleton { border: 1px solid #eee8f2; background: #fff; border-radius: 18px; padding: 23px; min-height: 264px; }
      .job-skeleton i, .skeleton-top span { display: block; border-radius: 5px; background: #f5f0f8; animation: skeleton-pulse 1.3s ease-in-out infinite alternate; }
      .skeleton-top { display: flex; gap: 12px; align-items: center; }
      .skeleton-top span { width: 46px; height: 46px; border-radius: 15px; }
      .skeleton-top i { width: 105px; height: 9px; margin: 5px 0; }
      .skeleton-top i + i { width: 70px; }
      .job-skeleton .skeleton-title { width: 68%; height: 19px; margin: 22px 0 14px; }
      .job-skeleton .skeleton-description { width: 48%; height: 9px; margin-bottom: 24px; }
      .skeleton-chips { display: flex; gap: 7px; margin-bottom: 28px; }
      .skeleton-chips i { width: 63px; height: 21px; }
      .skeleton-footer { border-top: 1px solid #f5eff8; display: flex; justify-content: space-between; padding-top: 14px; }
      .skeleton-footer i { width: 58px; height: 12px; }
      .jobs-view { color: var(--text, #2b293b); }
      h1, .job-title, .section-heading h2, .company-card h3 { color: var(--text, #302e42); }
      h1 span, .view-role, .discovery-banner button, .browse-tabs button.active, .save-button, .save-button.saved, .fit-badge, .job-salary { color: var(--accent, #6956ac); }
      .eyebrow, .intro-description, .search-hint, .results-count, .company-title, .company-location, .clear-filters, .browse-tabs button, .job-tag, .card-skills span, .card-skills .skills-unspecified, .company-card p, .section-heading p, .jobs-pagination > span { color: var(--muted, #77717f); }
      .company-title { font-size: 12px; }
      .company-location, .job-tag, .card-skills span, .results-count, .company-card p { font-size: 11px; }
      .view-role, .browse-tabs button { font-size: 12px; }
      .search-input-wrap, .filter-button, .job-card, .company-card, .job-skeleton, .pass-button { background: var(--surface, #fff); border-color: var(--border, #e8e3ec); }
      .search-input-wrap, .search-input-wrap input, .filter-button, .pass-button { color: var(--muted, #746b7d); }
      .search-input-wrap input::placeholder { color: var(--muted, #84798e); }
      .search-input-wrap:focus-within { border-color: var(--accent, #6956ac); }
      .filter-panel { background: var(--surface, #fff); border-color: var(--border, #e8e3ec); }
      .filter-button.active, .browse-tabs button.active, .job-tag, .save-button, .save-button:hover, .save-button.saved { background: var(--accent-soft, #eee8f5); border-color: var(--border, #e8e3ec); }
      .filter-button.active { color: var(--accent, #6956ac); }
      .job-card-footer, .card-skills span, .skeleton-footer { border-color: var(--border, #e8e3ec); }
      .job-card:hover { border-color: var(--accent, #b5a2cc); }
      .job-title:hover { color: var(--accent, #6956ac); }
      .job-title, .card-skills span { overflow-wrap: anywhere; }
      .fit-badge { background: var(--accent-soft, #f0ebf8); border-color: var(--border, #e8e3ec); }
      .fit-badge.high, .job-tag.remote { background: var(--success-soft); color: var(--success); border-color: var(--success-soft); }
      .job-tag.demo { background: var(--warning-soft); color: var(--warning); }
      .job-tag.passed { background: var(--danger-soft); color: var(--danger); }
      .pass-button:hover, .pass-button.passed { background: var(--danger-soft); color: var(--danger); }
      .discovery-banner { background: var(--accent-soft, #efebf7); border-color: var(--border, #e6dff0); }
      .banner-eyebrow, .discovery-banner h2 { color: var(--accent, #6956ac); }
      .discovery-banner p { color: var(--muted, #7e7191); }
      .graphic-orbit { border-color: var(--accent, #c3b4de); opacity: .15; }
      .graphic-shield { background: var(--surface, #fff); color: var(--accent, #9e8bbc); }
      .graphic-dot { background: var(--accent, #bdaed4); }
      .job-skeleton i, .skeleton-top span { background: var(--accent-soft, #f2edf7); }
      .search-input-wrap input { padding: 0; min-height: auto; border: 0; border-radius: 0; background: transparent; color: var(--text); }
      .search-input-wrap button, .section-heading { color: var(--muted); }
      .filter-button b { background: var(--accent-soft); color: var(--accent); }
      .jobs-view button:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
      @media(max-width: 400px) { .browse-toolbar { flex-wrap: wrap; gap: 8px; } .results-count { margin-left: auto; } }
      @keyframes skeleton-pulse { to { opacity: .4; } }
      @media(min-width: 1250px) { .company-strip { grid-template-columns: repeat(6, minmax(0, 1fr)); } .company-card { padding: 17px 14px; } }
      @media(max-width: 740px) { .jobs-grid { grid-template-columns: 1fr; } .page-intro { gap: 10px; } .intro-action { padding-top: 1px; } .intro-description { font-size: 12px; max-width: 320px; } .search-hint { display: none; } .discovery-banner { padding: 22px; } .banner-graphic { width: 104px; height: 126px; margin-right: -22px; margin-left: 10px; opacity: .8; } .orbit-one { width: 88px; height: 88px; } .orbit-two { width: 132px; height: 132px; } .graphic-shield { top: 37px; left: 24px; width: 57px; height: 57px; border-radius: 18px; } .graphic-shield :global(svg) { width: 31px; } .dot-one { left: 24px; top: 16px; } .dot-two { right: 14px; bottom: 15px; } .discovery-banner h2 { font-size: 20px; max-width: 240px; } .discovery-banner p { max-width: 250px; font-size: 11px; } .discovery-banner button { font-size: 10px; } .filter-panel { grid-template-columns: 1fr; padding: 17px; gap: 12px; } .filter-button { padding: 0 14px; } .results-count { font-size: 9px; } .browse-tabs button { padding: 8px 11px; } .job-card { padding: 21px 21px 0; } .company-strip { display: flex; overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x mandatory; } .company-card { width: 170px; flex-shrink: 0; scroll-snap-align: start; padding: 17px; } }
      @media(max-width: 400px) { .intro-action :global(.btn) { padding: 8px 10px; font-size: 10px; } h1 { font-size: 27px; } .eyebrow { font-size: 8px; } .intro-description { font-size: 11px; } .banner-graphic { display: none; } .company-title { max-width: 170px; } .filter-button span { display: none; } }
      @media(prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
    `}</style>
  </div>;
}

function ImportJob({ open, onClose, onImported, demo }: { open: boolean; onClose: () => void; onImported: () => void; demo: boolean }) {
  const { request, notify } = useWorkspace();
  const [tab, setTab] = useState<'manual' | 'source'>('manual');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [skills, setSkills] = useState('');
  const [workMode, setWorkMode] = useState('unspecified');
  const [provider, setProvider] = useState('greenhouse');
  const [board, setBoard] = useState('');
  const [region, setRegion] = useState('global');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null);
    try {
      if (tab === 'manual') {
        await request<Job>('/jobs/import', { method: 'POST', body: JSON.stringify({ title: title.trim(), company: company.trim(), description: description.trim(), location: location.trim(), source_url: url.trim(), apply_url: url.trim(), remote: workMode === 'remote', required_skills: skills.split(',').map(skill => skill.trim()).filter(Boolean), attributes: { workplace_type: workMode } }) });
        notify('Job added to your workspace. Explore its fit and prepare a draft.');
        setTitle(''); setCompany(''); setDescription(''); setLocation(''); setUrl(''); setSkills(''); setWorkMode('unspecified');
      } else {
        if (demo) throw new Error('Employer board imports need a connected live workspace. Demo mode does not fetch public listings.');
        const result = await request<SourceResult>('/jobs/import/source', { method: 'POST', body: JSON.stringify({ provider, board_token: board.trim(), company: company.trim(), region: provider === 'lever' ? region : 'global', cybersecurity_only: true, limit: 100 }) });
        notify(`${result.created} jobs added${result.updated ? `, ${result.updated} refreshed` : ''}.`, result.created || result.updated ? 'success' : 'info');
        setBoard('');
      }
      onImported(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'These jobs could not be imported.'); }
    finally { setPending(false); }
  }

  return <Modal open={open} onClose={onClose} title="Bring an opportunity in">
    <div className="import-shell"><p className="import-intro">Found a role elsewhere? Add it to your workspace and see how it fits.</p><div className="import-tabs" role="tablist" aria-label="Job import method"><button type="button" role="tab" aria-selected={tab === 'manual'} className={tab === 'manual' ? 'active' : ''} onClick={() => { setTab('manual'); setError(null); }}><Icon name="file-text" size={15} />Paste a job</button><button type="button" role="tab" aria-selected={tab === 'source'} className={tab === 'source' ? 'active' : ''} onClick={() => { setTab('source'); setError(null); }}><Icon name="building" size={15} />Employer board</button></div><form onSubmit={submit}>
      {tab === 'manual' ? <><Field label="Job title"><input className="field-input" value={title} required maxLength={300} onChange={event => setTitle(event.target.value)} placeholder="e.g., SOC Analyst" /></Field><Field label="Company"><input className="field-input" value={company} required maxLength={200} onChange={event => setCompany(event.target.value)} placeholder="Company name" /></Field><Field label="Job description"><textarea className="field-input description-input" value={description} required maxLength={100000} onChange={event => setDescription(event.target.value)} placeholder="Paste the full job description, including requirements." rows={6} /></Field><div className="import-row"><Field label="Location"><input className="field-input" value={location} maxLength={200} onChange={event => setLocation(event.target.value)} placeholder="City or country" /></Field><Field label="Work mode"><select className="field-input" aria-label="Work mode" value={workMode} onChange={event => setWorkMode(event.target.value)}><option value="unspecified">Not specified</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">On site</option></select></Field></div><Field label="Original job link" hint="Optional. A public HTTPS link is stored as a reference; the page is not fetched."><input className="field-input" value={url} type="url" pattern="https://.*" maxLength={2048} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></Field><Field label="Listed skills" hint="Optional. Separate the skills mentioned in the listing with commas."><input className="field-input" value={skills} maxLength={3000} onChange={event => setSkills(event.target.value)} placeholder="SIEM, incident response, Python" /></Field></> : <>{demo ? <div className="import-note"><Icon name="help" size={18} /><p>Live employer boards aren’t fetched in demo mode. Connect to your workspace to import public jobs.</p></div> : null}<Field label="Job board provider"><select className="field-input" aria-label="Job board provider" value={provider} onChange={event => setProvider(event.target.value)}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option></select></Field><Field label="Company name"><input className="field-input" value={company} required maxLength={200} onChange={event => setCompany(event.target.value)} placeholder="Company name" /></Field><Field label="Board name" hint={provider === 'greenhouse' ? 'The company token after boards.greenhouse.io/ or job-boards.greenhouse.io/.' : 'The company name after jobs.lever.co/.'}><input className="field-input" value={board} required maxLength={100} pattern="[A-Za-z0-9_-]+" onChange={event => setBoard(event.target.value)} placeholder="company-board-name" /></Field>{provider === 'lever' ? <Field label="Board region"><select className="field-input" aria-label="Board region" value={region} onChange={event => setRegion(event.target.value)}><option value="global">Global · jobs.lever.co</option><option value="eu">Europe · jobs.eu.lever.co</option></select></Field> : null}<div className="import-note"><Icon name="shield-check" size={18} /><p>Imports public cybersecurity listings only, up to 100 at a time. Submission options are shown for each role.</p></div></>}
      <ErrorNotice error={error} /><div className="import-footer"><Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" loading={pending} disabled={tab === 'source' && demo}>{tab === 'manual' ? 'Add job' : 'Import public jobs'}<Icon name="arrow-right" size={16} /></Button></div>
    </form></div>
    <style jsx>{`
      .import-intro { font-size: 13px; color: #8a7f9b; line-height: 1.75; margin: 0 0 21px; }
      .import-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: #f5effb; padding: 4px; border-radius: 11px; margin-bottom: 23px; }
      .import-tabs button { display: flex; justify-content: center; align-items: center; gap: 7px; border: 0; background: transparent; padding: 11px; border-radius: 8px; font: inherit; font-size: 11px; color: #b29bc6; font-weight: 600; cursor: pointer; }
      .import-tabs button.active { color: #b390c6; background: white; box-shadow: 0 2px 5px #63477107; }
      form { display: flex; flex-direction: column; gap: 16px; }
      .description-input { resize: vertical; min-height: 140px; line-height: 1.7; }
      .import-row { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
      .import-note { display: flex; gap: 10px; align-items: flex-start; border-radius: 11px; padding: 14px; background: #f7f1fc; color: #b596cc; border: 1px solid #f0e6f8; }
      .import-note p { font-size: 11px; line-height: 1.75; margin: 0; }
      .import-note :global(svg) { flex-shrink: 0; margin-top: 2px; }
      .import-footer { display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #f1e6f8; padding-top: 18px; margin-top: 3px; }
      .import-intro { color: var(--muted, #77717f); }
      .import-tabs, .import-note { background: var(--accent-soft, #f1ebf8); border-color: var(--border, #e8e1ee); }
      .import-tabs button { color: var(--muted, #77717f); }
      .import-tabs button.active { color: var(--accent, #6956ac); background: var(--surface, #fff); }
      .import-note { color: var(--muted, #77717f); }
      .import-footer { border-color: var(--border, #e8e1ee); }
      @media(max-width: 500px) { .import-row { grid-template-columns: 1fr; } }
    `}</style>
  </Modal>;
}
