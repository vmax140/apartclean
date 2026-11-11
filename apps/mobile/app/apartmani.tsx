import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { DEFAULT_ROOMS, newPropertySchema, t, type TranslationKey } from '@apartclean/shared';
import {
  createProperty,
  listProperties,
  listRegions,
  type Region,
} from '@apartclean/shared/property';
import { supabase } from '../lib/supabase';

// Lista apartmana i brzo dodavanje sa telefona (SPEC sekcija 7).
// Mapa je na webu; ovde se lokacija uzima dugmetom, a adresa se kuca.

type Row = Awaited<ReturnType<typeof listProperties>>[number];

const input = 'min-h-11 rounded-md border border-neutral-300 px-3 text-neutral-900 dark:border-neutral-700 dark:text-neutral-50';
const labelText = 'text-sm text-neutral-600 dark:text-neutral-400';

export default function Properties() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<TranslationKey | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // Učitavanje živi u samom efektu, sa zastavicom protiv upisa posle napuštanja ekrana.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const [properties, loadedRegions] = await Promise.all([
          listProperties(client),
          listRegions(client),
        ]);
        if (!active) return;
        setRows(properties);
        setRegions(loadedRegions);
      } catch {
        if (active) setMessage('property.loadFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken]);

  // Ime namerno ne počinje sa "use": to je obična funkcija, ne React hook.
  async function readCurrentLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setMessage('map.noLocation');
      return;
    }
    try {
      const position = await Location.getCurrentPositionAsync({});
      setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
      setMessage(null);
    } catch {
      setMessage('map.noLocation');
    }
  }

  async function save() {
    if (!supabase) return;
    const parsed = newPropertySchema.safeParse({
      name,
      region_id: regions[0]?.id,
      address,
      lat: point?.lat,
      lng: point?.lng,
      rooms: DEFAULT_ROOMS.slice(0, 3),
    });
    if (!parsed.success) {
      setMessage('property.saveFailed');
      return;
    }
    setBusy(true);
    try {
      await createProperty(supabase, parsed.data);
      setName('');
      setAddress('');
      setPoint(null);
      setAdding(false);
      setMessage('property.created');
      setReloadToken((value) => value + 1);
    } catch {
      setMessage('property.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView className="flex-1 bg-neutral-0 dark:bg-neutral-950" contentContainerClassName="gap-4 p-5">
      <Text className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        {t('property.title')}
      </Text>

      {message && (
        <Text className="text-pending-light dark:text-pending-dark" accessibilityRole="alert">
          {t(message)}
        </Text>
      )}

      {rows === null && <ActivityIndicator />}
      {rows?.length === 0 && <Text className={labelText}>{t('property.none')}</Text>}

      {rows?.map((row) => (
        <View key={row.id} className="gap-1 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <Text className="font-medium text-neutral-900 dark:text-neutral-50">{row.name}</Text>
          <Text className={labelText}>{row.address}</Text>
          <Text className={labelText}>{t('property.rooms', undefined, { broj: row.roomCount })}</Text>
        </View>
      ))}

      {!adding ? (
        <Pressable
          onPress={() => setAdding(true)}
          className="min-h-11 items-center justify-center rounded-md bg-primary-700 px-5"
        >
          <Text className="font-medium text-neutral-0">{t('property.new')}</Text>
        </Pressable>
      ) : (
        <View className="gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <Text className={labelText}>{t('field.name')}</Text>
          <TextInput className={input} value={name} onChangeText={setName} />

          <Text className={labelText}>{t('field.address')}</Text>
          <TextInput className={input} value={address} onChangeText={setAddress} />

          <Pressable
            onPress={() => void readCurrentLocation()}
            className="min-h-11 items-center justify-center rounded-md border border-primary-700 px-5"
          >
            <Text className="text-primary-700 dark:text-primary-400">{t('map.useCurrent')}</Text>
          </Pressable>
          <Text className={labelText}>
            {point
              ? t('map.coordinates', undefined, {
                  lat: point.lat.toFixed(5),
                  lng: point.lng.toFixed(5),
                })
              : t('map.pick')}
          </Text>

          <Pressable
            onPress={() => void save()}
            disabled={busy}
            className="min-h-11 items-center justify-center rounded-md bg-accent-600 px-5"
          >
            <Text className="font-medium text-neutral-0">{t('wizard.finish')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setAdding(false)}
            className="min-h-11 items-center justify-center px-5"
          >
            <Text className={labelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
