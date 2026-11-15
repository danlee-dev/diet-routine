import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import type { Env } from '@diet/data';

export const EnvContext = createContext<Env | null>(null);

export function useEnv(): Env {
  const env = useContext(EnvContext);
  if (!env) throw new Error('EnvContext missing');
  useSyncExternalStore(env.store.subscribe, env.store.getVersion, env.store.getVersion);
  // Native tabs freeze hidden screens; re-render when this screen comes back so it shows the latest rows.
  useIsFocused();
  return env;
}

/** Re-render every 30 s and when the app comes back to the foreground. */
export function useMinuteTick(): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 30000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setT(Date.now()); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  return t;
}
