import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './types/database';
import type { CleanerProfileInput, DocumentType } from './schemas/cleaner';
import { randomId } from './id';

export type CleanerClient = SupabaseClient<Database>;
export type CleanerProfile = Database['public']['Tables']['cleaner_profiles']['Row'];
export type VerificationRequest = Database['public']['Tables']['verification_requests']['Row'];
export type DirectoryEntry = Database['public']['Views']['cleaner_directory']['Row'];

export const VERIFICATION_BUCKET = 'verification-docs';
const SIGNED_URL_SECONDS = 300;

/** Putanja po docs/DECISIONS.md, odluka 5. */
export function verificationDocPath(userId: string, requestId: string, kind: 'front' | 'selfie') {
  return `${userId}/${requestId}-${kind}.jpg`;
}

export async function getCleanerProfile(client: CleanerClient, userId: string) {
  const [profile, regions, requests] = await Promise.all([
    client.from('cleaner_profiles').select('*').eq('user_id', userId).maybeSingle(),
    client.from('cleaner_regions').select('region_id').eq('cleaner_id', userId),
    client
      .from('verification_requests')
      .select('id,status,rejection_reason,created_at,reviewed_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (profile.error || regions.error || requests.error) throw new Error('CLEANER_LOAD_FAILED');
  return {
    profile: profile.data,
    regionIds: regions.data.map((row) => row.region_id),
    latestRequest: requests.data[0] ?? null,
  };
}

export async function saveCleanerProfile(client: CleanerClient, input: CleanerProfileInput) {
  const { error } = await client.rpc('save_cleaner_profile', { payload: input as unknown as Json });
  if (error) throw new Error(error.message.split(':')[0] || 'CLEANER_SAVE_FAILED');
}

/**
 * Slanje dokumenta i selfija. Oba fajla idu u privatan bucket; posle odluke
 * administratora ih briše Edge Function verify-decision (SPEC sekcija 9).
 * Broj dokumenta se nigde ne upisuje.
 */
export async function submitVerification(
  client: CleanerClient,
  options: { userId: string; documentType: DocumentType; front: Blob; selfie: Blob },
) {
  const requestId = randomId();
  const frontPath = verificationDocPath(options.userId, requestId, 'front');
  const selfiePath = verificationDocPath(options.userId, requestId, 'selfie');

  for (const [path, body] of [
    [frontPath, options.front],
    [selfiePath, options.selfie],
  ] as const) {
    const upload = await client.storage
      .from(VERIFICATION_BUCKET)
      .upload(path, body, { contentType: 'image/jpeg', upsert: false });
    if (upload.error) throw new Error('DOCUMENT_UPLOAD_FAILED');
  }

  const { error } = await client.from('verification_requests').insert({
    id: requestId,
    user_id: options.userId,
    document_type: options.documentType,
    doc_front_path: frontPath,
    selfie_path: selfiePath,
  });
  if (error) {
    await client.storage.from(VERIFICATION_BUCKET).remove([frontPath, selfiePath]);
    throw new Error('VERIFICATION_SUBMIT_FAILED');
  }
  return requestId;
}

/** Red čekanja za /admin/verifikacije (SPEC sekcija 7 — admin). */
export async function listPendingVerifications(client: CleanerClient) {
  const { data, error } = await client
    .from('verification_requests')
    .select('id,user_id,document_type,doc_front_path,selfie_path,created_at')
    .eq('status', 'pending')
    .order('created_at');
  if (error) throw new Error('VERIFICATIONS_LOAD_FAILED');
  if (!data.length) return [];

  const { data: people, error: peopleError } = await client
    .from('public_profiles')
    .select('id,full_name')
    .in('id', data.map((row) => row.user_id));
  if (peopleError) throw new Error('VERIFICATIONS_LOAD_FAILED');

  const names = new Map(people.map((person) => [person.id, person.full_name]));
  return data.map((row) => ({ ...row, full_name: names.get(row.user_id) ?? '' }));
}

/** Dokument i selfi se gledaju jedno pored drugog, preko kratkotrajnih linkova. */
export async function signVerificationDocs(client: CleanerClient, paths: (string | null)[]) {
  const present = paths.filter((path): path is string => !!path);
  if (!present.length) return new Map<string, string>();
  const { data, error } = await client.storage
    .from(VERIFICATION_BUCKET)
    .createSignedUrls(present, SIGNED_URL_SECONDS);
  if (error) throw new Error('DOCUMENT_LINK_FAILED');
  const byPath = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  }
  return byPath;
}

export async function decideVerification(
  client: CleanerClient,
  input: { requestId: string; approve: boolean; reason?: string },
) {
  const { error } = await client.functions.invoke('verify-decision', {
    body: { requestId: input.requestId, approve: input.approve, reason: input.reason ?? '' },
  });
  if (error) throw new Error('DECISION_FAILED');
}

export async function searchCleaners(
  client: CleanerClient,
  filters: { regionId?: number; verifiedOnly?: boolean } = {},
) {
  let query = client.from('cleaner_directory').select('*');
  if (filters.verifiedOnly) query = query.eq('is_verified', true);
  if (filters.regionId) query = query.contains('region_ids', [filters.regionId]);
  const { data, error } = await query.order('rating_avg', { ascending: false, nullsFirst: false });
  if (error) throw new Error('CLEANERS_LOAD_FAILED');
  return data;
}

/** Tim vlasnika: glavni (priority 1) i rezervni (2+), SPEC sekcija 5. */
export async function getTeam(client: CleanerClient, ownerId: string) {
  const { data, error } = await client
    .from('preferred_cleaners')
    .select('cleaner_id,priority')
    .eq('owner_id', ownerId)
    .order('priority');
  if (error) throw new Error('TEAM_LOAD_FAILED');
  return data;
}

export async function setTeamMember(
  client: CleanerClient,
  input: { ownerId: string; cleanerId: string; priority: number },
) {
  if (input.priority === 1) {
    // Glavni je samo jedan; prethodnog spuštamo u rezervne (jedinstveni indeks to i traži).
    await client
      .from('preferred_cleaners')
      .update({ priority: 2 })
      .eq('owner_id', input.ownerId)
      .eq('priority', 1);
  }
  const { error } = await client
    .from('preferred_cleaners')
    .upsert(
      { owner_id: input.ownerId, cleaner_id: input.cleanerId, priority: input.priority },
      { onConflict: 'owner_id,cleaner_id' },
    );
  if (error) throw new Error('TEAM_SAVE_FAILED');
}

export async function removeTeamMember(client: CleanerClient, ownerId: string, cleanerId: string) {
  const { error } = await client
    .from('preferred_cleaners')
    .delete()
    .eq('owner_id', ownerId)
    .eq('cleaner_id', cleanerId);
  if (error) throw new Error('TEAM_SAVE_FAILED');
}

