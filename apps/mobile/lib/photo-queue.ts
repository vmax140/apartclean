import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { UploadQueue, type QueueStorage } from '@apartclean/shared/upload-queue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@apartclean/shared';

// Slanje slika zadatka, otporno na nestanak mreže (SPEC sekcija 6, Izuzeci).
//
// U red ide samo putanja do fajla i podaci uz sliku, ne i sam sadržaj: slika od
// nekoliko stotina kilobajta u AsyncStorage-u bi red učinila sporim i krhkim.
// Fajl ostaje u kešu aplikacije dok ne bude poslat.

const LONG_EDGE = 1600;
const JPEG_QUALITY = 0.8;
const QUEUE_KEY = 'apartclean.photo-queue';

export type PendingPhoto = {
  taskId: string;
  roomId: string | null;
  checklistRowId: string | null;
  uri: string;
  sha256: string;
  width: number;
  height: number;
  capturedAt: string;
  lat: number | null;
  lng: number | null;
  createdBy: string;
};

const storage: QueueStorage = {
  read: (key) => AsyncStorage.getItem(key),
  write: (key, value) => AsyncStorage.setItem(key, value),
};

/**
 * Smanjenje na 1.600 px duže ivice, JPEG 80% i SHA-256 (pravilo iz CLAUDE.md).
 * Heš se računa nad poslatim fajlom, ne nad originalom, da bi odgovarao onome
 * što zaista stigne na server.
 */
export async function preparePhoto(uri: string, width: number, height: number) {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  context.resize(width >= height ? { width: LONG_EDGE } : { height: LONG_EDGE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const base64 = await FileSystem.readAsStringAsync(saved.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
    encoding: Crypto.CryptoEncoding.HEX,
  });

  return { uri: saved.uri, sha256, width: saved.width, height: saved.height };
}

async function upload(client: SupabaseClient<Database>, photo: PendingPhoto) {
  const photoId = Crypto.randomUUID();
  const path = `${photo.taskId}/${photoId}.jpg`;

  const base64 = await FileSystem.readAsStringAsync(photo.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

  const sent = await client.storage
    .from('task-photos')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (sent.error) throw new Error('UPLOAD_FAILED');

  const { error } = await client.from('task_photos').insert({
    id: photoId,
    task_id: photo.taskId,
    room_id: photo.roomId,
    checklist_row_id: photo.checklistRowId,
    kind: 'after',
    storage_path: path,
    width: photo.width,
    height: photo.height,
    sha256: photo.sha256,
    captured_at: photo.capturedAt,
    lat: photo.lat,
    lng: photo.lng,
    created_by: photo.createdBy,
  });
  if (error) {
    // Red nije upisan, pa fajl ne sme da ostane kao siroče.
    await client.storage.from('task-photos').remove([path]);
    throw new Error('SAVE_FAILED');
  }

  // Fajl je stigao; keš se čisti da telefon ne nosi nepotreban teret.
  await FileSystem.deleteAsync(photo.uri, { idempotent: true });
}

export function createPhotoQueue(client: SupabaseClient<Database>) {
  return new UploadQueue<PendingPhoto>(storage, QUEUE_KEY, (photo) => upload(client, photo));
}
