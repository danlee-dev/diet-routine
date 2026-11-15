// "What matters right now" for the Today screen: one focus, the day's timeline, one recommendation.
// Shared so the iPhone home, widgets and notifications pick the same thing as the web.
import {
  DINNER_CUTOFF, hhmm, SCEN, schedule, SKIP_ADVICE, type MealKey, type MealEntryRow, type PlannedMeal,
  type RoutineKey, type Slot,
} from '@diet/core';
import { ordersDue, workoutOn, type Env, type TodayView } from './model';

export type Focus =
  | { kind: 'wake' }
  | { kind: 'meal'; meal: PlannedMeal }
  | { kind: 'workout'; routine: RoutineKey; at: number }
  | { kind: 'cutoff'; meal: PlannedMeal }
  | { kind: 'done' };

/** Recommended home workout for today, if any. */
export function workoutPlan(env: Env, v: TodayView): { routine: RoutineKey; at: number | null; done: boolean } | null {
  const t = v.session;
  const routine = t === 'A' || t === 'B' ? t : t === 'light' ? 'A' : null;
  // a rest-day scenario hides the workout, unless the user or coach set today's session on purpose
  const edited = v.override?.workout?.week?.[String(v.ctx.dow)] != null || v.adjustments.some((x) => x.change.kind === 'workout');
  if (!routine || v.scen === 'lateHome' || (v.scen === 'rest' && !edited)) return null;
  const sch = schedule(v.day.wake_min);
  return { routine, at: sch?.workout ?? null, done: !!workoutOn(env, v.ctx.key) };
}

export function focusNow(env: Env, v: TodayView): Focus {
  if (v.day.wake_min == null && !v.entries.length) return { kind: 'wake' };
  const wp = workoutPlan(env, v);
  if (wp && !wp.done && wp.at != null && v.nowMin >= wp.at - 15 && v.nowMin <= wp.at + 90) return { kind: 'workout', routine: wp.routine, at: wp.at };
  const next = v.next;
  if (!next) return { kind: 'done' };
  if (next.key === 'dinner' && v.nowMin >= DINNER_CUTOFF) return { kind: 'cutoff', meal: next };
  return { kind: 'meal', meal: next };
}

/** What was eaten, in words: planned items for a plan check, items plus what was left for a partial meal. */
function loggedText(logged: MealEntryRow[]): string {
  return logged.map((e) => {
    const items = Array.isArray(e.items) ? (e.items as { name: string }[]).map((x) => x.name).join(' · ') : '';
    if (e.kind === 'plan') return items || e.name;
    if (e.kind === 'replace' && e.note?.startsWith('안 먹음')) return `${items}${items ? ' · ' : ''}${e.note}`;
    return e.name;
  }).join(', ');
}

export type TimelineState = 'done' | 'next' | 'late' | 'upcoming' | 'skipped';

export interface TimelineItem {
  id: string;
  kind: 'wake' | 'meal' | 'workout' | 'cutoff';
  at: number | null;
  title: string;
  sub: string;
  icon: string;
  state: TimelineState;
  meal?: PlannedMeal;
  entries?: MealEntryRow[];
  routine?: RoutineKey;
}

export function timeline(env: Env, v: TodayView): TimelineItem[] {
  const items: TimelineItem[] = [];
  const wake = v.day.wake_min;
  items.push({ id: 'wake', kind: 'wake', at: wake, title: wake != null ? '기상' : '일어나면 누르기', sub: wake != null ? '끼니 시간을 맞췄습니다' : '끼니 시간이 자동으로 정해집니다', icon: 'sunrise', state: wake != null ? 'done' : 'next' });
  // before waking up, the wake row is the only 'next'
  const nextKey = wake == null && !v.entries.length ? undefined : v.next?.key;
  for (const m of v.meals) {
    const logged = v.entries.filter((e) => e.slot === m.key);
    const eaten = logged.length > 0;
    const skipped = v.skipped.has(m.key);
    const late = !eaten && m.at != null && v.nowMin > m.at + 90;
    items.push({
      id: m.key, kind: 'meal', at: m.at ?? null, title: m.name,
      sub: skipped ? SKIP_ADVICE[m.key] : eaten ? loggedText(logged) : m.items.map((x) => x.name).join(' · '),
      icon: m.icon, state: skipped ? 'skipped' : eaten ? 'done' : m.key === nextKey ? (late ? 'late' : 'next') : late ? 'late' : 'upcoming', meal: m, entries: logged,
    });
  }
  const wp = workoutPlan(env, v);
  if (wp) {
    const r = v.routines[wp.routine];
    const item: TimelineItem = {
      id: 'workout', kind: 'workout', at: wp.at, title: r.name, sub: `${r.focus}${wp.at == null ? ' · 간식 1시간 뒤' : ''}`, icon: 'dumbbell',
      state: wp.done ? 'done' : wp.at != null && v.nowMin > wp.at + 120 ? 'late' : 'upcoming', routine: wp.routine,
    };
    // place before "운동 후"
    const i = items.findIndex((x) => x.id === 'post');
    items.splice(i >= 0 ? i : items.length, 0, item);
  }
  items.push({ id: 'cutoff', kind: 'cutoff', at: DINNER_CUTOFF, title: '저녁 마감', sub: '이후엔 물, 아메리카노, 제로 음료만', icon: 'clock', state: v.nowMin >= DINNER_CUTOFF ? 'done' : 'upcoming' });
  // chronological when times are known; untimed items keep their place right after the previous item
  let last = -1;
  const keyed = items.map((it, i) => {
    const k = it.at != null ? it.at : last + 0.01;
    last = Math.max(last, k);
    return { it, k, i };
  });
  keyed.sort((a, b) => a.k - b.k || a.i - b.i);
  return keyed.map((x) => x.it);
}

