import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { t, type AppRole } from '@apartclean/shared';
import { useAccount, type AuthMode } from '@apartclean/shared/use-account';
import { supabase } from '../lib/supabase';

const redirectTo = () => Linking.createURL('auth-callback');
const consumedCodes = new Set<string>();
const textClass = 'text-base text-neutral-900 dark:text-neutral-50';
const inputClass = 'min-h-12 rounded-md border border-neutral-500 px-3 ' + textClass;

function Action({ label, onPress, disabled = false, quiet = false }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled }}
    disabled={disabled}
    onPress={onPress}
    className={'min-h-12 justify-center rounded-md px-3 ' + (quiet ? 'border border-neutral-500' : 'bg-primary-700') + (disabled ? ' opacity-50' : '')}
  >
    <Text className={quiet ? textClass : 'text-base font-semibold text-white'}>{label}</Text>
  </Pressable>;
}

function Choice({ label, selected, toggle }: { label: string; selected: boolean; toggle: () => void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={toggle}
    className="min-h-12 flex-row items-center gap-3 py-2">
    <View className={'h-6 w-6 items-center justify-center rounded border border-neutral-500 ' + (selected ? 'bg-primary-700' : '')}>
      {selected && <Text className="text-white">✓</Text>}
    </View>
    <Text className={'flex-1 ' + textClass}>{label}</Text>
  </Pressable>;
}

export default function Home() {
  return <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 p-6">
      <Text className="text-2xl font-bold text-neutral-900 dark:text-white">{t('app.name')}</Text>
      {supabase ? <ConfiguredAccount /> : <Text className={textClass}>{t('auth.notConfigured')}</Text>}
    </ScrollView>
  </SafeAreaView>;
}

function ConfiguredAccount() {
  const account = useAccount(supabase!, redirectTo, Constants.expoConfig?.version ?? '0.0.0');
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [chosenRoles, setChosenRoles] = useState<AppRole[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [openDoc, setOpenDoc] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const incoming = Linking.useLinkingURL();
  const { completeLink } = account;

  useEffect(() => {
    if (!incoming) return;
    const code = Linking.parse(incoming).queryParams?.code;
    if (typeof code !== 'string' || consumedCodes.has(code)) return;
    consumedCodes.add(code);
    void completeLink(code);
  }, [incoming, completeLink]);

  useEffect(() => {
    // AppState.currentState ume da bude undefined pre nego što se modul inicijalizuje.
    const onAppState = (state: string | null | undefined) => {
      if (state === 'active') void supabase!.auth.startAutoRefresh();
      else void supabase!.auth.stopAutoRefresh();
    };
    onAppState(AppState.currentState);
    const subscription = AppState.addEventListener('change', onAppState);
    return () => {
      subscription.remove();
      void supabase!.auth.stopAutoRefresh();
    };
  }, []);

  const { userId, busy, failed, error, notice, account: data, activeRole } = account;
  const label = t(mode === 'magic' ? 'auth.sendLink' : mode === 'signUp' ? 'auth.signUp' : 'auth.signIn');
  const selected = data?.documents.filter((doc) => accepted[doc.id]) ?? [];

  return <>
    {error && <Text accessibilityRole="alert" className="text-red-600 dark:text-red-300">{t(error)}</Text>}
    {notice && <Text accessibilityLiveRegion="polite" className={textClass}>{t(notice)}</Text>}
    {userId === undefined || (userId && !data && !failed) ? <Text className={textClass}>{t('common.loading')}</Text> :
      !userId ? <>
        <Text className={textClass}>{label}</Text>
        {mode === 'signUp' && <>
          <Text className={textClass}>{t('auth.name')}</Text>
          <TextInput className={inputClass} accessibilityLabel={t('auth.name')} autoComplete="name" value={name} onChangeText={setName} />
        </>}
        <Text className={textClass}>{t('auth.email')}</Text>
        <TextInput className={inputClass} accessibilityLabel={t('auth.email')} autoComplete="email"
          keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} />
        {mode !== 'magic' && <>
          <Text className={textClass}>{t('auth.password')}</Text>
          <TextInput className={inputClass} accessibilityLabel={t('auth.password')} secureTextEntry
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'} value={password} onChangeText={setPassword} />
        </>}
        {mode === 'signUp' && <Choice label={t('auth.adult')} selected={adult} toggle={() => setAdult(!adult)} />}
        <Action label={label} disabled={busy} onPress={() => void account.authenticate(mode, { email, password, name, adult })} />
        {mode !== 'signIn' && <Action quiet label={t('auth.signIn')} onPress={() => setMode('signIn')} />}
        {mode !== 'signUp' && <Action quiet label={t('auth.signUp')} onPress={() => setMode('signUp')} />}
        {mode !== 'magic' && <Action quiet label={t('auth.sendLink')} onPress={() => setMode('magic')} />}
      </> : failed ? <Action label={t('common.retry')} onPress={account.reload} /> :
        data?.profile.status === 'suspended' || data?.profile.status === 'deleted' ?
          <Text className={textClass}>{t('auth.accountUnavailable')}</Text> :
        data && !data.roles.length ? <>
          <Text className={textClass}>{t('auth.roleTitle')}</Text>
          {(['owner', 'cleaner'] as const).map((role) => <Choice key={role} label={t(`role.${role}`)}
            selected={chosenRoles.includes(role)} toggle={() => setChosenRoles(
              chosenRoles.includes(role) ? chosenRoles.filter((item) => item !== role) : [...chosenRoles, role],
            )} />)}
          <Action label={t('common.next')} disabled={busy || !chosenRoles.length} onPress={() => void account.saveRoles(chosenRoles)} />
        </> : data && (data.documents.length > 0 || data.profile.status === 'pending') ? <>
          <Text className={textClass}>{t('auth.legalTitle')}</Text>
          <Text className={textClass}>{t('auth.legalIntro')}</Text>
          {data.documents.map((doc) => <View className="gap-2 rounded-md border border-neutral-500 p-3" key={doc.id}>
            <Action quiet label={doc.title + ' · ' + t('auth.version', undefined, { version: doc.version })}
              onPress={() => setOpenDoc(openDoc === doc.id ? undefined : doc.id)} />
            {openDoc === doc.id && <Text selectable className={textClass}>{doc.content_md}</Text>}
            <Choice label={t('auth.acceptDocument')} selected={!!accepted[doc.id]}
              toggle={() => setAccepted({ ...accepted, [doc.id]: !accepted[doc.id] })} />
          </View>)}
          <Action label={t('auth.accept')} disabled={busy || selected.length !== data.documents.length}
            onPress={() => void account.acceptDocuments(selected.map((doc) => doc.id))} />
        </> : data ? <>
          <Text className={textClass}>{t('auth.dashboard')}</Text>
          <Text className={textClass}>{data.profile.full_name}</Text>
          <Text className={textClass}>{t('auth.roleSwitch')}</Text>
          {data.roles.map((role) => <Choice key={role} label={t(`role.${role}`)} selected={activeRole === role}
            toggle={() => account.setActiveRole(role)} />)}
          {data.roles.includes('owner') && <Action label={t('property.title')}
            onPress={() => router.push('/apartmani')} />}
          {data.roles.includes('cleaner') && <><Action label={t('offers.title')}
            onPress={() => router.push('/ponude')} />
          <Action label={t('schedule.title')}
            onPress={() => router.push('/raspored')} />
          <Action quiet label={t('verify.title')}
            onPress={() => router.push('/verifikacija')} /></>}
          <Action quiet label={t('notifications.title')}
            onPress={() => router.push('/obavestenja')} />
          {confirmDelete ? <>
            <Text className={textClass}>{t('auth.deletePrompt')}</Text>
            <Action label={t('auth.confirmDelete')} disabled={busy} onPress={() => void account.signOut(true)} />
            <Action quiet label={t('common.cancel')} disabled={busy} onPress={() => setConfirmDelete(false)} />
          </> : <Action quiet label={t('auth.delete')} onPress={() => setConfirmDelete(true)} />}
        </> : null}
    {userId && <Action quiet label={t('auth.signOut')} disabled={busy} onPress={() => void account.signOut()} />}
  </>;
}
