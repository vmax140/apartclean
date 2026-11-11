import { useCallback, useEffect, useState } from 'react';
import type { AccountClient } from './account';
import { getAccount } from './account';
import type { AppRole } from './constants/enums';
import { emailSchema, signInSchema, signUpSchema } from './schemas/account';
import type { TranslationKey } from './i18n';

export type AuthMode = 'signIn' | 'signUp' | 'magic';

export function useAccount(client: AccountClient, redirectTo: () => string, appVersion: string) {
  const [userId, setUserId] = useState<string | null>();
  const [snapshot, setAccount] = useState<{ userId: string; data: Awaited<ReturnType<typeof getAccount>> }>();
  const [activeRole, setActiveRole] = useState<AppRole>();
  const [error, setError] = useState<TranslationKey>();
  const [notice, setNotice] = useState<TranslationKey>();
  const [busy, setBusy] = useState(false);
  const [failedUserId, setFailed] = useState<string>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getAccount(client, userId).then((value) => {
      if (cancelled) return;
      setAccount({ userId, data: value });
      setActiveRole((current) => current && value.roles.includes(current) ? current : value.roles[0]);
    }).catch(() => {
      if (!cancelled) setFailed(userId);
    });
    return () => { cancelled = true; };
  }, [client, userId, revision]);

  const reload = () => {
    setAccount(undefined);
    setFailed(undefined);
    setRevision((value) => value + 1);
  };

  const completeLink = useCallback(async (code: string) => {
    setBusy(true);
    const { error: linkError } = await client.auth.exchangeCodeForSession(code);
    setBusy(false);
    if (linkError) setError('auth.linkError');
  }, [client]);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  }

  function authenticate(mode: AuthMode, fields: { email: string; password: string; name: string; adult: boolean }) {
    return perform(async () => {
      if (mode === 'signUp') {
        const valid = signUpSchema.safeParse(fields);
        if (!valid.success) return setError('auth.invalidSignup');
        const result = await client.auth.signUp({
          email: valid.data.email,
          password: valid.data.password,
          options: {
            emailRedirectTo: redirectTo(),
            data: { full_name: valid.data.name, adult_confirmed: true },
          },
        });
        if (result.error) return setError(result.error.status === 429 ? 'auth.rateLimit' : 'auth.invalidSignup');
        if (!result.data.session) setNotice('auth.verifyEmail');
      } else if (mode === 'magic') {
        const valid = emailSchema.safeParse(fields.email);
        if (!valid.success) return setError('auth.invalidEmail');
        const { error: otpError } = await client.auth.signInWithOtp({
          email: valid.data,
          options: { emailRedirectTo: redirectTo(), shouldCreateUser: false },
        });
        if (otpError?.status === 429) return setError('auth.rateLimit');
        if (otpError && otpError.code !== 'otp_disabled' && otpError.code !== 'user_not_found') {
          return setError('common.error');
        }
        setNotice('auth.emailSent');
      } else {
        const valid = signInSchema.safeParse(fields);
        if (!valid.success) return setError('auth.invalidLogin');
        const { error: signInError } = await client.auth.signInWithPassword(valid.data);
        if (signInError) setError(signInError.code === 'email_not_confirmed' ? 'auth.verifyEmail' : 'auth.invalidLogin');
      }
    });
  }

  function saveRoles(roles: AppRole[]) {
    return perform(async () => {
      const { error: rpcError } = await client.rpc('set_initial_roles', { roles });
      if (rpcError) throw rpcError;
      reload();
    });
  }

  function acceptDocuments(documentIds: string[]) {
    return perform(async () => {
      const { error: invokeError } = await client.functions.invoke('accept-legal', {
        body: { documentIds, appVersion },
      });
      if (invokeError) {
        if (invokeError.context?.status === 409) {
          reload();
          setError('auth.legalChanged');
          return;
        }
        throw invokeError;
      }
      reload();
    });
  }

  function signOut(deleted = false) {
    return perform(async () => {
      if (deleted) {
        const { error: invokeError } = await client.functions.invoke('delete-account', {
          body: { confirmed: true },
        });
        if (invokeError) throw invokeError;
      }
      const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      setAccount(undefined);
      setActiveRole(undefined);
      if (deleted) setNotice('auth.deleted');
    });
  }

  return {
    userId, account: snapshot && snapshot.userId === userId ? snapshot.data : undefined, activeRole, setActiveRole, error, notice, busy, failed: !!userId && failedUserId === userId, reload,
    authenticate, completeLink, saveRoles, acceptDocuments, signOut,
  };
}
