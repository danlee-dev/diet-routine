// Where the pantry counts live: `profiles.preferences.pantry`, one { count, at } per shopping item.
// No new table, so it syncs with the profile. Kept apart from pantry.ts so model.ts (cycle reminders) can read
// which items are counted without an import cycle.
import { effectiveShop, keyOf, pantryItems, type PantryRecord, type ProfileRow } from '@diet/core';
import type { Env } from './model';
import { effectivePlan } from './plan';

const profile = (env: Env) => env.store.get<ProfileRow>('profiles', 'me');

export function pantryRecords(env: Env): Record<string, PantryRecord> {
  const raw = (profile(env)?.preferences as Record<string, unknown> | undefined)?.pantry;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, PantryRecord> = {};
  for (const [id, r] of Object.entries(raw as Record<string, Partial<PantryRecord>>)) {
    if (r && Number.isFinite(Number(r.count)) && typeof r.at === 'string') out[id] = { count: Number(r.count), at: r.at, prev: r.prev ?? null };
  }
  return out;
}

/** Replace the records (needs a profile; every signed-in or onboarded user has one). */
export function writePantryRecords(env: Env, next: Record<string, PantryRecord>): boolean {
  const p = profile(env);
  if (!p) return false;
  env.store.put<ProfileRow>('profiles', { ...p, preferences: { ...(p.preferences ?? {}), pantry: next } });
  return true;
}

/** Every list id (지금, 매주, 날짜별) of a product whose count is kept. Its date reminders step aside. */
export function countedIds(env: Env): Set<string> {
  const records = pantryRecords(env);
  const out = new Set<string>();
  if (!Object.keys(records).length) return out;
  for (const p of pantryItems(effectiveShop(effectivePlan(env, keyOf(env.now()))))) {
    if (p.ids.some((id) => records[id])) for (const id of p.ids) out.add(id);
  }
  return out;
}
