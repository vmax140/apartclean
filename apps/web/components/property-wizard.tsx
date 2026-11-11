'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_ROOMS,
  SELECTABLE_ROOM_TYPES,
  newPropertySchema,
  t,
  type CalendarInput,
  type RoomInput,
  type RoomType,
  type TranslationKey,
} from '@apartclean/shared';
import {
  createProperty,
  getProperty,
  listRegions,
  uploadReferencePhoto,
  type PropertyRoom,
  type Region,
} from '@apartclean/shared/property';
import { MapPicker, type Point } from '@/components/map-picker';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Čarobnjak iz SPEC sekcije 7: osnovno → lokacija → sobe → pristup → iCal →
// referentne slike → checklista. Apartman nastaje na kraju petog koraka, jer
// slike i checklista traže pravi property_id i room_id.

const STEPS = [
  'wizard.basics',
  'wizard.location',
  'wizard.rooms',
  'wizard.access',
  'wizard.calendars',
  'wizard.photos',
  'wizard.checklist',
] as const;

const field = 'min-h-11 w-full rounded-md border bg-background px-3';
const label = 'grid gap-1 text-sm';

type Draft = {
  name: string;
  region_id: number;
  complex_name: string;
  address: string;
  point: Point | null;
  geofence_m: number;
  size_m2: string;
  bedrooms: string;
  bathrooms: string;
  beds: string;
  max_guests: string;
  checkout_time: string;
  checkin_time: string;
  est_duration_min: number;
  default_price_rsd: string;
  cleaning_notes: string;
  rooms: RoomInput[];
  calendars: CalendarInput[];
  key_instructions: string;
  lockbox_code: string;
  wifi_name: string;
  wifi_password: string;
};

const EMPTY: Draft = {
  name: '',
  region_id: 0,
  complex_name: '',
  address: '',
  point: null,
  geofence_m: 150,
  size_m2: '',
  bedrooms: '',
  bathrooms: '',
  beds: '',
  max_guests: '',
  checkout_time: '10:00',
  checkin_time: '14:00',
  est_duration_min: 120,
  default_price_rsd: '',
  cleaning_notes: '',
  rooms: DEFAULT_ROOMS.slice(0, 3),
  calendars: [],
  key_instructions: '',
  lockbox_code: '',
  wifi_name: '',
  wifi_password: '',
};

const number = (value: string) => (value.trim() === '' ? undefined : Number(value));

