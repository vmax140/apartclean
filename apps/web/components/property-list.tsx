'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t } from '@apartclean/shared';
import { listProperties, listRegions, type Region } from '@apartclean/shared/property';
import { buttonVariants } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

type Row = Awaited<ReturnType<typeof listProperties>>[number];

export function PropertyList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void Promise.all([listProperties(supabase), listRegions(supabase)])
      .then(([properties, loadedRegions]) => {
        setRows(properties);
        setRegions(loadedRegions);
      })
      .catch(() => setFailed(true));
  }, []);

  const regionName = (id: number) => regions.find((region) => region.id === id)?.name ?? '';

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('property.title')}</h1>
        <Link href="/app/apartmani/novi" className={buttonVariants()}>
          {t('property.new')}
        </Link>
      </header>

      {failed && (
        <p role="alert" className="text-destructive">
          {t('property.loadFailed')}
        </p>
      )}

      {!rows && !failed && <p role="status">{t('common.loading')}</p>}

      {rows && rows.length === 0 && <p className="text-muted-foreground">{t('property.none')}</p>}

      <ul className="grid gap-3">
        {rows?.map((row) => (
          <li key={row.id}>
            <Link
              href={'/app/apartmani/' + row.id}
              className="flex min-h-touch items-center justify-between gap-4 rounded-lg border p-4 hover:bg-secondary"
            >
              <span className="grid gap-1">
                <span className="font-medium">{row.name}</span>
                <span className="text-sm text-muted-foreground">
                  {[regionName(row.region_id), row.complex_name].filter(Boolean).join(' · ')}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('property.rooms', undefined, { broj: row.roomCount })}
                </span>
              </span>
              {!row.is_active && (
                <span className="rounded-full bg-secondary px-3 py-1 text-xs">
                  {t('property.inactive')}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
