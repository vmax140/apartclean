import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types/database';
import type { TaskStatus, TaskType } from './constants/enums';

// Faza 2A: zadaci vlasnika. Status se nikad ne menja upisom — svaki prelaz ide
// kroz svoj RPC (SPEC sekcija 5), pa ovde nema nijednog update nad kolonom status.

export type TaskClient = SupabaseClient<Database>;
export type Task = Database['public']['Tables']['cleaning_tasks']['Row'];
export type TaskOffer = Database['public']['Tables']['task_offers']['Row'];

export type NewTaskInput = {
  property_id: string;
  type: TaskType;
  window_start: string;
  window_end: string;
  price_rsd?: number;
  owner_notes?: string;
  extras?: Record<string, boolean>;
};

export async function listTasks(client: TaskClient, filters: { status?: TaskStatus } = {}) {
  let query = client
    .from('cleaning_tasks')
    .select('id,status,type,window_start,window_end,price_rsd,cleaner_id,property_id,properties(name)')
    .order('window_start', { ascending: false });
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query;
  if (error) throw new Error('TASKS_LOAD_FAILED');
  return data.map((row) => ({
    ...row,
    propertyName: (row.properties as unknown as { name: string } | null)?.name ?? '',
  }));
}

export async function createTask(client: TaskClient, input: NewTaskInput) {
  const { data, error } = await client
    .from('cleaning_tasks')
    .insert({
      property_id: input.property_id,
      // owner_id mora da se poklopi sa prijavljenim korisnikom — tako traži RLS.
      owner_id: (await client.auth.getUser()).data.user?.id ?? '',
      type: input.type,
      status: 'draft',
      window_start: input.window_start,
      window_end: input.window_end,
      price_rsd: input.price_rsd ?? null,
      owner_notes: input.owner_notes ?? null,
      extras: input.extras ?? {},
    })
    .select('id')
    .single();
  if (error) throw new Error('TASK_CREATE_FAILED');
  return data.id;
}

export type TaskDetails = {
  task: Task;
  propertyName: string;
  offers: TaskOffer[];
  cleanerName: string | null;
  timeline: { key: string; at: string }[];
};

export async function getTask(client: TaskClient, id: string): Promise<TaskDetails> {
  const [task, offers] = await Promise.all([
    client.from('cleaning_tasks').select('*,properties(name)').eq('id', id).single(),
    client.from('task_offers').select('*').eq('task_id', id).order('created_at'),
  ]);
  if (task.error || offers.error) throw new Error('TASK_LOAD_FAILED');

  let cleanerName: string | null = null;
  if (task.data.cleaner_id) {
    const { data } = await client
      .from('public_profiles')
      .select('full_name')
      .eq('id', task.data.cleaner_id)
      .maybeSingle();
    cleanerName = data?.full_name ?? null;
  }

  return {
    task: task.data,
    propertyName: (task.data.properties as unknown as { name: string } | null)?.name ?? '',
    offers: offers.data,
    cleanerName,
    timeline: buildTimeline(task.data),
  };
}

