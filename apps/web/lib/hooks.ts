'use client';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Env } from '@diet/data';

export const EnvContext = createContext<Env | null>(null);

/** The store env plus a version number that changes on every data change (re-render trigger). */
export function useEnv(): Env {
  const env = useContext(EnvContext);
  if (!env) throw new Error('EnvContext missing');
  useSyncExternalStore(env.store.subscribe, env.store.getVersion, env.store.getVersion);
  return env;
}

/** Re-render every 30 s so relative times stay current; reload when the date changes. */
export function useMinuteTick(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const day = new Date().toDateString();
    const id = setInterval(() => {
      if (new Date().toDateString() !== day) { location.reload(); return; }
      setT(Date.now());
    }, 30000);
    const vis = () => { if (!document.hidden) setT(Date.now()); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return t;
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => { const m = matchMedia(query); m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); },
    () => matchMedia(query).matches,
    () => false,
  );
}

export const usePhone = () => useMedia('(max-width: 767px)');
