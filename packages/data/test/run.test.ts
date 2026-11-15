import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM, RunTracker, type GeoFix, type WorkoutRow } from '@diet/core';
import { completeWorkout, DataStore, dayRow, dayTarget, deleteRun, runById, runCredit, runRoute, runSegments, runsList, runTotals, saveRun, setDay, setWeight, todayView, workoutOn, type Env } from '../src';
import type { SupabaseClient } from '@supabase/supabase-js';

const makeEnv = async () => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  const env: Env = { store, program: DEFAULT_PROGRAM, now: () => new Date(2026, 10, 15, 20, 0), newId: () => `id-${++n}` };
  return env;
};

const R = 6371008.8;
/** a straight 1 Hz run east from Seoul City Hall */
function trackRun(startMs: number, secs: number, speed: number, fromX = 0) {
  const tr = new RunTracker(startMs);
  for (let i = 0; i <= secs; i++) {
    const x = fromX + speed * i;
    const f: GeoFix = { lat: 37.5665, lng: 126.978 + (x / (R * Math.cos((37.5665 * Math.PI) / 180))) * (180 / Math.PI), t: startMs + i * 1000, acc: 5, speed };
    tr.ingest(f);
  }
  return tr.summary(startMs + secs * 1000);
}

describe('runs', () => {
  it('saves a run with kcal from the latest weight, a workout row, steps and budget credit', async () => {
    const env = await makeEnv();
    setWeight(env, '2026-11-14', 75.2);
    setDay(env, '2026-11-15', { steps: 3000 });
    const start = new Date(2026, 10, 15, 19, 0);
    const summary = trackRun(start.getTime(), 1300, 3.0); // ~3.9 km
    const before = dayTarget(env, todayView(env));
    const row = saveRun(env, { id: 'run-1', kind: 'run', startedAt: start, endedAt: new Date(start.getTime() + 1300_000), summary });

    expect(row.distance_m).toBeGreaterThan(3850);
    expect(row.kcal).toBeGreaterThan(200);
    expect(row.polyline).toBeTruthy();
    expect(runRoute(row).length).toBeLessThan(10); // a straight line simplifies to its ends
    expect(row.new_distance_m).toBeGreaterThan(3800);
    expect(row.new_distance_m).toBeLessThanOrEqual(row.distance_m);

    const workouts = env.store.all<WorkoutRow>('workouts');
    expect(workouts).toHaveLength(1);
    expect(workouts[0]).toMatchObject({ type: 'run', run_id: 'run-1', date: '2026-11-15', kcal: row.kcal });
    expect(workoutOn(env, '2026-11-15')).toBeUndefined(); // a run is not the home workout

    expect(dayRow(env, '2026-11-15').steps).toBeGreaterThan(3000 + 3500);
    expect(runCredit(env, '2026-11-15')).toBe(Math.round(row.kcal! / 2));
    expect(dayTarget(env, todayView(env))).toBe(before + Math.round(row.kcal! / 2));
  });

  it('does not add steps twice when the same run is saved again', async () => {
    const env = await makeEnv();
    const start = new Date(2026, 10, 15, 19, 0);
    const summary = trackRun(start.getTime(), 600, 3.0);
    saveRun(env, { id: 'r', kind: 'run', startedAt: start, endedAt: new Date(start.getTime() + 600_000), summary });
    const steps = dayRow(env, '2026-11-15').steps;
    saveRun(env, { id: 'r', kind: 'run', startedAt: start, endedAt: new Date(start.getTime() + 600_000), summary });
    expect(dayRow(env, '2026-11-15').steps).toBe(steps);
    expect(env.store.all<WorkoutRow>('workouts')).toHaveLength(1);
  });

  it('leaves Health-counted steps alone', async () => {
    const env = await makeEnv();
    setDay(env, '2026-11-15', { steps: 5000, steps_source: 'health' });
    const start = new Date(2026, 10, 15, 19, 0);
    saveRun(env, { id: 'r', kind: 'run', startedAt: start, endedAt: start, summary: trackRun(start.getTime(), 300, 3) });
    expect(dayRow(env, '2026-11-15').steps).toBe(5000);
  });

  it('keeps the home workout separate from a run on the same day', async () => {
    const env = await makeEnv();
    const start = new Date(2026, 10, 15, 7, 0);
    saveRun(env, { id: 'r', kind: 'run', startedAt: start, endedAt: start, summary: trackRun(start.getTime(), 300, 3) });
    completeWorkout(env, '2026-11-15', 'A', { rounds: 3, startedAt: start, endedAt: start });
    const ws = env.store.all<WorkoutRow>('workouts');
    expect(ws.map((w) => w.type).sort()).toEqual(['home_a', 'run']);
    expect(workoutOn(env, '2026-11-15')?.type).toBe('home_a');
  });

  it('deletes a run with its workout and steps, and undoes it', async () => {
    const env = await makeEnv();
    setDay(env, '2026-11-15', { steps: 1000 });
    const start = new Date(2026, 10, 15, 19, 0);
    saveRun(env, { id: 'r', kind: 'run', startedAt: start, endedAt: start, summary: trackRun(start.getTime(), 600, 3) });
    const withRun = dayRow(env, '2026-11-15').steps;
    const undo = deleteRun(env, 'r');
    expect(runById(env, 'r')).toBeUndefined();
    expect(env.store.all<WorkoutRow>('workouts')).toHaveLength(0);
    expect(dayRow(env, '2026-11-15').steps).toBe(1000);
    expect(runCredit(env, '2026-11-15')).toBe(0);
    undo();
    expect(runById(env, 'r')).toBeDefined();
    expect(dayRow(env, '2026-11-15').steps).toBe(withRun);
  });

  it('counts only new ground on a repeated route and totals everything', async () => {
    const env = await makeEnv();
    const d1 = new Date(2026, 10, 14, 19, 0);
    const d2 = new Date(2026, 10, 15, 19, 0);
    saveRun(env, { id: 'a', kind: 'run', startedAt: d1, endedAt: d1, summary: trackRun(d1.getTime(), 400, 3) });
    const b = saveRun(env, { id: 'b', kind: 'run', startedAt: d2, endedAt: d2, summary: trackRun(d2.getTime(), 600, 3) });
    expect(b.new_distance_m).toBeGreaterThan(500);
    expect(b.new_distance_m).toBeLessThan(700);
    expect(runsList(env).map((r) => r.id)).toEqual(['b', 'a']);
    const t = runTotals(runsList(env));
    expect(t.count).toBe(2);
    expect(t.distance_m).toBeGreaterThan(2950);
  });

  it('honours a run credit ratio from the profile preferences', async () => {
    const env = await makeEnv();
    env.store.put('profiles', { preferences: { run_credit_ratio: 0 } });
    const start = new Date(2026, 10, 15, 19, 0);
    saveRun(env, { id: 'r', kind: 'run', startedAt: start, endedAt: start, summary: trackRun(start.getTime(), 600, 3) });
    expect(runCredit(env, '2026-11-15')).toBe(0);
  });

  it('gives back half of a workout read from Apple Health, but nothing for a home workout', async () => {
    const env = await makeEnv();
    const base = (id: string, source: 'app' | 'health', type: WorkoutRow['type'], kcal: number) => ({
      id, date: '2026-11-15', type, started_at: null, ended_at: null, duration_s: 1800, rounds: null, kcal, source, run_id: null, note: null,
    });
    env.store.put<WorkoutRow>('workouts', base('w1', 'health', 'other', 301));
    env.store.put<WorkoutRow>('workouts', base('w2', 'app', 'home_a', 200));
    expect(runCredit(env, '2026-11-15')).toBe(151);
    expect(runCredit(env, '2026-11-14')).toBe(0);
  });

  it('keeps the pedometer cadence on the run and when the run is saved again', async () => {
    const env = await makeEnv();
    const start = new Date(2026, 10, 15, 19, 0);
    const input = { id: 'c', kind: 'run' as const, startedAt: start, endedAt: new Date(start.getTime() + 600_000), summary: trackRun(start.getTime(), 600, 3) };
    expect(saveRun(env, { ...input, avgCadence: 168 }).avg_cadence).toBe(168);
    expect(saveRun(env, input).avg_cadence).toBe(168);
  });
});

