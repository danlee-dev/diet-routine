// Pantry on top of the store: counts by shopping item, used up by the meals logged on any device,
// refilled by "샀어요". Web and iPhone call these, so both show the same count and the same reorder day.
import {
  afterPurchase, applyPlanChanges, effectiveShop, keyOf, pantryStatus, plan, stockAlerts,
  type ChecklistRow, type MealEntryRow, type PantryInput, type PantryRecord, type PantryStatus, type StockAlert,
} from '@diet/core';
import { entriesFor, type Env, type Undo } from './model';
import { effectivePlan } from './plan';
import { pantryRecords, writePantryRecords } from './pantryRecords';

export { countedIds, pantryRecords } from './pantryRecords';

/** An ordinary day of today's plan (at home, no one-day changes): the rate behind "N일분". */
const ordinaryDay = (env: Env, date: string) => applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }), effectivePlan(env, date), []);

/** Everything the pure pantry functions need, read from the store. The reminders planner can pass this to stockAlerts. */
export function pantryInput(env: Env): PantryInput {
  const date = keyOf(env.now());
  const records = pantryRecords(env);
  const since = Object.values(records).reduce((a, r) => (r.at < a ? r.at : a), '9999');
  // one state per slot and day, as everywhere else (two devices checking the same meal count once)
  const dates = new Set(env.store.where<MealEntryRow>('meal_entries', (e) => (e.eaten_at ?? '') > since).map((e) => e.date));
  const entries = [...dates].flatMap((d) => entriesFor(env, d)).filter((e) => (e.eaten_at ?? '') > since);
  return { shop: effectiveShop(effectivePlan(env, date)), records, entries, meals: ordinaryDay(env, date) };
}

export const pantryView = (env: Env): PantryStatus[] => pantryStatus(pantryInput(env));

/** Items at three days or fewer, fewest first. */
export const stockAlertsFor = (env: Env, days?: number): StockAlert[] => stockAlerts(pantryInput(env), { days });

/** The pantry item a list id (지금 n1, 날짜별 hellotin, ...) belongs to. */
export const pantryFor = (env: Env, listId: string): PantryStatus | undefined => pantryView(env).find((s) => s.item.ids.includes(listId));

/** Change the records; the undo puts back only the keys this change touched. */
function update(env: Env, fn: (all: Record<string, PantryRecord>) => void): Undo {
  const before = pantryRecords(env);
  const next = { ...before };
  fn(next);
  const touched = [...new Set([...Object.keys(before), ...Object.keys(next)])].filter((k) => before[k] !== next[k]);
  if (!touched.length || !writePantryRecords(env, next)) return () => {};
  return () => {
    const cur = pantryRecords(env);
    for (const k of touched) { if (before[k]) cur[k] = before[k]!; else delete cur[k]; }
    writePantryRecords(env, cur);
  };
}

const now = (env: Env) => env.now().toISOString();

/** "지금 12개 있어요": a hand count from now on. */
export function setStock(env: Env, listId: string, count: number): Undo {
  const s = pantryFor(env, listId);
  if (!s) return () => {};
  const id = s.item.id;
  return update(env, (all) => {
    for (const other of s.item.ids) if (other !== id) delete all[other];
    all[id] = { count: Math.max(0, Math.round(count * 10) / 10), at: now(env), prev: null };
  });
}

/** Bought `packs` purchases: what is left plus a full pack each. Remembers the count before, for un-marking. */
export function markBought(env: Env, listId: string, packs = 1): Undo {
  const s = pantryFor(env, listId);
  if (!s) return () => {};
  const id = s.item.id;
  return update(env, (all) => {
    for (const other of s.item.ids) if (other !== id) delete all[other];
    all[id] = { count: afterPurchase(s, packs), at: now(env), prev: s.record ? { count: s.record.count, at: s.record.at } : null };
  });
}

/** Undo the last purchase if that is what the record holds; returns false when there was nothing to undo. */
export function unmarkBought(env: Env, listId: string): boolean {
  const s = pantryFor(env, listId);
  if (!s?.record || s.record.prev === undefined) return false;
  const prev = s.record.prev;
  update(env, (all) => {
    if (prev) all[s.item.id] = { count: prev.count, at: prev.at, prev: null };
    else delete all[s.item.id];
  });
  return true;
}

/** Stop counting an item: its date reminders (if any) come back. */
export function stopCounting(env: Env, listId: string): Undo {
  const s = pantryFor(env, listId);
  if (!s) return () => {};
  return update(env, (all) => { for (const id of s.item.ids) delete all[id]; });
}

/**
 * The 장보기 checkbox: checking means bought (refills the count), unchecking puts the count back when the
 * last change was that purchase. Returns whether it is now checked and an undo for the toast.
 */
export function toggleBought(env: Env, listId: string): { checked: boolean; undo: Undo; status?: PantryStatus } {
  const pk = `shop:${listId}`;
  const cur = env.store.get<ChecklistRow>('checklist', pk);
  const checked = !(cur?.checked ?? false);
  env.store.put<ChecklistRow>('checklist', { list: 'shop', item_key: listId, checked });
  if (checked) {
    const undoStock = markBought(env, listId);
    return {
      checked, status: pantryFor(env, listId),
      undo: () => { undoStock(); env.store.put<ChecklistRow>('checklist', { list: 'shop', item_key: listId, checked: false }); },
    };
  }
  const before = pantryRecords(env);
  unmarkBought(env, listId);
  return {
    checked, status: pantryFor(env, listId),
    undo: () => { writePantryRecords(env, before); env.store.put<ChecklistRow>('checklist', { list: 'shop', item_key: listId, checked: true }); },
  };
}
