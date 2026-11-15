// Context snapshot for the coach: everything the model needs about "right now", computed on the device
// from the same core functions the screens use, so the coach sees exactly the numbers on screen.
import { SCEN, type RoutineDef, type RoutineKey, type WeekType } from '../data';
import type { DayRow, MealEntryRow, PlanRow, WeightRow, WorkoutRow } from '../db';
import { dayCtx, type Program } from '../program';
import type { AdjustedMeal, DayAdjustment, PlanOverride, RuleCard, ShopPlan } from '../rebalance';
import { summary } from '../schedule';
import { clamp, hhmm, round1 } from '../util';
import { trend, weightSeries, weightStats } from '../weight';
import type { CoachSnapshot, SnapMeal } from './types';

export interface SnapshotInput {
  now: Date;
  program: Program;
  day: DayRow;
  /** today's meals after plan versions and day adjustments (todayView().meals) */
  meals: AdjustedMeal[];
  /** plan version in effect today and where it came from */
  override: PlanOverride | null;
  planMeta: { from: string; source: PlanRow['source']; note: string | null } | null;
  /** today's `plan_adjustments` and the kcal target after them */
  adjustments: DayAdjustment[];
  target: number;
  /** weekly schedule and routines after edits, today's session after one-day changes */
  week: { t: WeekType; label: string }[];
  routines: Record<RoutineKey, RoutineDef>;
  session: WeekType;
  /** profiles.onboarding and profiles.preferences (free-form jsonb; sanitized here) */
  profile?: { onboarding?: Record<string, unknown> | null; preferences?: Record<string, unknown> | null } | null;
  shop: ShopPlan;
  rules: RuleCard[];
  /** today's meal entries, already deduped per slot */
  entries: MealEntryRow[];
  weights: WeightRow[];
  workouts: WorkoutRow[];
  workoutPlan: { routine: RoutineKey; at: number | null; done: boolean } | null;
  stepsGoal: number;
  timeZone?: string;
}

const r = Math.round;

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : undefined);
const strs = (v: unknown, n: number, max: number): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, n).map((x) => x.trim().slice(0, max)) : undefined);
const oneOf = <T extends string>(v: unknown, ok: readonly T[]): T | undefined => (ok.includes(v as T) ? (v as T) : undefined);

/** Known profile fields only, typed and bounded, so odd stored values never break the snapshot. */
function profileSnap(p: SnapshotInput['profile']): CoachSnapshot['profile'] {
  if (!p || (!p.onboarding && !p.preferences)) return null;
  const o = { ...(p.preferences ?? {}), ...(p.onboarding ?? {}) } as Record<string, unknown>;
  const pick = {
    name: str(o.name, 30), sex: oneOf(o.sex, ['male', 'female'] as const), age: int(o.age, 10, 110), heightCm: int(o.heightCm, 100, 250),
    goalWeightKg: typeof o.goalWeightKg === 'number' ? clamp(round1(o.goalWeightKg), 30, 300) : undefined,
    activity: oneOf(o.activity, ['sedentary', 'light', 'active'] as const), allergies: strs(o.allergies, 10, 20), dislikes: strs(o.dislikes, 20, 30),
    cooking: str(o.cooking, 20), eatingOut: str(o.eatingOut, 20), workoutPlace: str(o.workoutPlace, 20), workoutDays: int(o.workoutDays, 0, 7),
    budgetWeek: int(o.budgetWeek, 0, 5_000_000), note: str(o.note ?? o.notes ?? o.likes, 300),
  };
  return Object.fromEntries(Object.entries(pick).filter(([, v]) => v !== undefined)) as NonNullable<CoachSnapshot['profile']>;
}

