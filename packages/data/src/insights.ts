// Insights over the store: everything the records screen, the Today suggestions and the reminder planner
// read beyond the day itself. The math is in @diet/core (insights.ts, reminders.ts); this file only gathers
// rows, so the phone and the web show the same numbers.
import {
  adaptiveTarget, adaptiveText, addDays, adjustedTarget, applyPlanChanges, arrivalText, dayCtx, estimateMaintenance, goalArrival, keyOf,
  overshootFor, overshootText, parseKey, plan, recapRange, reminderIdParts, saltyDay, skipPattern, skipPlanChange, skipText, STEPS_SHARE,
  stepsGoal, summary, trendByDate, trendOn, waterNoteText, waterWeightNote, weekGoalText, weeklyRecap, weeklyReportText,
  type Arrival, type DatedWeight, type DayAdjustment, type IntakeDay, type MaintenanceEstimate, type MealKey, type Overshoot,
  type RecapDay, type ReminderExtras, type ReminderOutcome, type SkipChange, type SkipPattern, type SlotDay, type TargetProposal,
  type WaterNote, type WeeklyRecap, type WeightRow,
} from '@diet/core';
import { dayRow, entriesFor, mealsFor, weightOn, workoutOn, type Env, type TodayView, type Undo } from './model';
import { addAdjustments, adjustmentsFor, effectivePlan, savePlan } from './plan';
import { adoptLegacyProfile, profileOf } from './profile';
import { runCredit, runsOn } from './runCredit';

const todayKey = (env: Env): string => keyOf(env.now());
const shift = (key: string, n: number): string => keyOf(addDays(parseKey(key), n));

// These read two or three weeks of rows; screens call them on every render. Cache per store version and day.
const caches = new WeakMap<object, Map<string, { at: string; value: unknown }>>();
function cached<T>(env: Env, name: string, fn: () => T): T {
  const at = `${env.store.getVersion()}|${todayKey(env)}`;
  let m = caches.get(env.store);
  if (!m) { m = new Map(); caches.set(env.store, m); }
  const hit = m.get(name);
  if (hit && hit.at === at) return hit.value as T;
  const value = fn();
  m.set(name, { at, value });
  return value;
}

