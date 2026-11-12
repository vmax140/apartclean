import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { t, type TranslationKey } from '@apartclean/shared';
import { checkIn, getNextJob, loadAccessInfo, type AccessInfo } from '@apartclean/shared/field';
import { supabase } from '../lib/supabase';

// Ekran Danas (SPEC sekcija 7 — spremač): sledeći zadatak i JEDNO veliko dugme.
// Koja je to akcija zavisi od statusa, pa spremačica nikad ne bira između dugmadi.

type Job = Awaited<ReturnType<typeof getNextJob>>;

const big = 'min-h-14 items-center justify-center rounded-xl px-6';
const muted = 'text-sm text-neutral-600 dark:text-neutral-400';

export default function Today() {
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [reason, setReason] = useState('');
  const [needsReason, setNeedsReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const next = await getNextJob(client);
        if (!active) return;
        setJob(next);
        // Pristupni podaci stižu tek kad baza potvrdi da smeju (SPEC sekcija 4).
        if (next && next.status !== 'accepted') {
          setAccess(await loadAccessInfo(client, next.id).catch(() => null));
        }
      } catch {
        if (active) setMessage('task.loadFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const arrive = useCallback(async () => {
    const client = supabase;
    if (!client || !job) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setMessage('today.locationNeeded');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await checkIn(client, {
        taskId: job.id,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        reason: reason.trim() || undefined,
      });
      setNeedsReason(false);
      setReason('');
      setReloadToken((value) => value + 1);
    } catch (problem) {
      const code = problem instanceof Error ? problem.message : '';
      if (code === 'VAN_KRUGA') {
        // Dolazak van kruga nije zabranjen — traži se razlog koji vlasnik vidi.
        setNeedsReason(true);
        setMessage('today.outsideCircle');
      } else {
        setMessage('offers.failed');
      }
    } finally {
      setBusy(false);
    }
  }, [job, reason]);

  if (job === undefined) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-0 dark:bg-neutral-950">
        <ActivityIndicator />
      </View>
    );
  }

  if (job === null) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-neutral-0 p-6 dark:bg-neutral-950">
        <Text className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          {t('today.title')}
        </Text>
        <Text className={muted}>{t('today.none')}</Text>
      </View>
    );
  }

  const arrived = job.status !== 'accepted';

  return (
    <ScrollView className="flex-1 bg-neutral-0 dark:bg-neutral-950" contentContainerClassName="gap-5 p-5">
      <Text className={muted}>{t('today.next')}</Text>
      <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {job.property.name}
      </Text>
      <Text className={muted}>
        {new Date(job.window_start).toLocaleString('sr-Latn-RS', {
          weekday: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })}
        {' – '}
        {new Date(job.window_end).toLocaleTimeString('sr-Latn-RS', {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Text>

      {message && (
        <Text className="text-pending-light dark:text-pending-dark" accessibilityRole="alert">
          {t(message)}
        </Text>
      )}

      {/* Adresa se vidi tek posle prihvatanja — a ovaj ekran je uvek posle njega. */}
      <Pressable
        className={`${big} border border-primary-700`}
        onPress={() =>
          void Linking.openURL(
            `geo:${job.property.lat},${job.property.lng}?q=${encodeURIComponent(job.property.address)}`,
          )
        }
      >
        <Text className="text-primary-700 dark:text-primary-400">{t('today.navigate')}</Text>
      </Pressable>

      {!arrived ? (
        <>
          {needsReason && (
            <TextInput
              className="min-h-14 rounded-xl border border-pending-light px-4 text-neutral-900 dark:text-neutral-50"
              placeholder={t('today.reasonPlaceholder')}
              value={reason}
              onChangeText={setReason}
              multiline
            />
          )}
          <Pressable
            className={`${big} bg-accent-600`}
            disabled={busy || (needsReason && reason.trim() === '')}
            onPress={() => void arrive()}
          >
            <Text className="text-lg font-semibold text-neutral-0">
              {busy ? t('today.arriving') : t('today.arrive')}
            </Text>
          </Pressable>
          <Text className={muted}>{t('access.locked')}</Text>
        </>
      ) : (
        <>
          {access && (
            <View className="gap-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <Text className="font-medium text-neutral-900 dark:text-neutral-50">
                {t('access.title')}
              </Text>
              {access.key_instructions && <Text className={muted}>{access.key_instructions}</Text>}
              {access.lockbox_code && (
                <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                  {t('access.lockbox')}: {access.lockbox_code}
                </Text>
              )}
              {access.wifi_name && (
                <Text className={muted}>
                  {t('access.wifi')}: {access.wifi_name}
                  {access.wifi_password ? ` / ${access.wifi_password}` : ''}
                </Text>
              )}
            </View>
          )}
          <Pressable
            className={`${big} bg-accent-600`}
            onPress={() => router.push({ pathname: '/zadatak', params: { id: job.id, propertyId: job.property_id } })}
          >
            <Text className="text-lg font-semibold text-neutral-0">{t('today.continue')}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
