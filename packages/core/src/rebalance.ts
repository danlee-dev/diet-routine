// The meal plan as data (user/coach overrides + day adjustments) and the rebalancing engine.
// Rule of thumb: trim carbs and extras first, never protein; spread what cannot fit today over the next days.
import { CUTS, CYCLE, KEEP, PROTEIN_ADDS, ROUTINES, SHOP_NOW, SHOP_WEEK, WEEK, type CycleItem, type Cut, type MealKey, type PlanItem, type RoutineDef, type RoutineKey, type ShopItem, type WeekType } from './data';
import type { Slot } from './db';
import type { PlannedMeal } from './schedule';

/** A change to one meal in the template (stored in the `plans` table, effective from a date). */
export interface MealOverride {
  name?: string;
  time?: string;
  items?: PlanItem[];
  kcal?: number;
  protein?: number;
  /** drop this meal from the day entirely (e.g. "간식 빼줘") */
  removed?: boolean;
  /** shown under the meal, e.g. why it changed */
  note?: string;
}

/** Changes to the weekly workout plan (stored with the meal plan in `plans`). */
export interface WorkoutOverride {
  /** session per weekday, keyed by Date.getDay() as a string ("0" = Sunday) */
  week?: Partial<Record<string, WeekType>>;
  /** a routine's exercises at base reps (the weekly multiplier still applies); name/focus for e.g. gym routines */
  routines?: Partial<Record<RoutineKey, { items: RoutineDef['items']; name?: string; focus?: string }>>;
}

export interface RuleCard { icon: string; title: string; desc: string }

/** A user's shopping list: once now, weekly fresh items, and date-based reorders. */
export interface ShopPlan { now: ShopItem[]; week: ShopItem[]; cycle: CycleItem[] }

export interface PlanOverride {
  meals?: Partial<Record<MealKey, MealOverride>>;
  workout?: WorkoutOverride;
  /** personal shopping list (new users); null/absent = the built-in list */
  shop?: ShopPlan;
  /** "항상 지키는 것" cards */
  rules?: RuleCard[];
}

export const effectiveShop = (o?: PlanOverride | null): ShopPlan => o?.shop ?? { now: SHOP_NOW, week: SHOP_WEEK, cycle: CYCLE };
export const effectiveRules = (o?: PlanOverride | null): RuleCard[] => (o?.rules?.length ? o.rules : [...KEEP]);

export const WEEK_LABEL: Record<WeekType, string> = { rest: '휴식', A: 'A', B: 'B', walk: '걷기', light: '가볍게' };
export const WEEK_TYPES: WeekType[] = ['A', 'B', 'walk', 'light', 'rest'];

/** The weekly schedule after overrides. Index = Date.getDay(). */
export function effectiveWeek(o?: PlanOverride | null): { t: WeekType; label: string }[] {
  return WEEK.map((d, i) => {
    const t = o?.workout?.week?.[String(i)] ?? d.t;
    return { t, label: WEEK_LABEL[t] };
  });
}

/** Routines after overrides. */
export function effectiveRoutines(o?: PlanOverride | null): Record<RoutineKey, RoutineDef> {
  const r = o?.workout?.routines;
  return {
    A: r?.A?.items?.length ? { ...ROUTINES.A, ...r.A, items: r.A.items } : ROUTINES.A,
    B: r?.B?.items?.length ? { ...ROUTINES.B, ...r.B, items: r.B.items } : ROUTINES.B,
  };
}

/** Today's session: the weekly plan, unless a one-day adjustment changed it. */
export function sessionFor(dow: number, o?: PlanOverride | null, adjustments: DayAdjustment[] = []): WeekType {
  let t = effectiveWeek(o)[dow]!.t;
  for (const a of adjustments) if (a.change.kind === 'workout' && a.change.workout) t = a.change.workout;
  return t;
}

// ---- pure edits (return a new override) ----
export const withWeekDay = (o: PlanOverride | null | undefined, dow: number, t: WeekType): PlanOverride => ({
  ...o, workout: { ...o?.workout, week: { ...o?.workout?.week, [String(dow)]: t } },
});
export const withRoutineItems = (o: PlanOverride | null | undefined, key: RoutineKey, items: RoutineDef['items']): PlanOverride => ({
  ...o, workout: { ...o?.workout, routines: { ...o?.workout?.routines, [key]: { ...o?.workout?.routines?.[key], items } } },
});
export const withMeal = (o: PlanOverride | null | undefined, key: MealKey, m: MealOverride | null): PlanOverride => {
  const meals = { ...o?.meals };
  if (m) meals[key] = m; else delete meals[key];
  return { ...o, meals };
};

