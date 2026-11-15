// The editable plan: versions in `plans` (effective from a date) and one-day changes in `plan_adjustments`.
// Web, iPhone and the AI coach all write through these functions, so an edit on one shows up the same on the other.
import {
  addDays, keyOf as toKey, parseKey, programKey, proposalToAdjustments, rebalance, withMeal, withRoutineItems, withWeekDay,
  type DayAdjustment, type Proposal, type MealKey, type MealOverride, type PlanAdjustmentRow, type PlanOverride, type PlanRow,
  type RoutineDef, type RoutineKey, type WeekType,
} from '@diet/core';
import type { Env, TodayView } from './model';

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

// ---------- rebalance ----------

/** How today would end if the rest goes as planned, and what to change to land on target. */
export function rebalanceToday(env: Env, v: TodayView): Proposal {
  const appliedCuts = new Set(v.adjustments.map((a) => a.change.cut_id).filter((x): x is string => !!x));
  return rebalance({
    meals: v.meals, logged: v.eaten, eatenKcal: v.sum.eaten, eatenProtein: v.sum.eatenProtein,
    target: v.target, proteinFloor: env.program.proteinFloor, appliedCuts, nowMin: v.nowMin,
  });
}

/** Worth showing: over by more than 100 kcal with something to change, or short on protein. */
export const rebalanceWorthShowing = (p: Proposal): boolean =>
  (p.over > 100 && (p.cuts.length > 0 || p.carry.length > 0)) || p.proteinAdds.length > 0;

/** Write the proposal as day adjustments (today's cuts and adds, carry-over on the next days). Returns undo. */
export const applyRebalance = (env: Env, p: Proposal, reason?: string): (() => void) =>
  addAdjustments(env, proposalToAdjustments(p, reason ?? (p.over > 0 ? `계획대로면 ${p.over}kcal 넘쳐서 맞췄습니다` : '단백질이 모자라서 더했습니다')));

/**
 * What pushed the day over, in the user's words: food logged on top of the plan, and meals eaten
 * differently that came in above the planned meal. Partial meals (below plan) are not causes.
 */
export function overCauses(v: TodayView): { name: string; kcal: number }[] {
  const out: { name: string; kcal: number }[] = [];
  const replaced = new Map<string, { names: string[]; kcal: number }>();
  for (const e of v.entries) {
    if (e.slot === 'extra' || e.kind === 'extra') out.push({ name: e.name, kcal: e.kcal });
    else if (e.kind === 'replace') {
      const r = replaced.get(e.slot) ?? { names: [], kcal: 0 };
      r.names.push(e.name);
      r.kcal += e.kcal;
      replaced.set(e.slot, r);
    }
  }
  for (const [slot, r] of replaced) {
    const planned = v.meals.find((m) => m.key === slot)?.kcal ?? 0;
    if (r.kcal - planned > 30) out.push({ name: r.names.join(', '), kcal: r.kcal - planned });
  }
  return out.sort((a, b) => b.kcal - a.kcal);
}
