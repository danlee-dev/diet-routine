// "코치가 바꿈" on the today screen: which of the day's meals and workout the coach changed, and the chat
// message that did it (plan_adjustments / plans rows carry chat_message_id), so a tap opens that conversation.
import type { MealKey, PlanAdjustmentRow, PlanRow } from '@diet/core';
import type { Env } from './model';

export interface CoachMark {
  /** the assistant chat_messages row whose card wrote the change (null for rows saved before ids were kept) */
  messageId: string | null;
  /** why, in the coach's words (adjustment label or plan note) */
  note: string | null;
}

export interface CoachMarks {
  meals: Partial<Record<MealKey, CoachMark>>;
  workout: CoachMark | null;
}

const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};

/**
 * Who last changed one part of the plan in effect on `date`: walk the versions oldest first; a version whose
 * value differs from the one before takes over, and a version that goes back to an earlier value gives it
 * back to whoever made that value (so "되돌림" does not read as a coach change).
 */
function originOf(rows: PlanRow[], pick: (r: PlanRow) => unknown): PlanRow | null {
  const seen = new Map<string, PlanRow | null>([[canon(undefined), null]]);
  let cur = canon(undefined);
  let origin: PlanRow | null = null;
  for (const r of rows) {
    const v = canon(pick(r));
    if (v === cur) continue;
    origin = seen.has(v) ? seen.get(v)! : r;
    if (!seen.has(v)) seen.set(v, r);
    cur = v;
  }
  return origin;
}

export function coachMarks(env: Env, date: string): CoachMarks {
  const marks: CoachMarks = { meals: {}, workout: null };
  const rows = env.store
    .where<PlanRow>('plans', (r) => r.effective_from <= date)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from) || (a.updated_at ?? '').localeCompare(b.updated_at ?? ''));
  const latest = rows[rows.length - 1];
  for (const key of ['breakfast', 'lunch', 'snack', 'post', 'dinner'] as MealKey[]) {
    if (!latest?.slots?.meals?.[key]) continue;
    const o = originOf(rows, (r) => r.slots?.meals?.[key]);
    if (o?.source === 'ai') marks.meals[key] = { messageId: o.chat_message_id ?? null, note: latest.slots.meals[key]?.note ?? o.note };
  }
  const dow = String(new Date(`${date}T00:00:00`).getDay());
  if (latest?.workout) {
    const o = originOf(rows, (r) => ({ day: r.workout?.week?.[dow], routines: r.workout?.routines }));
    if (o?.source === 'ai') marks.workout = { messageId: o.chat_message_id ?? null, note: o.note };
  }
  // one-day changes are the most specific: they win over a template change on the same meal
  const adj = env.store
    .where<PlanAdjustmentRow>('plan_adjustments', (a) => a.date === date && a.source === 'ai')
    .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''));
  for (const a of adj) {
    const mark = { messageId: a.chat_message_id ?? null, note: a.change.label };
    if (a.change.kind === 'workout') marks.workout = mark;
    else if (a.slot && a.slot !== 'extra') marks.meals[a.slot] = mark;
  }
  return marks;
}
