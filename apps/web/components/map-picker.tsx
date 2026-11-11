'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@apartclean/shared';
import { Button } from '@/components/ui/button';
import 'leaflet/dist/leaflet.css';

// Leaflet + OpenStreetMap, bez Google Maps ključa (SPEC sekcija 7).
// Leaflet se uvozi tek u pregledaču jer dira window pri učitavanju.

export type Point = { lat: number; lng: number };

const KOPAONIK: Point = { lat: 43.2847, lng: 20.8103 };

export function MapPicker({
  value,
  onChange,
  radiusM,
}: {
  value: Point | null;
  onChange: (point: Point) => void;
  radiusM?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const marker = useRef<import('leaflet').CircleMarker | null>(null);
  const circle = useRef<import('leaflet').Circle | null>(null);
  const latest = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Ref se ne sme dirati tokom iscrtavanja; mapa se pravi jednom, a poziv mora
  // uvek da gađa najnoviji onChange.
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    let instance: import('leaflet').Map | null = null;

    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !container.current || map.current) return;

      instance = L.map(container.current).setView([KOPAONIK.lat, KOPAONIK.lng], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(instance);

      instance.on('click', (event: import('leaflet').LeafletMouseEvent) => {
        latest.current({ lat: event.latlng.lat, lng: event.latlng.lng });
      });

      map.current = instance;
      // Kontejner često dobije konačnu veličinu tek posle prvog iscrtavanja.
      setTimeout(() => instance?.invalidateSize(), 0);
    })();

    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
      marker.current = null;
      circle.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || !value) return;
    void (async () => {
      const L = (await import('leaflet')).default;
      const position: [number, number] = [value.lat, value.lng];
      if (!marker.current) {
        marker.current = L.circleMarker(position, {
          radius: 8,
          color: '#1e4679',
          fillColor: '#1bac6f',
          fillOpacity: 1,
        }).addTo(map.current!);
      } else {
        marker.current.setLatLng(position);
      }

      if (radiusM) {
        if (!circle.current) {
          circle.current = L.circle(position, {
            radius: radiusM,
            color: '#1bac6f',
            weight: 1,
            fillOpacity: 0.08,
          }).addTo(map.current!);
        } else {
          circle.current.setLatLng(position);
          circle.current.setRadius(radiusM);
        }
      }
      map.current!.setView(position, Math.max(map.current!.getZoom(), 15));
    })();
  }, [value, radiusM]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setProblem(t('map.noLocation'));
      return;
    }
    setLocating(true);
    setProblem(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onChange({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        setLocating(false);
        setProblem(t('map.noLocation'));
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="grid gap-3">
      <div
        ref={container}
        className="h-72 w-full overflow-hidden rounded-lg border"
        role="application"
        aria-label={t('wizard.location')}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={locating}>
          {t('map.useCurrent')}
        </Button>
        <p className="text-sm text-muted-foreground">
          {value
            ? t('map.coordinates', undefined, {
                lat: value.lat.toFixed(5),
                lng: value.lng.toFixed(5),
              })
            : t('map.pick')}
        </p>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
