import 'react-native-url-polyfill/auto';
import { createClient, processLock } from '@supabase/supabase-js';
import type { Database } from '@apartclean/shared';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const storage = {
  async getItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(key));
    if (!count) return null;
    const parts = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(key + '.' + i)));
    return parts.some((part) => part === null) ? null : parts.join('');
  },
  async setItem(key: string, value: string) {
    // Limit each stored value to at most 2 KiB, including non-ASCII account metadata.
    const previous = Number(await SecureStore.getItemAsync(key));
    const parts = value.match(/[\s\S]{1,500}/gu) ?? [''];
    await Promise.all(parts.map((part, i) => SecureStore.setItemAsync(key + '.' + i, part)));
    await SecureStore.setItemAsync(key, String(parts.length));
    for (let i = parts.length; i < previous; i++) await SecureStore.deleteItemAsync(key + '.' + i);
  },
  async removeItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(key));
    await SecureStore.deleteItemAsync(key);
    await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(key + '.' + i)));
  },
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && key ? createClient<Database>(url, key, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : storage,
    flowType: 'pkce',
    detectSessionInUrl: false,
    lock: processLock,
  },
}) : undefined;
