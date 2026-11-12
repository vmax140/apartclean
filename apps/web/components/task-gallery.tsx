'use client';

import { useEffect, useState } from 'react';
import { t } from '@apartclean/shared';
import { getGallery } from '@apartclean/shared/closing';
import { supabase } from '@/lib/supabase';

// Galerija sa poređenjem (SPEC sekcija 7: BeforeAfterCompare).
// Referentna slika i slika posle čišćenja stoje jedna uz drugu, po sobama —
// vlasnik tako vidi razliku bez prebacivanja između ekrana.

type Gallery = Awaited<ReturnType<typeof getGallery>>;

export function TaskGallery({ taskId, propertyId }: { taskId: string; propertyId: string }) {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void getGallery(client, taskId, propertyId)
      .then((data) => active && setGallery(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [taskId, propertyId]);

  if (failed) return <p className="text-destructive">{t('gallery.none')}</p>;
  if (!gallery) return <p role="status">{t('common.loading')}</p>;
  if (gallery.photos.length === 0) return <p className="text-muted-foreground">{t('gallery.none')}</p>;

  const byRoom = new Map<string | null, typeof gallery.photos>();
  for (const photo of gallery.photos) {
    byRoom.set(photo.roomId, [...(byRoom.get(photo.roomId) ?? []), photo]);
  }

  return (
    <section className="grid gap-5">
      <h2 className="text-lg font-medium">{t('gallery.title')}</h2>

      {[...byRoom.entries()].map(([roomId, photos]) => {
        const room = gallery.rooms.find((entry) => entry.id === roomId);
        const reference = roomId ? gallery.references.get(roomId) : undefined;
        return (
          <div key={roomId ?? 'bez-sobe'} className="grid gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              {room?.name ?? t('gallery.noRoom')}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {reference && (
                <figure className="grid gap-1">
                  <figcaption className="text-xs text-muted-foreground">
                    {t('gallery.before')}
                  </figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element -- potpisani link iz Supabase Storage-a */}
                  <img
                    src={reference}
                    alt={t('gallery.before')}
                    className="aspect-[4/3] w-full rounded-md border object-cover"
                  />
                </figure>
              )}
              <div className="grid gap-1">
                <span className="text-xs text-muted-foreground">{t('gallery.after')}</span>
                <div className="flex flex-wrap gap-2">
                  {photos.map((photo) => (
                    // eslint-disable-next-line @next/next/no-img-element -- potpisani link iz Supabase Storage-a
                    <img
                      key={photo.id}
                      src={photo.url}
                      alt={room?.name ?? t('gallery.after')}
                      title={new Date(photo.capturedAt).toLocaleString('sr-Latn-RS')}
                      className="aspect-[4/3] w-40 rounded-md border object-cover"
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