export function PropertyWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [regions, setRegions] = useState<Region[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PropertyRoom[]>([]);
  const [checklist, setChecklist] = useState<{ label: string; room_type: RoomType | null }[]>([]);

  useEffect(() => {
    if (!supabase) return;
    void listRegions(supabase)
      .then((data) => {
        setRegions(data);
        setDraft((current) => (current.region_id ? current : { ...current, region_id: data[0]?.id ?? 0 }));
      })
      .catch(() => setError('property.loadFailed'));
  }, []);

  function patch(changes: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function buildPayload() {
    return newPropertySchema.safeParse({
      name: draft.name,
      region_id: draft.region_id,
      complex_name: draft.complex_name || undefined,
      address: draft.address,
      lat: draft.point?.lat,
      lng: draft.point?.lng,
      geofence_m: draft.geofence_m,
      size_m2: number(draft.size_m2),
      bedrooms: number(draft.bedrooms),
      bathrooms: number(draft.bathrooms),
      beds: number(draft.beds),
      max_guests: number(draft.max_guests),
      checkout_time: draft.checkout_time,
      checkin_time: draft.checkin_time,
      est_duration_min: draft.est_duration_min,
      default_price_rsd: number(draft.default_price_rsd),
      cleaning_notes: draft.cleaning_notes || undefined,
      rooms: draft.rooms.map((room, index) => ({ ...room, sort_order: index })),
      calendars: draft.calendars.filter((entry) => entry.ical_url.trim() !== ''),
    });
  }

  async function save() {
    if (!supabase) return;
    const parsed = buildPayload();
    if (!parsed.success) {
      setError('property.saveFailed');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await createProperty(supabase, parsed.data);

      if (draft.key_instructions || draft.lockbox_code || draft.wifi_name || draft.wifi_password) {
        // Šifre idu kroz Edge Function, koja ih šifruje pre upisa (odluka 4).
        const { error: accessError } = await supabase.functions.invoke('property-access', {
          body: {
            action: 'save',
            propertyId: id,
            key_instructions: draft.key_instructions,
            lockbox_code: draft.lockbox_code,
            wifi_name: draft.wifi_name,
            wifi_password: draft.wifi_password,
          },
        });
        if (accessError) throw new Error('access');
      }

      const details = await getProperty(supabase, id);
      setPropertyId(id);
      setRooms(details.rooms);
      setChecklist(details.checklist.map((item) => ({ label: item.label, room_type: item.room_type })));
      setStep(5);
    } catch {
      setError('property.saveFailed');
    } finally {
      setBusy(false);
    }
  }

  const canAdvance =
    step === 0
      ? draft.name.trim().length >= 2 && draft.region_id > 0
      : step === 1
        ? draft.address.trim().length >= 3 && draft.point !== null
        : step === 2
          ? draft.rooms.length > 0 && draft.rooms.every((room) => room.name.trim() !== '')
          : true;

  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-8">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold">{t('property.new')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('wizard.step', undefined, { broj: step + 1, ukupno: STEPS.length })} ·{' '}
          {t(STEPS[step]!)}
        </p>
      </header>

      {error && (
        <p role="alert" className="text-destructive">
          {t(error)}
        </p>
      )}

      {step === 0 && (
        <section className="grid gap-4">
          <label className={label}>
            {t('field.name')}
            <input className={field} value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label className={label}>
            {t('field.region')}
            <select
              className={field}
              value={draft.region_id}
              onChange={(e) => patch({ region_id: Number(e.target.value) })}
            >
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            {t('field.complex')}
            <input
              className={field}
              value={draft.complex_name}
              onChange={(e) => patch({ complex_name: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['field.sizeM2', 'size_m2'],
                ['field.bedrooms', 'bedrooms'],
                ['field.bathrooms', 'bathrooms'],
                ['field.beds', 'beds'],
                ['field.maxGuests', 'max_guests'],
                ['field.price', 'default_price_rsd'],
              ] as const
            ).map(([key, name]) => (
              <label key={name} className={label}>
                {t(key)}
                <input
                  className={field}
                  inputMode="numeric"
                  value={draft[name]}
                  onChange={(e) => patch({ [name]: e.target.value.replace(/\D/g, '') } as Partial<Draft>)}
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              {t('field.checkoutTime')}
              <input
                type="time"
                className={field}
                value={draft.checkout_time}
                onChange={(e) => patch({ checkout_time: e.target.value })}
              />
            </label>
            <label className={label}>
              {t('field.checkinTime')}
              <input
                type="time"
                className={field}
                value={draft.checkin_time}
                onChange={(e) => patch({ checkin_time: e.target.value })}
              />
            </label>
          </div>
          <label className={label}>
            {t('field.cleaningNotes')}
            <textarea
              className="min-h-24 w-full rounded-md border bg-background p-3"
              value={draft.cleaning_notes}
              onChange={(e) => patch({ cleaning_notes: e.target.value })}
            />
          </label>
        </section>
      )}

      {step === 1 && (
        <section className="grid gap-4">
          <label className={label}>
            {t('field.address')}
            <input
              className={field}
              value={draft.address}
              onChange={(e) => patch({ address: e.target.value })}
            />
          </label>
          <MapPicker
            value={draft.point}
            radiusM={draft.geofence_m}
            onChange={(point) => patch({ point })}
          />
          <label className={label}>
            {t('field.geofence')}
            <input
              className={field}
              inputMode="numeric"
              value={draft.geofence_m}
              onChange={(e) => patch({ geofence_m: Number(e.target.value.replace(/\D/g, '') || 0) })}
            />
          </label>
        </section>
      )}

      {step === 2 && (
        <section className="grid gap-3">
          {draft.rooms.map((room, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
              <label className={label}>
                {t('field.roomType')}
                <select
                  className={field}
                  value={room.type}
                  onChange={(e) => {
                    const rooms = [...draft.rooms];
                    rooms[index] = { ...room, type: e.target.value as RoomType };
                    patch({ rooms });
                  }}
                >
                  {SELECTABLE_ROOM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`roomType.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                {t('field.roomName')}
                <input
                  className={field}
                  value={room.name}
                  onChange={(e) => {
                    const rooms = [...draft.rooms];
                    rooms[index] = { ...room, name: e.target.value };
                    patch({ rooms });
                  }}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={() => patch({ rooms: draft.rooms.filter((_, i) => i !== index) })}
                disabled={draft.rooms.length === 1}
              >
                {t('room.remove')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              patch({
                rooms: [
                  ...draft.rooms,
                  { type: 'other', name: '', sort_order: draft.rooms.length },
                ],
              })
            }
          >
            {t('room.add')}
          </Button>
        </section>
      )}

      {step === 3 && (
        <section className="grid gap-4">
          <p className="text-sm text-muted-foreground">{t('access.secretNote')}</p>
          <label className={label}>
            {t('field.keyInstructions')}
            <textarea
              className="min-h-24 w-full rounded-md border bg-background p-3"
              value={draft.key_instructions}
              onChange={(e) => patch({ key_instructions: e.target.value })}
            />
          </label>
          <label className={label}>
            {t('field.lockbox')}
            <input
              className={field}
              value={draft.lockbox_code}
              onChange={(e) => patch({ lockbox_code: e.target.value })}
            />
          </label>
          <label className={label}>
            {t('field.wifiName')}
            <input
              className={field}
              value={draft.wifi_name}
              onChange={(e) => patch({ wifi_name: e.target.value })}
            />
          </label>
          <label className={label}>
            {t('field.wifiPassword')}
            <input
              className={field}
              value={draft.wifi_password}
              onChange={(e) => patch({ wifi_password: e.target.value })}
            />
          </label>
        </section>
      )}

      {step === 4 && (
        <section className="grid gap-3">
          {draft.calendars.map((entry, index) => (
            <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[auto_1fr_auto]">
              <select
                className={field}
                value={entry.source}
                onChange={(e) => {
                  const calendars = [...draft.calendars];
                  calendars[index] = { ...entry, source: e.target.value as CalendarInput['source'] };
                  patch({ calendars });
                }}
              >
                <option value="booking">Booking</option>
                <option value="airbnb">Airbnb</option>
                <option value="other">iCal</option>
              </select>
              <input
                className={field}
                placeholder={t('field.icalUrl')}
                value={entry.ical_url}
                onChange={(e) => {
                  const calendars = [...draft.calendars];
                  calendars[index] = { ...entry, ical_url: e.target.value };
                  patch({ calendars });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => patch({ calendars: draft.calendars.filter((_, i) => i !== index) })}
              >
                {t('room.remove')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => patch({ calendars: [...draft.calendars, { source: 'booking', ical_url: '' }] })}
          >
            {t('room.add')}
          </Button>
        </section>
      )}

      {step === 5 && propertyId && (
        <PhotoStep propertyId={propertyId} rooms={rooms} />
      )}

      {step === 6 && (
        <section className="grid gap-2">
          {checklist.map((item, index) => (
            <p key={index} className="rounded-md border px-3 py-2 text-sm">
              {item.room_type ? t(`roomType.${item.room_type}`) + ' · ' : ''}
              {item.label}
            </p>
          ))}
        </section>
      )}

      <footer className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          disabled={step === 0 || step >= 5}
        >
          {t('wizard.back')}
        </Button>

        {step < 4 && (
          <Button type="button" onClick={() => setStep((current) => current + 1)} disabled={!canAdvance}>
            {t('wizard.next')}
          </Button>
        )}
        {step === 4 && (
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {t('wizard.finish')}
          </Button>
        )}
        {step === 5 && (
          <Button type="button" onClick={() => setStep(6)}>
            {t('wizard.next')}
          </Button>
        )}
        {step === 6 && (
          <Button type="button" onClick={() => router.push('/app/apartmani/' + propertyId)}>
            {t('property.open')}
          </Button>
        )}
      </footer>
    </main>
  );
}

function PhotoStep({ propertyId, rooms }: { propertyId: string; rooms: PropertyRoom[] }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [problem, setProblem] = useState<TranslationKey | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(roomId: string, file: File) {
    if (!supabase) return;
    try {
      await uploadReferencePhoto(supabase, { propertyId, roomId, body: file });
      setCounts((current) => ({ ...current, [roomId]: (current[roomId] ?? 0) + 1 }));
      setProblem(null);
    } catch {
      setProblem('photo.uploadFailed');
    }
  }

  return (
    <section className="grid gap-3">
      {problem && (
        <p role="alert" className="text-destructive">
          {t('photo.uploadFailed')}
        </p>
      )}
      {rooms.map((room) => (
        <div key={room.id} className="grid gap-2 rounded-md border p-3">
          <p className="font-medium">{room.name}</p>
          <p className="text-sm text-muted-foreground">
            {counts[room.id] ? counts[room.id] + '' : t('photo.none')}
          </p>
          <input
            ref={(element) => {
              inputs.current[room.id] = element;
            }}
            type="file"
            accept="image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(room.id, file);
              event.target.value = '';
            }}
          />
          <Button type="button" variant="outline" onClick={() => inputs.current[room.id]?.click()}>
            {t('photo.add')}
          </Button>
        </div>
      ))}
    </section>
  );
}
