// View models and actions on top of the store. Web and iPhone call these same functions,
// so a check on one device produces exactly the same rows and totals on the other.
import {
  addDays, dayCtx, decodeLegacyBackup, defaultScen, dueOrders, legacyToRows, minutesOf, plan, planEntry, previousWeight,
  programDate, programKey, rolling7, stepsGoal, summary, weightSeries, weightStats,
  type ChecklistRow, type DayCtx, type DayRow, type EatoutSlot, type MealEntryRow, type MealKey, type PlannedMeal,
  type Program, type RoutineKey, type ScenId, type Summary, type WeightRow, type WorkoutRow,
} from '@diet/core';
import type { DataStore } from './store';

export interface Env {
  store: DataStore;
  program: Program;
  now: () => Date;
  newId: () => string;
}

const blankDay = (date: string, dow: number): DayRow => ({
  date, scenario: defaultScen(dow), eatout_slot: 'lunch', wake_min: null, water_cups: 0, steps: 0,
  steps_source: 'manual', kcal_target: null, note: null, updated_at: '', deleted_at: null,
});

export function dayRow(env: Env, date: string): DayRow {
  const dow = new Date(`${date}T00:00:00`).getDay();
  const r = env.store.get<DayRow>('days', date);
  const base = blankDay(date, dow);
  return r ? { ...base, ...r, scenario: r.scenario ?? base.scenario, eatout_slot: r.eatout_slot ?? 'lunch' } : base;
}

export const entriesFor = (env: Env, date: string): MealEntryRow[] =>
  env.store.where<MealEntryRow>('meal_entries', (e) => e.date === date).sort((a, b) => (a.eaten_at ?? '').localeCompare(b.eaten_at ?? ''));

export const weightOn = (env: Env, date: string): number | null => env.store.get<WeightRow>('weights', date)?.kg ?? null;

export const workoutOn = (env: Env, date: string): WorkoutRow | undefined =>
  env.store.where<WorkoutRow>('workouts', (w) => w.date === date)[0];

export const previousWeightFor = (env: Env, i: number): number | null =>
  previousWeight(env.program, env.store.all<WeightRow>('weights'), i);

export const checklistSet =(env: Env, list: ChecklistRow['list']): Set<string> =>
  new Set(env.store.where<ChecklistRow>('checklist', (c) => c.list === list && c.checked).map((c) => c.item_key));

export interface TodayView {
  ctx: DayCtx;
  nowMin: number;
  day: DayRow;
  scen: ScenId;
  eatout: EatoutSlot;
  meals: PlannedMeal[];
  entries: MealEntryRow[];
  eaten: Set<MealKey>;
  /** slots intentionally skipped (subset of eaten) */
  skipped: Set<MealKey>;
  sum: Summary;
  next: PlannedMeal | undefined;
  stepsGoal: number;
  weight: number | null;
  prevWeight: number | null;
}

export function todayView(env: Env): TodayView {
  const now = env.now();
  const ctx = dayCtx(env.program, now);
  const day = dayRow(env, ctx.key);
  const scen = day.scenario ?? defaultScen(ctx.dow);
  const eatout = day.eatout_slot ?? 'lunch';
  const meals = plan({ scen, eatout, wake: day.wake_min });
  const entries = entriesFor(env, ctx.key);
  const eaten = new Set<MealKey>();
  const skipped = new Set<MealKey>();
  for (const e of entries) if (e.slot !== 'extra') { eaten.add(e.slot); if (e.kind === 'skip') skipped.add(e.slot); }
  return {
    ctx, nowMin: minutesOf(now), day, scen, eatout, meals, entries, eaten, skipped,
    sum: summary(meals, entries),
    next: meals.find((m) => !eaten.has(m.key)),
    stepsGoal: stepsGoal(ctx.week),
    weight: weightOn(env, ctx.key),
    prevWeight: previousWeight(env.program, env.store.all<WeightRow>('weights'), ctx.idx),
  };
}

export interface DayRecord {
  i: number;
  date: Date;
  key: string;
  meals: number;
  eaten: MealKey[];
  weight: number | null;
  workout: WorkoutRow | undefined;
  water: number;
  steps: number;
}

export function dayRecord(env: Env, i: number): DayRecord {
  const date = programDate(env.program, i);
  const key = programKey(env.program, i);
  const d = dayRow(env, key);
  const eaten = [...new Set(entriesFor(env, key).filter((e) => e.slot !== 'extra').map((e) => e.slot as MealKey))];
  return { i, date, key, meals: eaten.length, eaten, weight: weightOn(env, key), workout: workoutOn(env, key), water: d.water_cups, steps: d.steps };
}

export function streaks(env: Env, dayIdx: number): { streak: number; workouts: number } {
  let streak = 0;
  for (let i = dayIdx; i >= 0; i--) {
    const n = dayRecord(env, i).meals;
    if (n >= 4) streak++;
    else if (i === dayIdx) continue;
    else break;
  }
  let workouts = 0;
  for (let i = 0; i <= Math.min(dayIdx, env.program.days - 1); i++) if (dayRecord(env, i).workout) workouts++;
  return { streak, workouts };
}

export function weightData(env: Env, dayIdx: number) {
  const rows = env.store.all<WeightRow>('weights');
  const series = weightSeries(env.program, rows, Math.max(0, dayIdx));
  return { series, avg: rolling7(series), stats: weightStats(env.program, series) };
}

export const ordersDue = (env: Env) => {
  const ctx = dayCtx(env.program, env.now());
  return dueOrders({ dayIdx: ctx.idx, dow: ctx.dow, dayKey: ctx.key, done: checklistSet(env, 'cycle') });
};

