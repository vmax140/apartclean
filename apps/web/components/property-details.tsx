'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  getProperty,
  signReferencePhotos,
  type PropertyDetails as Details,
} from '@apartclean/shared/property';
import {
  listPropertyReports,
  setReportStatus,
  type PropertyReport,
} from '@apartclean/shared/closing';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Tabovi po SPEC sekciji 7: detalji, sobe i referentne slike, checklista,
// kalendar, istorija, prijave štete. Poslednja tri zavise od Faza 2A–2E,
// pa za sada stoje prazna umesto da se prave privremena rešenja.

const TABS = [
  'tab.details',
  'tab.rooms',
  'tab.checklist',
  'tab.calendar',
  'tab.history',
  'tab.reports',
] as const;

// Kalendar i istorija zavise od faza koje tek dolaze; prijave štete stižu sada.
const LATER: TranslationKey[] = ['tab.calendar', 'tab.history'];

export function PropertyDetails({ id }: { id: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [links, setLinks] = useState<Map<string, string>>(new Map());
  const [tab, setTab] = useState<(typeof TABS)[number]>('tab.details');
  const [failed, setFailed] = useState(false);
  const [reports, setReports] = useState<PropertyReport[]>([]);
  const [reportsToken, setReportsToken] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    void getProperty(supabase, id)
      .then(async (loaded) => {
        setDetails(loaded);
        setLinks(await signReferencePhotos(supabase!, loaded.photos));
      })
      .catch(() => setFailed(true));
  }, [id]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void listPropertyReports(client, id)
      .then((data) => active && setReports(data))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id, reportsToken]);

  if (failed) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="text-destructive">
          {t('property.loadFailed')}
        </p>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p role="status">{t('common.loading')}</p>
      </main>
    );
  }

  const { property, rooms, calendars, photos, checklist } = details;

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <header className="grid gap-1">
        <Link href="/app/apartmani" className="text-sm underline">
          {t('property.title')}
        </Link>
        <h1 className="text-2xl font-semibold">{property.name}</h1>
        <p className="text-sm text-muted-foreground">{property.address}</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={t('tab.details')}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className={`min-h-touch rounded-md px-4 text-sm ${
              tab === key ? 'bg-primary text-primary-foreground' : 'border hover:bg-secondary'
            }`}
          >
            {t(key)}
          </button>
        ))}
      </nav>

      {tab === 'tab.details' && (
        <section className="grid gap-2">
          <Row label={t('field.complex')} value={property.complex_name} />
          <Row label={t('field.sizeM2')} value={property.size_m2} />
          <Row label={t('field.bedrooms')} value={property.bedrooms} />
          <Row label={t('field.bathrooms')} value={property.bathrooms} />
          <Row label={t('field.beds')} value={property.beds} />
          <Row label={t('field.maxGuests')} value={property.max_guests} />
          <Row label={t('field.checkoutTime')} value={clock(property.checkout_time)} />
          <Row label={t('field.checkinTime')} value={clock(property.checkin_time)} />
          <Row label={t('field.duration')} value={property.est_duration_min} />
          <Row label={t('field.price')} value={property.default_price_rsd} />
          <Row label={t('field.geofence')} value={property.geofence_m} />
          <Row label={t('field.cleaningNotes')} value={property.cleaning_notes} />
          <p className="pt-2 text-sm text-muted-foreground">{t('access.secretNote')}</p>
        </section>
      )}

      {tab === 'tab.rooms' && (
        <section className="grid gap-4">
          {rooms.map((room) => {
            const roomPhotos = photos.filter((photo) => photo.room_id === room.id);
            return (
              <div key={room.id} className="grid gap-2 rounded-lg border p-4">
                <p className="font-medium">
                  {room.name} · {t(`roomType.${room.type}`)}
                </p>
                {roomPhotos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('photo.none')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {roomPhotos.map((photo) => (
                      // eslint-disable-next-line @next/next/no-img-element -- potpisani link iz Supabase Storage-a, van next/image domena
                      <img
                        key={photo.id}
                        src={links.get(photo.id) ?? ''}
                        alt={photo.angle_label ?? room.name}
                        className="h-28 w-40 rounded-md border object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {tab === 'tab.checklist' && (
        <section className="grid gap-2">
          {checklist.map((item) => (
            <p key={item.id} className="rounded-md border px-3 py-2 text-sm">
              {item.room_type ? t(`roomType.${item.room_type}`) + ' · ' : ''}
              {item.label}
              {item.requires_photo ? ' 📷' : ''}
            </p>
          ))}
        </section>
      )}

      {tab === 'tab.calendar' && (
        <section className="grid gap-2">
          {calendars.map((calendar) => (
            <p key={calendar.id} className="rounded-md border px-3 py-2 text-sm break-all">
              {calendar.source} · {calendar.ical_url}
            </p>
          ))}
          <p className="text-sm text-muted-foreground">{t('tab.empty')}</p>
        </section>
      )}

      {tab === 'tab.reports' && (
        <section className="grid gap-3">
          {reports.length === 0 && <p className="text-muted-foreground">{t('reports.none')}</p>}
          {reports.map((report) => (
            <article key={report.id} className="grid gap-2 rounded-lg border p-4">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{t(`report.${report.category}`)}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`reports.${report.status as 'open' | 'acknowledged' | 'resolved'}`)}
                  {' · '}
                  {new Date(report.created_at).toLocaleDateString('sr-Latn-RS')}
                </span>
              </p>
              <p className="text-sm">{report.description}</p>
              {report.status !== 'resolved' && (
                <div className="flex flex-wrap gap-2">
                  {report.status === 'open' && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const client = supabase;
                        if (!client) return;
                        void setReportStatus(client, report.id, 'acknowledged').then(() =>
                          setReportsToken((value) => value + 1),
                        );
                      }}
                    >
                      {t('reports.acknowledge')}
                    </Button>
                  )}
                  <Button
                    variant="accent"
                    onClick={() => {
                      const client = supabase;
                      if (!client) return;
                      void setReportStatus(client, report.id, 'resolved').then(() =>
                        setReportsToken((value) => value + 1),
                      );
                    }}
                  >
                    {t('reports.resolve')}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {LATER.includes(tab) && tab !== 'tab.calendar' && (
        <section>
          <p className="text-sm text-muted-foreground">{t('tab.empty')}</p>
        </section>
      )}
    </main>
  );
}

/** Postgres vraća time kao HH:MM:SS; korisniku su sekunde suvišne. */
function clock(value: string) {
  return value.slice(0, 5);
}

function Row({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === '') return null;
  return (
    <p className="flex justify-between gap-4 border-b py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </p>
  );
}
