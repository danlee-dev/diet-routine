// AI coach on the device: build the context snapshot from the local store, and apply / undo change cards.
// Cards come from the server (model-influenced), so they are validated again here before anything is written.
// Plan and adjustment rows go through the shared plan API (plan.ts) with source 'ai', the card title as the
// note and the chat message id, so the plan screens can show "코치가 바꿈" and link back to the conversation.
import {
  keyOf, withMeal, withRoutineItems,
  type MealEntryRow, type MealKey, type MealOverride, type PlanOverride, type PlanRow, type RoutineDef, type RoutineKey, type WeekType,
  type WeightRow, type WorkoutRow,
} from '@diet/core';
import { buildSnapshot, CardZ, type CardRow, type CoachCard, type CoachSnapshot } from '@diet/core/coach';
import { skipMeal, todayView, type Env, type Undo } from './model';
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

type PlanPatch = Extract<CardRow, { op: 'plan' }>;
/** previous values of everything a patch touched, to undo just that patch later */
interface PlanInverse {
  meals: [MealKey, MealOverride | undefined][];
  week: [string, WeekType | undefined][];
  routines: [RoutineKey, RoutineDef['items'] | undefined][];
}

const setWeek = (o: PlanOverride, dow: string, t: WeekType | undefined): PlanOverride => {
  const week = { ...o.workout?.week };
  if (t) week[dow] = t; else delete week[dow];
  return { ...o, workout: { ...o.workout, week } };
};
const setRoutine = (o: PlanOverride, k: RoutineKey, items: RoutineDef['items'] | undefined): PlanOverride => {
  if (items) return withRoutineItems(o, k, items);
  const routines = { ...o.workout?.routines };
  delete routines[k];
  return { ...o, workout: { ...o.workout, routines } };
};

/** Fold a patch onto a plan version. Meal fields merge onto the meal as it is now, so a card never carries stale edits. */
function foldPatch(base: PlanOverride, row: PlanPatch): { next: PlanOverride; inverse: PlanInverse } {
  let next = base;
  const inverse: PlanInverse = { meals: [], week: [], routines: [] };
  for (const [k, m] of Object.entries(row.meals ?? {}) as [MealKey, MealOverride | null][]) {
    const prev = next.meals?.[k];
    inverse.meals.push([k, prev]);
    next = withMeal(next, k, m ? { ...prev, ...m } : null);
  }
  for (const [d, t] of Object.entries(row.week ?? {})) {
    if (!t) continue;
    inverse.week.push([d, next.workout?.week?.[d]]);
    next = setWeek(next, d, t);
  }
  for (const [k, items] of Object.entries(row.routines ?? {}) as [RoutineKey, RoutineDef['items'] | undefined][]) {
    if (!items) continue;
    inverse.routines.push([k, next.workout?.routines?.[k]?.items]);
    next = setRoutine(next, k, items);
  }
  return { next, inverse };
}

function unfold(cur: PlanOverride, inv: PlanInverse): PlanOverride {
  let next = cur;
  for (const [k, m] of inv.meals) next = withMeal(next, k, m ?? null);
  for (const [d, t] of inv.week) next = setWeek(next, d, t);
  for (const [k, items] of inv.routines) next = setRoutine(next, k, items);
  return next;
}

const canon = (o: PlanOverride | null) => JSON.stringify({ meals: o?.meals ?? {}, workout: o?.workout ?? null });

/**
 * Save a plan patch from its date on. Later-dated versions (e.g. "내일부터" saved earlier) get the same patch,
 * otherwise they would hide it from that day on. Undo reverts only this patch, whatever else changed since.
 */
function applyPlanPatch(env: Env, row: PlanPatch, card: CoachCard): Undo {
  const dates = [row.effective_from, ...new Set(env.store.where<PlanRow>('plans', (r) => r.effective_from > row.effective_from).map((r) => r.effective_from))].sort();
  const done: { date: string; written: string; inverse: PlanInverse; undo: Undo }[] = [];
  for (const date of dates) {
    const { next, inverse } = foldPatch(effectivePlan(env, date) ?? {}, row);
    const undo = savePlan(env, next, { source: 'ai', note: row.note, from: date, chatMessageId: card.messageId ?? null });
    done.push({ date, written: canon(next), inverse, undo });
  }
  return () => {
    for (const d of [...done].reverse()) {
      const cur = effectivePlan(env, d.date);
      // nothing changed since: restore exactly (drops a version this card created); otherwise undo just this patch
      if (canon(cur) === d.written) d.undo();
      else savePlan(env, unfold(cur ?? {}, d.inverse), { source: 'ai', note: `되돌림: ${row.note}`, from: d.date });
    }
  };
}

/** Write one card row. Returns its undo. */
function applyRow(env: Env, row: CardRow, card: CoachCard): Undo {
  switch (row.op) {
    case 'meal_entry': {
      // every live row of the slot, not just the deduped one (same as logFood), so none resurfaces later
      const replaced = row.slot === 'extra' ? [] : env.store.where<MealEntryRow>('meal_entries', (e) => e.date === row.date && e.slot === row.slot);
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
        // bring back what this card replaced only if nothing newer took the slot meanwhile
        const newer = row.slot !== 'extra' && env.store.where<MealEntryRow>('meal_entries', (e) => e.date === row.date && e.slot === row.slot).length > 0;
        if (!newer) for (const e of replaced) env.store.put('meal_entries', { ...e, deleted_at: null });
      };
    }
    case 'skip_meal':
      return skipMeal(env, row.date, row.slot);
    case 'plan':
      return applyPlanPatch(env, row, card);
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
  // plan and one-day changes from an earlier day would land on the wrong day; records of what was eaten still apply
  const stale = parsed.data.day < keyOf(env.now()) && parsed.data.rows.some((r) => r.op === 'plan' || r.op === 'adjustment' || r.op === 'session');
  if (stale) return { ok: false, error: '지난 날짜의 카드라 적용하지 않았습니다. 코치에게 다시 물어봐 주세요' };
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
