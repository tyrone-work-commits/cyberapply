'use client';

import { useState, type FormEvent } from 'react';
import { useLoad } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { Badge, Button, Card, ErrorNotice, Field, Icon, Modal } from './ui';

type Task = { id: string; application_id: string; kind: 'interview' | 'follow_up'; title: string; due_at: string; remind_at: string; notes: string; done: boolean };
type AppChoice = { id: string; job_id: string; status: string };
const localDate = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function ApplicationOption({ app }: { app: AppChoice }) {
  const job = useLoad<{ title: string; company: string }>(`/jobs/${app.job_id}`);
  return <option value={app.id}>{job.data ? `${job.data.title} · ${job.data.company}` : 'Application ' + app.id.slice(0, 8)}</option>;
}

export function ApplicationSchedule() {
  const { request, refresh, notify } = useWorkspace();
  const tasks = useLoad<{ items: Task[] }>('/application-tasks?limit=200');
  const applications = useLoad<{ items: AppChoice[] }>('/applications?limit=100');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState('');
  const [kind, setKind] = useState<'interview' | 'follow_up'>('follow_up');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [reminder, setReminder] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const visible = tasks.data?.items.filter(task => completed ? task.done : !task.done) || [];
  function edit(task?: Task) {
    setEditing(task?.id || null); setApplicationId(task?.application_id || applications.data?.items[0]?.id || '');
    setKind(task?.kind || 'follow_up'); setTitle(task?.title || ''); setDue(task ? localDate(task.due_at) : '');
    setReminder(task ? localDate(task.remind_at) : ''); setNotes(task?.notes || ''); setError(''); setOpen(true);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy('save'); setError('');
    try {
      await request(editing ? `/application-tasks/${editing}` : '/application-tasks', { method: editing ? 'PUT' : 'POST', body: {
        application_id: applicationId, kind, title: title.trim(), due_at: new Date(due).toISOString(),
        remind_at: reminder ? new Date(reminder).toISOString() : undefined, notes,
      } });
      setOpen(false); tasks.reload(); refresh(); notify('Schedule saved. Reminders will appear in your updates.');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(''); }
  }
  async function action(task: Task, operation: 'done' | 'delete' | 'calendar') {
    if (busy) return; setBusy(task.id); setError('');
    try {
      if (operation === 'calendar') {
        const blob = await request<Blob>(`/application-tasks/${task.id}/calendar`, { responseType: 'blob' });
        const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'cyberapply-event.ics'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        await request(`/application-tasks/${task.id}`, { method: operation === 'delete' ? 'DELETE' : 'PATCH', body: operation === 'done' ? { done: !task.done } : undefined });
        tasks.reload(); refresh();
      }
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(''); }
  }
  return <Card className="stack application-schedule"><div className="section-heading"><div><h2>Your next steps</h2><p className="muted">Interview dates and follow-ups, in your local time.</p></div><Button variant="secondary" onClick={() => edit()} disabled={!applications.data?.items.length}><Icon name="plus" size={16} />Schedule</Button></div>
    <div className="row wrap" role="group" aria-label="Schedule status"><Button variant={completed ? 'ghost' : 'secondary'} size="sm" aria-pressed={!completed} onClick={() => setCompleted(false)}>Upcoming</Button><Button variant={completed ? 'secondary' : 'ghost'} size="sm" aria-pressed={completed} onClick={() => setCompleted(true)}>Completed</Button></div>
    <ErrorNotice error={tasks.error || (!open ? error : '')} />
    {visible.length ? visible.map(task => <article key={task.id} className="schedule-item"><div><div className="row wrap"><strong>{task.title}</strong><Badge tone={task.kind === 'interview' ? 'info' : 'neutral'}>{task.kind === 'interview' ? 'Interview' : 'Follow-up'}</Badge>{!task.done && Date.parse(task.due_at) < Date.now() && <Badge tone="warning">Due</Badge>}</div><time dateTime={task.due_at}>{new Date(task.due_at).toLocaleString()}</time>{task.notes && <p className="muted">{task.notes}</p>}</div><div className="row wrap"><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void action(task, 'done')}>{task.done ? 'Reopen' : 'Mark done'}</Button><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => edit(task)}>Edit</Button><Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void action(task, 'calendar')}>Add to calendar</Button><Button variant="ghost" className="icon-btn" aria-label={`Delete schedule ${task.title}`} disabled={!!busy} onClick={() => void action(task, 'delete')}><Icon name="trash" size={16} /></Button></div></article>) : <p className="muted">{completed ? 'Completed schedule items will appear here.' : 'Schedule an interview or follow-up after starting an application.'}</p>}
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title={editing ? 'Edit your next step' : 'Schedule your next step'}><form className="stack" onSubmit={save}><Field label="Application"><select value={applicationId} onChange={event => setApplicationId(event.target.value)} required><option value="">Choose an application</option>{applications.data?.items.map(app => <ApplicationOption key={app.id} app={app} />)}</select></Field><Field label="Type"><select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="follow_up">Follow-up reminder</option><option value="interview">Interview</option></select></Field><Field label="Title"><input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} required placeholder="e.g., Follow up with recruiter" /></Field><Field label="Date and time" hint="Your device’s local timezone is used."><input type="datetime-local" value={due} onChange={event => setDue(event.target.value)} required /></Field><Field label="Remind me at" hint="Optional. Interviews default to 30 minutes before; follow-ups default to the scheduled time."><input type="datetime-local" value={reminder} onChange={event => setReminder(event.target.value)} /></Field><Field label="Notes"><textarea rows={3} value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} /></Field><ErrorNotice error={error} /><Button type="submit" loading={busy === 'save'}>Save schedule</Button></form></Modal>
  </Card>;
}
