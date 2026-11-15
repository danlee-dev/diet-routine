// The editable plan: versions in `plans` (effective from a date) and one-day changes in `plan_adjustments`.
// Web, iPhone and the AI coach all write through these functions, so an edit on one shows up the same on the other.
import {
  addDays, keyOf as toKey, parseKey, programKey, withMeal, withRoutineItems, withWeekDay,
  type DayAdjustment, type MealKey, type MealOverride, type PlanAdjustmentRow, type PlanOverride, type PlanRow,
  type RoutineDef, type RoutineKey, type WeekType,
} from '@diet/core';
import type { Env } from './model';

export type PlanSource = 'ai' | 'user';

const latestPlanRow = (env: Env, date: string): PlanRow | undefined =>
  env.store
    .where<PlanRow>('plans', (r) => r.effective_from <= date)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0];

/** The plan in effect on a date (null = the built-in plan). */
export function effectivePlan(env: Env, date: string): PlanOverride | null {
  const r = latestPlanRow(env, date);
  if (!r) return null;
  return { meals: r.slots?.meals ?? undefined, workout: r.workout ?? undefined };
}

/** When and why the plan in effect on a date last changed. */
export function planMeta(env: Env, date: string): { from: string; source: PlanRow['source']; note: string | null } | null {
  const r = latestPlanRow(env, date);
  return r ? { from: r.effective_from, source: r.source, note: r.note } : null;
}

/**
 * Save a new version of the plan effective from `from` (default today). Edits on the same day replace that
 * day's version instead of piling up rows. Returns an undo.
 */
export function savePlan(env: Env, next: PlanOverride, meta: { source: PlanSource; note?: string | null; from?: string; chatMessageId?: string | null }): () => void {
  const from = meta.from ?? toKey(env.now());
  const same = env.store.where<PlanRow>('plans', (r) => r.effective_from === from)[0];
  const prev = same ? { ...same } : null;
  const row: PlanRow = {
    id: same?.id ?? env.newId(),
    effective_from: from,
    slots: { meals: next.meals ?? {} },
    workout: next.workout ?? null,
    source: meta.source,
    note: meta.note ?? null,
    chat_message_id: meta.chatMessageId ?? null,
    updated_at: '',
  };
  env.store.put<PlanRow>('plans', row);
  return () => {
    if (prev) env.store.put<PlanRow>('plans', { ...prev, deleted_at: null });
    else env.store.remove('plans', row.id);
  };
}

const today = (env: Env) => toKey(env.now());
const current = (env: Env) => effectivePlan(env, today(env));

export const setWeekDay = (env: Env, dow: number, t: WeekType, source: PlanSource = 'user', note?: string) =>
  savePlan(env, withWeekDay(current(env), dow, t), { source, note: note ?? '주간 운동 계획을 바꿨습니다' });

export const setRoutineItems = (env: Env, key: RoutineKey, items: RoutineDef['items'], source: PlanSource = 'user', note?: string) =>
  savePlan(env, withRoutineItems(current(env), key, items), { source, note: note ?? '홈트 구성을 바꿨습니다' });

export const setMealOverride = (env: Env, key: MealKey, m: MealOverride | null, source: PlanSource = 'user', note?: string) =>
  savePlan(env, withMeal(current(env), key, m), { source, note: note ?? '식단표를 바꿨습니다' });

/** Go back to the built-in workout plan (keeps meal changes). */
export function resetWorkout(env: Env, source: PlanSource = 'user'): () => void {
  const cur = current(env);
  return savePlan(env, { ...cur, workout: undefined }, { source, note: '기본 운동 계획으로 되돌렸습니다' });
}

// ---------- one-day changes ----------

export function adjustmentsFor(env: Env, date: string): DayAdjustment[] {
  return env.store
    .where<PlanAdjustmentRow>('plan_adjustments', (a) => a.date === date)
    .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''))
    .map((a) => ({ id: a.id, slot: a.slot, change: a.change, reason: a.reason, source: a.source }));
}

/** Write day adjustments (offset in days from `base`, default today). Returns an undo. */
export function addAdjustments(env: Env, rows: { offset: number; adj: DayAdjustment }[], base?: string, chatMessageId?: string | null): () => void {
  const b = parseKey(base ?? today(env));
  const ids: string[] = [];
  for (const { offset, adj } of rows) {
    const id = adj.id ?? env.newId();
    ids.push(id);
    env.store.put<PlanAdjustmentRow>('plan_adjustments', {
      id, date: toKey(addDays(b, offset)), slot: adj.slot, change: adj.change, reason: adj.reason ?? null,
      source: adj.source, chat_message_id: chatMessageId ?? null, updated_at: '',
    });
  }
  return () => { for (const id of ids) env.store.remove('plan_adjustments', id); };
}

export const removeAdjustment = (env: Env, id: string): void => env.store.remove('plan_adjustments', id);

/** Change only today's session (e.g. rest today, or B instead of A). Replaces an earlier one-day workout change. */
export function setTodaySession(env: Env, t: WeekType, source: 'user' | 'ai' = 'user', reason?: string): () => void {
  const date = today(env);
  const old = env.store.where<PlanAdjustmentRow>('plan_adjustments', (a) => a.date === date && a.change.kind === 'workout');
  for (const o of old) env.store.remove('plan_adjustments', o.id);
  const undoNew = addAdjustments(env, [{ offset: 0, adj: { slot: null, source, reason: reason ?? null, change: { kind: 'workout', kcal_delta: 0, label: '오늘 운동 변경', workout: t } } }]);
  return () => { undoNew(); for (const o of old) env.store.put<PlanAdjustmentRow>('plan_adjustments', { ...o, deleted_at: null }); };
}

/** Program day key helper for callers that think in program days. */
export const planDateKey = (env: Env, i: number): string => programKey(env.program, i);
