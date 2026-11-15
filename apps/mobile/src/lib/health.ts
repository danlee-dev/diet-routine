// Apple Health bridge. In: today's steps, the latest body mass, last night's sleep end (as a wake time
// the user confirms). Out: weights logged in the app and finished home workouts, each written once.
// Nothing here asks for permission by itself; the settings section calls connectHealth().
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import {
  AuthorizationRequestStatus, AuthorizationStatus, CategoryValueSleepAnalysis, UpdateFrequency, WorkoutActivityType,
  authorizationStatusFor, clearBackgroundTypes, configureBackgroundTypes, deleteObjects, getRequestStatusForAuthorization, isHealthDataAvailable,
  queryCategorySamples, queryQuantitySamples, queryStatisticsForQuantity, requestAuthorization, saveCategorySample, saveQuantitySample,
  saveWorkoutSample, subscribeToChanges, type QuantitySample,
} from '@kingstinct/react-native-healthkit';
import { hhmm, keyOf, parseKey, round1, startOfDay, wakeFromSleep, type WeightRow, type WorkoutRow } from '@diet/core';
import { setDay, setWake, todayView, type Env } from '@diet/data';
import { devicePref } from './env';
import { createPrefStore, postWakeSuggestion } from './notifications';

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
const MASS = 'HKQuantityTypeIdentifierBodyMass' as const;
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;
const WORKOUT = 'HKWorkoutTypeIdentifier' as const;
const READ = [STEPS, MASS, SLEEP] as const;
const SHARE = [MASS, WORKOUT] as const;

export interface HealthPrefs {
  /** The user connected Apple Health from settings (authorization was requested). */
  connected: boolean;
  /** First day whose app weights and workouts are written to Health (no back-filling history). */
  connectedOn: string | null;
  steps: boolean;
  weightIn: boolean;
  weightOut: boolean;
  sleep: boolean;
  workoutOut: boolean;
}

export const healthPrefs = createPrefStore<HealthPrefs>('health', {
  connected: false, connectedOn: null, steps: true, weightIn: true, weightOut: true, sleep: true, workoutOut: true,
});

export const useHealthPrefs = (): HealthPrefs => useSyncExternalStore(healthPrefs.subscribe, healthPrefs.get, healthPrefs.get);

export function healthAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  try { return isHealthDataAvailable(); } catch { return false; }
}

const todayKey = (env: Env): string => keyOf(env.now());

// ---------------- permission ----------------
export type HealthAccess = 'unavailable' | 'notAsked' | 'asked';

/** HealthKit never reveals read grants; "asked" means the sheet was shown for every type we use. */
export async function healthAccess(): Promise<HealthAccess> {
  if (!healthAvailable()) return 'unavailable';
  const s = await getRequestStatusForAuthorization({ toRead: READ, toShare: SHARE });
  return s === AuthorizationRequestStatus.unnecessary ? 'asked' : 'notAsked';
}

/** Write access per type (the one thing HealthKit does report). */
export function healthWriteAllowed(): { weight: boolean; workout: boolean } {
  if (!healthAvailable()) return { weight: false, workout: false };
  return {
    weight: authorizationStatusFor(MASS) === AuthorizationStatus.sharingAuthorized,
    workout: authorizationStatusFor(WORKOUT) === AuthorizationStatus.sharingAuthorized,
  };
}

/** Show the Health permission sheet and turn syncing on. Called from the settings section only. */
export async function connectHealth(env: Env): Promise<boolean> {
  if (!healthAvailable()) return false;
  try {
    await requestAuthorization({ toRead: READ, toShare: SHARE });
  } catch {
    return false;
  }
  healthPrefs.set({ connected: true, connectedOn: healthPrefs.get().connectedOn ?? todayKey(env) });
  return true;
}

/** Stop syncing, including the background wake-ups registered at launch. Permissions stay in Settings. */
export function disconnectHealth(): void {
  backgroundConfigured = false;
  void clearBackgroundTypes().catch(() => false);
  healthPrefs.set({ connected: false });
}