/** Every weigh-in as dated points (not limited to the program days). */
export function datedWeights(env: Env, upto?: string): DatedWeight[] {
  return env.store.all<WeightRow>('weights')
    .filter((w) => !w.deleted_at && typeof w.kg === 'number' && w.kg > 30 && w.kg < 250 && (!upto || w.date <= upto))
    .map((w) => ({ key: w.date, kg: w.kg }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------- intake per day ----------------
const carriedOut = (a: DayAdjustment) => a.change.kind === 'carry' && a.change.kcal_delta > 0;

export interface DayIntake extends IntakeDay {
  target: number;
  /** meals eaten (logged and not skipped) */
  meals: number;
  planned: MealKey[];
  slots: Partial<Record<MealKey, 'skip' | 'eaten'>>;
}

/**
 * What a day added up to. The target is the day's own (carry-overs and run credit included); with
 * `beforeCarry`, the excess that day moved to the next days is not counted as allowance.
 */
export function dayIntake(env: Env, key: string, opts: { beforeCarry?: boolean } = {}): DayIntake {
  const meals = mealsFor(env, key);
  const entries = entriesFor(env, key);
  const sum = summary(meals, entries);
  const adj = adjustmentsFor(env, key);
  const base = dayRow(env, key).kcal_target ?? env.program.baseKcal;
  const target = adjustedTarget(base, opts.beforeCarry ? adj.filter((a) => !carriedOut(a)) : adj) + runCredit(env, key);
  const slots: DayIntake['slots'] = {};
  for (const e of entries) if (e.slot !== 'extra') slots[e.slot] = e.kind === 'skip' ? 'skip' : 'eaten';
  const planned = meals.map((m) => m.key);
  return {
    key, kcal: sum.eaten, target, complete: planned.length > 0 && planned.every((k) => slots[k] != null),
    meals: planned.filter((k) => slots[k] === 'eaten').length, planned, slots,
  };
}

// ---------------- weight ----------------
export interface WeightInsight {
  /** smoothed trend at each weigh-in */
  trend: DatedWeight[];
  /** today's trend value (the last one at or before today) */
  now: number | null;
  water: (WaterNote & { title: string; body: string }) | null;
  arrival: Arrival;
  arrivalLine: string | null;
  maintenance: MaintenanceEstimate | null;
}

export function weightInsight(env: Env): WeightInsight {
  const today = todayKey(env);
  const weights = datedWeights(env, today);
  const trend = trendByDate(weights);
  const now = trendOn(trend, today);
  // a jump this morning after eating out yesterday
  const kg = weightOn(env, today);
  const prev = [...weights].reverse().find((w) => w.key < today && w.key >= shift(today, -3))?.kg ?? null;
  const y = shift(today, -1);
  const salty = saltyDay(entriesFor(env, y), dayRow(env, y).scenario);
  const note = waterWeightNote(kg, prev, salty, trendOn(trend, y) ?? now);
  const arrival = goalArrival(weights, env.program.goalWeight);
  return {
    trend, now, water: note ? { ...note, ...waterNoteText(note) } : null,
    arrival, arrivalLine: arrivalText(arrival, env.program.goalWeight), maintenance: maintenanceEstimate(env),
  };
}

/** Real maintenance from the last three weeks of complete days before today. */
export function maintenanceEstimate(env: Env): MaintenanceEstimate | null {
  return cached(env, 'maintenance', () => {
    const today = todayKey(env);
    const days = Array.from({ length: 21 }, (_, i) => dayIntake(env, shift(today, -1 - i)));
    return estimateMaintenance(days, datedWeights(env, today));
  });
}

// ---------------- suggestions for Today ----------------
/** One accept/dismiss card. `apply` writes through the plan/profile functions and returns an undo. */
export interface Suggestion {
  id: string;
  kind: 'carry' | 'target' | 'skip';
  title: string;
  body: string;
  accept: string;
  done: string;
  apply: () => Undo;
}

/** Change the daily target (profile `base_kcal`). Returns an undo. */
export function setBaseKcal(env: Env, kcal: number): Undo {
  if (!profileOf(env.store)) adoptLegacyProfile(env);
  const p = profileOf(env.store)!;
  const before = p.base_kcal;
  env.store.put('profiles', { ...p, base_kcal: Math.round(kcal) });
  return () => { const cur = profileOf(env.store); if (cur) env.store.put('profiles', { ...cur, base_kcal: before }); };
}

export function adaptiveProposal(env: Env): TargetProposal | null {
  const est = maintenanceEstimate(env);
  return est ? adaptiveTarget(est, env.program.baseKcal, profileOf(env.store)?.sex ?? null) : null;
}

export function skipProposal(env: Env): { pattern: SkipPattern; change: SkipChange } | null {
  return cached(env, 'skip', () => findSkip(env));
}

function findSkip(env: Env): { pattern: SkipPattern; change: SkipChange } | null {
  const today = todayKey(env);
  const days: SlotDay[] = Array.from({ length: 14 }, (_, i) => {
    const k = shift(today, -1 - i);
    const d = dayIntake(env, k);
    return { key: k, dow: parseKey(k).getDay(), planned: d.planned, slots: d.slots };
  });
  const pattern = skipPattern(days);
  if (!pattern) return null;
  // the plan as edited, on an ordinary day, without one-day changes
  const override = effectivePlan(env, today);
  const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }), override);
  const change = skipPlanChange(pattern, meals, override);
  return change ? { pattern, change } : null;
}

/** Yesterday's overshoot as of today, and whether its cuts are already in the plan. */
export function overshootInfo(env: Env): Overshoot | null {
  return cached(env, 'overshoot', () => findOvershoot(env));
}

function findOvershoot(env: Env): Overshoot | null {
  const today = todayKey(env);
  const y = shift(today, -1);
  if (!entriesFor(env, y).length) return null;
  const yi = dayIntake(env, y, { beforeCarry: true });
  // carried already: yesterday's rebalance moved the excess forward, or "나눠서 줄이기" was pressed this morning
  const movedYesterday = adjustmentsFor(env, y).some(carriedOut);
  const applied: { offset: number; kcal: number }[] = [];
  for (let o = 0; o < 3; o++) {
    const cut = adjustmentsFor(env, shift(today, o)).filter((a) => a.change.kind === 'carry' && a.change.kcal_delta < 0).reduce((s, a) => s - a.change.kcal_delta, 0);
    if (cut > 0) applied.push({ offset: o, kcal: cut });
  }
  const mine = adjustmentsFor(env, today).some((a) => a.change.kind === 'carry' && a.change.label.startsWith('어제 넘친 만큼'));
  const v = dayIntake(env, today);
  return overshootFor(yi.kcal - yi.target, v.target, movedYesterday || mine ? applied : []);
}

/** Write the morning-after split ("오늘부터 3일 동안 200kcal씩") as day adjustments. */
export function applyOvershootCarry(env: Env): Undo {
  const o = overshootInfo(env);
  if (!o || o.applied || !o.carry.length) return () => {};
  return addAdjustments(env, o.carry.map((c) => ({
    offset: c.offset,
    adj: { slot: null, source: 'rebalance', reason: `어제 ${o.over}kcal 넘쳐서 나눴습니다`, change: { kind: 'carry', kcal_delta: -c.kcal, label: `어제 넘친 만큼 ${c.kcal}kcal 덜 먹기` } },
  })));
}

