import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { TASK_STATUS_TONE, t, type TranslationKey } from '@apartclean/shared';
import { listMySchedule, withdrawTask } from '@apartclean/shared/task';
import { supabase } from '../lib/supabase';

// Ekran Raspored (SPEC sekcija 7 — spremač): prihvaćeni poslovi po danima.

type Job = Awaited<ReturnType<typeof listMySchedule>>[number];

const press = 'min-h-11 items-center justify-center rounded-md px-5';
const muted = 'text-sm text-neutral-600 dark:text-neutral-400';

const TONE_TEXT = {
  ready: 'text-ready-light dark:text-ready-dark',
  pending: 'text-pending-light dark:text-pending-dark',
  problem: 'text-problem-light dark:text-problem-dark',
  neutral: 'text-neutral-600 dark:text-neutral-400',
} as const;

/** Danas i sutra dobijaju ime; dalji dani datum. */
function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const diff = Math.round(
    (new Date(date.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000,
  );
  if (diff === 0) return t('schedule.today');
  if (diff === 1) return t('schedule.tomorrow');
  return date.toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

export default function Schedule() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const data = await listMySchedule(client);
        if (active) setJobs(data);
      } catch {
        if (active) setMessage('task.loadFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const withdraw = useCallback(async (taskId: string) => {
    const client = supabase;
    if (!client) return;
    try {
      await withdrawTask(client, taskId);
      setConfirming(null);
      setReloadToken((value) => value + 1);
    } catch {
      setMessage('offers.failed');
    }
  }, []);

  // Grupisanje po danu, da raspored liči na raspored a ne na spisak.
  const byDay = new Map<string, Job[]>();
  for (const job of jobs ?? []) {
    const key = new Date(job.window_start).toDateString();
    byDay.set(key, [...(byDay.get(key) ?? []), job]);
  }

  return (
    <ScrollView className="flex-1 bg-neutral-0 dark:bg-neutral-950" contentContainerClassName="gap-4 p-5">
      <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {t('schedule.title')}
      </Text>

      {message && (
        <Text className="text-problem-light dark:text-problem-dark" accessibilityRole="alert">
          {t(message)}
        </Text>
      )}

      {jobs === null && <ActivityIndicator />}
      {jobs?.length === 0 && <Text className={muted}>{t('schedule.none')}</Text>}

      {[...byDay.entries()].map(([day, dayJobs]) => (
        <View key={day} className="gap-3">
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            {dayLabel(dayJobs[0]!.window_start)}
          </Text>

          {dayJobs.map((job) => (
            <View
              key={job.id}
              className="gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <Text className="font-medium text-neutral-900 dark:text-neutral-50">
                {job.propertyName}
              </Text>
              <Text className={muted}>
                {new Date(job.window_start).toLocaleTimeString('sr-Latn-RS', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' – '}
                {new Date(job.window_end).toLocaleTimeString('sr-Latn-RS', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              <Text className={`text-sm font-medium ${TONE_TEXT[TASK_STATUS_TONE[job.status]]}`}>
                {t(`taskStatus.${job.status}`)}
              </Text>

              {job.status === 'accepted' &&
                (confirming === job.id ? (
                  <>
                    <Text className={muted}>{t('schedule.withdrawWarning')}</Text>
                    <Pressable
                      className={`${press} bg-problem-light`}
                      onPress={() => void withdraw(job.id)}
                    >
                      <Text className="font-medium text-neutral-0">{t('schedule.withdraw')}</Text>
                    </Pressable>
                    <Pressable className={press} onPress={() => setConfirming(null)}>
                      <Text className={muted}>{t('common.cancel')}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable className={press} onPress={() => setConfirming(job.id)}>
                    <Text className={muted}>{t('schedule.withdraw')}</Text>
                  </Pressable>
                ))}
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
