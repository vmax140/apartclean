import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { REPORT_CATEGORIES, t, type ReportCategory, type TranslationKey } from '@apartclean/shared';
import {
  getWork,
  remainingWork,
  reportIssue,
  setChecklistItem,
  submitWork,
  type Work,
} from '@apartclean/shared/field';
import { createPhotoQueue, preparePhoto, type PendingPhoto } from '../lib/photo-queue';
import { supabase } from '../lib/supabase';

// Ekran rada (SPEC sekcija 6, koraci 6–8): checklista po sobama, kamera sa
// providnom referentnom slikom, prijava štete i predaja.
//
// Slike se ne šalju odmah — idu u red koji preživljava nestanak mreže i gašenje
// aplikacije. Predaja se nudi tek kada je red prazan.

const big = 'min-h-14 items-center justify-center rounded-xl px-6';
const press = 'min-h-11 items-center justify-center rounded-md px-5';
const muted = 'text-sm text-neutral-600 dark:text-neutral-400';

type Target = { checklistRowId: string | null; roomId: string | null; referenceUri?: string };

export default function TaskWork() {
  const params = useLocalSearchParams<{ id: string; propertyId: string }>();
  const taskId = params.id;
  const propertyId = params.propertyId;

  const [work, setWork] = useState<Work | null>(null);
  const [references, setReferences] = useState<Map<string, string>>(new Map());
  const [pending, setPending] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory>('damage');
  const [reportText, setReportText] = useState('');

  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const queue = useMemo(() => (supabase ? createPhotoQueue(supabase) : null), []);

  const refreshQueue = useCallback(async () => {
    if (!queue) return;
    setPending(await queue.size());
    setStuck((await queue.stuck()).length > 0);
  }, [queue]);

  useEffect(() => {
    const client = supabase;
    if (!client || !taskId || !propertyId) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await getWork(client, taskId, propertyId);
        if (!active) return;
        setWork(loaded);
        if (loaded.references.length) {
          const { data } = await client.storage
            .from('reference-photos')
            .createSignedUrls(loaded.references.map((photo) => photo.storage_path), 600);
          const byPath = new Map((data ?? []).map((entry) => [entry.path ?? '', entry.signedUrl]));
          setReferences(
            new Map(
              loaded.references.map((photo) => [photo.room_id, byPath.get(photo.storage_path) ?? '']),
            ),
          );
        }
        await refreshQueue();
      } catch {
        if (active) setMessage('task.loadFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, [taskId, propertyId, reloadToken, refreshQueue]);

  // Pokušaj slanja pri svakom otvaranju ekrana i posle svake snimljene slike.
  useEffect(() => {
    if (!queue) return;
    void queue.flush().then(refreshQueue);
  }, [queue, refreshQueue, reloadToken]);

  async function capture() {
    if (!camera.current || !target || !supabase) return;
    setBusy(true);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 1, skipProcessing: true });
      if (!shot) return;
      const prepared = await preparePhoto(shot.uri, shot.width, shot.height);

      // Vreme i lokacija idu uz sliku i proveravaju se na serveru (SPEC sekcija 8).
      let coords: { lat: number | null; lng: number | null } = { lat: null, lng: null };
      try {
        const position = await Location.getCurrentPositionAsync({});
        coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      } catch {
        // Bez GPS-a slika i dalje vredi; AI proveru to samo čini opreznijom.
      }

      const { data } = await supabase.auth.getUser();
      const photo: PendingPhoto = {
        taskId,
        roomId: target.roomId,
        checklistRowId: target.checklistRowId,
        uri: prepared.uri,
        sha256: prepared.sha256,
        width: prepared.width,
        height: prepared.height,
        capturedAt: new Date().toISOString(),
        lat: coords.lat,
        lng: coords.lng,
        createdBy: data.user?.id ?? '',
      };

      await queue!.add(photo);
      setTarget(null);
      await queue!.flush();
      await refreshQueue();
      setReloadToken((value) => value + 1);
    } catch {
      setMessage('photo.uploadFailed');
    } finally {
      setBusy(false);
    }
  }

  if (target) {
    if (!permission?.granted) {
      return (
        <View className="flex-1 justify-center gap-4 bg-neutral-0 p-5 dark:bg-neutral-950">
          <Text className={muted}>{t('verify.cameraDenied')}</Text>
          <Pressable className={`${press} bg-primary-700`} onPress={() => void requestPermission()}>
            <Text className="font-medium text-neutral-0">{t('common.retry')}</Text>
          </Pressable>
          <Pressable className={press} onPress={() => setTarget(null)}>
            <Text className={muted}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View className="flex-1 bg-neutral-950">
        <View className="flex-1">
          <CameraView ref={camera} style={{ flex: 1 }} facing="back" />
          {/* Referentna slika preko kadra: spremačica vidi kako soba treba da izgleda. */}
          {target.referenceUri ? (
            <Image
              source={{ uri: target.referenceUri }}
              className="absolute inset-0"
              resizeMode="cover"
              style={{ opacity: 0.35 }}
            />
          ) : null}
        </View>
        <View className="gap-3 p-5">
          {!target.referenceUri && <Text className="text-neutral-400">{t('work.noReference')}</Text>}
          <Pressable className={`${big} bg-accent-600`} disabled={busy} onPress={() => void capture()}>
            <Text className="text-lg font-semibold text-neutral-0">{t('work.takePhoto')}</Text>
          </Pressable>
          <Pressable className={press} onPress={() => setTarget(null)}>
            <Text className="text-neutral-400">{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!work) {
    return (
      <View className="flex-1 items-center justify-center bg-neutral-0 dark:bg-neutral-950">
        <ActivityIndicator />
      </View>
    );
  }

  const left = remainingWork(work);
  const photographed = new Set(
    work.photos.flatMap((photo) => [photo.checklist_row_id, photo.room_id].filter(Boolean) as string[]),
  );
  const canSubmit = left.ready && pending === 0;

  return (
    <ScrollView className="flex-1 bg-neutral-0 dark:bg-neutral-950" contentContainerClassName="gap-5 p-5">
      <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {t('work.title')}
      </Text>

      {/* Pokazatelj reda: spremačica uvek zna da li su slike otišle. */}
      <Text className={stuck ? 'text-problem-light dark:text-problem-dark' : muted}>
        {stuck
          ? t('queue.stuck')
          : pending > 0
            ? t('queue.pending', undefined, { broj: pending })
            : t('queue.allSent')}
      </Text>

      {message && (
        <Text className="text-pending-light dark:text-pending-dark" accessibilityRole="alert">
          {t(message)}
        </Text>
      )}

      {work.rooms.map((room) => {
        const items = work.checklist.filter((row) => row.room_id === room.id);
        if (!items.length) return null;
        return (
          <View key={room.id} className="gap-3">
            <Text className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              {room.name}
            </Text>
            {items.map((item) => (
              <ChecklistRow
                key={item.id}
                label={item.label}
                done={item.is_done}
                needsPhoto={item.requires_photo}
                hasPhoto={photographed.has(item.id) || photographed.has(room.id)}
                onToggle={() => {
                  if (!supabase) return;
                  void setChecklistItem(supabase, item.id, !item.is_done).then(() =>
                    setReloadToken((value) => value + 1),
                  );
                }}
                onPhoto={() =>
                  setTarget({
                    checklistRowId: item.id,
                    roomId: room.id,
                    referenceUri: references.get(room.id),
                  })
                }
              />
            ))}
          </View>
        );
      })}

      {work.checklist.some((row) => row.room_id === null) && (
        <View className="gap-3">
          <Text className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
            {t('work.generalItems')}
          </Text>
          {work.checklist
            .filter((row) => row.room_id === null)
            .map((item) => (
              <ChecklistRow
                key={item.id}
                label={item.label}
                done={item.is_done}
                needsPhoto={item.requires_photo}
                hasPhoto={photographed.has(item.id)}
                onToggle={() => {
                  if (!supabase) return;
                  void setChecklistItem(supabase, item.id, !item.is_done).then(() =>
                    setReloadToken((value) => value + 1),
                  );
                }}
                onPhoto={() => setTarget({ checklistRowId: item.id, roomId: null })}
              />
            ))}
        </View>
      )}

      {reportOpen ? (
        <View className="gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <Text className="font-medium text-neutral-900 dark:text-neutral-50">{t('report.title')}</Text>
          <View className="flex-row flex-wrap gap-2">
            {REPORT_CATEGORIES.map((category) => (
              <Pressable
                key={category}
                onPress={() => setReportCategory(category)}
                className={`${press} border ${
                  reportCategory === category ? 'border-accent-600' : 'border-neutral-300'
                }`}
              >
                <Text className="text-neutral-900 dark:text-neutral-50">{t(`report.${category}`)}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            className="min-h-20 rounded-md border border-neutral-300 px-3 text-neutral-900 dark:text-neutral-50"
            placeholder={t('report.description')}
            value={reportText}
            onChangeText={setReportText}
            multiline
          />
          <Pressable
            className={`${press} bg-pending-light`}
            disabled={reportText.trim() === ''}
            onPress={() => {
              if (!supabase) return;
              void reportIssue(supabase, {
                taskId,
                category: reportCategory,
                description: reportText,
              })
                .then(() => {
                  setReportText('');
                  setReportOpen(false);
                  setMessage('report.sent');
                })
                .catch(() => setMessage('report.failed'));
            }}
          >
            <Text className="font-medium text-neutral-0">{t('report.send')}</Text>
          </Pressable>
          <Pressable className={press} onPress={() => setReportOpen(false)}>
            <Text className={muted}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable className={press} onPress={() => setReportOpen(true)}>
          <Text className={muted}>{t('report.title')}</Text>
        </Pressable>
      )}

      {!canSubmit && <Text className={muted}>{t('work.submitBlocked')}</Text>}
      <Pressable
        className={`${big} ${canSubmit ? 'bg-accent-600' : 'bg-neutral-300'}`}
        disabled={!canSubmit || busy}
        onPress={() => {
          if (!supabase) return;
          setBusy(true);
          void submitWork(supabase, taskId)
            .then(() => router.replace('/danas'))
            .catch(() => setMessage('work.submitBlocked'))
            .finally(() => setBusy(false));
        }}
      >
        <Text className="text-lg font-semibold text-neutral-0">{t('today.submit')}</Text>
      </Pressable>
    </ScrollView>
  );
}

function ChecklistRow({
  label,
  done,
  needsPhoto,
  hasPhoto,
  onToggle,
  onPhoto,
}: {
  label: string;
  done: boolean;
  needsPhoto: boolean;
  hasPhoto: boolean;
  onToggle: () => void;
  onPhoto: () => void;
}) {
  return (
    <View className="gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <Pressable className="min-h-11 flex-row items-center gap-3" onPress={onToggle}>
        <View
          className={`h-6 w-6 rounded border ${
            done ? 'border-accent-600 bg-accent-600' : 'border-neutral-400'
          }`}
        />
        <Text
          className={`flex-1 ${done ? 'text-neutral-500 line-through' : 'text-neutral-900 dark:text-neutral-50'}`}
        >
          {label}
        </Text>
      </Pressable>

      {needsPhoto && (
        <Pressable
          className={`min-h-11 items-center justify-center rounded-md px-4 ${
            hasPhoto ? 'bg-ready-surface dark:bg-ready-surfaceDark' : 'border border-primary-700'
          }`}
          onPress={onPhoto}
        >
          <Text
            className={
              hasPhoto
                ? 'text-ready-light dark:text-ready-dark'
                : 'text-primary-700 dark:text-primary-400'
            }
          >
            {hasPhoto ? t('work.photoTaken') : t('work.needsPhoto')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