/** Cards for Today, most pressing first: yesterday's overshoot, a new target, a meal to drop. */
export function todaySuggestions(env: Env): Suggestion[] {
  const out: Suggestion[] = [];
  const today = todayKey(env);
  const o = overshootInfo(env);
  if (o && !o.applied && o.carry.length) {
    const t = overshootText(o);
    out.push({ id: `carry:${today}`, kind: 'carry', ...t, accept: `${o.carry.length}일에 나누기`, done: `${o.carry.length}일 동안 나눠 줄입니다`, apply: () => applyOvershootCarry(env) });
  }
  const p = adaptiveProposal(env);
  if (p) {
    out.push({ id: `target:${p.next}`, kind: 'target', ...adaptiveText(p), accept: `${p.next.toLocaleString('ko-KR')}kcal로 바꾸기`, done: '하루 목표를 바꿨습니다', apply: () => setBaseKcal(env, p.next) });
  }
  const s = skipProposal(env);
  if (s) {
    const t = skipText(s.pattern, s.change);
    const from = s.change.from.name.replace(/\s*\(.*\)$/, '');
    const to = s.change.to.name.replace(/\s*\(.*\)$/, '');
    out.push({
      id: `skip:${s.pattern.slot}:${s.change.weekdays ? 'wd' : 'all'}`, kind: 'skip', ...t, accept: '이렇게 바꾸기', done: '식단표를 바꿨습니다',
      apply: () => savePlan(env, s.change.override, { source: 'user', note: `${s.change.weekdays ? '평일 ' : ''}${from}을 빼고 ${to}에 더했습니다` }),
    });
  }
  return out;
}

// ---------------- weekly recap ----------------
export function recapDay(env: Env, key: string): RecapDay {
  const d = dayIntake(env, key);
  const ctx = dayCtx(env.program, parseKey(key));
  return {
    key, eaten: d.kcal, target: d.target, complete: d.complete, meals: d.meals, workout: !!workoutOn(env, key),
    runs: runsOn(env, key).map((r) => ({ kind: r.kind, km: (r.distance_m ?? 0) / 1000 })),
    steps: dayRow(env, key).steps, stepsGoal: stepsGoal(ctx.week),
  };
}

export function weeklyRecapFor(env: Env, range?: { from: string; to: string }): WeeklyRecap & { nextGoal: string } {
  const today = todayKey(env);
  const r = range ?? recapRange(today);
  const days = Array.from({ length: 7 }, (_, i) => recapDay(env, shift(r.from, i)));
  const rec = weeklyRecap(days, r, today, datedWeights(env, today));
  const week = dayCtx(env.program, parseKey(r.to)).week;
  return { ...rec, nextGoal: weekGoalText(env.program, week + 1) };
}

// ---------------- reminder inputs ----------------
/** What the planner needs beyond the day view: yesterday's overshoot, and on Sundays the week's report. */
export function reminderExtras(env: Env, v: TodayView): ReminderExtras {
  const weekly = v.ctx.dow === 0 ? (() => {
    const r = weeklyRecapFor(env, { from: shift(v.ctx.key, -6), to: v.ctx.key });
    return weeklyReportText(r, r.nextGoal);
  })() : null;
  return { overshoot: overshootInfo(env), weekly };
}

/** Whether a delivered reminder's subject got done anyway (meal logged, glass drunk, weight saved...). */
export function reminderDone(env: Env, id: string): boolean {
  const p = reminderIdParts(id);
  if (!p) return false;
  const { date, kind, subject } = p;
  switch (kind) {
    case 'meal':
    case 'cutoff':
    case 'wrap': {
      const logged = new Set(entriesFor(env, date).map((e) => e.slot));
      const want = kind === 'wrap' ? mealsFor(env, date).map((m) => m.key) : (subject.split('+') as MealKey[]);
      return want.every((k) => logged.has(k));
    }
    case 'water': return dayRow(env, date).water_cups >= Number(subject);
    case 'weigh': return weightOn(env, date) != null;
    case 'wake': return dayRow(env, date).wake_min != null;
    case 'workout': return !!workoutOn(env, date);
    case 'steps': return dayRow(env, date).steps >= stepsGoal(dayCtx(env.program, parseKey(date)).week) * STEPS_SHARE;
    default: return false;
  }
}

/**
 * Outcomes of delivered reminders for the auto-reduce rule. `ledger` maps id to its delivery time (ms) and
 * `acted` holds ids whose notification was opened or pressed. Past days are judged in full; today only
 * reports reactions (whether today was ignored is not known yet).
 */
export function reminderOutcomes(env: Env, ledger: Record<string, number>, acted: ReadonlySet<string>): ReminderOutcome[] {
  const now = env.now().getTime();
  const today = todayKey(env);
  const out: ReminderOutcome[] = [];
  for (const [id, at] of Object.entries(ledger)) {
    if (at > now) continue;
    const p = reminderIdParts(id);
    if (!p) continue;
    const did = acted.has(id) || reminderDone(env, id);
    if (p.date < today || did) out.push({ date: p.date, kind: p.kind, acted: did });
  }
  return out;
}
