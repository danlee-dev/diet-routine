// AI coach on the device: build the context snapshot from the local store, and apply / undo change cards.
// Cards come from the server (model-influenced), so they are validated again here before anything is written.
// Plan and adjustment rows go through the shared plan API (plan.ts) with source 'ai', the card title as the
// note and the chat message id, so the plan screens can show "코치가 바꿈" and link back to the conversation.
import {
  addDays, effectiveShop, keyOf, stableId, startOfDay, withMeal, withRoutine, withRoutineItems,
  type EventRow, type MealEntryRow, type MealKey, type MealOverride, type PlanOverride, type PlanRow, type RoutineDef, type RoutineKey, type ShopItem,
  type ShopPlan, type WeekType, type WeightRow, type WorkoutRow,
} from '@diet/core';
import { buildSnapshot, CardZ, type CardRow, type CoachCard, type CoachSnapshot } from '@diet/core/coach';
import { recentDayStats } from './coachHistory';
import { entriesFor, skipMeal, todayView, type Env, type Undo } from './model';
import { addAdjustments, effectivePlan, planMeta, savePlan, setTodaySession } from './plan';
import { profileOf } from './profile';
import { workoutPlan } from './today';

/**
 * Everything the coach needs about right now, from the same view the today screen renders.
 * `extras` adds what only the tools read (tomorrow's plan, two weeks of day stats, planned events);
 * the request sends them, screens that only show the header totals skip the work.
 */
export function coachSnapshot(env: Env, timeZone?: string, opts: { extras?: boolean } = {}): CoachSnapshot {
  const v = todayView(env);
  const wp = workoutPlan(env, v);
  const extras = opts.extras ? snapshotExtras(env, v.ctx.key) : {};
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
    profile: (() => { const p = profileOf(env.store); return p ? { onboarding: p.onboarding ?? null, preferences: p.preferences ?? null } : null; })(),
    shop: v.shop,
    rules: v.rules,
    entries: v.entries,
    weights: env.store.all<WeightRow>('weights'),
    workouts: env.store.all<WorkoutRow>('workouts'),
    workoutPlan: wp ? { routine: wp.routine, at: wp.at, done: wp.done } : null,
    stepsGoal: v.stepsGoal,
    timeZone,
    ...extras,
  });
}

function snapshotExtras(env: Env, today: string) {
  const tomorrowStart = startOfDay(addDays(env.now(), 1));
  const vt = todayView({ ...env, now: () => tomorrowStart });
  return {
    events: env.store.where<EventRow>('events', (e) => e.date >= today),
    tomorrow: { date: vt.ctx.key, target: vt.target, meals: vt.meals },
    history: recentDayStats(env, 15),
  };
}

/**
 * Row id for row `i` of a card: the same on every device (so a card applied on one shows as applied on the
 * other), and different for any other card even if two turns reused a card id (the row's content is part of it).
 */
export const cardRowId = (card: Pick<CoachCard, 'id' | 'messageId' | 'rows'>, i: number): string =>
  stableId(`coach-row:${card.messageId ?? ''}:${card.id}:${i}:${canonJson(card.rows[i])}`);

type PlanPatch = Extract<CardRow, { op: 'plan' }>;
/** previous values of everything a patch touched, to undo just that patch later */
interface PlanInverse {
  meals: [MealKey, MealOverride | undefined][];
  week: [string, WeekType | undefined][];
  routines: [RoutineKey, RoutineDef['items'] | undefined][];
  amrap: [RoutineKey, number | null | undefined][];
  shop: ShopInverse[];
}

type ShopOp = NonNullable<PlanPatch['shopOps']>[number];
type ShopInverse = { action: 'remove'; id: string } | { action: 'insert'; list: 'now' | 'week'; at: number; item: ShopItem } | { action: 'replace'; id: string; item: ShopItem };
const findItem = (shop: ShopPlan, id: string) => (['now', 'week'] as const).map((list) => ({ list, at: shop[list].findIndex((x) => x.id === id) })).find((x) => x.at >= 0);

