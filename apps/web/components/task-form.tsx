'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TASK_TYPES, t, type TaskType, type TranslationKey } from '@apartclean/shared';
import { listProperties } from '@apartclean/shared/property';
import { createTask } from '@apartclean/shared/task';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// /app/zadaci/novi (SPEC sekcija 7). Zadatak nastaje kao nacrt; ponuda ide
// posebnim korakom, jer draft → offered je prelaz i mora kroz RPC.

const field = 'min-h-11 w-full rounded-md border bg-background px-3';
const label = 'grid gap-1 text-sm';

type Property = Awaited<ReturnType<typeof listProperties>>[number];

/** Podrazumevani okvir: sutra od 10 do 14, kao tipična smena između gostiju. */
function defaultWindow() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(14, 0, 0, 0);
  const asLocal = (date: Date) =>
    new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return { start: asLocal(start), end: asLocal(end) };
}

export function TaskForm() {
  const router = useRouter();
  const initial = defaultWindow();
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [type, setType] = useState<TaskType>('turnover');
  const [from, setFrom] = useState(initial.start);
  const [to, setTo] = useState(initial.end);
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const data = await listProperties(client);
        if (!active) return;
        setProperties(data);
        setPropertyId((current) => current || (data[0]?.id ?? ''));
      } catch {
        if (active) setError('property.loadFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    const client = supabase;
    if (!client || !propertyId) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createTask(client, {
        property_id: propertyId,
        type,
        window_start: new Date(from).toISOString(),
        window_end: new Date(to).toISOString(),
        price_rsd: price.trim() === '' ? undefined : Number(price),
        owner_notes: notes.trim() === '' ? undefined : notes.trim(),
      });
      router.push('/app/zadaci/' + id);
    } catch {
      setError('task.createFailed');
    } finally {
      setBusy(false);
    }
  }

  const valid = propertyId !== '' && new Date(to) > new Date(from);

  return (
    <main className="mx-auto grid max-w-xl gap-5 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t('task.new')}</h1>

      {error && (
        <p role="alert" className="text-destructive">
          {t(error)}
        </p>
      )}

      <label className={label}>
        {t('task.property')}
        <select
          className={field}
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
        >
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>

      <label className={label}>
        {t('task.type')}
        <select className={field} value={type} onChange={(event) => setType(event.target.value as TaskType)}>
          {TASK_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`taskType.${value}`)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          {t('task.from')}
          <input
            type="datetime-local"
            className={field}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className={label}>
          {t('task.to')}
          <input
            type="datetime-local"
            className={field}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>

      <label className={label}>
        {t('task.price')}
        <input
          className={field}
          inputMode="numeric"
          value={price}
          onChange={(event) => setPrice(event.target.value.replace(/\D/g, ''))}
        />
      </label>

      <label className={label}>
        {t('task.notes')}
        <textarea
          className="min-h-24 w-full rounded-md border bg-background p-3"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      <Button onClick={() => void save()} disabled={!valid || busy}>
        {t('task.save')}
      </Button>
    </main>
  );
}
