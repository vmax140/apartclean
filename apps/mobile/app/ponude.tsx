import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  acceptOffer,
  declineOffer,
  listMyOffers,
  listOpenTasks,
  minutesLeft,
} from '@apartclean/shared/task';
import { supabase } from '../lib/supabase';

// Ekran Ponude (SPEC sekcija 7 — spremač): ponude sa rokom i otvoreni poslovi
// u regionu. Jedna glavna akcija po kartici, dodirni elementi preko 44 px.

type Offer = Awaited<ReturnType<typeof listMyOffers>>[number];
type OpenTask = Awaited<ReturnType<typeof listOpenTasks>>[number];

const press = 'min-h-11 items-center justify-center rounded-md px-5';
const muted = 'text-sm text-neutral-600 dark:text-neutral-400';
const card = 'gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800';

function when(value: string) {
  return new Date(value).toLocaleString('sr-Latn-RS', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Offers() {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [open, setOpen] = useState<OpenTask[]>([]);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const [mine, market] = await Promise.all([listMyOffers(client), listOpenTasks(client)]);
        if (!active) return;
        setOffers(mine);
        setOpen(market);
      } catch {
        if (active) setMessage('offers.failed');
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const act = useCallback(async (taskId: string, action: 'accept' | 'decline') => {
    const client = supabase;
    if (!client) return;
    setBusy(taskId);
    setMessage(null);
    try {
      if (action === 'accept') await acceptOffer(client, taskId);
      else await declineOffer(client, taskId);
      setReloadToken((value) => value + 1);
    } catch (problem) {
      // Najčešći ishod kada neko drugi prihvati prvi.
      const code = problem instanceof Error ? problem.message : '';
      setMessage(code === 'POGRESAN_STATUS' ? 'offers.taken' : 'offers.failed');
      setReloadToken((value) => value + 1);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <ScrollView
      className="flex-1 bg-neutral-0 dark:bg-neutral-950"
      contentContainerClassName="gap-4 p-5"
      refreshControl={
        <RefreshControl
          refreshing={offers === null}
          onRefresh={() => setReloadToken((value) => value + 1)}
        />
      }
    >
      <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {t('offers.title')}
      </Text>

      {message && (
        <Text className="text-pending-light dark:text-pending-dark" accessibilityRole="alert">
          {t(message)}
        </Text>
      )}

      {offers === null && <ActivityIndicator />}
      {offers?.length === 0 && <Text className={muted}>{t('offers.none')}</Text>}

      {offers?.map((offer) => {
        const left = minutesLeft(offer.expiresAt);
        return (
          <View key={offer.id} className={card}>
            <Text className="font-medium text-neutral-900 dark:text-neutral-50">
              {offer.task?.complexName ?? offer.task?.propertyName}
            </Text>
            <Text className={muted}>{when(offer.task!.window_start)}</Text>
            {offer.proposedPrice !== null && (
              <Text className={muted}>{offer.proposedPrice} RSD</Text>
            )}
            <Text
              className={
                left !== null && left <= 0
                  ? 'text-sm text-problem-light dark:text-problem-dark'
                  : 'text-sm text-pending-light dark:text-pending-dark'
              }
            >
              {left === null
                ? ''
                : left <= 0
                  ? t('offers.expired')
                  : t('offers.expiresIn', undefined, { minuta: left })}
            </Text>

            <Pressable
              className={`${press} bg-accent-600`}
              disabled={busy === offer.taskId}
              onPress={() => void act(offer.taskId, 'accept')}
            >
              <Text className="font-medium text-neutral-0">{t('offers.accept')}</Text>
            </Pressable>
            <Pressable
              className={press}
              disabled={busy === offer.taskId}
              onPress={() => void act(offer.taskId, 'decline')}
            >
              <Text className={muted}>{t('offers.decline')}</Text>
            </Pressable>
          </View>
        );
      })}

      <Text className="pt-4 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
        {t('offers.openMarket')}
      </Text>
      {open.length === 0 && <Text className={muted}>{t('offers.noOpen')}</Text>}

      {open.map((task) => (
        <View key={task.id} className={card}>
          {/* Dok zadatak nije prihvaćen, vidi se samo kompleks i region — ne i adresa. */}
          <Text className="font-medium text-neutral-900 dark:text-neutral-50">
            {task.complexName ?? task.propertyName}
          </Text>
          <Text className={muted}>{when(task.window_start)}</Text>
          {task.price_rsd !== null && <Text className={muted}>{task.price_rsd} RSD</Text>}
          <Pressable
            className={`${press} bg-primary-700`}
            disabled={busy === task.id}
            onPress={() => void act(task.id, 'accept')}
          >
            <Text className="font-medium text-neutral-0">{t('offers.take')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
