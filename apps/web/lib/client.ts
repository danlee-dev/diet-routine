'use client';
// Browser-side singletons: the local store (localStorage), the Supabase client when configured, the Env
// that every view/action in @diet/data receives, and the signed-in user.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GeneratedPlan, OnboardingAnswers } from '@diet/core';
import { adoptLegacyProfile, DataStore, profileState, programFromStore, type Env } from '@diet/data';

const STORE_KEY = 'dr:store:v1';

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

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
      // per user: read from the profile row every time, so onboarding, sign-in pulls and edits apply at once
      get program() { return programFromStore(store); },
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    };
    // the owner's browser from before onboarding existed: keep their built-in plan as their profile
    if (profileState(store) === 'legacy') adoptLegacyProfile(env);
    window.addEventListener('pagehide', () => { void store.flush(); });
    return env;
  })();
  return ready;
}

// ---------------- auth state ----------------
export interface AuthUser { id: string; email: string | null }
export interface AuthState {
  /** false until Supabase has restored (or ruled out) a session */
  ready: boolean;
  user: AuthUser | null;
  /** sign-in failure brought back on the redirect (?error_description=...) */
  error: string | null;
}

let auth: AuthState = { ready: false, user: null, error: null };
const authListeners = new Set<() => void>();
const setAuth = (patch: Partial<AuthState>) => {
  auth = { ...auth, ...patch };
  for (const fn of authListeners) fn();
};

export const authStore = {
  get: (): AuthState => auth,
  subscribe: (fn: () => void) => { authListeners.add(fn); return () => { authListeners.delete(fn); }; },
  clearError: () => setAuth({ error: null }),
};

const ERR_KEYS = ['error', 'error_code', 'error_description'];

/**
 * A failed OAuth or email-link sign-in comes back as ?error_description=... (or in the hash).
 * Keep the message for the settings sheet and strip it from the URL before supabase-js and the hash router see it.
 */
function takeUrlAuthError(): string | null {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const desc = url.searchParams.get('error_description') ?? hash.get('error_description')
    ?? url.searchParams.get('error') ?? hash.get('error');
  if (!desc) return null;
  for (const k of ERR_KEYS) url.searchParams.delete(k);
  if (ERR_KEYS.some((k) => hash.has(k))) url.hash = '';
  history.replaceState(history.state, '', url.toString());
  return desc.replace(/\+/g, ' ');
}

let supa: SupabaseClient | null | undefined;

/** Supabase client, or null when the project is not configured yet (local-only mode). */
export function getSupabase(): SupabaseClient | null {
  if (supa !== undefined) return supa;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const urlError = takeUrlAuthError();
  if (urlError) setAuth({ error: urlError });
  // PKCE: Google and the email link return to ?code=..., which the client exchanges on load.
  // Tokens never land in the URL hash, which the app uses for its own routes (#today, #records, #plan).
  supa = url && key
    ? createClient(url, key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;
  return supa;
}

let authStarted = false;

/**
 * Wire auth to the store once per page: restore the saved session (including one just returned from
 * Google or the email link), attach sync for that user, and follow sign-in / sign-out from then on.
 */
export function startAuth(e: Env): void {
  if (authStarted) return;
  authStarted = true;
  const client = getSupabase();
  if (!client) { setAuth({ ready: true }); return; }
  let attachedTo: string | null = null;
  // initialize() hands back the result of reading the redirect. A failed exchange (expired code, link opened
  // in another browser) leaves ?code= in the URL and no session: report it and clean the URL.
  void client.auth.initialize().then(({ error }) => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('code')) {
      url.searchParams.delete('code');
      history.replaceState(history.state, '', url.toString());
    }
    if (error) setAuth({ error: error.message });
  });
  // INITIAL_SESSION fires after the client has finished reading ?code= from the redirect, so it already
  // carries the new session. SIGNED_IN covers the email code and later sign-ins in this tab.
  client.auth.onAuthStateChange((_evt, session) => {
    const u = session?.user ?? null;
    setAuth({ ready: true, user: u ? { id: u.id, email: u.email ?? null } : null, ...(u ? { error: null } : {}) });
    if (u && u.id !== attachedTo) {
      attachedTo = u.id;
      // Supabase calls made inside this callback can deadlock on its auth lock, so start sync on the next tick.
      setTimeout(() => { void e.store.attach(client, u.id); }, 0);
    } else if (!u && attachedTo) {
      attachedTo = null;
      e.store.detach();
    }
  });
}

export async function signInWithGoogle(): Promise<string | null> {
  const client = getSupabase();
  if (!client) return '동기화 서버가 아직 연결되지 않았습니다';
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  return error ? error.message : null;
}

/**
 * Ask the server (coach) to refine the offline plan. Signed-in only; falls back to null on any failure or
 * after `timeoutMs`, and the caller keeps the local plan.
 */
export async function generatePlanRemote(answers: OnboardingAnswers, baseline: GeneratedPlan, timeoutMs = 20000): Promise<GeneratedPlan | null> {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/plan/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ answers, baseline }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const g = (await res.json()) as Partial<GeneratedPlan> | null;
    // accept only something shaped like a plan; anything else keeps the local one
    const ok = !!g && typeof g.targets?.kcal === 'number' && typeof g.targets?.proteinFloor === 'number' && !!g.plan?.meals
      && typeof g.weeklyCost === 'number' && !!g.day && Array.isArray(g.notes);
    return ok ? (g as GeneratedPlan) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function signOut(e: Env): Promise<void> {
  const client = getSupabase();
  e.store.detach();
  if (client) await client.auth.signOut();
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