// ---------------- reads ----------------
async function syncSteps(env: Env): Promise<void> {
  const v = todayView(env);
  const res = await queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
    filter: { date: { startDate: v.ctx.date, endDate: env.now() } }, unit: 'count',
  });
  const n = Math.min(99999, Math.round(res.sumQuantity?.quantity ?? 0));
  const d = v.day;
  // Health owns the number once it is the source; a manual entry is only replaced when Health catches up
  if (d.steps_source === 'health' ? n !== d.steps : n > d.steps) setDay(env, v.ctx.key, { steps: n, steps_source: 'health' });
}

// every sample this app writes carries a 'dr-' external id; anything else (a scale, another app) is a reading
const isOwnSample = (s: QuantitySample): boolean => String(s.metadata?.HKExternalUUID ?? '').startsWith('dr-');

export interface HealthWeight { kg: number; at: Date; own: boolean; uuid: string }

export async function latestHealthWeight(): Promise<HealthWeight | null> {
  const s = (await queryQuantitySamples(MASS, { limit: 1, ascending: false, unit: 'kg' }))[0];
  return s ? { kg: round1(s.quantity), at: s.endDate, own: isOwnSample(s), uuid: s.uuid } : null;
}

const SEEN_WEIGHTS = 'health:seenWeights';

/**
 * A scale reading from today fills today's weight unless the user typed one. Each Health sample is looked at
 * once: a reading the user deleted in the app does not come back, and a new reading (new sample) still does.
 */
async function importWeight(env: Env): Promise<void> {
  const w = await latestHealthWeight();
  const key = todayKey(env);
  if (!w || w.own || keyOf(w.at) !== key) return;
  const seen = devicePref.get<string[]>(SEEN_WEIGHTS, []);
  if (seen.includes(w.uuid)) return;
  devicePref.set(SEEN_WEIGHTS, [...seen.slice(-59), w.uuid]);
  const cur = env.store.get<WeightRow>('weights', key);
  if (cur && (cur.source !== 'health' || Math.abs(cur.kg - w.kg) < 0.05)) return;
  env.store.put<WeightRow>('weights', { date: key, kg: w.kg, source: 'health' });
}

/** End of last night's sleep as minutes today, or null (rules in core `wakeFromSleep`). */
export async function lastNightWake(env: Env): Promise<number | null> {
  const now = env.now();
  const from = new Date(startOfDay(now).getTime() - 6 * 3600_000);
  const samples = await queryCategorySamples(SLEEP, { limit: 0, filter: { date: { startDate: from, endDate: now } } });
  return wakeFromSleep(
    samples
      .filter((s) => s.value !== CategoryValueSleepAnalysis.awake)
      .map((s) => ({ start: s.startDate, end: s.endDate, asleep: s.value !== CategoryValueSleepAnalysis.inBed })),
    now,
  );
}

// ---------------- wake suggestion (confirm, never silent) ----------------
export interface WakeSuggestion { date: string; wake: number }
const wakeStore = createPrefStore<{ pending: WakeSuggestion | null; askedOn: string | null; dismissedOn: string | null }>(
  'health:wake', { pending: null, askedOn: null, dismissedOn: null },
);

async function suggestWake(env: Env): Promise<void> {
  const v = todayView(env);
  const st = wakeStore.get();
  if (v.day.wake_min != null || st.dismissedOn === v.ctx.key) return;
  const wake = await lastNightWake(env);
  if (wake == null) return;
  if (st.pending?.date !== v.ctx.key || st.pending.wake !== wake) wakeStore.set({ pending: { date: v.ctx.key, wake } });
  // one notification a day, only when reminders allow it now; the in-app card shows a corrected time either way
  if (st.askedOn !== v.ctx.key && (await postWakeSuggestion(v.ctx.key, wake, hhmm(wake), env.now()))) wakeStore.set({ askedOn: v.ctx.key });
}

/**
 * Today's wake time read from Apple Health, waiting for the user's yes. For a card on the Today screen:
 * `accept()` sets it with the same rule as the time sheet, `dismiss()` hides it for today.
 */
