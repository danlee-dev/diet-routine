// Runs on top of the store: saving a finished run (with its workout row, steps and food-budget credit),
// lists, totals and "my map". Web and iPhone call these, so a run saved on the phone shows the same
// distance, kcal and budget change on the desktop.
import {
  closedLoopArea, decodePolyline, encodePolyline, estimateRunSteps, keyOf, newDistance, pathLength, routeBBox, runKcal, runKcalCredit, simplifyRoute,
  stableId, RUN_CREDIT_RATIO, type LatLng, type ProfileRow, type RunRow, type RunSummary, type WeightRow, type WorkoutRow,
} from '@diet/core';
import { dayRow, setDay, type Env, type Undo } from './model';

export { runCredit, runCreditRatio, runDate, runsList, runsOn } from './runCredit';
import { runDate, runsList } from './runCredit';

export const runById = (env: Env, id: string): RunRow | undefined => env.store.get<RunRow>('runs', id);

/**
 * Stored route: one encoded polyline per stretch, joined by a space (outside the polyline alphabet,
 * so rows with a single line decode the same). A pause or an uncounted gap starts a new stretch.
 */
export const runSegments = (r: Pick<RunRow, 'polyline'>): LatLng[][] =>
  r.polyline ? r.polyline.split(' ').filter(Boolean).map((p) => decodePolyline(p)).filter((g) => g.length) : [];

/** Every point in order (segments joined). */
export const runRoute = (r: Pick<RunRow, 'polyline'>): LatLng[] => runSegments(r).flat();

/** The workout row that mirrors a run has an id derived from the run, so saving twice never duplicates it. */
export const runWorkoutId = (runId: string): string => stableId(`run-workout:${runId}`);

/** Body weight for kcal: latest weigh-in on or before the date, else the program's start weight. */
export function weightFor(env: Env, date: string): number {
  let best: WeightRow | undefined;
  for (const w of env.store.all<WeightRow>('weights')) if (w.date <= date && (!best || w.date > best.date)) best = w;
  return best?.kg ?? env.program.startWeight;
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
  const segments = (s.segments?.length ? s.segments : [s.route]).map((g) => simplifyRoute(g, 2)).filter((g) => g.length);
  const route = segments.flat();
  const earlier = runsList(env).filter((r) => r.id !== input.id && r.started_at < input.startedAt.toISOString()).flatMap(runSegments);
  // new ground is measured on the drawn lines, then scaled to the tracked distance (the two differ slightly)
  const drawn = segments.reduce((a, g) => a + pathLength(g), 0);
  const fresh = segments.reduce((a, g) => a + newDistance(g, earlier), 0);
  const freshShare = drawn > 0 ? Math.min(1, fresh / drawn) : null;
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
    polyline: segments.length ? segments.map((g) => encodePolyline(g)).join(' ') : null,
    bbox: routeBBox(segments),
    new_distance_m: freshShare == null ? null : Math.round(freshShare * s.distance_m),
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
