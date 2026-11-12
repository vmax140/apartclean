import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';
import type { ReportCategory } from './constants/enums';

// Faza 2D: ono što spremačica radi na terenu (SPEC sekcija 6, koraci 5–8).

export type FieldClient = SupabaseClient<Database>;
export type ChecklistRow = Database['public']['Tables']['task_checklist']['Row'];
export type TaskPhoto = Database['public']['Tables']['task_photos']['Row'];
export type Room = Database['public']['Tables']['property_rooms']['Row'];

export type AccessInfo = {
  key_instructions: string | null;
  lockbox_code: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
};

/** Sledeći posao za ekran Danas: jedan zadatak, jedna glavna akcija. */
export async function getNextJob(client: FieldClient) {
  const { data, error } = await client
    .from('cleaning_tasks')
    .select('id,status,type,window_start,window_end,property_id,arrival_distance_m,properties(name,address,lat,lng,geofence_m,complex_name)')
    .in('status', ['accepted', 'in_progress', 'needs_fixes'])
    .order('window_start')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('TASK_LOAD_FAILED');
  if (!data) return null;
  const property = data.properties as unknown as {
    name: string;
    address: string;
    lat: number;
    lng: number;
    geofence_m: number;
    complex_name: string | null;
  };
  return { ...data, property };
}

export type Work = {
  rooms: Room[];
  checklist: ChecklistRow[];
  photos: Pick<TaskPhoto, 'id' | 'room_id' | 'checklist_row_id'>[];
  references: { id: string; room_id: string; storage_path: string; angle_label: string | null }[];
};

export async function getWork(client: FieldClient, taskId: string, propertyId: string): Promise<Work> {
  const [rooms, checklist, photos, references] = await Promise.all([
    client.from('property_rooms').select('*').eq('property_id', propertyId).order('sort_order'),
    client.from('task_checklist').select('*').eq('task_id', taskId).order('room_id').order('label'),
    client.from('task_photos').select('id,room_id,checklist_row_id').eq('task_id', taskId),
    client
      .from('reference_photos')
      .select('id,room_id,storage_path,angle_label')
      .eq('property_id', propertyId),
  ]);
  if (rooms.error || checklist.error || photos.error || references.error) {
    throw new Error('WORK_LOAD_FAILED');
  }
  return {
    rooms: rooms.data,
    checklist: checklist.data,
    photos: photos.data,
    references: references.data,
  };
}

export async function setChecklistItem(client: FieldClient, id: string, done: boolean) {
  const { error } = await client
    .from('task_checklist')
    .update({ is_done: done, done_at: done ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw new Error('CHECKLIST_UPDATE_FAILED');
}

export async function checkIn(
  client: FieldClient,
  input: { taskId: string; lat: number; lng: number; reason?: string },
) {
  const { error } = await client.rpc('check_in', {
    target_task: input.taskId,
    lat: input.lat,
    lng: input.lng,
    reason: input.reason ?? undefined,
  });
  if (error) throw new Error(error.message.split(':')[0] || 'CHECKIN_FAILED');
}

/**
 * Pristupni podaci se dešifruju u Edge Function-u i stižu tek kada baza potvrdi
 * da je zadatak dodeljen ovoj spremačici i da je u vremenskom okviru (SPEC sekcija 4).
 */
export async function loadAccessInfo(client: FieldClient, taskId: string) {
  const { data, error } = await client.functions.invoke('property-access', {
    body: { action: 'cleaner', taskId },
  });
  if (error) throw new Error('ACCESS_LOCKED');
  return (data as { access: AccessInfo | null }).access;
}

export async function reportIssue(
  client: FieldClient,
  input: { taskId: string; category: ReportCategory; description: string; photoIds?: string[] },
) {
  const { error } = await client.rpc('report_property_issue', {
    target_task: input.taskId,
    category: input.category,
    description: input.description,
    photo_ids: input.photoIds ?? [],
  });
  if (error) throw new Error(error.message.split(':')[0] || 'REPORT_FAILED');
}

export async function submitWork(client: FieldClient, taskId: string) {
  const { error } = await client.rpc('submit_task', { target_task: taskId });
  if (error) throw new Error(error.message.split(':')[0] || 'SUBMIT_FAILED');
}

/** Šta još fali do predaje — isto pravilo koje baza primenjuje u submit_task. */
export function remainingWork(work: Work) {
  const undone = work.checklist.filter((row) => !row.is_done);
  const photographed = new Set(
    work.photos.flatMap((photo) =>
      [photo.checklist_row_id, photo.room_id].filter((value): value is string => value !== null),
    ),
  );
  const missingPhotos = work.checklist.filter(
    (row) => row.requires_photo && !photographed.has(row.id) && !(row.room_id && photographed.has(row.room_id)),
  );
  return { undone, missingPhotos, ready: undone.length === 0 && missingPhotos.length === 0 };
}
