'use client';

import { useCallback, useEffect, useState } from 'react';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  decideVerification,
  listPendingVerifications,
  signVerificationDocs,
} from '@apartclean/shared/cleaner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// /admin/verifikacije (SPEC sekcija 7 — admin): dokument i selfi jedno pored
// drugog, Odobri ili Odbij sa razlogom. Fajlove briše Edge Function, odmah po odluci.

type Request = Awaited<ReturnType<typeof listPendingVerifications>>[number];

export function VerificationQueue() {
  const [rows, setRows] = useState<Request[] | null>(null);
  const [links, setLinks] = useState<Map<string, string>>(new Map());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const pending = await listPendingVerifications(client);
        if (!active) return;
        setRows(pending);
        setLinks(
          await signVerificationDocs(
            client,
            pending.flatMap((row) => [row.doc_front_path, row.selfie_path]),
          ),
        );
      } catch {
        if (active) setMessage('admin.onlyAdmin');
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const decide = useCallback(async (request: Request, approve: boolean) => {
    const client = supabase;
    if (!client) return;
    const reason = reasons[request.id]?.trim() ?? '';
    if (!approve && reason === '') return;
    setBusy(request.id);
    setMessage(null);
    try {
      await decideVerification(client, { requestId: request.id, approve, reason });
      setMessage('admin.decided');
      setReloadToken((value) => value + 1);
    } catch {
      setMessage('admin.decisionFailed');
    } finally {
      setBusy(null);
    }
  }, [reasons]);

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t('admin.queueTitle')}</h1>

      {message && (
        <p role="status" className={message === 'admin.decided' ? 'text-accent' : 'text-destructive'}>
          {t(message)}
        </p>
      )}

      {!rows && !message && <p role="status">{t('common.loading')}</p>}
      {rows?.length === 0 && <p className="text-muted-foreground">{t('admin.queueEmpty')}</p>}

      {rows?.map((row) => (
        <article key={row.id} className="grid gap-4 rounded-lg border p-4">
          <header className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-medium">{row.full_name}</h2>
            <p className="text-sm text-muted-foreground">
              {t(`verify.${row.document_type as 'licna_karta' | 'pasos'}`)} ·{' '}
              {new Date(row.created_at).toLocaleDateString('sr-Latn-RS')}
            </p>
          </header>

          {/* Jedno pored drugog — administrator poredi lice sa dokumentom. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['admin.document', row.doc_front_path],
              ['admin.selfie', row.selfie_path],
            ] as const).map(([label, path]) => (
              <figure key={label} className="grid gap-1">
                <figcaption className="text-sm text-muted-foreground">{t(label)}</figcaption>
                {path && links.get(path) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- potpisani link iz Supabase Storage-a
                  <img
                    src={links.get(path)}
                    alt={t(label)}
                    className="aspect-[4/3] w-full rounded-md border object-contain"
                  />
                ) : (
                  <p className="text-sm text-destructive">{t('common.error')}</p>
                )}
              </figure>
            ))}
          </div>

          <label className="grid gap-1 text-sm">
            {t('admin.rejectReason')}
            <input
              className="min-h-11 rounded-md border bg-background px-3"
              value={reasons[row.id] ?? ''}
              onChange={(event) => setReasons({ ...reasons, [row.id]: event.target.value })}
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <Button variant="accent" disabled={busy === row.id} onClick={() => void decide(row, true)}>
              {t('admin.approve')}
            </Button>
            <Button
              variant="destructive"
              // Odbijanje bez razloga nema smisla: spremačica ne bi znala šta da popravi.
              disabled={busy === row.id || (reasons[row.id]?.trim() ?? '') === ''}
              onClick={() => void decide(row, false)}
            >
              {t('admin.reject')}
            </Button>
          </div>
        </article>
      ))}
    </main>
  );
}
