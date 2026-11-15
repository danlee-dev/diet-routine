// Runs on top of the store: saving a finished run (with its workout row, steps and food-budget credit),
// lists, totals and "my map". Web and iPhone call these, so a run saved on the phone shows the same
// distance, kcal and budget change on the desktop.
import {
  closedLoopArea, decodePolyline, encodePolyline, estimateRunSteps, keyOf, newDistance, routeBBox, runKcal, runKcalCredit, simplifyRoute,
  stableId, RUN_CREDIT_RATIO, type LatLng, type ProfileRow, type RunRow, type RunSummary, type WeightRow, type WorkoutRow,
} from '@diet/core';
import { dayRow, setDay, type Env, type Undo } from './model';

/** Local calendar day a run belongs to (the day it started). */
export const runDate = (r: Pick<RunRow, 'started_at'>): string => keyOf(new Date(r.started_at));

export const runsList = (env: Env): RunRow[] =>
  env.store.all<RunRow>('runs').sort((a, b) => b.started_at.localeCompare(a.started_at));

export const runById = (env: Env, id: string): RunRow | undefined => env.store.get<RunRow>('runs', id);

export const runsOn = (env: Env, date: string): RunRow[] => runsList(env).filter((r) => runDate(r) === date);

export const runRoute = (r: Pick<RunRow, 'polyline'>): LatLng[] => (r.polyline ? decodePolyline(r.polyline) : []);

/** The workout row that mirrors a run has an id derived from the run, so saving twice never duplicates it. */
export const runWorkoutId = (runId: string): string => stableId(`run-workout:${runId}`);

/** Body weight for kcal: latest weigh-in on or before the date, else the program's start weight. */
export function weightFor(env: Env, date: string): number {
  let best: WeightRow | undefined;
  for (const w of env.store.all<WeightRow>('weights')) if (w.date <= date && (!best || w.date > best.date)) best = w;
  return best?.kg ?? env.program.startWeight;
}

/** Share of run kcal given back to the day's food budget. `profiles.preferences.run_credit_ratio` overrides it. */
export function runCreditRatio(env: Env): number {
  const prefs = env.store.get<ProfileRow>('profiles', 'me')?.preferences as Record<string, unknown> | undefined;
  const r = Number(prefs?.run_credit_ratio);
  return prefs?.run_credit_ratio != null && Number.isFinite(r) ? r : RUN_CREDIT_RATIO;
}

/** kcal added to the day's target by that day's runs. */
export function runCredit(env: Env, date: string): number {
  const ratio = runCreditRatio(env);
  return runsOn(env, date).reduce((s, r) => s + runKcalCredit(r.kcal, ratio), 0);
}

/** Steps a run adds to a manually counted day. With Health steps the phone already counted them. */
const runSteps = (env: Env, r: Pick<RunRow, 'splits'>): number => estimateRunSteps(r.splits ?? [], env.program.heightCm);

export interface SaveRunInput {
  id: string;
  kind: 'run' | 'walk';
  startedAt: Date;
  endedAt: Date;
  summary: RunSummary;
}

/**
 * Store a finished run: the run row (simplified encoded route, splits, kcal from the user's weight,
 * new ground vs earlier runs, loop area), a mirrored workout row, and estimated steps on a manual day.
 * Saving the same id again updates it without adding steps twice.
 */
export function saveRun(env: Env, input: SaveRunInput): RunRow {
  const date = keyOf(input.startedAt);
  const prev = runById(env, input.id);
  const s = input.summary;
  const route = simplifyRoute(s.route, 2);
  const earlier = runsList(env).filter((r) => r.id !== input.id && r.started_at < input.startedAt.toISOString()).map(runRoute);
  const row: RunRow = {
    id: input.id,
    kind: input.kind,
    started_at: input.startedAt.toISOString(),
    ended_at: input.endedAt.toISOString(),
    distance_m: s.distance_m,
    moving_s: s.moving_s,
    elapsed_s: s.elapsed_s,
    avg_pace_s_per_km: s.avg_pace_s_per_km,
    kcal: runKcal(s.splits, weightFor(env, date)),
    elev_gain_m: s.elev_gain_m,
    avg_cadence: null,
    splits: s.splits,
    polyline: route.length ? encodePolyline(route) : null,
    bbox: routeBBox([route]),
    new_distance_m: route.length > 1 ? newDistance(route, earlier) : null,
    closed_area_m2: closedLoopArea(route),
    health_uuid: prev?.health_uuid ?? null,
  };
  env.store.put<RunRow>('runs', row);
  env.store.put<WorkoutRow>('workouts', {
    id: runWorkoutId(input.id), date, type: input.kind === 'walk' ? 'walk' : 'run',
    started_at: row.started_at, ended_at: row.ended_at, duration_s: row.moving_s, rounds: null,
    kcal: row.kcal, source: 'app', run_id: input.id, note: null,
  });
  if (!prev) {
    const day = dayRow(env, date);
    if (day.steps_source !== 'health') setDay(env, date, { steps: Math.min(99999, day.steps + runSteps(env, row)) });
  }
  return env.store.get<RunRow>('runs', input.id)!;
}

/** Soft-delete a run, its workout row and the steps it added. Returns undo. */
export function deleteRun(env: Env, id: string): Undo {
  const run = runById(env, id);
  if (!run) return () => {};
  const workout = env.store.get<WorkoutRow>('workouts', runWorkoutId(id));
  const date = runDate(run);
  const day = dayRow(env, date);
  const added = day.steps_source !== 'health' ? Math.min(day.steps, runSteps(env, run)) : 0;
  env.store.remove('runs', id);
  if (workout) env.store.remove('workouts', workout.id);
  if (added) setDay(env, date, { steps: day.steps - added });
  return () => {
    env.store.put<RunRow>('runs', { ...run, deleted_at: null });
    if (workout) env.store.put<WorkoutRow>('workouts', { ...workout, deleted_at: null });
    if (added) setDay(env, date, { steps: dayRow(env, date).steps + added });
  };
}

export interface RunTotals {
  count: number;
  distance_m: number;
  moving_s: number;
  kcal: number;
  /** ground covered for the first time, summed over runs */
  new_m: number;
  /** area of closed loops, summed */
  area_m2: number;
}

export function runTotals(runs: RunRow[]): RunTotals {
  const t: RunTotals = { count: 0, distance_m: 0, moving_s: 0, kcal: 0, new_m: 0, area_m2: 0 };
  for (const r of runs) {
    t.count++;
    t.distance_m += Number(r.distance_m) || 0;
    t.moving_s += r.moving_s || 0;
    t.kcal += Number(r.kcal) || 0;
    t.new_m += Number(r.new_distance_m) || 0;
    t.area_m2 += Number(r.closed_area_m2) || 0;
  }
  return t;
}