/** A one-day change (stored in `plan_adjustments`). slot null = whole day (e.g. carried-over kcal). */
export interface AdjustmentChange {
  kind: 'cut' | 'add' | 'carry' | 'edit' | 'workout';
  kcal_delta: number;
  protein_delta?: number;
  label: string;
  cut_id?: string;
  items?: PlanItem[];
  /** kind 'workout': today's session instead of the weekly plan */
  workout?: WeekType;
}

export interface DayAdjustment {
  id?: string;
  slot: Slot | null;
  change: AdjustmentChange;
  reason?: string | null;
  source: 'rebalance' | 'ai' | 'user';
}

export interface AdjustedMeal extends PlannedMeal {
  /** labels of adjustments applied today, e.g. ["햇반 반 공기만"] */
  changes?: string[];
  /** set when the template was edited (coach or user) */
  edited?: string;
}

/** Apply template overrides and day adjustments on top of the situation-aware plan. */
export function applyPlanChanges(meals: PlannedMeal[], override?: PlanOverride | null, adjustments: DayAdjustment[] = []): AdjustedMeal[] {
  const out: AdjustedMeal[] = [];
  for (const base of meals) {
    const o = override?.meals?.[base.key];
    if (o?.removed) continue;
    let m: AdjustedMeal = { ...base };
    if (o) {
      m = {
        ...m,
        ...(o.name ? { name: o.name } : {}),
        ...(o.time ? { time: o.time, ...(/^\d{1,2}:\d{2}$/.test(o.time) ? { at: Number(o.time.split(':')[0]) * 60 + Number(o.time.split(':')[1]) } : {}) } : {}),
        ...(o.items ? { items: o.items } : {}),
        ...(o.kcal != null ? { kcal: o.kcal } : {}),
        ...(o.protein != null ? { protein: o.protein } : {}),
        edited: o.note ?? '식단표를 바꿨어요',
      };
    }
    const mine = adjustments.filter((a) => a.slot === base.key);
    for (const a of mine) {
      if (a.change.kind === 'workout') continue;
      if (a.change.kind === 'edit' && a.change.items) m.items = a.change.items;
      m.kcal = Math.max(0, m.kcal + a.change.kcal_delta);
      m.protein = Math.max(0, m.protein + (a.change.protein_delta ?? 0));
      m.changes = [...(m.changes ?? []), a.change.label];
    }
    out.push(m);
  }
  return out;
}

/** Day target after carried-over kcal (slot null adjustments). */
export const adjustedTarget = (base: number, adjustments: DayAdjustment[]): number =>
  base + adjustments.filter((a) => a.slot == null && a.change.kind !== 'workout').reduce((s, a) => s + a.change.kcal_delta, 0);

export interface RebalanceInput {
  /** today's meals after template overrides and existing adjustments */
  meals: AdjustedMeal[];
  /** slots already logged (eaten, replaced or skipped) */
  logged: Set<MealKey>;
  eatenKcal: number;
  eatenProtein: number;
  target: number;
  proteinFloor: number;
  /** cut ids already applied today */
  appliedCuts: Set<string>;
  /** minutes since midnight; meals already past their time are still trimmable until logged */
  nowMin?: number;
}

export interface Proposal {
  /** projected kcal over the target before changes (negative = under) */
  over: number;
  cuts: Cut[];
  /** remaining excess spread over the next days: offset in days (1 = tomorrow) */
  carry: { offset: number; kcal: number }[];
  /** extra steps suggested for tomorrow when the excess is large */
  stepsBonus: number;
  proteinAdds: { slot: MealKey; id: string; label: string; kcal: number; protein: number }[];
  before: { total: number; protein: number };
  after: { total: number; protein: number };
  /** one-line Korean summary for cards and notifications */
  summary: string;
}

const MAX_CARRY_PER_DAY = 200;
const CARRY_DAYS = 3;