describe('runs: segments and sync order', () => {
  it('stores each stretch separately and decodes old single-line rows', async () => {
    const env = await makeEnv();
    const start = new Date(2026, 10, 15, 19, 0);
    const a = trackRun(start.getTime(), 120, 3);
    const b = trackRun(start.getTime() + 200_000, 120, 3, 800);
    const summary = { ...a, distance_m: a.distance_m + b.distance_m, segments: [...a.segments, ...b.segments], route: [...a.route, ...b.route] };
    const row = saveRun(env, { id: 'seg', kind: 'run', startedAt: start, endedAt: start, summary });
    expect(runSegments(row)).toHaveLength(2);
    expect(row.polyline!.split(' ')).toHaveLength(2);
    // the 440 m between the stretches is not drawn, so it is not "new ground" either
    expect(row.new_distance_m).toBeLessThanOrEqual(row.distance_m);
    expect(runSegments({ polyline: '_p~iF~ps|U_ulLnnqC' })).toHaveLength(1);
  });

  it('pushes runs before workouts so the run_id foreign key holds', async () => {
    const env = await makeEnv();
    const start = new Date(2026, 10, 15, 7, 0);
    completeWorkout(env, '2026-11-15', 'A', { rounds: 3, startedAt: start, endedAt: start }); // workouts enters the outbox first
    saveRun(env, { id: 'r', kind: 'run', startedAt: start, endedAt: start, summary: trackRun(start.getTime(), 300, 3) });
    const order: string[] = [];
    const client = {
      from: (t: string) => ({
        upsert: async () => { order.push(t); return { error: null }; },
        select: () => ({ gt: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
      }),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: async () => {},
    } as unknown as SupabaseClient;
    await env.store.attach(client, 'user-1');
    expect(order.indexOf('runs')).toBeLessThan(order.indexOf('workouts'));
    expect(env.store.pendingCount()).toBe(0);
  });
});
