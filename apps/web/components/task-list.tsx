'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  TASK_STATUSES,
  TASK_STATUS_TONE,
  t,
  type StatusTone,
  type TaskStatus,
} from '@apartclean/shared';
import { listTasks } from '@apartclean/shared/task';
import { buttonVariants } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// /app/zadaci (SPEC sekcija 7): lista sa filterom po statusu.

type Row = Awaited<ReturnType<typeof listTasks>>[number];

const TONE: Record<StatusTone, string> = {
  ready: 'bg-ready-surface text-ready-light dark:bg-ready-surfaceDark dark:text-ready-dark',
  pending: 'bg-pending-surface text-pending-light dark:bg-pending-surfaceDark dark:text-pending-dark',
  problem: 'bg-problem-surface text-problem-light dark:bg-problem-surfaceDark dark:text-problem-dark',
  neutral: 'bg-secondary text-secondary-foreground',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${TONE[TASK_STATUS_TONE[status]]}`}>
      {t(`taskStatus.${status}`)}
    </span>
  );
}

export function TaskList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const data = await listTasks(client, status ? { status } : {});
        if (active) setRows(data);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [status]);

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('task.title')}</h1>
        <Link href="/app/zadaci/novi" className={buttonVariants()}>
          {t('task.new')}
        </Link>
      </header>

      <select
        className="min-h-11 w-full max-w-xs rounded-md border bg-background px-3"
        value={status}
        onChange={(event) => setStatus(event.target.value as TaskStatus | '')}
      >
        <option value="">{t('task.allStatuses')}</option>
        {TASK_STATUSES.map((value) => (
          <option key={value} value={value}>
            {t(`taskStatus.${value}`)}
          </option>
        ))}
      </select>

      {failed && (
        <p role="alert" className="text-destructive">
          {t('task.loadFailed')}
        </p>
      )}
      {!rows && !failed && <p role="status">{t('common.loading')}</p>}
      {rows?.length === 0 && <p className="text-muted-foreground">{t('task.none')}</p>}

      <ul className="grid gap-3">
        {rows?.map((row) => (
          <li key={row.id}>
            <Link
              href={'/app/zadaci/' + row.id}
              className="flex min-h-touch flex-wrap items-center justify-between gap-3 rounded-lg border p-4 hover:bg-secondary"
            >
              <span className="grid gap-1">
                <span className="font-medium">{row.propertyName}</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(row.window_start).toLocaleString('sr-Latn-RS', {
                    day: 'numeric',
                    month: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {t(`taskType.${row.type}`)}
                  {row.price_rsd ? ` · ${row.price_rsd} RSD` : ''}
                </span>
              </span>
              <StatusBadge status={row.status} />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
