'use client';

import { useEffect, useState } from 'react';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  listNotifications,
  markAllRead,
  markRead,
  type Notification,
} from '@apartclean/shared/notification';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// /app/obavestenja (SPEC sekcija 7). Push je na telefonu; ovde je spisak.

export function NotificationList() {
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const data = await listNotifications(client);
        if (active) setRows(data);
      } catch {
        if (active) setMessage('notifications.loadFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const unread = rows?.filter((row) => row.read_at === null).length ?? 0;

  return (
    <main className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('notifications.title')}</h1>
        {unread > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              const client = supabase;
              if (!client) return;
              void markAllRead(client).then(() => setReloadToken((value) => value + 1));
            }}
          >
            {t('notifications.markAll')}
          </Button>
        )}
      </header>

      {unread > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('notifications.unread', undefined, { broj: unread })}
        </p>
      )}

      {message && (
        <p role="alert" className="text-destructive">
          {t(message)}
        </p>
      )}
      {!rows && !message && <p role="status">{t('common.loading')}</p>}
      {rows?.length === 0 && <p className="text-muted-foreground">{t('notifications.none')}</p>}

      <ul className="grid gap-3">
        {rows?.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => {
                const client = supabase;
                if (!client || row.read_at) return;
                void markRead(client, row.id).then(() => setReloadToken((value) => value + 1));
              }}
              className={`grid w-full min-h-touch gap-1 rounded-lg border p-4 text-left ${
                row.read_at ? '' : 'border-accent bg-accent/5'
              }`}
            >
              <span className="font-medium">{row.title}</span>
              <span className="text-sm text-muted-foreground">{row.body}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString('sr-Latn-RS', {
                  day: 'numeric',
                  month: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
