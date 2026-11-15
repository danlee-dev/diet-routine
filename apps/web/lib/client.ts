'use client';
// Browser-side singletons: the local store (localStorage), the Supabase client when configured, and the Env
// that every view/action in @diet/data receives.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_PROGRAM } from '@diet/core';
import { DataStore, type Env } from '@diet/data';

const STORE_KEY = 'dr:store:v1';

const localPersist = {
  async load() {
    try { return localStorage.getItem(STORE_KEY); } catch { return null; }
  },
  async save(json: string) {
    try { localStorage.setItem(STORE_KEY, json); } catch { /* storage full or blocked */ }
  },
};

let env: Env | null = null;
let ready: Promise<Env> | null = null;

/** Lazily create the store once per page. */
export function getEnv(): Promise<Env> {
  if (ready) return ready;
  ready = (async () => {
    const store = new DataStore(localPersist);
    await store.init();
    env = {
      store,
      program: DEFAULT_PROGRAM,
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    };
    window.addEventListener('pagehide', () => { void store.flush(); });
    return env;
  })();
  return ready;
}

let supa: SupabaseClient | null | undefined;

/** Supabase client, or null when the project is not configured yet (local-only mode). */
export function getSupabase(): SupabaseClient | null {
  if (supa !== undefined) return supa;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  supa = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
  return supa;
}

/** Device-only preferences (not synced). */
export const devicePref = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(`dr:pref:${k}`); return v == null ? d : (JSON.parse(v) as T); } catch { return d; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem(`dr:pref:${k}`, JSON.stringify(v)); } catch { /* ignore */ }
  },
};

/** Legacy site data left in this browser under dp:* keys (same origin as the old page). */
export function readLegacyLocal(): Record<string, unknown> | null {
  try {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('dp:')) continue;
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      try { out[k.slice(3)] = JSON.parse(raw); n++; } catch { /* skip */ }
    }
    return n ? out : null;
  } catch {
    return null;
  }
}
