// App singletons: the local store (SQLite key-value), Supabase client, and the Env shared with @diet/data.
import 'react-native-url-polyfill/auto';
import Storage from 'expo-sqlite/kv-store';
import * as Crypto from 'expo-crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DataStore, programFromStore, type Env } from '@diet/data';

const STORE_KEY = 'dr:store:v1';

const persist = {
  load: async () => Storage.getItem(STORE_KEY),
  save: async (json: string) => { await Storage.setItem(STORE_KEY, json); },
};

let ready: Promise<Env> | null = null;
export function getEnv(): Promise<Env> {
  if (ready) return ready;
  ready = (async () => {
    const store = new DataStore(persist);
    await store.init();
    // program comes from the profile row (onboarding, or the owner's adopted built-in plan)
    return { store, get program() { return programFromStore(store); }, now: () => new Date(), newId: () => Crypto.randomUUID() } as Env;
  })();
  return ready;
}

let supa: SupabaseClient | null | undefined;
export function getSupabase(): SupabaseClient | null {
  if (supa !== undefined) return supa;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  supa = url && key
    ? createClient(url, key, { auth: { storage: Storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' } })
    : null;
  return supa;
}

/** Device-only preferences (not synced). */
export const devicePref = {
  get<T>(k: string, d: T): T {
    try { const v = Storage.getItemSync(`dr:pref:${k}`); return v == null ? d : (JSON.parse(v) as T); } catch { return d; }
  },
  set(k: string, v: unknown) {
    try { Storage.setItemSync(`dr:pref:${k}`, JSON.stringify(v)); } catch { /* ignore */ }
  },
};