export function useWakeSuggestion(env: Env): { wake: number | null; accept: () => void; dismiss: () => void } {
  'use no memo'; // todayView(env) reads mutable rows through a stable env
  const st = useSyncExternalStore(wakeStore.subscribe, wakeStore.get, wakeStore.get);
  const v = todayView(env);
  const p = st.pending;
  const live = p && p.date === v.ctx.key && v.day.wake_min == null ? p.wake : null;
  return {
    wake: live,
    accept: () => { if (live != null) setWake(env, live, { lateRule: true }); wakeStore.set({ pending: null }); },
    dismiss: () => wakeStore.set({ pending: null, dismissedOn: v.ctx.key }),
  };
}

// ---------------- writes (each once) ----------------
// Samples carry a HealthKit sync identifier per day / workout: a newer version replaces the older sample in
// Health itself, so an edit, a reinstall (lost ledger) or a second device never leaves two weights for one day.
// The device ledger is only needed to delete what the app removed.
type WeightLedger = Record<string, { kg: number; uuid?: string }>;
const WEIGHT_LEDGER = 'health:weights';
const WORKOUT_LEDGER = 'health:workouts';

/** When the sample is stamped: the moment it was logged if that was on its own day, else 08:00 of that day. */
function stampFor(date: string, updatedAt: string | undefined): Date {
  const u = updatedAt ? new Date(updatedAt) : null;
  if (u && keyOf(u) === date) return u;
  const d = parseKey(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0);
}

async function exportWeights(env: Env, since: string): Promise<void> {
  const ledger = devicePref.get<WeightLedger>(WEIGHT_LEDGER, {});
  const live = new Set<string>();
  for (const w of env.store.all<WeightRow>('weights')) {
    if (w.source !== 'manual' || w.date < since) continue;
    live.add(w.date);
    const prev = ledger[w.date];
    if (prev && Math.abs(prev.kg - w.kg) < 0.05) continue;
    const at = stampFor(w.date, w.updated_at);
    const saved = await saveQuantitySample(MASS, 'kg', w.kg, at, at, {
      HKExternalUUID: `dr-weight-${w.date}`, HKSyncIdentifier: `dr-weight-${w.date}`, HKSyncVersion: Date.parse(w.updated_at ?? '') || Date.now(),
      HKWasUserEntered: true,
    });
    ledger[w.date] = { kg: w.kg, uuid: saved?.uuid };
    devicePref.set(WEIGHT_LEDGER, ledger);
  }
  // weights deleted in the app are removed from Health too
  for (const [date, e] of Object.entries(ledger)) {
    if (live.has(date) || date < since) continue;
    if (e.uuid) await deleteObjects(MASS, { uuid: e.uuid }).catch(() => 0);
    delete ledger[date];
    devicePref.set(WEIGHT_LEDGER, ledger);
  }
}

async function exportWorkouts(env: Env, since: string): Promise<void> {
  const done = new Set(devicePref.get<string[]>(WORKOUT_LEDGER, []));
  for (const w of env.store.all<WorkoutRow>('workouts')) {
    // runs are written by the run tracker with their route; only home workouts here
    if (w.source !== 'app' || (w.type !== 'home_a' && w.type !== 'home_b') || !w.started_at || !w.ended_at || w.date < since) continue;
    // a workout redone the same day keeps its row id with new times: write it again as a newer version
    const key = `${w.id}:${w.ended_at}`;
    if (done.has(key)) continue;
    try {
      await saveWorkoutSample(WorkoutActivityType.functionalStrengthTraining, [], new Date(w.started_at), new Date(w.ended_at), undefined, {
        HKExternalUUID: `dr-workout-${w.id}`, HKSyncIdentifier: `dr-workout-${w.id}`, HKSyncVersion: Date.parse(w.ended_at),
      });
    } catch (e) {
      if (__DEV__) console.warn('[health] workout', e);
      continue; // one bad row must not block the others
    }
    done.add(key);
    devicePref.set(WORKOUT_LEDGER, [...done].slice(-200));
  }
}

