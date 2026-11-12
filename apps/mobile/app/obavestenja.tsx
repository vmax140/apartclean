import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  listNotifications,
  markAllRead,
  markRead,
  type Notification,
} from '@apartclean/shared/notification';
import { enablePush, type PushResult } from '../lib/push';
import { supabase } from '../lib/supabase';

// Spisak obaveštenja i uključivanje push-a (SPEC sekcija 7).
// Spisak radi i bez push-a — push je dodatak, ne uslov.

const press = 'min-h-11 items-center justify-center rounded-md px-5';
const muted = 'text-sm text-neutral-600 dark:text-neutral-400';

const PUSH_MESSAGE: Record<PushResult, TranslationKey> = {
  enabled: 'push.enabled',
  denied: 'push.denied',
  unsupported: 'push.unsupported',
  failed: 'push.unsupported',
};

export default function Notifications() {
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
    <ScrollView className="flex-1 bg-neutral-0 dark:bg-neutral-950" contentContainerClassName="gap-4 p-5">
      <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {t('notifications.title')}
      </Text>

      <Pressable
        className={`${press} border border-primary-700`}
        onPress={() => {
          const client = supabase;
          if (!client) return;
          void enablePush(client).then((result) => setMessage(PUSH_MESSAGE[result]));
        }}
      >
        <Text className="text-primary-700 dark:text-primary-400">{t('push.enable')}</Text>
      </Pressable>

      {message && (
        <Text className="text-pending-light dark:text-pending-dark" accessibilityRole="alert">
          {t(message)}
        </Text>
      )}

      {unread > 0 && (
        <View className="gap-2">
          <Text className={muted}>{t('notifications.unread', undefined, { broj: unread })}</Text>
          <Pressable
            className={press}
            onPress={() => {
              const client = supabase;
              if (!client) return;
              void markAllRead(client).then(() => setReloadToken((value) => value + 1));
            }}
          >
            <Text className={muted}>{t('notifications.markAll')}</Text>
          </Pressable>
        </View>
      )}

      {rows === null && <ActivityIndicator />}
      {rows?.length === 0 && <Text className={muted}>{t('notifications.none')}</Text>}

      {rows?.map((row) => (
        <Pressable
          key={row.id}
          onPress={() => {
            const client = supabase;
            if (!client || row.read_at) return;
            void markRead(client, row.id).then(() => setReloadToken((value) => value + 1));
          }}
          className={`gap-1 rounded-lg border p-4 ${
            row.read_at
              ? 'border-neutral-200 dark:border-neutral-800'
              : 'border-accent-500 bg-accent-50 dark:bg-accent-950'
          }`}
        >
          <Text className="font-medium text-neutral-900 dark:text-neutral-50">{row.title}</Text>
          <Text className={muted}>{row.body}</Text>
          <Text className="text-xs text-neutral-500">
            {new Date(row.created_at).toLocaleString('sr-Latn-RS', {
              day: 'numeric',
              month: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
