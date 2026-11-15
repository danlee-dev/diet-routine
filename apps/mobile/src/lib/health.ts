// Apple Health bridge. In: today's steps, the latest body mass, last night's sleep end (as a wake time
// the user confirms), today's active energy and workouts other apps recorded (Apple Watch). Out: weights
// logged in the app, finished home workouts, and runs and walks with their GPS route, each written once.
// Nothing here asks for permission by itself; the settings section calls connectHealth().
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import {
  AuthorizationRequestStatus, AuthorizationStatus, CategoryValueSleepAnalysis, UpdateFrequency, WorkoutActivityType,
  authorizationStatusFor, clearBackgroundTypes, configureBackgroundTypes, deleteObjects, getRequestStatusForAuthorization, isHealthDataAvailable,
  queryCategorySamples, queryQuantitySamples, queryStatisticsForQuantity, requestAuthorization, saveCategorySample, saveQuantitySample,
  queryWorkoutSamples, saveWorkoutSample, subscribeToChanges, type LocationForSaving, type QuantitySample, type QuantitySampleForSaving,
} from '@kingstinct/react-native-healthkit';
import Storage from 'expo-sqlite/kv-store';
import {
  hhmm, keyOf, parseKey, round1, stableId, startOfDay, wakeFromSleep, type GeoFix, type RunRow, type WeightRow, type WorkoutRow, type WorkoutType,
} from '@diet/core';
import { runDate, setDay, setWake, todayView, type Env } from '@diet/data';
import { devicePref } from './env';
import { createPrefStore, postWakeSuggestion } from './notifications';

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
const MASS = 'HKQuantityTypeIdentifierBodyMass' as const;
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;
const WORKOUT = 'HKWorkoutTypeIdentifier' as const;
const READ = [STEPS, MASS, SLEEP] as const;
const SHARE = [MASS, WORKOUT] as const;
const ACTIVE = 'HKQuantityTypeIdentifierActiveEnergyBurned' as const;
const DISTANCE = 'HKQuantityTypeIdentifierDistanceWalkingRunning' as const;
const ROUTE = 'HKWorkoutRouteTypeIdentifier' as const;
/**
 * Asked apart from READ/SHARE: an install connected before these existed keeps syncing the basics
 * (healthAccess() stays 'asked') and sees the new sheet only when it saves a run or taps the settings row.
 */
const EXTRA_READ = [ACTIVE, WORKOUT] as const;
// HealthKit rejects a route share request that does not name the workout type in the same call
const EXTRA_SHARE = [WORKOUT, ROUTE, DISTANCE, ACTIVE] as const;
const OWN_BUNDLE = 'dev.danlee.dietroutine';

export interface HealthPrefs {
  /** The user connected Apple Health from settings (authorization was requested). */
  connected: boolean;
  /** First day whose app weights and workouts are written to Health (no back-filling history). */
  connectedOn: string | null;
  steps: boolean;
  weightIn: boolean;
  weightOut: boolean;
  sleep: boolean;
  /** home workouts, runs and walks */
  workoutOut: boolean;
  /** today's active energy and workouts recorded by other apps (Apple Watch) */
  activityIn: boolean;
}

