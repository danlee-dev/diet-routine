// AI coach on the device: build the context snapshot from the local store, and apply / undo change cards.
// Cards come from the server (model-influenced), so they are validated again here before anything is written.
// Plan and adjustment rows go through the shared plan API (plan.ts) with source 'ai', the card title as the
// note and the chat message id, so the plan screens can show "코치가 바꿈" and link back to the conversation.
import {
  keyOf, withMeal, withRoutineItems, withWeekDay,
  type MealEntryRow, type MealKey, type MealOverride, type PlanOverride, type RoutineKey, type WeightRow, type WorkoutRow,
} from '@diet/core';
import { buildSnapshot, CardZ, type CardRow, type CoachCard, type CoachSnapshot } from '@diet/core/coach';
import { entriesFor, skipMeal, todayView, type Env, type Undo } from './model';
import { addAdjustments, effectivePlan, planMeta, savePlan, setTodaySession } from './plan';
import { workoutPlan } from './today';

/** Everything the coach needs about right now, from the same view the today screen renders. */
export function coachSnapshot(env: Env, timeZone?: string): CoachSnapshot {
  const v = todayView(env);
  const wp = workoutPlan(env, v);
  return buildSnapshot({
    now: env.now(),
    program: env.program,
    day: v.day,
    meals: v.meals,
    override: v.override,
    planMeta: planMeta(env, v.ctx.key),
    adjustments: v.adjustments,
    target: v.target,
    week: v.week,
    routines: v.routines,
    session: v.session,
    entries: v.entries,
    weights: env.store.all<WeightRow>('weights'),
    workouts: env.store.all<WorkoutRow>('workouts'),
    workoutPlan: wp ? { routine: wp.routine, at: wp.at, done: wp.done } : null,
    stepsGoal: v.stepsGoal,
    timeZone,
  });
}

/** Fold a plan patch onto the plan in effect on its date (so a card never carries stale edits from other cards). */
function patchPlan(env: Env, row: Extract<CardRow, { op: 'plan' }>): PlanOverride {
  let next: PlanOverride = effectivePlan(env, row.effective_from) ?? {};
  for (const [k, m] of Object.entries(row.meals ?? {}) as [MealKey, MealOverride | null][]) next = withMeal(next, k, m);
  for (const [d, t] of Object.entries(row.week ?? {})) if (t) next = withWeekDay(next, Number(d), t);
  for (const [k, items] of Object.entries(row.routines ?? {}) as [RoutineKey, NonNullable<typeof row.routines>[RoutineKey]][]) if (items) next = withRoutineItems(next, k, items);
  return next;
}

/** Write one card row. Returns its undo. */
function applyRow(env: Env, row: CardRow, card: CoachCard): Undo {
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
    case 'plan':
      return savePlan(env, patchPlan(env, row), { source: 'ai', note: row.note, from: row.effective_from, chatMessageId: card.messageId ?? null });
    case 'adjustment':
      return addAdjustments(env, [{ offset: 0, adj: { slot: row.slot, change: row.change, reason: row.reason, source: 'ai' } }], row.date, card.messageId ?? null);
    case 'session':
      if (row.date !== keyOf(env.now())) throw new Error('날짜가 지난 카드라 적용하지 않았습니다');
      return setTodaySession(env, row.session, 'ai', row.reason);
  }
}

export type ApplyResult = { ok: true; undo: Undo } | { ok: false; error: string };

/** Apply a change card (the user tapped 적용). All rows or none; undo reverts them in reverse order. */
export function applyCard(env: Env, card: CoachCard | unknown): ApplyResult {
  const parsed = CardZ.safeParse(card);
  if (!parsed.success) return { ok: false, error: '카드 형식이 올바르지 않아 적용하지 않았습니다' };
  const undos: Undo[] = [];
  try {
    for (const row of parsed.data.rows) undos.push(applyRow(env, row, parsed.data));
  } catch (e) {
    for (const u of undos.reverse()) u();
    return { ok: false, error: e instanceof Error ? e.message : '적용하지 못했습니다' };
  }
  return { ok: true, undo: () => { for (const u of [...undos].reverse()) u(); } };
}

export type { CoachCard, CoachSnapshot };
