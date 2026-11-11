import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './types/database';
import type { NewProperty } from './schemas/property';
import { randomId } from './id';

export type PropertyClient = SupabaseClient<Database>;
export type Property = Database['public']['Tables']['properties']['Row'];
export type PropertyRoom = Database['public']['Tables']['property_rooms']['Row'];
export type ReferencePhoto = Database['public']['Tables']['reference_photos']['Row'];
export type PropertyCalendar = Database['public']['Tables']['property_calendars']['Row'];
export type ChecklistItem = Database['public']['Tables']['checklist_items']['Row'];
export type Region = Database['public']['Tables']['regions']['Row'];

export const REFERENCE_BUCKET = 'reference-photos';

/** Potpisani link traje kratko — dovoljno da se slika prikaže, prekratko da se deli. */
const SIGNED_URL_SECONDS = 600;

export async function listRegions(client: PropertyClient) {
  const { data, error } = await client.from('regions').select('*').order('name');
  if (error) throw new Error('REGIONS_LOAD_FAILED');
  return data;
}

export async function listProperties(client: PropertyClient) {
  const { data, error } = await client
    .from('properties')
    .select('id,name,address,complex_name,region_id,is_active,created_at,property_rooms(count)')
    .order('created_at', { ascending: false });
  if (error) throw new Error('PROPERTIES_LOAD_FAILED');
  return data.map((row) => ({
    ...row,
    roomCount: (row.property_rooms as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}

export type PropertyDetails = {
  property: Property;
  rooms: PropertyRoom[];
  calendars: PropertyCalendar[];
  photos: ReferencePhoto[];
  checklist: ChecklistItem[];
};

export async function getProperty(client: PropertyClient, id: string): Promise<PropertyDetails> {
  const [property, rooms, calendars, photos, templates] = await Promise.all([
    client.from('properties').select('*').eq('id', id).single(),
    client.from('property_rooms').select('*').eq('property_id', id).order('sort_order'),
    client.from('property_calendars').select('*').eq('property_id', id),
    client.from('reference_photos').select('*').eq('property_id', id).order('created_at'),
    client.from('checklist_templates').select('id').eq('property_id', id),
  ]);
  if (property.error || rooms.error || calendars.error || photos.error || templates.error) {
    throw new Error('PROPERTY_LOAD_FAILED');
  }

  const templateId = templates.data[0]?.id;
  let checklist: ChecklistItem[] = [];
  if (templateId) {
    const items = await client
      .from('checklist_items')
      .select('*')
      .eq('template_id', templateId)
      .order('room_type')
      .order('sort_order');
    if (items.error) throw new Error('PROPERTY_LOAD_FAILED');
    checklist = items.data;
  }

  return {
    property: property.data,
    rooms: rooms.data,
    calendars: calendars.data,
    photos: photos.data,
    checklist,
  };
}

/**
 * Apartman, sobe, kalendari i checklista nastaju u jednoj transakciji.
 * Vlasnika upisuje baza iz prijave, ne klijent.
 */
export async function createProperty(client: PropertyClient, input: NewProperty) {
  const { data, error } = await client.rpc('create_property', { payload: input as Json });
  // Poruke iz baze su oblika 'KOD: objašnjenje' — klijentu vraćamo samo kod.
  if (error) throw new Error(error.message.split(':')[0] || 'PROPERTY_CREATE_FAILED');
  return data;
}


/** Putanja po docs/DECISIONS.md, odluka 5. */
export function referencePhotoPath(propertyId: string, roomId: string, photoId: string) {
  return `${propertyId}/${roomId}/${photoId}.jpg`;
}

export async function uploadReferencePhoto(
  client: PropertyClient,
  options: {
    propertyId: string;
    roomId: string;
    body: Blob | ArrayBuffer | Uint8Array;
    angleLabel?: string;
    notes?: string;
  },
) {
  const photoId = randomId();
  const path = referencePhotoPath(options.propertyId, options.roomId, photoId);

  const upload = await client.storage
    .from(REFERENCE_BUCKET)
    .upload(path, options.body as Blob, { contentType: 'image/jpeg', upsert: false });
  if (upload.error) throw new Error('PHOTO_UPLOAD_FAILED');

  const { error } = await client.from('reference_photos').insert({
    id: photoId,
    property_id: options.propertyId,
    room_id: options.roomId,
    storage_path: path,
    angle_label: options.angleLabel ?? null,
    notes: options.notes ?? null,
  });
  if (error) {
    // Red nije upisan, pa fajl ne sme da ostane kao siroče.
    await client.storage.from(REFERENCE_BUCKET).remove([path]);
    throw new Error('PHOTO_SAVE_FAILED');
  }
  return photoId;
}

export async function removeReferencePhoto(client: PropertyClient, photo: ReferencePhoto) {
  const { error } = await client.from('reference_photos').delete().eq('id', photo.id);
  if (error) throw new Error('PHOTO_DELETE_FAILED');
  await client.storage.from(REFERENCE_BUCKET).remove([photo.storage_path]);
}

/** Bucket je privatan, pa se slike prikazuju isključivo preko potpisanih linkova. */
export async function signReferencePhotos(client: PropertyClient, photos: ReferencePhoto[]) {
  if (!photos.length) return new Map<string, string>();
  const { data, error } = await client.storage
    .from(REFERENCE_BUCKET)
    .createSignedUrls(photos.map((photo) => photo.storage_path), SIGNED_URL_SECONDS);
  if (error) throw new Error('PHOTO_LINK_FAILED');
  const byPath = new Map(data.map((entry) => [entry.path ?? '', entry.signedUrl]));
  return new Map(photos.map((photo) => [photo.id, byPath.get(photo.storage_path) ?? '']));
}