/** Apply shop edits to the list as it is now; an edit whose item is already gone is skipped. */
function applyShopOps(base: ShopPlan, ops: ShopOp[]): { shop: ShopPlan; inverse: ShopInverse[] } {
  const shop: ShopPlan = { now: [...base.now], week: [...base.week], cycle: base.cycle };
  const inverse: ShopInverse[] = [];
  for (const op of ops) {
    if (op.action === 'add' && op.item && op.list && !findItem(shop, op.item.id)) {
      shop[op.list].push(op.item);
      inverse.push({ action: 'remove', id: op.item.id });
      continue;
    }
    const at = findItem(shop, op.id);
    if (!at) continue;
    const old = shop[at.list][at.at]!;
    if (op.action === 'remove') { shop[at.list].splice(at.at, 1); inverse.push({ action: 'insert', list: at.list, at: at.at, item: old }); }
    else if (op.action === 'replace' && op.item) { shop[at.list][at.at] = op.item; inverse.push({ action: 'replace', id: op.item.id, item: old }); }
  }
  return { shop, inverse };
}

function undoShopOps(base: ShopPlan, inverse: ShopInverse[]): ShopPlan {
  const shop: ShopPlan = { now: [...base.now], week: [...base.week], cycle: base.cycle };
  for (const inv of [...inverse].reverse()) {
    if (inv.action === 'insert') { if (!findItem(shop, inv.item.id)) shop[inv.list].splice(Math.min(inv.at, shop[inv.list].length), 0, inv.item); continue; }
    const at = findItem(shop, inv.id);
    if (!at) continue;
    if (inv.action === 'remove') shop[at.list].splice(at.at, 1);
    else shop[at.list][at.at] = inv.item;
  }
  return shop;
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
  const inverse: PlanInverse = { meals: [], week: [], routines: [], amrap: [], shop: [] };
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
  for (const [k, m] of Object.entries(row.amrap ?? {}) as [RoutineKey, number | null][]) {
    const cur = next.workout?.routines?.[k];
    inverse.amrap.push([k, cur?.amrapMin]);
    next = withRoutine(next, k, { items: cur?.items ?? [], amrapMin: m });
  }
  if (row.shopOps?.length) {
    // a user still on the built-in list gets their own copy the first time the coach edits it
    const r = applyShopOps(effectiveShop(next), row.shopOps);
    next = { ...next, shop: r.shop };
    inverse.shop = r.inverse;
  }
  return { next, inverse };
}

function unfold(cur: PlanOverride, inv: PlanInverse): PlanOverride {
  let next = cur;
  for (const [k, m] of inv.meals) next = withMeal(next, k, m ?? null);
  for (const [d, t] of inv.week) next = setWeek(next, d, t);
  for (const [k, items] of inv.routines) next = setRoutine(next, k, items);
  for (const [k, m] of inv.amrap) {
    const cur = next.workout?.routines?.[k];
    if (cur) next = withRoutine(next, k, { items: cur.items, amrapMin: m ?? null });
  }
  if (inv.shop.length) next = { ...next, shop: undoShopOps(effectiveShop(next), inv.shop) };
  return next;
}

