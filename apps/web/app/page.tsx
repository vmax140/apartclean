import {
  DEFAULT_LOCALE,
  TASK_STATUS_TONE,
  t,
  type StatusTone,
  type TaskStatus,
} from '@apartclean/shared';
import { ThemeToggle } from './theme-toggle';

const TONE_CLASS: Record<StatusTone, string> = {
  ready: 'bg-ready-surface text-ready-light dark:bg-ready-surfaceDark dark:text-ready-dark',
  pending:
    'bg-pending-surface text-pending-light dark:bg-pending-surfaceDark dark:text-pending-dark',
  problem:
    'bg-problem-surface text-problem-light dark:bg-problem-surfaceDark dark:text-problem-dark',
  neutral: 'bg-secondary text-secondary-foreground',
};

const SHOWCASE: TaskStatus[] = ['ready', 'in_progress', 'needs_fixes', 'draft'];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">{t('app.name', DEFAULT_LOCALE)}</h1>
          <p className="mt-2 text-lg text-accent">{t('app.tagline', DEFAULT_LOCALE)}</p>
        </div>
        <ThemeToggle />
      </div>

      <p className="text-muted-foreground">{t('app.description', DEFAULT_LOCALE)}</p>

      <div className="flex flex-wrap gap-2">
        {SHOWCASE.map((status) => (
          <span
            key={status}
            className={`rounded-full px-3 py-1 text-sm font-medium ${TONE_CLASS[TASK_STATUS_TONE[status]]}`}
          >
            {t(`taskStatus.${status}`, DEFAULT_LOCALE)}
          </span>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Faza 0: temelj projekta. Prijava, apartmani i zadaci stižu u Fazi 1.
      </p>
    </main>
  );
}
