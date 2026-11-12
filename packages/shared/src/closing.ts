import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';

// Faza 2E: zatvaranje posla, ocene i poruke (SPEC sekcija 6, koraci 10–11).

export type ClosingClient = SupabaseClient<Database>;
export type Review = Database['public']['Tables']['reviews']['Row'];
export type Message = Database['public']['Tables']['messages']['Row'];
export type PropertyReport = Database['public']['Tables']['property_reports']['Row'];

export type GalleryPhoto = {
  id: string;
  roomId: string | null;
  url: string;
  capturedAt: string;
  kind: string;
};

/**
 * Slike zadatka i referentne slike istog apartmana, poređane po sobama —
 * da se „pre i posle" vidi jedno uz drugo (SPEC sekcija 7, BeforeAfterCompare).
 */
export async function getGallery(client: ClosingClient, taskId: string, propertyId: string) {
  const [photos, references, rooms] = await Promise.all([
    client
      .from('task_photos')
      .select('id,room_id,storage_path,captured_at,kind')
      .eq('task_id', taskId)
      .order('captured_at'),
    client
      .from('reference_photos')
      .select('id,room_id,storage_path')
      .eq('property_id', propertyId),
    client.from('property_rooms').select('id,name,type').eq('property_id', propertyId).order('sort_order'),
  ]);
  if (photos.error || references.error || rooms.error) throw new Error('GALLERY_LOAD_FAILED');

  const [taskUrls, referenceUrls] = await Promise.all([
    sign(client, 'task-photos', photos.data.map((photo) => photo.storage_path)),
    sign(client, 'reference-photos', references.data.map((photo) => photo.storage_path)),
  ]);

  return {
    rooms: rooms.data,
    photos: photos.data.map((photo) => ({
      id: photo.id,
      roomId: photo.room_id,
      url: taskUrls.get(photo.storage_path) ?? '',
      capturedAt: photo.captured_at,
      kind: photo.kind,
    })) satisfies GalleryPhoto[],
    references: new Map(
      references.data.map((photo) => [photo.room_id, referenceUrls.get(photo.storage_path) ?? '']),
    ),
  };
}

async function sign(client: ClosingClient, bucket: string, paths: string[]) {
  const result = new Map<string, string>();
  if (!paths.length) return result;
  const { data, error } = await client.storage.from(bucket).createSignedUrls(paths, 600);
  if (error) return result;
  for (const entry of data) {
    if (entry.path && entry.signedUrl) result.set(entry.path, entry.signedUrl);
  }
  return result;
}

// ===== OCENE =====

export type ReviewInput = {
  rating: number;
  quality?: number;
  punctuality?: number;
  communication?: number;
  comment?: string;
};

export async function submitReview(client: ClosingClient, taskId: string, input: ReviewInput) {
  const { error } = await client.rpc('submit_review', {
    target_task: taskId,
    rating: input.rating,
    quality: input.quality ?? undefined,
    punctuality: input.punctuality ?? undefined,
    communication: input.communication ?? undefined,
    comment: input.comment ?? undefined,
  });
  if (error) throw new Error(error.message.split(':')[0] || 'REVIEW_FAILED');
}

/**
 * Ocene za zadatak. Dok obe strane ne ocene, RLS propušta samo sopstvenu —
 * zato se ovde i ne pokušava ništa pametnije: ocene su dvostruko slepe
 * (SPEC sekcija 6, korak 10).
 */
export async function getReviews(client: ClosingClient, taskId: string) {
  const { data, error } = await client.from('reviews').select('*').eq('task_id', taskId);
  if (error) throw new Error('REVIEWS_LOAD_FAILED');
  return data;
}

export async function markPaid(client: ClosingClient, taskId: string, paid = true) {
  const { error } = await client.rpc('mark_task_paid', { target_task: taskId, paid });
  if (error) throw new Error(error.message.split(':')[0] || 'PAYMENT_FAILED');
}

// ===== PORUKE =====

export async function listMessages(client: ClosingClient, taskId: string) {
  const { data, error } = await client
    .from('messages')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at');
  if (error) throw new Error('MESSAGES_LOAD_FAILED');
  return data;
}

export async function sendMessage(client: ClosingClient, taskId: string, body: string) {
  const text = body.trim();
  if (!text) return;
  const { data } = await client.auth.getUser();
  const { error } = await client
    .from('messages')
    .insert({ task_id: taskId, sender_id: data.user?.id ?? '', body: text });
  if (error) throw new Error('MESSAGE_SEND_FAILED');
}

/**
 * Pretplata na nove poruke zadatka. RLS važi i ovde, pa red stiže samo onome
 * ko sme da ga vidi — pretplata se ne može iskoristiti da se vire tuđi razgovori.
 */
export function subscribeToMessages(
  client: ClosingClient,
  taskId: string,
  onMessage: (message: Message) => void,
): RealtimeChannel {
  return client
    .channel(`messages:${taskId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `task_id=eq.${taskId}` },
      (payload) => onMessage(payload.new as Message),
    )
    .subscribe();
}

// ===== PRIJAVE ŠTETE =====

export async function listPropertyReports(client: ClosingClient, propertyId: string) {
  const { data, error } = await client
    .from('property_reports')
    .select('*')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('REPORTS_LOAD_FAILED');
  return data;
}

export async function setReportStatus(
  client: ClosingClient,
  reportId: string,
  status: 'open' | 'acknowledged' | 'resolved',
) {
  const { error } = await client.rpc('set_report_status', {
    target_report: reportId,
    new_status: status,
  });
  if (error) throw new Error(error.message.split(':')[0] || 'REPORT_UPDATE_FAILED');
}