// ---------------- actions ----------------
export type Undo = () => void;

export function setDay(env: Env, date: string, patch: Partial<DayRow>): void {
  env.store.put<DayRow>('days', { ...dayRow(env, date), ...patch, date });
}

/** Toggle a planned meal as eaten. Returns undo when it was just marked. */
export function toggleMeal(env: Env, date: string, key: MealKey): { added: boolean; undo: Undo } {
  const live = entriesFor(env, date).filter((e) => e.slot === key);
  if (live.length) {
    for (const e of live) env.store.remove('meal_entries', e.id);
    return { added: false, undo: () => { for (const e of live) env.store.put('meal_entries', { ...e, deleted_at: null }); } };
  }
  const d = dayRow(env, date);
  const m = plan({ scen: d.scenario ?? 'home', eatout: d.eatout_slot ?? 'lunch', wake: d.wake_min }).find((x) => x.key === key);
  if (!m) return { added: false, undo: () => {} };
  const row = planEntry(m, date, env.newId(), env.now());
  env.store.put('meal_entries', row);
  return { added: true, undo: () => env.store.remove('meal_entries', row.id) };
}

/** Mark a planned meal as skipped (0 kcal). Returns undo. */
export function skipMeal(env: Env, date: string, key: MealKey): Undo {
  const prev = entriesFor(env, date).filter((e) => e.slot === key);
  for (const e of prev) env.store.remove('meal_entries', e.id);
  const id = env.newId();
  env.store.put<MealEntryRow>('meal_entries', {
    id, date, slot: key, kind: 'skip', eaten_at: env.now().toISOString(), food_id: null, name: '건너뜀', servings: null, amount_text: null,
    items: null, kcal: 0, protein_g: 0, carbs_g: null, fat_g: null, sugar_g: null, sodium_mg: null, fiber_g: null,
    source: 'manual', photo_path: null, confidence: 1, note: null, deleted_at: null,
  });
  return () => {
    env.store.remove('meal_entries', id);
    for (const e of prev) env.store.put('meal_entries', { ...e, deleted_at: null });
  };
}

export function setWake(env: Env, minutes: number, opts: { lateRule: boolean }): void {
  const ctx = dayCtx(env.program, env.now());
  const d = dayRow(env, ctx.key);
  const patch: Partial<DayRow> = { wake_min: minutes };
  if (opts.lateRule && d.wake_min == null && minutes >= 11 * 60 && d.scenario === 'home') patch.scenario = 'late';
  setDay(env, ctx.key, patch);
}

export function setWeight(env: Env, date: string, kg: number | null): Undo {
  const prev = env.store.get<WeightRow>('weights', date);
  if (kg == null) env.store.remove('weights', date);
  else env.store.put<WeightRow>('weights', { date, kg: Math.round(kg * 10) / 10, source: 'manual' });
  return () => {
    if (prev) env.store.put<WeightRow>('weights', { ...prev, deleted_at: null });
    else env.store.remove('weights', date);
  };
}

export function setSteps(env: Env, date: string, steps: number): Undo {
  const prev = dayRow(env, date).steps;
  setDay(env, date, { steps: Math.max(0, Math.min(99999, Math.round(steps))), steps_source: 'manual' });
  return () => setDay(env, date, { steps: prev });
}

export function setWater(env: Env, date: string, cups: number): void {
  setDay(env, date, { water_cups: Math.max(0, Math.min(8, cups)) });
}

export function toggleChecklist(env: Env, list: ChecklistRow['list'], itemKey: string): boolean {
  const pk = `${list}:${itemKey}`;
  const cur = env.store.get<ChecklistRow>('checklist', pk);
  const next = !(cur?.checked ?? false);
  env.store.put<ChecklistRow>('checklist', { list, item_key: itemKey, checked: next });
  return next;
}

export function clearChecklist(env: Env, list: ChecklistRow['list']): void {
  for (const c of env.store.where<ChecklistRow>('checklist', (x) => x.list === list && x.checked)) {
    env.store.put<ChecklistRow>('checklist', { ...c, checked: false });
  }
}

export function completeWorkout(env: Env, date: string, routine: RoutineKey, info: { rounds: number; startedAt: Date; endedAt: Date }): void {
  const existing = workoutOn(env, date);
  env.store.put<WorkoutRow>('workouts', {
    id: existing?.id ?? env.newId(), date, type: routine === 'A' ? 'home_a' : 'home_b',
    started_at: info.startedAt.toISOString(), ended_at: info.endedAt.toISOString(),
    duration_s: Math.round((info.endedAt.getTime() - info.startedAt.getTime()) / 1000),
    rounds: info.rounds, kcal: null, source: 'app', run_id: null, note: null,
  });
}

/** Import a legacy backup code. Returns counts for the confirmation message. */
export function importLegacy(env: Env, code: string) {
  return importLegacyData(env, decodeLegacyBackup(code));
}

/** Import decoded legacy keys (without the 'dp:' prefix), e.g. read straight from localStorage. */
export function importLegacyData(env: Env, data: Record<string, unknown>) {
  const rows = legacyToRows(data, env.newId);
  env.store.putMany('days', rows.days);
  env.store.putMany('meal_entries', rows.entries);
  env.store.putMany('weights', rows.weights);
  env.store.putMany('workouts', rows.workouts);
  env.store.putMany('checklist', rows.checklist);
  return { days: rows.days.length, meals: rows.entries.length, weights: rows.weights.length, workouts: rows.workouts.length };
}

export const tomorrowKey = (env: Env): string => {
  const d = addDays(env.now(), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
