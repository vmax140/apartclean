'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { t, type AppRole } from '@apartclean/shared';
import { useAccount, type AuthMode } from '@apartclean/shared/use-account';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

const redirectTo = () => window.location.origin + '/prijava';
const inputStyle = 'min-h-11 rounded-md border bg-background px-3';

export function AccountScreen({ initialMode = 'signIn', adminOnly = false }: {
  initialMode?: AuthMode;
  adminOnly?: boolean;
}) {
  return supabase ? <ConfiguredAccount initialMode={initialMode} adminOnly={adminOnly} /> :
    <main className="mx-auto max-w-lg p-6"><p>{t('auth.notConfigured')}</p></main>;
}

function ConfiguredAccount({ initialMode, adminOnly }: { initialMode: AuthMode; adminOnly: boolean }) {
  const account = useAccount(supabase!, redirectTo, '0.0.0');
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(false);
  const [chosenRoles, setChosenRoles] = useState<AppRole[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const handled = useRef(false);
  const { completeLink } = account;

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) return;
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    void completeLink(code);
  }, [completeLink]);

  const { userId, busy, failed, error, notice, account: data, activeRole } = account;
  const signedIn = !!userId;
  const selectedDocs = data?.documents.filter((doc) => accepted[doc.id]) ?? [];
  const blocked = data && (data.profile.status === 'suspended' || data.profile.status === 'deleted');
  const effectiveRole = adminOnly && data?.roles.includes('admin') ? 'admin' : activeRole;

  return (
    <main className="mx-auto grid max-w-xl gap-5 px-6 py-12">
      <Link href="/" className="w-fit text-2xl font-bold">{t('app.name')}</Link>
      {error && <p role="alert" className="text-destructive">{t(error)}</p>}
      {notice && <p role="status">{t(notice)}</p>}
      {userId === undefined || (signedIn && !data && !failed) ? (
        <p role="status">{t('common.loading')}</p>
      ) : !signedIn ? (
        <>
          <h1 className="text-xl font-semibold">{t(mode === 'magic' ? 'auth.sendLink' : 'auth.' + mode as 'auth.signIn' | 'auth.signUp')}</h1>
          <form className="grid gap-4" onSubmit={(event) => {
            event.preventDefault();
            void account.authenticate(mode, { email, password, name, adult });
          }}>
            {mode === 'signUp' && <label className="grid gap-1">{t('auth.name')}
              <input className={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </label>}
            <label className="grid gap-1">{t('auth.email')}
              <input className={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required />
            </label>
            {mode !== 'magic' && <label className="grid gap-1">{t('auth.password')}
              <input className={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'} required />
            </label>}
            {mode === 'signUp' && <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} required />{t('auth.adult')}
            </label>}
            <Button type="submit" disabled={busy}>{t(mode === 'magic' ? 'auth.sendLink' : mode === 'signUp' ? 'auth.signUp' : 'auth.signIn')}</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {mode !== 'signIn' && <Button variant="ghost" onClick={() => setMode('signIn')}>{t('auth.signIn')}</Button>}
            {mode !== 'signUp' && <Button variant="ghost" onClick={() => setMode('signUp')}>{t('auth.signUp')}</Button>}
            {mode !== 'magic' && <Button variant="ghost" onClick={() => setMode('magic')}>{t('auth.sendLink')}</Button>}
          </div>
        </>
      ) : failed ? (
        <Button onClick={account.reload}>{t('common.retry')}</Button>
      ) : blocked ? (
        <p>{t('auth.accountUnavailable')}</p>
      ) : data && !data.roles.length ? (
        <section className="grid gap-3">
          <h1 className="text-xl font-semibold">{t('auth.roleTitle')}</h1>
          {(['owner', 'cleaner'] as const).map((role) => <label key={role} className="flex min-h-11 items-center gap-3">
            <input type="checkbox" checked={chosenRoles.includes(role)} onChange={(e) => {
              setChosenRoles(e.target.checked ? [...chosenRoles, role] : chosenRoles.filter((r) => r !== role));
            }} />{t(`role.${role}`)}
          </label>)}
          <Button disabled={!chosenRoles.length || busy} onClick={() => void account.saveRoles(chosenRoles)}>{t('common.next')}</Button>
        </section>
      ) : data && (data.documents.length > 0 || data.profile.status === 'pending') ? (
        <section aria-labelledby="legal-title" className="grid gap-4 rounded-lg border p-4">
          <h1 id="legal-title" className="text-xl font-semibold">{t('auth.legalTitle')}</h1>
          <p>{t('auth.legalIntro')}</p>
          {data.documents.map((doc) => <div key={doc.id} className="rounded-md border p-3">
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-medium">{doc.title} · {t('auth.version', undefined, { version: doc.version })}</summary>
              <p className="whitespace-pre-wrap">{doc.content_md}</p>
            </details>
            <label className="flex min-h-11 items-center gap-3">
              <input type="checkbox" checked={!!accepted[doc.id]} onChange={(e) => setAccepted({ ...accepted, [doc.id]: e.target.checked })} />
              {t('auth.acceptDocument')}
            </label>
          </div>)}
          <Button disabled={busy || selectedDocs.length !== data.documents.length} onClick={() => void account.acceptDocuments(selectedDocs.map((doc) => doc.id))}>{t('auth.accept')}</Button>
        </section>
      ) : adminOnly && effectiveRole !== 'admin' ? (
        <p>{t('auth.accountUnavailable')}</p>
      ) : data ? (
        <section className="grid gap-4">
          <h1 className="text-xl font-semibold">{t('auth.dashboard')}</h1>
          <p>{data.profile.full_name}</p>
          <label className="grid gap-1">{t('auth.roleSwitch')}
            <select className={inputStyle} value={effectiveRole} onChange={(e) => {
              const role = data.roles.find((item) => item === e.target.value);
              if (role) account.setActiveRole(role);
            }} disabled={adminOnly || data.roles.length < 2}>
              {data.roles.map((role) => <option key={role} value={role}>{t(`role.${role}`)}</option>)}
            </select>
          </label>
          {effectiveRole === 'admin' && !adminOnly && <Link href="/admin" className="min-h-11 underline">{t('role.admin')}</Link>}
          {!adminOnly && <div className="grid gap-2">
            {confirmDelete ? <>
              <p>{t('auth.deletePrompt')}</p>
              <Button variant="destructive" disabled={busy} onClick={() => void account.signOut(true)}>{t('auth.confirmDelete')}</Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
            </> : <Button variant="outline" onClick={() => setConfirmDelete(true)}>{t('auth.delete')}</Button>}
          </div>}
        </section>
      ) : null}
      {signedIn && <Button variant="ghost" disabled={busy} onClick={() => void account.signOut()}>{t('auth.signOut')}</Button>}
    </main>
  );
}