const canon = (o: PlanOverride | null) => JSON.stringify({ meals: o?.meals ?? {}, workout: o?.workout ?? null, shop: o?.shop ?? null, rules: o?.rules ?? null });

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
function applyRow(env: Env, row: CardRow, card: CoachCard, i: number): Undo {
  const id = cardRowId(card, i);
  switch (row.op) {
    case 'meal_entry': {
      // every live row of the slot, not just the deduped one (same as logFood), so none resurfaces later
      const replaced = row.slot === 'extra' ? [] : env.store.where<MealEntryRow>('meal_entries', (e) => e.date === row.date && e.slot === row.slot && e.id !== id);
      for (const e of replaced) env.store.remove('meal_entries', e.id);
      const entry: Omit<MealEntryRow, 'updated_at'> = {
        id, date: row.date, slot: row.slot, kind: row.slot === 'extra' ? 'extra' : 'replace', eaten_at: env.now().toISOString(),
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
      return addAdjustments(env, [{ offset: 0, adj: { id, slot: row.slot, change: row.change, reason: row.reason, source: 'ai' } }], row.date, card.messageId ?? null);
    case 'session':
      if (row.date !== keyOf(env.now())) throw new Error('날짜가 지난 카드라 적용하지 않았습니다');
      return setTodaySession(env, row.session, 'ai', row.reason, { id, chatMessageId: card.messageId ?? null });
    case 'event': {
      env.store.put<EventRow>('events', { id, date: row.date, slot: row.slot, kind: row.kind, note: row.note });
      return () => env.store.remove('events', id);
    }
  }
}

export type ApplyResult = { ok: true; undo: Undo } | { ok: false; error: string };

/** Apply a change card (the user tapped 적용). All rows or none; undo reverts them in reverse order. */
export function applyCard(env: Env, card: CoachCard | unknown): ApplyResult {
  const parsed = CardZ.safeParse(card);
  if (!parsed.success) return { ok: false, error: '카드 형식이 올바르지 않아 적용하지 않았습니다' };
  // plan and one-day changes from an earlier day would land on the wrong day; records of what was eaten still apply
  const stale = parsed.data.day < keyOf(env.now()) && parsed.data.rows.some((r) => r.op === 'plan' || r.op === 'adjustment' || r.op === 'session' || r.op === 'event');
  if (stale) return { ok: false, error: '지난 날짜의 카드라 적용하지 않았습니다. 코치에게 다시 물어봐 주세요' };
  const undos: Undo[] = [];
  try {
    parsed.data.rows.forEach((row, i) => { undos.push(applyRow(env, row, parsed.data, i)); });
  } catch (e) {
    for (const u of undos.reverse()) u();
    return { ok: false, error: e instanceof Error ? e.message : '적용하지 못했습니다' };
  }
  return { ok: true, undo: () => { for (const u of [...undos].reverse()) u(); } };
}

// ---------------------------------------------------------------- applied state across devices

/** JSON with sorted keys: rows come back from Postgres jsonb with their keys reordered. */
function canonJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const same = (a: unknown, b: unknown) => canonJson(a) === canonJson(b);

/** Whether the plan in effect already holds everything a plan patch sets. */
export function patchContained(plan: PlanOverride | null, row: PlanPatch): boolean {
  const p = plan ?? {};
  for (const [k, m] of Object.entries(row.meals ?? {}) as [MealKey, MealOverride | null][]) {
    const cur = p.meals?.[k];
    if (m === null) { if (cur) return false; continue; }
    if (!cur) return false;
    for (const [f, val] of Object.entries(m)) if (!same(cur[f as keyof MealOverride], val)) return false;
  }
  for (const [d, t] of Object.entries(row.week ?? {})) if (t && p.workout?.week?.[d] !== t) return false;
  for (const [k, items] of Object.entries(row.routines ?? {}) as [RoutineKey, RoutineDef['items'] | undefined][]) {
    if (items && !same(p.workout?.routines?.[k]?.items, items)) return false;
  }
  for (const [k, m] of Object.entries(row.amrap ?? {}) as [RoutineKey, number | null][]) if ((p.workout?.routines?.[k]?.amrapMin ?? null) !== m) return false;
  if (row.shopOps?.length) {
    const shop = effectiveShop(p);
    const has = (id: string) => !!findItem(shop, id);
    for (const op of row.shopOps) {
      if (op.action === 'remove' ? has(op.id) : !has(op.item?.id ?? op.id)) return false;
    }
  }
  return true;
}

/**
 * Whether a card's rows are in the store, wherever it was applied. Rows with a card-derived id (records,
 * one-day changes, events) are looked up by id; plan patches count as applied when the plan in effect from
 * their date already holds them; a skip counts when that slot is logged as skipped.
 */
export function cardApplied(env: Env, card: CoachCard): boolean {
  return card.rows.every((row, i) => {
    const id = cardRowId(card, i);
    switch (row.op) {
      case 'meal_entry': return !!env.store.get<MealEntryRow>('meal_entries', id);
      case 'skip_meal': return entriesFor(env, row.date).some((e) => e.slot === row.slot && e.kind === 'skip');
      case 'adjustment':
      case 'session': return !!env.store.get('plan_adjustments', id);
      case 'event': return !!env.store.get<EventRow>('events', id);
      case 'plan': return patchContained(effectivePlan(env, row.effective_from), row);
    }
  });
}

/** A card applied on another device can be undone here only when every row is removable by its id. */
export const undoableByRows = (card: CoachCard): boolean => card.rows.every((r) => r.op === 'adjustment' || r.op === 'session' || r.op === 'event');

/** Undo such a card by removing its rows. Returns false (and changes nothing) for other cards. */
export function undoByRows(env: Env, card: CoachCard): boolean {
  if (!undoableByRows(card)) return false;
  card.rows.forEach((r, i) => env.store.remove(r.op === 'event' ? 'events' : 'plan_adjustments', cardRowId(card, i)));
  return true;
}

export type { CoachCard, CoachSnapshot };
