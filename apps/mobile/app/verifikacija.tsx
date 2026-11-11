import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { DOCUMENT_TYPES, t, type DocumentType, type TranslationKey } from '@apartclean/shared';
import { getCleanerProfile, submitVerification } from '@apartclean/shared/cleaner';
import { supabase } from '../lib/supabase';

// Verifikacija spremačice (SPEC sekcije 6 i 9).
// Slike se snimaju isključivo kamerom u aplikaciji — galerija se nigde ne nudi,
// jer bi tuđa slika dokumenta obesmislila celu proveru.
// Smanjenje na 1.600 px i JPEG 80% po pravilu iz CLAUDE.md.

const LONG_EDGE = 1600;
const JPEG_QUALITY = 0.8;

type Shot = { uri: string; blob: Blob };
type Target = 'front' | 'selfie';

const press = 'min-h-11 items-center justify-center rounded-md px-5';
const muted = 'text-sm text-neutral-600 dark:text-neutral-400';

export default function Verification() {
  const [permission, requestPermission] = useCameraPermissions();
  const [documentType, setDocumentType] = useState<DocumentType>('licna_karta');
  const [shots, setShots] = useState<Partial<Record<Target, Shot>>>({});
  const [target, setTarget] = useState<Target | null>(null);
  const [status, setStatus] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const camera = useRef<CameraView>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      const { data } = await client.auth.getUser();
      const id = data.user?.id;
      if (!id || !active) return;
      setUserId(id);
      try {
        const { profile, latestRequest } = await getCleanerProfile(client, id);
        if (!active) return;
        if (profile?.verification === 'verified') setStatus('verify.statusVerified');
        else if (latestRequest?.status === 'pending') setStatus('verify.statusPending');
        else if (latestRequest?.status === 'rejected') {
          setRejection(latestRequest.rejection_reason ?? '');
          setStatus('verify.statusRejected');
        }
        else setStatus('verify.statusUnverified');
      } catch {
        if (active) setStatus('verify.submitFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function capture() {
    if (!camera.current || !target) return;
    const photo = await camera.current.takePictureAsync({ quality: 1, skipProcessing: true });
    if (!photo) return;

    const context = ImageManipulator.ImageManipulator.manipulate(photo.uri);
    context.resize(photo.width >= photo.height ? { width: LONG_EDGE } : { height: LONG_EDGE });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      compress: JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    const blob = await (await fetch(saved.uri)).blob();
    setShots((current) => ({ ...current, [target]: { uri: saved.uri, blob } }));
    setTarget(null);
  }

  async function send() {
    const client = supabase;
    if (!client || !userId || !shots.front || !shots.selfie) return;
    setBusy(true);
    try {
      await submitVerification(client, {
        userId,
        documentType,
        front: shots.front.blob,
        selfie: shots.selfie.blob,
      });
      setShots({});
      setStatus('verify.submitted');
    } catch {
      setStatus('verify.submitFailed');
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
        <CameraView
          ref={camera}
          style={{ flex: 1 }}
          facing={(target === 'selfie' ? 'front' : 'back') as CameraType}
        />
        <View className="gap-3 p-5">
          <Pressable className={`${press} bg-accent-600`} onPress={() => void capture()}>
            <Text className="font-medium text-neutral-0">
              {target === 'selfie' ? t('verify.takeSelfie') : t('verify.takeDocument')}
            </Text>
          </Pressable>
          <Pressable className={press} onPress={() => setTarget(null)}>
            <Text className="text-neutral-400">{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-neutral-0 dark:bg-neutral-950"
      contentContainerClassName="gap-4 p-5"
    >
      <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {t('verify.title')}
      </Text>
      <Text className={muted}>{t('verify.intro')}</Text>
      <Text className={muted}>{t('verify.cameraOnly')}</Text>

      {status && (
        <Text className="text-pending-light dark:text-pending-dark" accessibilityRole="alert">
          {t(status, undefined, { razlog: rejection })}
        </Text>
      )}

      <Text className={muted}>{t('verify.documentType')}</Text>
      <View className="flex-row gap-2">
        {DOCUMENT_TYPES.map((type) => (
          <Pressable
            key={type}
            onPress={() => setDocumentType(type)}
            className={`${press} border ${
              documentType === type ? 'border-accent-600 bg-accent-50' : 'border-neutral-300'
            }`}
          >
            <Text className="text-neutral-900 dark:text-neutral-50">{t(`verify.${type}`)}</Text>
          </Pressable>
        ))}
      </View>

      {(['front', 'selfie'] as const).map((slot) => (
        <View key={slot} className="gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <Text className="font-medium text-neutral-900 dark:text-neutral-50">
            {slot === 'selfie' ? t('verify.takeSelfie') : t('verify.takeDocument')}
          </Text>
          {shots[slot] && (
            <Image source={{ uri: shots[slot]!.uri }} className="h-40 w-full rounded-md" resizeMode="contain" />
          )}
          <Pressable className={`${press} border border-primary-700`} onPress={() => setTarget(slot)}>
            <Text className="text-primary-700 dark:text-primary-400">
              {shots[slot] ? t('verify.retake') : t('verify.takeDocument')}
            </Text>
          </Pressable>
        </View>
      ))}

      <Pressable
        className={`${press} ${shots.front && shots.selfie && !busy ? 'bg-accent-600' : 'bg-neutral-300'}`}
        disabled={!shots.front || !shots.selfie || busy}
        onPress={() => void send()}
      >
        {busy ? (
          <ActivityIndicator />
        ) : (
          <Text className="font-medium text-neutral-0">{t('verify.submit')}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
