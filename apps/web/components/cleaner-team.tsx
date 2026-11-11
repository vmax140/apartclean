'use client';

import { useEffect, useState } from 'react';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  getTeam,
  removeTeamMember,
  searchCleaners,
  setTeamMember,
  type DirectoryEntry,
} from '@apartclean/shared/cleaner';
import { listRegions, type Region } from '@apartclean/shared/property';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// /app/spremaci (SPEC sekcija 7 — vlasnik): moj tim sa glavnom i rezervnima,
// plus pretraga. Neverifikovana spremačica se vidi i može u tim, ali nosi oznaku —
// ponude sa tržišta dobija tek posle verifikacije (docs/DECISIONS.md, odluka 13).

export function CleanerTeam() {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [team, setTeam] = useState<{ cleaner_id: string; priority: number }[]>([]);
  const [people, setPeople] = useState<DirectoryEntry[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionId, setRegionId] = useState(0);
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void (async () => {
      try {
        const { data } = await client.auth.getUser();
        const id = data.user?.id;
        if (!id || !active) return;
        const [members, directory, loadedRegions] = await Promise.all([
          getTeam(client, id),
          searchCleaners(client, {
            verifiedOnly,
            regionId: regionId || undefined,
          }),
          listRegions(client),
        ]);
        if (!active) return;
        setOwnerId(id);
        setTeam(members);
        setPeople(directory);
        setRegions(loadedRegions);
      } catch {
        if (active) setMessage('team.saveFailed');
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadToken, regionId, verifiedOnly]);

  async function change(action: () => Promise<void>) {
    setMessage(null);
    try {
      await action();
      setReloadToken((value) => value + 1);
    } catch {
      setMessage('team.saveFailed');
    }
  }

  const byId = new Map(people.map((person) => [person.user_id, person]));
  const inTeam = new Set(team.map((member) => member.cleaner_id));

  return (
    <main className="mx-auto grid max-w-3xl gap-8 px-4 py-8">
      <section className="grid gap-3">
        <h1 className="text-2xl font-semibold">{t('team.title')}</h1>
        {message && (
          <p role="alert" className="text-destructive">
            {t(message)}
          </p>
        )}
        {team.length === 0 && <p className="text-muted-foreground">{t('team.empty')}</p>}

        {team.map((member) => {
          const person = byId.get(member.cleaner_id);
          return (
            <div key={member.cleaner_id} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <span className="grid gap-1">
                <span className="font-medium">{person?.full_name ?? member.cleaner_id}</span>
                <span className="text-sm text-muted-foreground">
                  {member.priority === 1 ? t('team.primary') : t('team.backup')}
                </span>
              </span>
              <span className="ml-auto flex flex-wrap gap-2">
                {member.priority !== 1 && ownerId && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void change(() =>
                        setTeamMember(supabase!, { ownerId, cleanerId: member.cleaner_id, priority: 1 }),
                      )
                    }
                  >
                    {t('team.makePrimary')}
                  </Button>
                )}
                {ownerId && (
                  <Button
                    variant="ghost"
                    onClick={() => void change(() => removeTeamMember(supabase!, ownerId, member.cleaner_id))}
                  >
                    {t('team.remove')}
                  </Button>
                )}
              </span>
            </div>
          );
        })}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">{t('team.search')}</h2>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="min-h-11 rounded-md border bg-background px-3"
            value={regionId}
            onChange={(event) => setRegionId(Number(event.target.value))}
          >
            <option value={0}>{t('team.allRegions')}</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(event) => setVerifiedOnly(event.target.checked)}
            />
            {t('team.verifiedOnly')}
          </label>
        </div>

        {people
          .filter((person) => !inTeam.has(person.user_id))
          .map((person) => (
            <div key={person.user_id} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <span className="grid gap-1">
                <span className="font-medium">{person.full_name}</span>
                <span className="text-sm text-muted-foreground">
                  {person.is_verified ? t('team.verified') : t('team.notVerified')}
                  {' · '}
                  {t('team.jobs', undefined, { broj: person.completed_jobs ?? 0 })}
                  {person.base_price_rsd ? ` · ${person.base_price_rsd} RSD` : ''}
                </span>
              </span>
              {ownerId && (
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={() =>
                    void change(() =>
                      setTeamMember(supabase!, {
                        ownerId,
                        cleanerId: person.user_id!,
                        priority: team.length === 0 ? 1 : 2,
                      }),
                    )
                  }
                >
                  {team.length === 0 ? t('team.makePrimary') : t('team.addBackup')}
                </Button>
              )}
            </div>
          ))}
      </section>
    </main>
  );
}
