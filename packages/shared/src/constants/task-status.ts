import { TASK_STATUSES, type TaskStatus } from './enums';

/**
 * Boja statusa po SPEC sekciji 7 „Dizajn": status se uvek vidi i bojom i rečju.
 * zeleno = spremno, žuto = u toku ili čeka, crveno = problem, sivo = neutralno.
 */
export type StatusTone = 'ready' | 'pending' | 'problem' | 'neutral';

export const TASK_STATUS_TONE: Readonly<Record<TaskStatus, StatusTone>> = {
  draft: 'neutral',
  open: 'pending',
  offered: 'pending',
  accepted: 'pending',
  in_progress: 'pending',
  submitted: 'pending',
  needs_fixes: 'problem',
  ready: 'ready',
  completed: 'ready',
  disputed: 'problem',
  cancelled: 'neutral',
  expired: 'problem',
};

/** Statusi u kojima zadatak još nije zatvoren — za liste „aktivno danas". */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  'open',
  'offered',
  'accepted',
  'in_progress',
  'submitted',
  'needs_fixes',
  'ready',
];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}
