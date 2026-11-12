import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';

// Faza 2C: obaveštenja u aplikaciji i prijava uređaja za push.

export type NotificationClient = SupabaseClient<Database>;
export type Notification = Database['public']['Tables']['notifications']['Row'];

export async function listNotifications(client: NotificationClient, limit = 50) {
  const { data, error } = await client
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('NOTIFICATIONS_LOAD_FAILED');
  return data;
}

export async function countUnread(client: NotificationClient) {
  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw new Error('NOTIFICATIONS_LOAD_FAILED');
  return count ?? 0;
}

export async function markRead(client: NotificationClient, id: string) {
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error('NOTIFICATION_UPDATE_FAILED');
}

export async function markAllRead(client: NotificationClient) {
  const { error } = await client
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw new Error('NOTIFICATION_UPDATE_FAILED');
}

/**
 * Prijava uređaja za push. Isti token ume da pređe na drugi nalog kada se neko
 * odjavi pa se drugi prijavi na istom telefonu — zato ide kroz RPC, koji stari
 * red ukloni pre upisa.
 */
export async function registerPushDevice(
  client: NotificationClient,
  token: string,
  platform: 'ios' | 'android' | 'web',
) {
  const { error } = await client.rpc('register_push_device', {
    token,
    device_platform: platform,
  });
  if (error) throw new Error('DEVICE_REGISTER_FAILED');
}
