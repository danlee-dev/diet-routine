// Keeps the widgets, Siri answers and Live Activities in step with the store, and applies what they asked
// for while the app was closed. Mounted once in the root layout.
//   store change  -> glance.json (widgets reload only when something they show changed), cutoff countdown
//   foreground / Darwin notification -> queued actions applied through @diet/data, then glance.json again
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router, usePathname } from 'expo-router';
import { minutesOf } from '@diet/core';
import { applyQueued, glance, glanceKey, parseQueued, type Env } from '@diet/data';
import { DarouNative } from '../../../modules/darou-native';
import { startRunActivitySync, syncCutoffActivity } from './activities';

let lastKey = '';

/** Write glance.json; `force` writes even when nothing changed (after applying queued actions). */
export function writeGlance(env: Env, force = false): void {
  const g = glance(env);
  const key = glanceKey(g);
  const changed = key !== lastKey;
  if (!changed && !force) return;
  if (DarouNative.writeGlance(JSON.stringify(g), changed || force)) lastKey = key;
}

/** "달리기 시작" from Siri opens the app; an older request (the app was opened much later) is dropped. */
const START_RUN_FRESH_MS = 2 * 60_000;

/** Apply every queued action once. Returns a run start request, if one is fresh. */
export function drainQueue(env: Env): 'run' | 'walk' | null {
  const raw = DarouNative.readQueue();
  if (!raw.length) return null;
  const done: string[] = [];
  let startRun: 'run' | 'walk' | null = null;
  for (const r of raw) {
    const a = parseQueued(r);
    if (!a) {
      if (typeof r.id === 'string') done.push(r.id); // unknown or broken: drop it instead of retrying forever
      continue;
    }
    try {
      if (applyQueued(env, a) === 'app' && a.kind === 'startRun' && Date.now() - a.at < START_RUN_FRESH_MS) startRun = a.mode;
    } catch (e) {
      if (__DEV__) console.warn('[native] queued action', a.kind, e);
    }
    done.push(a.id);
  }
  DarouNative.ackQueue(done);
  writeGlance(env, true);
  return startRun;
}

/**
 * Open the run screen with a start request. On it already (before the start or while recording), only the
 * param changes, so a second run screen never stacks on top of the first.
 */
function openRun(mode: 'run' | 'walk', pathname: string): void {
  if (pathname.startsWith('/run')) router.setParams({ start: mode });
  else router.push({ pathname: '/run', params: { start: mode } });
}

export function useNativeExtras(env: Env | null, onboarded: boolean): void {
  const pathname = usePathname();
  const onboardedRef = useRef(onboarded);
  const pathRef = useRef(pathname);
  const pendingRun = useRef<'run' | 'walk' | null>(null);
  useEffect(() => { onboardedRef.current = onboarded; pathRef.current = pathname; }, [onboarded, pathname]);

  // a request that arrived before onboarding finished (or before the first screen) waits for it
  useEffect(() => {
    if (!onboarded || !pendingRun.current) return;
    const mode = pendingRun.current;
    pendingRun.current = null;
    setTimeout(() => openRun(mode, pathRef.current), 0);
  }, [onboarded]);

  useEffect(() => {
    if (!env || !DarouNative.available) return;
    startRunActivitySync();
    let storeTimer: ReturnType<typeof setTimeout> | null = null;
    let cutoffTimer: ReturnType<typeof setTimeout> | null = null;

    // check the cutoff countdown again at the next minute it can change (19:30, 20:00) while the app is open
    const cutoff = () => {
      if (cutoffTimer) clearTimeout(cutoffTimer);
      cutoffTimer = null;
      const next = syncCutoffActivity(env);
      if (next == null || AppState.currentState !== 'active') return;
      const now = env.now();
      const ms = (next - minutesOf(now)) * 60_000 - now.getSeconds() * 1000 + 1000;
      if (ms > 0 && ms < 6 * 3600_000) cutoffTimer = setTimeout(cutoff, ms);
    };

    const drain = () => {
      const mode = drainQueue(env);
      if (!mode) return;
      // the run screen starts recording itself from the param (and just shows the run if one is going).
      // Deferred a tick so a cold start has its first screen before anything is pushed on top.
      if (onboardedRef.current) setTimeout(() => openRun(mode, pathRef.current), 0);
      else pendingRun.current = mode;
    };

    const all = () => { drain(); writeGlance(env); cutoff(); };

    const offStore = env.store.subscribe(() => {
      if (storeTimer) clearTimeout(storeTimer);
      storeTimer = setTimeout(() => { writeGlance(env); cutoff(); }, 400);
    });
    const queueSub = DarouNative.addListener('onQueue', drain);
    const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') all(); });
    all();
    return () => {
      offStore();
      queueSub.remove();
      appSub.remove();
      if (storeTimer) clearTimeout(storeTimer);
      if (cutoffTimer) clearTimeout(cutoffTimer);
    };
  }, [env]);
}
