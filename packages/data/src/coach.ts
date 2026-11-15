// AI coach on the device: build the context snapshot from the local store, and apply / undo change cards.
// Cards come from the server (model-influenced), so they are validated again here before any row is written.
//
// Row formats this file writes (the today screen reads the same ones):
// - plans:            { id, effective_from, slots: PlanOverride, scenarios: null, source: 'ai', note }
//                     The newest row (effective_from <= date, then updated_at) is the whole active override.
//                     Each coach change writes a new row containing the merged override, so undo = delete that row.
// - plan_adjustments: { id, date, slot, change: AdjustmentChange (+ target/workout/steps_delta), reason, source: 'ai' }
// - meal_entries:     replace / extra / skip rows, same shapes as logFood and skipMeal.
import { plan, type DayAdjustment, type MealEntryRow, type PlanOverride, type Slot, type WeightRow, type WorkoutRow } from '@diet/core';
import { buildSnapshot, CardZ, DayAdjustmentZ, PlanOverrideZ, type CardRow, type CoachCard, type CoachSnapshot } from '@diet/core/coach';
import { dayRow, entriesFor, skipMeal, todayView, type Env, type Undo } from './model';
import { workoutPlan } from './today';

export interface PlanRow {
  id: string;
  effective_from: string;
  slots: unknown;
  scenarios?: unknown;
  source: 'default' | 'ai' | 'user';
  note: string | null;
  chat_message_id?: string | null;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface PlanAdjustmentRow {
  id: string;
  date: string;
  slot: Slot | null;
  change: unknown;
  reason: string | null;
  source: 'rebalance' | 'ai' | 'user';
  chat_message_id?: string | null;
  updated_at?: string;
  deleted_at?: string | null;
}

/** The template override active on `date` (latest `plans` row that has started), or null. */
export function activePlanOverride(env: Env, date: string): PlanOverride | null {
  const rows = env.store.where<PlanRow>('plans', (p) => p.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  for (const r of rows) {
    const parsed = PlanOverrideZ.safeParse(r.slots);
    if (parsed.success) return parsed.data as PlanOverride;
  }
  return null;
}

/** `plan_adjustments` rows for one day, in creation order. Rows with an unknown shape are ignored. */
export function dayAdjustments(env: Env, date: string): DayAdjustment[] {
  const rows = env.store.where<PlanAdjustmentRow>('plan_adjustments', (a) => a.date === date)
    .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''));
  const out: DayAdjustment[] = [];
  for (const r of rows) {
    const parsed = DayAdjustmentZ.safeParse({ id: r.id, slot: r.slot, change: r.change, reason: r.reason, source: r.source });
    if (parsed.success) out.push(parsed.data as DayAdjustment);
  }
  return out;
}

/** Everything the coach needs about right now, computed with the same core functions as the screens. */
export function coachSnapshot(env: Env, timeZone?: string): CoachSnapshot {
  const v = todayView(env);
  const date = v.ctx.key;
  const day = dayRow(env, date);
  const wp = workoutPlan(env, v);
  return buildSnapshot({
    now: env.now(),
    program: env.program,
    day,
    // from the day row, not v.meals: the snapshot applies overrides itself, once
    baseMeals: plan({ scen: day.scenario ?? 'home', eatout: day.eatout_slot ?? 'lunch', wake: day.wake_min }),
    override: activePlanOverride(env, date),
    adjustments: dayAdjustments(env, date),
    entries: entriesFor(env, date),
    weights: env.store.all<WeightRow>('weights'),
    workouts: env.store.all<WorkoutRow>('workouts'),
    workoutPlan: wp ? { routine: wp.routine, at: wp.at, done: wp.done } : null,
    stepsGoal: v.stepsGoal,
    timeZone,
  });
}

/** Write one card row. Returns its undo. */
function applyRow(env: Env, row: CardRow, reason: string | undefined): Undo {
  switch (row.op) {
    case 'meal_entry': {
      const replaced = row.slot === 'extra' ? [] : entriesFor(env, row.date).filter((e) => e.slot === row.slot);
      for (const e of replaced) env.store.remove('meal_entries', e.id);
      const entry: Omit<MealEntryRow, 'updated_at'> = {
        id: env.newId(), date: row.date, slot: row.slot, kind: row.slot === 'extra' ? 'extra' : 'replace', eaten_at: env.now().toISOString(),
        food_id: null, name: row.name, servings: null, amount_text: row.amount, items: null,
        kcal: Math.round(row.kcal), protein_g: Math.round(row.protein), carbs_g: null, fat_g: null, sugar_g: null, sodium_mg: null, fiber_g: null,
        source: row.source, photo_path: null, confidence: row.confidence, note: row.note, deleted_at: null,
      };
      env.store.put('meal_entries', entry);
      return () => {
        env.store.remove('meal_entries', entry.id);
        for (const e of replaced) env.store.put('meal_entries', { ...e, deleted_at: null });
      };
    }
    case 'skip_meal':
      return skipMeal(env, row.date, row.slot);
    case 'plan': {
      const r: PlanRow = { id: env.newId(), effective_from: row.effective_from, slots: row.override, scenarios: null, source: 'ai', note: row.note || reason || null, chat_message_id: null, deleted_at: null };
      env.store.put('plans', r);
      return () => env.store.remove('plans', r.id);
    }
    case 'adjustment': {
      const r: PlanAdjustmentRow = { id: env.newId(), date: row.date, slot: row.slot, change: row.change, reason: row.reason || reason || null, source: 'ai', chat_message_id: null, deleted_at: null };
      env.store.put('plan_adjustments', r);
      return () => env.store.remove('plan_adjustments', r.id);
    }
  }
}

export type ApplyResult = { ok: true; undo: Undo } | { ok: false; error: string };

/** Apply a change card (the user tapped 적용). All rows or none; undo reverts them in reverse order. */
export function applyCard(env: Env, card: CoachCard | unknown): ApplyResult {
  const parsed = CardZ.safeParse(card);
  if (!parsed.success) return { ok: false, error: '카드 형식이 올바르지 않아 적용하지 않았습니다' };
  const undos: Undo[] = [];
  try {
    for (const row of parsed.data.rows) undos.push(applyRow(env, row, parsed.data.note));
  } catch (e) {
    for (const u of undos.reverse()) u();
    return { ok: false, error: e instanceof Error ? e.message : '적용하지 못했습니다' };
  }
  return { ok: true, undo: () => { for (const u of [...undos].reverse()) u(); } };
}

export type { CoachCard, CoachSnapshot };