/** Vremenska linija za ekran detalja: samo koraci koji su se stvarno desili. */
export function buildTimeline(task: Task) {
  const steps: [string, string | null][] = [
    ['timeline.created', task.created_at],
    ['timeline.accepted', task.accepted_at],
    ['timeline.arrived', task.arrived_at],
    ['timeline.submitted', task.submitted_at],
    ['timeline.ready', task.ready_at],
    ['timeline.completed', task.completed_at],
    ['timeline.cancelled', task.cancelled_at],
  ];
  return steps
    .filter((step): step is [string, string] => step[1] !== null)
    .map(([key, at]) => ({ key, at }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Prelazi koje vlasnik sme da pokrene iz datog statusa (SPEC sekcija 5). */
export function ownerActions(status: TaskStatus) {
  switch (status) {
    case 'draft':
      return ['offer', 'cancel'] as const;
    case 'offered':
    case 'open':
    case 'accepted':
      return ['cancel'] as const;
    case 'submitted':
      return ['markReady', 'requestFixes'] as const;
    case 'ready':
      return ['complete', 'dispute'] as const;
    case 'completed':
      return ['dispute'] as const;
    default:
      return [] as const;
  }
}

type RpcName =
  | 'offer_task'
  | 'cancel_task'
  | 'mark_ready'
  | 'request_fixes'
  | 'complete_task'
  | 'accept_offer'
  | 'decline_offer'
  | 'withdraw_task';

async function runTransition(client: TaskClient, fn: RpcName, args: Record<string, unknown>) {
  const { error } = await client.rpc(fn, args as never);
  // Greške iz baze stižu kao 'KOD: objašnjenje'; klijentu vraćamo samo kod.
  if (error) throw new Error(error.message.split(':')[0] || 'TRANSITION_FAILED');
}

export const offerTask = (client: TaskClient, id: string) =>
  runTransition(client, 'offer_task', { target_task: id });

export const cancelTask = (client: TaskClient, id: string, reason: string) =>
  runTransition(client, 'cancel_task', { target_task: id, reason });

export const markReady = (client: TaskClient, id: string) =>
  runTransition(client, 'mark_ready', { target_task: id });

export const requestFixes = (client: TaskClient, id: string, note: string) =>
  runTransition(client, 'request_fixes', { target_task: id, note });

export const completeTask = (client: TaskClient, id: string) =>
  runTransition(client, 'complete_task', { target_task: id });

export async function openDispute(client: TaskClient, id: string, reason: string) {
  const { error } = await client.rpc('open_dispute', { target_task: id, reason });
  if (error) throw new Error(error.message.split(':')[0] || 'TRANSITION_FAILED');
}

// ===== STRANA SPREMAČICE (Faza 2C) =====

/** Ponude koje čekaju odgovor, sa rokom (SPEC sekcija 7 — ekran Ponude). */
export async function listMyOffers(client: TaskClient) {
  const { data, error } = await client
    .from('task_offers')
    // Mora biti jedan doslovan string: spajanje delova obara zaključivanje tipa.
    .select('id,task_id,status,expires_at,proposed_price_rsd,cleaning_tasks(id,status,type,window_start,window_end,price_rsd,property_id,properties(name,complex_name,region_id))')
    .eq('status', 'offered')
    .order('expires_at');
  if (error) throw new Error('OFFERS_LOAD_FAILED');
  return data.map(shapeOffer).filter((row) => row.task !== null);
}

/**
 * Otvoreni poslovi u regionima spremačice. RLS već propušta samo one koje sme
 * da vidi, pa ovde nema dodatnog filtriranja po regionu.
 */
export async function listOpenTasks(client: TaskClient) {
  const { data, error } = await client
    .from('cleaning_tasks')
    .select('id,status,type,window_start,window_end,price_rsd,property_id,properties(name,complex_name,region_id)')
    .eq('status', 'open')
    .order('window_start');
  if (error) throw new Error('TASKS_LOAD_FAILED');
  return data.map(shapeTask);
}

/** Prihvaćeni zadaci spremačice, poređani po terminu (ekran Raspored). */
export async function listMySchedule(client: TaskClient) {
  const { data, error } = await client
    .from('cleaning_tasks')
    .select('id,status,type,window_start,window_end,price_rsd,property_id,properties(name,complex_name,region_id)')
    .in('status', ['accepted', 'in_progress', 'submitted', 'needs_fixes', 'ready'])
    .order('window_start');
  if (error) throw new Error('TASKS_LOAD_FAILED');
  return data.map(shapeTask);
}

// Redovi iz različitih upita imaju različite oblike; ovde nam trebaju samo
// zajednička polja, pa je ulaz namerno širok.
type AnyRow = Record<string, unknown>;

function shapeTask(row: AnyRow) {
  const property = row.properties as { name: string; complex_name: string | null } | null;
  return {
    ...(row as unknown as Pick<Task, 'id' | 'status' | 'type' | 'window_start' | 'window_end' | 'price_rsd' | 'property_id'>),
    propertyName: property?.name ?? '',
    complexName: property?.complex_name ?? null,
  };
}

function shapeOffer(row: AnyRow) {
  const task = row.cleaning_tasks as AnyRow | null;
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    expiresAt: row.expires_at as string | null,
    proposedPrice: row.proposed_price_rsd as number | null,
    task: task ? shapeTask(task) : null,
  };
}

export const acceptOffer = (client: TaskClient, taskId: string) =>
  runTransition(client, 'accept_offer', { target_task: taskId });

export const declineOffer = (client: TaskClient, taskId: string) =>
  runTransition(client, 'decline_offer', { target_task: taskId });

export const withdrawTask = (client: TaskClient, taskId: string) =>
  runTransition(client, 'withdraw_task', { target_task: taskId });

/** Preostalo vreme ponude u minutima; negativno znači da je rok prošao. */
export function minutesLeft(expiresAt: string | null) {
  if (!expiresAt) return null;
  return Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
}