export interface Recommendation {
  id: string;
  icon: string;
  title: string;
  body: string;
  action?: { label: string; kind: 'order' | 'steps' | 'water' | 'rules'; url?: string };
}

/** Exactly one suggestion for today, by priority. */
export function recommendation(env: Env, v: TodayView): Recommendation {
  const due = ordersDue(env);
  if (due.length) {
    const d = due[0]!;
    return { id: `order:${d.id}`, icon: 'shopping-basket', title: `${d.name}`, body: due.length > 1 ? `주문할 것 ${due.length}개 중 하나입니다` : '오늘 주문할 날입니다', action: { label: d.url ? '쿠팡 열기' : '장보기 보기', kind: 'order', url: d.url } };
  }
  const goal = v.stepsGoal;
  if (v.nowMin >= 17 * 60 && v.day.steps < goal * 0.6) {
    const left = goal - v.day.steps;
    const min = Math.max(10, Math.round(left / 100));
    return { id: 'steps', icon: 'footprints', title: `${left.toLocaleString('ko-KR')}보 남았어요`, body: `지금 ${min}분 걸으면 오늘 목표를 채웁니다`, action: { label: '걸음 입력', kind: 'steps' } };
  }
  const wakeAt = v.day.wake_min ?? 8 * 60;
  const expectedCups = Math.min(8, Math.floor(((v.nowMin - wakeAt) / (DINNER_CUTOFF + 120 - wakeAt)) * 8));
  if (v.day.water_cups + 2 <= expectedCups) {
    return { id: 'water', icon: 'glass-water', title: `물 ${v.day.water_cups}잔째`, body: `지금쯤 ${expectedCups}잔이면 좋습니다. 한 컵 마시고 표시하세요`, action: { label: '+1잔', kind: 'water' } };
  }
  const s = SCEN[v.scen];
  return { id: `rule:${v.scen}`, icon: s.icon, title: s.name, body: s.rules[0] ?? s.short, action: { label: '규칙 보기', kind: 'rules' } };
}

/** Log something eaten instead of (or in addition to) the plan. */
export function logFood(env: Env, input: { date: string; slot: Slot; name: string; amount: string; kcal: number; protein: number; source: MealEntryRow['source'] }): () => void {
  const replaced = input.slot === 'extra' ? [] : env.store.where<MealEntryRow>('meal_entries', (e) => e.date === input.date && e.slot === input.slot);
  for (const e of replaced) env.store.remove('meal_entries', e.id);
  const row: Omit<MealEntryRow, 'updated_at'> = {
    id: env.newId(), date: input.date, slot: input.slot, kind: input.slot === 'extra' ? 'extra' : 'replace', eaten_at: env.now().toISOString(),
    food_id: null, name: input.name, servings: null, amount_text: input.amount, items: null,
    kcal: Math.round(input.kcal), protein_g: Math.round(input.protein), carbs_g: null, fat_g: null, sugar_g: null, sodium_mg: null, fiber_g: null,
    source: input.source, photo_path: null, confidence: 0.6, note: null, deleted_at: null,
  };
  env.store.put('meal_entries', row);
  return () => {
    env.store.remove('meal_entries', row.id);
    for (const e of replaced) env.store.put('meal_entries', { ...e, deleted_at: null });
  };
}

/** Daily target: a day override (coach adjustments) or the program base. */
export const dayTarget = (_env: Env, v: TodayView): number => v.target;
/** What can still be eaten today against the target. */
export const remainingKcal = (env: Env, v: TodayView): number => dayTarget(env, v) - v.sum.eaten;
/** How far the rest of the plan would go over (positive) or under (negative) the target. */
export const projectedOver = (env: Env, v: TodayView): number => v.sum.total - dayTarget(env, v);
export const focusLabel = (f: Focus): string =>
  f.kind === 'meal' ? `${f.meal.name}${f.meal.at != null ? ` · ${hhmm(f.meal.at)}` : ''}` : f.kind === 'workout' ? '홈트 시간' : f.kind === 'cutoff' ? '저녁 마감 지남' : f.kind === 'wake' ? '좋은 아침' : '오늘 끝';

export type { MealKey };
