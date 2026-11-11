import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';
import type { AppRole } from './constants/enums';

export type AccountClient = SupabaseClient<Database>;
export type LegalDocument = Database['public']['Tables']['legal_documents']['Row'];

export async function getAccount(client: AccountClient, userId: string) {
  const [profile, roles, documents, accepted] = await Promise.all([
    client.from('profiles').select('full_name,status').eq('id', userId).single(),
    client.from('user_roles').select('role').eq('user_id', userId),
    client.from('legal_documents').select('*').eq('is_active', true).order('kind'),
    client.from('legal_acceptances').select('document_id').eq('user_id', userId),
  ]);
  if (profile.error || roles.error || documents.error || accepted.error) throw new Error('ACCOUNT_LOAD_FAILED');
  const assigned = roles.data.map(({ role }) => role);
  const acceptedIds = new Set(accepted.data.map(({ document_id }) => document_id));
  return {
    profile: profile.data,
    roles: assigned,
    documents: documents.data.filter((doc) => !acceptedIds.has(doc.id) && appliesTo(doc, assigned)),
  };
}

export function appliesTo(doc: Pick<LegalDocument, 'applies_to'>, roles: AppRole[]) {
  return doc.applies_to === null || doc.applies_to.some((role) => roles.includes(role));
}
