import type { Job } from './cyber-domain';
import { boardKey, type EmployerBoard, type JobSearch } from './job-catalog';

type VerifiedForm = {
  board: EmployerBoard;
  externalId: string;
  applyUrl: string;
  verifiedAt: string;
  authorizationReference: string;
};

// Add an exact vacancy only after the employer form, authorization, selected-CV
// upload, submission, and confirmation have been verified with the local worker.
// A public job feed or a draft form mapping is not sufficient evidence.
export const verifiedAutoApplyForms: readonly VerifiedForm[] = [];

export function verifiedAutoApplyBoards(): EmployerBoard[] {
  return [...new Map(verifiedAutoApplyForms.map(form => [boardKey(form.board), form.board])).values()];
}

export function verifiedAutoApplySearch(settings: JobSearch): JobSearch {
  return { ...settings, boards: verifiedAutoApplyBoards() };
}

export function isVerifiedAutoApplyJob(job: Job): boolean {
  if (!job.source || job.source.availability !== 'open') return false;
  return verifiedAutoApplyForms.some(form =>
    boardKey(form.board) === boardKey(job.source!) &&
    form.externalId === job.source!.externalId &&
    form.applyUrl === (job.applyUrl || job.url) &&
    Boolean(form.verifiedAt && form.authorizationReference)
  );
}
