'use client';

import { useState } from 'react';
import { useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { Badge, Button, Icon, Modal } from '@/components/ui';
import { PreferencesEditor, ProfileEditor, ProfileResponse, Resume, ResumeManager } from '@/components/profile-view';

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const { refresh, notify } = useWorkspace();
  const [step, setStep] = useState(0);
  const profile = useLoad<ProfileResponse>('/profiles/me');
  const resumes = useLoad<{ items: Resume[] }>('/resumes?limit=50');
  const ready = !!profile.data?.confirmed && !!resumes.data?.items.find(item => item.is_main)?.reviewed;
  const finish = () => { refresh(); notify(ready ? 'Your profile is ready. Let’s find your next opportunity.' : 'Setup saved. You can finish reviewing your résumé from your profile.', 'success'); onComplete(); };
  const steps = [
    { title: 'Let’s get to know you', description: 'Start with the facts you want employers to see. Add only what you know.' },
    { title: 'What does your next role look like?', description: 'Choose the roles, locations and work arrangements that suit you.' },
    { title: 'Bring your experience along', description: 'Add your résumé and confirm its facts. You can keep refining it later.' },
  ];
  return <Modal open onClose={onComplete} title="Your next chapter starts here" wide>
    <div className="stack onboarding">
      <div className="progress-steps" aria-label="Setup progress">{steps.map((item, index) => <div key={item.title} className={`progress-step ${index === step ? 'active' : index < step ? 'complete' : ''}`} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Icon name="check" size={15} /> : index + 1}</span><strong>{['Your profile', 'Your preferences', 'Your résumé'][index]}</strong></div>)}</div>
      <div><Badge tone="info">Step {step + 1} of 3</Badge><h2>{steps[step].title}</h2><p className="muted">{steps[step].description}</p></div>
      {step === 0 ? <ProfileEditor requireConfirmation onSaved={() => { profile.reload(); setStep(1); }} /> : step === 1 ? <PreferencesEditor onSaved={() => setStep(2)} /> : <ResumeManager onReviewed={() => resumes.reload()} />}
      <div className="divider" /><div className="row wrap onboarding-footer">{step > 0 && <Button variant="ghost" onClick={() => setStep(current => current - 1)}><Icon name="arrow-left" size={16} /> Back</Button>}<div className="grow" />{step === 2 ? <Button onClick={finish}>{ready ? 'Start exploring' : 'Finish for now'} <Icon name="arrow-right" size={17} /></Button> : <Button variant="ghost" onClick={onComplete}>Finish setup later</Button>}</div>
    </div>
  </Modal>;
}