export function rebalance(input: RebalanceInput): Proposal {
  const remaining = input.meals.filter((m) => !input.logged.has(m.key));
  const total = input.eatenKcal + remaining.reduce((s, m) => s + m.kcal, 0);
  const protein = input.eatenProtein + remaining.reduce((s, m) => s + m.protein, 0);
  const over = total - input.target;
  const remainingSlots = new Set(remaining.map((m) => m.key));

  const cuts: Cut[] = [];
  let need = over > 50 ? over : 0;
  let lostProtein = 0;
  if (need > 0) {
    for (const c of CUTS) {
      if (need <= 0) break;
      if (!remainingSlots.has(c.slot) || input.appliedCuts.has(c.id)) continue;
      // the item this cut trims must still be in the meal (it may have been edited out)
      if (c.item && !remaining.find((m) => m.key === c.slot)?.items.some((x) => x.name.includes(c.item!))) continue;
      // keep protein at or above the floor
      if (protein - lostProtein - c.protein < input.proteinFloor && c.protein > 0) continue;
      const replaced = c.replaces ? cuts.findIndex((x) => x.id === c.replaces) : -1;
      const prev = replaced >= 0 ? cuts[replaced]! : null;
      if (c.replaces && !prev && input.appliedCuts.has(c.replaces)) continue; // stronger cut on top of an applied one: skip for simplicity
      if (prev) cuts.splice(replaced, 1);
      cuts.push(c);
      need -= c.kcal - (prev?.kcal ?? 0);
      lostProtein += c.protein - (prev?.protein ?? 0);
    }
  }
  const cutKcal = cuts.reduce((s, c) => s + c.kcal, 0);
  const cutProtein = cuts.reduce((s, c) => s + c.protein, 0);

  const carry: Proposal['carry'] = [];
  let left = Math.max(0, over - cutKcal);
  for (let d = 1; d <= CARRY_DAYS && left > 50; d++) {
    const k = Math.min(MAX_CARRY_PER_DAY, Math.round(left / 10) * 10);
    carry.push({ offset: d, kcal: k });
    left -= k;
  }
  const stepsBonus = over - cutKcal > 600 ? 3000 : 0;

  // protein top-up when the day would end under the floor
  const proteinAdds: Proposal['proteinAdds'] = [];
  let p = protein - cutProtein;
  const lastSlot = (remaining.find((m) => m.key === 'dinner') ?? remaining[remaining.length - 1])?.key;
  if (p < input.proteinFloor && lastSlot) {
    for (const a of PROTEIN_ADDS) {
      if (p >= input.proteinFloor) break;
      proteinAdds.push({ slot: lastSlot, id: a.id, label: a.label, kcal: a.kcal, protein: a.protein });
      p += a.protein;
    }
  }
  const addKcal = proteinAdds.reduce((s, a) => s + a.kcal, 0);
  const after = { total: total - cutKcal + addKcal, protein: p };

  const parts: string[] = [];
  if (cuts.length) parts.push(`남은 끼니에서 ${cutKcal}kcal 줄이기`);
  if (carry.length) parts.push(`다음 ${carry.length}일 동안 ${carry.map((c) => c.kcal).join('·')}kcal 나눠 줄이기`);
  if (stepsBonus) parts.push(`내일 걸음 +${stepsBonus.toLocaleString('ko-KR')}`);
  if (proteinAdds.length) parts.push(`단백질 보충 ${proteinAdds.map((a) => a.label).join(', ')}`);
  const summary = parts.length ? parts.join(' · ') : over <= 50 ? '오늘 계획 안에 있어요' : '더 줄일 항목이 없어요';

  return { over, cuts, carry, stepsBonus, proteinAdds, before: { total, protein }, after, summary };
}

/** Turn a proposal into adjustment rows: today's cuts/adds and future carry-overs. */
export function proposalToAdjustments(p: Proposal, reason: string): { offset: number; adj: DayAdjustment }[] {
  const rows: { offset: number; adj: DayAdjustment }[] = [];
  for (const c of p.cuts) {
    rows.push({ offset: 0, adj: { slot: c.slot, source: 'rebalance', reason, change: { kind: 'cut', kcal_delta: -c.kcal, protein_delta: -c.protein, label: c.label, cut_id: c.id } } });
  }
  for (const a of p.proteinAdds) {
    rows.push({ offset: 0, adj: { slot: a.slot, source: 'rebalance', reason, change: { kind: 'add', kcal_delta: a.kcal, protein_delta: a.protein, label: a.label } } });
  }
  for (const c of p.carry) {
    rows.push({ offset: c.offset, adj: { slot: null, source: 'rebalance', reason, change: { kind: 'carry', kcal_delta: -c.kcal, label: `넘친 만큼 ${c.kcal}kcal 덜 먹기` } } });
  }
  // today's side of the carry: the deferred amount is now owed by the next days, so today's target rises by it
  // and the card settles instead of asking for the same excess again
  const carried = p.carry.reduce((s, c) => s + c.kcal, 0);
  if (carried > 0) {
    rows.push({ offset: 0, adj: { slot: null, source: 'rebalance', reason, change: { kind: 'carry', kcal_delta: carried, label: `${p.carry.length}일에 나눠 덜 먹기로 옮김` } } });
  }
  return rows;
}
