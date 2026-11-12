'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  cancelTask,
  completeTask,
  getTask,
  markReady,
  offerTask,
  openDispute,
  ownerActions,
  requestFixes,
  type TaskDetails as Details,
} from '@apartclean/shared/task';
import { StatusBadge } from '@/components/task-list';

// Sekunde ništa ne znače vlasniku, a prave šum u svakom redu.
const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// /app/zadaci/[id] (SPEC sekcija 7): vremenska linija, spremačica i radnje.
// Svaka radnja je jedan prelaz iz SPEC sekcije 5 i ide kroz svoj RPC.

type Action = ReturnType<typeof ownerActions>[number];

const NEEDS_REASON: Action[] = ['cancel', 'requestFixes', 'dispute'];

export function TaskDetails({ id }: { id: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const data = await getTask(client, id);
        if (active) setDetails(data);
      } catch {
        if (active) setMessage('task.loadFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, [id, reloadToken]);

  const run = useCallback(
    async (action: Action) => {
      const client = supabase;
      if (!client) return;
      if (NEEDS_REASON.includes(action) && reason.trim() === '') return;
      setBusy(true);
      setMessage(null);
      try {
        if (action === 'offer') await offerTask(client, id);
        else if (action === 'cancel') await cancelTask(client, id, reason);
        else if (action === 'markReady') await markReady(client, id);
        else if (action === 'requestFixes') await requestFixes(client, id, reason);
        else if (action === 'complete') await completeTask(client, id);
        else if (action === 'dispute') await openDispute(client, id, reason);
        setReason('');
        setMessage('action.done');
        setReloadToken((value) => value + 1);
      } catch (problem) {
        // Baza vraća kod greške; ako za njega imamo prevod, pokazujemo njega.
        const code = problem instanceof Error ? problem.message : '';
        const key = `error.${code}` as TranslationKey;
        setMessage(code && t(key) !== key ? key : 'action.failed');
      } finally {
        setBusy(false);
      }
    },
    [id, reason],
  );

  if (!details) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <p role={message ? 'alert' : 'status'} className={message ? 'text-destructive' : ''}>
          {t(message ?? 'common.loading')}
        </p>
      </main>
    );
  }

  const { task, propertyName, cleanerName, timeline, offers } = details;
  const actions = ownerActions(task.status);
  const needsReason = actions.some((action) => NEEDS_REASON.includes(action));

  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-8">
      <header className="grid gap-2">
        <Link href="/app/zadaci" className="text-sm underline">
          {t('task.title')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{propertyName}</h1>
          <StatusBadge status={task.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {new Date(task.window_start).toLocaleString('sr-Latn-RS', DATE_TIME)} –{' '}
          {new Date(task.window_end).toLocaleTimeString('sr-Latn-RS', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          {' · '}
          {t(`taskType.${task.type}`)}
        </p>
      </header>

      {message && (
        <p role="status" className={message === 'action.done' ? 'text-accent' : 'text-destructive'}>
          {t(message)}
        </p>
      )}

      <section className="grid gap-2 rounded-lg border p-4">
        <p className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t('task.cleaner')}</span>
          <span>{cleanerName ?? t('task.noCleaner')}</span>
        </p>
        {task.price_rsd !== null && (
          <p className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{t('task.price')}</span>
            <span>{task.price_rsd}</span>
          </p>
        )}
        {offers.length > 0 && (
          <p className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{t('task.offers')}</span>
            <span>{offers.length}</span>
          </p>
        )}
        {task.owner_notes && <p className="pt-2 text-sm">{task.owner_notes}</p>}
        {task.cancel_reason && (
          <p className="pt-2 text-sm text-destructive">{task.cancel_reason}</p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-medium">{t('timeline.title')}</h2>
        <ol className="grid gap-2">
          {timeline.map((step) => (
            <li key={step.key} className="flex justify-between gap-4 border-l-2 border-accent pl-3 text-sm">
              <span>{t(step.key as TranslationKey)}</span>
              <span className="text-muted-foreground">
                {new Date(step.at).toLocaleString('sr-Latn-RS', DATE_TIME)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {actions.length > 0 && (
        <section className="grid gap-3">
          {needsReason && (
            <label className="grid gap-1 text-sm">
              {t('action.reasonPrompt')}
              <input
                className="min-h-11 rounded-md border bg-background px-3"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
          <div className="flex flex-wrap gap-3">
            {actions.map((action) => (
              <Button
                key={action}
                variant={action === 'cancel' || action === 'dispute' ? 'destructive' : 'default'}
                disabled={busy || (NEEDS_REASON.includes(action) && reason.trim() === '')}
                onClick={() => void run(action)}
              >
                {t(`action.${action}` as TranslationKey)}
              </Button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