export const healthPrefs = createPrefStore<HealthPrefs>('health', {
  connected: false, connectedOn: null, steps: true, weightIn: true, weightOut: true, sleep: true, workoutOut: true, activityIn: true,
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

/** Whether the sheet for active energy, other apps' workouts and run routes was shown. */
export async function healthExtrasAccess(): Promise<HealthAccess> {
  if (!healthAvailable()) return 'unavailable';
  try {
    const s = await getRequestStatusForAuthorization({ toRead: EXTRA_READ, toShare: EXTRA_SHARE });
    return s === AuthorizationRequestStatus.unnecessary ? 'asked' : 'notAsked';
  } catch (e) {
    if (__DEV__) console.warn('[health] extras status', e);
    return 'notAsked';
  }
}

/** For an install connected before runs and activity were synced: show the sheet for the new types. */
export async function requestHealthExtras(): Promise<boolean> {
  if (!healthAvailable() || !healthPrefs.get().connected) return false;
  try {
    await requestAuthorization({ toRead: EXTRA_READ, toShare: EXTRA_SHARE });
  } catch {
    return false;
  }
  healthPrefs.set({}); // re-run the sync hook so it observes the new types
  return true;
}

/**
 * Right after a run is saved: an install connected before routes were synced is asked once for the new
 * types, so this run lands in Health with its route. HealthKit shows the sheet only the first time.
 */
export async function askHealthExtrasForRun(): Promise<void> {
  if (!healthPrefs.get().connected || (await healthAccess()) !== 'asked') return;
  if ((await healthExtrasAccess()) === 'notAsked') await requestHealthExtras();
}

/** Show the Health permission sheet and turn syncing on. Called from the settings section only. */
export async function connectHealth(env: Env): Promise<boolean> {
  if (!healthAvailable()) return false;
  try {
    await requestAuthorization({ toRead: [...READ, ...EXTRA_READ], toShare: [...SHARE, ...EXTRA_SHARE] });
  } catch {
    return false;
  }
  healthPrefs.set({ connected: true, connectedOn: healthPrefs.get().connectedOn ?? todayKey(env) });
  return true;
}

/** Stop syncing, including the background wake-ups registered at launch. Permissions stay in Settings. */
export function disconnectHealth(): void {
  backgroundConfigured = 0;
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

// ---------------- activity in: active energy, other apps' workouts ----------------
const activeStore = createPrefStore<{ date: string | null; kcal: number | null }>('health:active', { date: null, kcal: null });

/** Active energy Apple Health counted today (kcal), for display only: the day's food target never adds it. */
export function useActiveEnergy(env: Env): number | null {
  'use no memo';
  const st = useSyncExternalStore(activeStore.subscribe, activeStore.get, activeStore.get);
  return st.date === todayKey(env) ? st.kcal : null;
}

async function syncActiveEnergy(env: Env): Promise<void> {
  const v = todayView(env);
  const res = await queryStatisticsForQuantity(ACTIVE, ['cumulativeSum'], {
    filter: { date: { startDate: v.ctx.date, endDate: env.now() } }, unit: 'kcal',
  });
  const kcal = Math.round(res.sumQuantity?.quantity ?? 0);
  const cur = activeStore.get();
  if (cur.date !== v.ctx.key || cur.kcal !== kcal) activeStore.set({ date: v.ctx.key, kcal });
}

const WORKOUT_TYPE: Partial<Record<WorkoutActivityType, WorkoutType>> = {
  [WorkoutActivityType.running]: 'run', [WorkoutActivityType.walking]: 'walk', [WorkoutActivityType.hiking]: 'walk',
};
const WORKOUT_NAME: Partial<Record<WorkoutActivityType, string>> = {
  [WorkoutActivityType.running]: '달리기', [WorkoutActivityType.walking]: '걷기', [WorkoutActivityType.hiking]: '하이킹',
  [WorkoutActivityType.cycling]: '사이클', [WorkoutActivityType.swimming]: '수영', [WorkoutActivityType.yoga]: '요가',
  [WorkoutActivityType.pilates]: '필라테스', [WorkoutActivityType.functionalStrengthTraining]: '근력 운동',
  [WorkoutActivityType.traditionalStrengthTraining]: '근력 운동', [WorkoutActivityType.coreTraining]: '코어 운동',
  [WorkoutActivityType.highIntensityIntervalTraining]: '인터벌', [WorkoutActivityType.elliptical]: '일립티컬',
  [WorkoutActivityType.rowing]: '로잉', [WorkoutActivityType.stairClimbing]: '계단 오르기', [WorkoutActivityType.stairs]: '계단 오르기',
  [WorkoutActivityType.dance]: '댄스', [WorkoutActivityType.mixedCardio]: '유산소',
};

const overlapS = (r: RunRow, start: Date, end: Date): number => {
  const a = Math.max(Date.parse(r.started_at), start.getTime());
  const b = Math.min(Date.parse(r.ended_at ?? r.started_at), end.getTime());
  return Math.max(0, (b - a) / 1000);
};

/**
 * Workouts other apps saved to Health (Apple Watch, NRC, ...) since yesterday become the day's workout
 * rows (source 'health'), so their kcal counts like a run. Ones this app wrote, and ones that overlap a
 * run recorded here (phone and watch at once), are skipped; a workout deleted from Health leaves the day.
 */
async function importWorkouts(env: Env): Promise<void> {
  const now = env.now();
  const from = new Date(startOfDay(now).getTime() - 86_400_000);
  const list = await queryWorkoutSamples({ limit: 0, ascending: true, filter: { date: { startDate: from, endDate: now } } });
  const runs = env.store.all<RunRow>('runs');
  const seen = new Set<string>();
  for (const w of list) {
    const ext = String(w.metadata?.HKExternalUUID ?? '');
    if (ext.startsWith('dr-') || w.sourceRevision?.source?.bundleIdentifier?.startsWith(OWN_BUNDLE)) continue;
    const durS = Math.round((w.endDate.getTime() - w.startDate.getTime()) / 1000);
    if (durS < 60 || runs.some((r) => overlapS(r, w.startDate, w.endDate) > durS * 0.5)) continue;
    const id = stableId(`health-workout:${w.uuid}`);
    seen.add(id);
    const e = w.totalEnergyBurned;
    const kcal = e ? Math.round(e.unit === 'kJ' ? e.quantity / 4.184 : e.quantity) : null;
    const row: Omit<WorkoutRow, 'updated_at'> = {
      id, date: keyOf(w.startDate), type: WORKOUT_TYPE[w.workoutActivityType] ?? 'other',
      started_at: w.startDate.toISOString(), ended_at: w.endDate.toISOString(), duration_s: durS, rounds: null,
      kcal: kcal && kcal > 0 ? kcal : null, source: 'health', run_id: null,
      note: `${w.sourceRevision?.source?.name ?? '건강 앱'} · ${WORKOUT_NAME[w.workoutActivityType] ?? '운동'}`,
    };
    const cur = env.store.get<WorkoutRow>('workouts', id);
    if (!cur || cur.kcal !== row.kcal || cur.ended_at !== row.ended_at || cur.type !== row.type || cur.note !== row.note) {
      env.store.put<WorkoutRow>('workouts', row);
    }
  }
  const fromKey = keyOf(from);
  for (const r of env.store.where<WorkoutRow>('workouts', (x) => x.source === 'health' && x.date >= fromKey)) {
    if (!seen.has(r.id)) env.store.remove('workouts', r.id);
  }
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

// ---------------- runs out (with the route) ----------------
// The finished run's timestamped fixes are kept on the device until the run is written to Health, because
// the synced row only has the simplified route without times.
type PackedFix = [number, number, number, number | null, number | null, number | null];
const ROUTE_KEY = (id: string) => `dr:health:route:${id}`;
const ROUTE_IDS = 'health:routeIds';
const RUN_LEDGER = 'health:runs';
const r7 = (x: number) => Math.round(x * 1e7) / 1e7;
const r1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

/**
 * Keep a finished run's route for Apple Health. `altitudeValid` is false when altitudes are barometric
 * (relative to the start), which Health would read as height above sea level.
 */
export function stashRunRoute(runId: string, fixes: GeoFix[], altitudeValid: boolean): void {
  if (Platform.OS !== 'ios' || fixes.length < 2) return;
  const packed: PackedFix[] = fixes.map((f) => [f.t, r7(f.lat), r7(f.lng), altitudeValid ? r1(f.alt) : null, r1(f.acc), r1(f.speed)]);
  try { Storage.setItemSync(ROUTE_KEY(runId), JSON.stringify(packed)); } catch { return; }
  const ids = devicePref.get<string[]>(ROUTE_IDS, []).filter((x) => x !== runId);
  ids.push(runId);
  // a few runs saved while Health is not connected are kept; older ones are dropped
  for (const old of ids.splice(0, Math.max(0, ids.length - 10))) dropRoute(old);
  devicePref.set(ROUTE_IDS, ids);
}

function takeRoute(runId: string): LocationForSaving[] {
  try {
    const raw = Storage.getItemSync(ROUTE_KEY(runId));
    const packed = raw ? (JSON.parse(raw) as PackedFix[]) : [];
    return packed.map(([t, lat, lng, alt, acc, speed]) => ({
      latitude: lat, longitude: lng, date: new Date(t),
      altitude: alt ?? 0, verticalAccuracy: alt == null ? -1 : 5, // negative: altitude unknown
      horizontalAccuracy: acc ?? 10, speed: speed != null && speed >= 0 ? speed : -1, course: -1,
    }));
  } catch {
    return [];
  }
}

function dropRoute(runId: string): void {
  try { Storage.removeItemSync(ROUTE_KEY(runId)); } catch { /* gone */ }
  devicePref.set(ROUTE_IDS, devicePref.get<string[]>(ROUTE_IDS, []).filter((x) => x !== runId));
}

/**
 * Runs and walks since connecting become Health workouts (running / walking) with distance and active
 * energy, plus the GPS route when it is still on this device, so the Fitness app and activity rings see
 * them. A run deleted in the app is deleted from Health.
 */
async function exportRuns(env: Env, since: string, extras: boolean): Promise<void> {
  const ledger = devicePref.get<Record<string, string>>(RUN_LEDGER, {});
  const live = new Set<string>();
  for (const r of env.store.all<RunRow>('runs')) {
    if (runDate(r) < since) continue;
    live.add(r.id);
    if (ledger[r.id] || r.health_uuid || !r.ended_at) continue;
    const start = new Date(r.started_at);
    const end = new Date(r.ended_at);
    const kcal = Math.round(r.kcal ?? 0);
    // samples need the extra share types; without them the workout still carries its totals
    const samples: QuantitySampleForSaving[] = !extras ? [] : [
      { quantityType: DISTANCE, quantity: r.distance_m, unit: 'm', startDate: start, endDate: end },
      ...(kcal > 0 ? [{ quantityType: ACTIVE, quantity: kcal, unit: 'kcal', startDate: start, endDate: end }] : []),
    ];
    let uuid: string;
    try {
      const w = await saveWorkoutSample(r.kind === 'walk' ? WorkoutActivityType.walking : WorkoutActivityType.running, samples, start, end,
        { distance: r.distance_m, energyBurned: kcal }, {
          HKExternalUUID: `dr-run-${r.id}`, HKSyncIdentifier: `dr-run-${r.id}`, HKSyncVersion: 1, HKIndoorWorkout: false,
        });
      uuid = w.uuid;
      ledger[r.id] = uuid;
      devicePref.set(RUN_LEDGER, ledger);
      const route = takeRoute(r.id);
      if (extras && route.length > 1 && authorizationStatusFor(ROUTE) === AuthorizationStatus.sharingAuthorized) {
        await w.saveWorkoutRoute(route).catch((e: unknown) => { if (__DEV__) console.warn('[health] route', e); });
      }
    } catch (e) {
      if (__DEV__) console.warn('[health] run', e);
      continue; // one bad row must not block the others
    }
    dropRoute(r.id);
    env.store.put<RunRow>('runs', { ...r, health_uuid: uuid });
  }
  // rows are only soft-deleted, never dropped, so a ledger entry without a live run was deleted in the app
  for (const [id, uuid] of Object.entries(ledger)) {
    if (live.has(id)) continue;
    await deleteObjects(WORKOUT, { uuid }).catch(() => 0);
    delete ledger[id];
    devicePref.set(RUN_LEDGER, ledger);
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
    if (p.activityIn && (await healthExtrasAccess()) === 'asked') {
      await syncActiveEnergy(env).catch(() => undefined);
      await importWorkouts(env).catch((e: unknown) => { if (__DEV__) console.warn('[health] workouts in', e); });
    }
  });
}

/** Push app weights and home workouts written since connecting. */
export function pushHealth(env: Env): Promise<void> {
  return serial(async () => {
    const p = healthPrefs.get();
    if (!p.connected || !p.connectedOn || !healthAvailable() || (await healthAccess()) !== 'asked') return;
    const allowed = healthWriteAllowed();
    if (p.weightOut && allowed.weight) await exportWeights(env, p.connectedOn);
    if (p.workoutOut && allowed.workout) {
      await exportWorkouts(env, p.connectedOn);
      await exportRuns(env, p.connectedOn, (await healthExtrasAccess()) === 'asked');
    }
  });
}

/**
 * Mount once in the root layout. While connected: pulls on foreground and on HealthKit changes
 * (observer queries, plus background delivery so a finished night of sleep or new steps wake the app),
 * and pushes new app weights and workouts when the store changes.
 */
/** number of types registered for background delivery this launch (0 = none) */
let backgroundConfigured = 0;

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
      // the activity types only once their sheet was shown (same crash rule)
      const extras = (await healthExtrasAccess()) === 'asked';
      if (mine !== run) return;
      const observed = extras ? [...READ, ...EXTRA_READ] : [...READ];
      // configure first: it tears down and re-registers the launch observers, which drops JS callbacks
      // attached before it. Once per launch is enough (it is persisted natively), unless the types grew.
      if (backgroundConfigured !== observed.length) {
        backgroundConfigured = (await configureBackgroundTypes(observed, UpdateFrequency.hourly).catch(() => false)) ? observed.length : 0;
        if (mine !== run) return;
      }
      subs = observed.map((t) => subscribeToChanges(t, () => { void pullHealth(env); }));
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