// ---------------- sync ----------------
let chain: Promise<void> = Promise.resolve();
function serial(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task).catch((e: unknown) => { if (__DEV__) console.warn('[health]', e); });
  return chain;
}

/** Pull steps, weight and the wake suggestion. Safe to call often. */
export function pullHealth(env: Env): Promise<void> {
  return serial(async () => {
    const p = healthPrefs.get();
    if (!p.connected || !healthAvailable() || (await healthAccess()) !== 'asked') return;
    if (p.steps) await syncSteps(env).catch(() => undefined);
    if (p.weightIn) await importWeight(env).catch(() => undefined);
    if (p.sleep) await suggestWake(env).catch(() => undefined);
  });
}

/** Push app weights and home workouts written since connecting. */
export function pushHealth(env: Env): Promise<void> {
  return serial(async () => {
    const p = healthPrefs.get();
    if (!p.connected || !p.connectedOn || !healthAvailable() || (await healthAccess()) !== 'asked') return;
    const allowed = healthWriteAllowed();
    if (p.weightOut && allowed.weight) await exportWeights(env, p.connectedOn);
    if (p.workoutOut && allowed.workout) await exportWorkouts(env, p.connectedOn);
  });
}

/**
 * Mount once in the root layout. While connected: pulls on foreground and on HealthKit changes
 * (observer queries, plus background delivery so a finished night of sleep or new steps wake the app),
 * and pushes new app weights and workouts when the store changes.
 */
let backgroundConfigured = false;

export function useHealthSync(env: Env | null): void {
  useEffect(() => {
    if (!env || !healthAvailable()) return;
    let subs: { remove: () => boolean }[] = [];
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let run = 0; // the latest start() wins; an older one that resolves late does nothing
    const stop = () => { for (const s of subs) s.remove(); subs = []; };
    const start = async () => {
      const mine = ++run;
      stop();
      if (!healthPrefs.get().connected) return;
      // a type we never asked for crashes HealthKit queries: only observe once the sheet was shown
      if ((await healthAccess()) !== 'asked' || mine !== run) return;
      // configure first: it tears down and re-registers the launch observers, which drops JS callbacks
      // attached before it. Once per launch is enough (it is persisted natively).
      if (!backgroundConfigured) {
        backgroundConfigured = await configureBackgroundTypes([...READ], UpdateFrequency.hourly).catch(() => false);
        if (mine !== run) return;
      }
      subs = READ.map((t) => subscribeToChanges(t, () => { void pullHealth(env); }));
      void pullHealth(env);
      void pushHealth(env);
    };
    const offPrefs = healthPrefs.subscribe(() => { void start(); });
    const offStore = env.store.subscribe(() => {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => { void pushHealth(env); }, 1500);
    });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') void pullHealth(env); });
    void start();
    return () => {
      run++;
      stop();
      if (pushTimer) clearTimeout(pushTimer);
      offPrefs();
      offStore();
      app.remove();
    };
  }, [env]);
}

// ---------------- simulator seeding (dev builds only) ----------------
/** Writes sample steps, a weight and last night's sleep so the bridge can be tried on a simulator. */
export async function seedHealthSamples(env: Env): Promise<void> {
  if (!__DEV__ || !healthAvailable()) return;
  await requestAuthorization({ toRead: READ, toShare: [...SHARE, STEPS, SLEEP] });
  const now = env.now();
  const day = startOfDay(now);
  const at = (h: number, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  for (const [h, n] of [[8, 1200], [10, 900], [12, 1500]] as const) {
    if (at(h, 30) < now) await saveQuantitySample(STEPS, 'count', n, at(h), at(h, 30), { HKExternalUUID: `seed-steps-${keyOf(day)}-${h}` });
  }
  const bed = new Date(day.getTime() - 90 * 60_000);
  await saveQuantitySample(MASS, 'kg', 74.6, at(7, 20), at(7, 20), { HKExternalUUID: `seed-mass-${keyOf(day)}` });
  await saveCategorySample(SLEEP, CategoryValueSleepAnalysis.asleepCore, bed, at(7, 12), { HKExternalUUID: `seed-sleep-${keyOf(day)}` });
}