export function buildSnapshot(i: SnapshotInput): CoachSnapshot {
  const ctx = dayCtx(i.program, i.now);
  const nowMin = i.now.getHours() * 60 + i.now.getMinutes();
  const meals = i.meals;
  const sum = summary(meals, i.entries);

  const snapMeals: SnapMeal[] = meals.map((m) => {
    const logged = i.entries.filter((e) => e.slot === m.key);
    const state: SnapMeal['state'] = logged.some((e) => e.kind === 'skip') ? 'skipped'
      : logged.some((e) => e.kind === 'replace') ? 'replaced'
      : logged.length ? 'eaten' : 'pending';
    return {
      key: m.key,
      name: m.name.slice(0, 40),
      time: m.at != null ? hhmm(m.at) : m.time.slice(0, 40),
      items: m.items.slice(0, 12).map((x) => ({ name: x.name.slice(0, 60), amount: x.amount.slice(0, 60), ...(x.note ? { note: x.note.slice(0, 160) } : {}) })),
      kcal: clamp(r(m.kcal), 0, 5000),
      protein: clamp(r(m.protein), 0, 400),
      state,
      ...(state === 'replaced' ? { logged: logged.filter((e) => e.kind === 'replace').slice(0, 10).map((e) => ({ name: e.name.slice(0, 80), kcal: clamp(r(e.kcal), 0, 5000), protein: clamp(r(e.protein_g), 0, 400) })) } : {}),
      ...(m.changes?.length ? { changes: m.changes.slice(0, 10).map((c) => c.slice(0, 80)) } : {}),
      ...(m.edited ? { edited: m.edited.slice(0, 160) } : {}),
    };
  });

  const extras = i.entries.filter((e) => e.slot === 'extra').slice(0, 20)
    .map((e) => ({ name: e.name.slice(0, 80), kcal: clamp(r(e.kcal), 0, 5000), protein: clamp(r(e.protein_g), 0, 400) }));

  const today = ctx.key;
  // same validity rule as the weight chart (weight.ts): a typo like 7.6 never reaches the coach
  const weights = i.weights.filter((w) => !w.deleted_at && w.date <= today && w.kg > 30 && w.kg < 200).sort((a, b) => a.date.localeCompare(b.date));
  const series = weights.slice(-14).map((w) => ({ date: w.date, kg: round1(w.kg) }));
  const points = weightSeries(i.program, weights, ctx.idx);
  const tr = trend(points);
  const stats = weightStats(i.program, points);

  const recent = i.workouts.filter((w) => !w.deleted_at && w.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14)
    .map((w) => ({ date: w.date, type: w.type, minutes: w.duration_s != null ? clamp(r(w.duration_s / 60), 0, 1000) : null, rounds: w.rounds != null ? clamp(w.rounds, 0, 50) : null }));

  const wp = i.workoutPlan;
  const target = i.target;
  const routine = (k: RoutineKey) => ({ name: i.routines[k].name.slice(0, 30), focus: i.routines[k].focus.slice(0, 40), items: i.routines[k].items.slice(0, 12) });

  return {
    v: 1,
    now: {
      date: today,
      time: hhmm(nowMin),
      minutes: nowMin,
      dow: ctx.dow,
      dayNo: ctx.no,
      week: ctx.week,
      ...(i.timeZone ? { tz: i.timeZone.slice(0, 60) } : {}),
    },
    scenario: { id: i.day.scenario ?? 'home', name: SCEN[i.day.scenario ?? 'home'].name },
    wakeTime: i.day.wake_min != null ? hhmm(i.day.wake_min) : null,
    target: { kcal: clamp(r(target), 600, 5000), base: clamp(r(i.program.baseKcal), 600, 5000), proteinFloor: i.program.proteinFloor },
    meals: snapMeals,
    extras,
    totals: { eatenKcal: r(sum.eaten), eatenProtein: r(sum.eatenProtein), projectedKcal: r(sum.total), projectedProtein: r(sum.totalProtein) },
    steps: { count: clamp(r(i.day.steps), 0, 200000), goal: i.stepsGoal },
    water: { cups: clamp(i.day.water_cups, 0, 30), goal: 8 },
    workout: {
      planned: wp ? { routine: wp.routine, name: i.routines[wp.routine].name.slice(0, 30), focus: i.routines[wp.routine].focus.slice(0, 40), time: wp.at != null ? hhmm(wp.at) : null } : null,
      done: !!wp?.done,
      recent,
    },
    weight: {
      today: weights.find((w) => w.date === today)?.kg ?? null,
      start: i.program.startWeight,
      goal: i.program.goalWeight,
      series,
      trend: tr.length ? round1(tr[tr.length - 1]!.w) : null,
      ratePerWeek: stats.ratePerWeek,
    },
    planOverride: i.override,
    planMeta: i.planMeta ? { from: i.planMeta.from, source: i.planMeta.source, note: i.planMeta.note?.slice(0, 200) ?? null } : null,
    week: i.week.map((d) => ({ t: d.t, label: d.label.slice(0, 10) })),
    routines: { A: routine('A'), B: routine('B') },
    session: i.session,
    adjustments: i.adjustments.slice(0, 40),
    profile: profileSnap(i.profile),
    shop: {
      now: i.shop.now.slice(0, 30).map((x) => ({ id: x.id.slice(0, 80), name: x.name.slice(0, 80), qty: x.qty.slice(0, 60), price: clamp(r(x.price), 0, 1_000_000) })),
      week: i.shop.week.slice(0, 30).map((x) => ({ id: x.id.slice(0, 80), name: x.name.slice(0, 80), qty: x.qty.slice(0, 60), price: clamp(r(x.price), 0, 1_000_000) })),
    },
    rules: i.rules.slice(0, 6).map((x) => ({ icon: x.icon.slice(0, 30), title: x.title.slice(0, 60), desc: x.desc.slice(0, 160) })),
  };
}

/** The snapshot as the model reads it: compact JSON inside a tag, sent as user-turn data (never in the system prompt). */
export function snapshotForModel(s: CoachSnapshot): string {
  const { planOverride: _o, adjustments, week, ...rest } = s;
  const adj = adjustments.map((a) => ({ slot: a.slot, label: a.change.label, kcal: a.change.kcal_delta, ...(a.change.workout ? { session: a.change.workout } : {}) }));
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  // '<' escaped so a food name or note like "</context>" cannot close the data block early
  const json = JSON.stringify({ ...rest, week: week.map((d, i) => `${i}(${days[i]}): ${d.t}`), todayAdjustments: adj }).replace(/</g, '\\u003c');
  return `<context>\n${json}\n</context>`;
}
