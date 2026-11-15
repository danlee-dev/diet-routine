import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM, type WeightRow } from '@diet/core';
import { DataStore, focusNow, importLegacy, setWeight, skipMeal, timeline, todayView, toggleMeal, type Env } from '../src';

const memory = () => {
  let saved: string | null = null;
  return { load: async () => saved, save: async (j: string) => { saved = j; }, peek: () => saved };
};

const makeEnv = async (persist = memory()) => {
  const store = new DataStore(persist);
  await store.init();
  let n = 0;
  const env: Env = { store, program: DEFAULT_PROGRAM, now: () => new Date(2026, 10, 15, 12, 0), newId: () => `id-${++n}` };
  return { env, persist };
};

describe('DataStore', () => {
  it('marks a meal eaten and undoes it', async () => {
    const { env } = await makeEnv();
    const r = toggleMeal(env, '2026-11-15', 'breakfast');
    expect(r.added).toBe(true);
    let v = todayView(env);
    expect(v.sum.eaten).toBe(295);
    expect(v.next?.key).toBe('lunch');
    r.undo();
    v = todayView(env);
    expect(v.sum.eaten).toBe(0);
    expect(env.store.pendingCount()).toBe(1); // the deleted row still needs to sync
  });

  it('keeps the newer row when a stale remote row arrives', async () => {
    const { env } = await makeEnv();
    setWeight(env, '2026-11-15', 75.4);
    const local = env.store.get<WeightRow>('weights', '2026-11-15')!;
    const changed = env.store.applyRemote('weights', { date: '2026-11-15', kg: 77, source: 'manual', updated_at: '2020-01-01T00:00:00Z' });
    expect(changed).toBe(false);
    expect(env.store.get<WeightRow>('weights', '2026-11-15')!.kg).toBe(local.kg);
    expect(env.store.applyRemote('weights', { date: '2026-11-15', kg: 75.1, source: 'health', updated_at: '2099-01-01T00:00:00Z' })).toBe(true);
    expect(env.store.get<WeightRow>('weights', '2026-11-15')!.kg).toBe(75.1);
  });

  it('persists and reloads the snapshot', async () => {
    const p = memory();
    const { env } = await makeEnv(p);
    setWeight(env, '2026-11-15', 75.4);
    await env.store.flush();
    const { env: env2 } = await makeEnv(p);
    expect(todayView(env2).weight).toBe(75.4);
  });

  it('imports a legacy backup code', async () => {
    const { env } = await makeEnv();
    const raw = { 'dp:checks:2026-11-15': '["breakfast"]', 'dp:weight:2026-11-15': '75.9', 'dp:water:2026-11-15': '4' };
    const counts = importLegacy(env, Buffer.from(JSON.stringify(raw)).toString('base64'));
    expect(counts).toMatchObject({ days: 1, meals: 1, weights: 1 });
    const v = todayView(env);
    expect([v.sum.eaten, v.weight, v.day.water_cups]).toEqual([295, 75.9, 4]);
  });

  it('skips a meal at 0 kcal, moves focus on, and undoes', async () => {
    const { env } = await makeEnv();
    env.store.put('days', { date: '2026-11-15', wake_min: 9 * 60, scenario: 'home' });
    const undo = skipMeal(env, '2026-11-15', 'breakfast');
    let v = todayView(env);
    expect(v.skipped.has('breakfast')).toBe(true);
    expect(v.sum.total).toBe(1390 - 295);
    expect(v.next?.key).toBe('lunch');
    expect(timeline(env, v).find((x) => x.id === 'breakfast')!.state).toBe('skipped');
    const f = focusNow(env, v);
    expect(f.kind === 'meal' && f.meal.key).toBe('lunch');
    undo();
    v = todayView(env);
    expect(v.skipped.size).toBe(0);
    expect(v.sum.total).toBe(1390);
  });

  it('merges the same meal checked on two devices into one row', async () => {
    const a = await makeEnv();
    const b = await makeEnv();
    toggleMeal(a.env, '2026-11-15', 'breakfast');
    toggleMeal(b.env, '2026-11-15', 'breakfast');
    const ra = a.env.store.all<{ id: string }>('meal_entries')[0]!;
    const rb = b.env.store.all<{ id: string }>('meal_entries')[0]!;
    expect(ra.id).toBe(rb.id);
    // b receives a's row: still one breakfast, counted once
    b.env.store.applyRemote('meal_entries', { ...ra, updated_at: '2099-01-01T00:00:00Z' });
    expect(todayView(b.env).sum.eaten).toBe(295);
  });

  it('counts a slot once even when old random-id duplicates exist', async () => {
    const { env } = await makeEnv();
    const base = { date: '2026-11-15', slot: 'breakfast', kind: 'plan', eaten_at: null, food_id: null, name: '아침', servings: null, amount_text: null, items: null, kcal: 295, protein_g: 21, source: 'plan', photo_path: null, confidence: 1, note: null, deleted_at: null };
    env.store.applyRemote('meal_entries', { ...base, id: 'dup-1', updated_at: '2026-11-15T01:00:00Z' });
    env.store.applyRemote('meal_entries', { ...base, id: 'dup-2', updated_at: '2026-11-15T02:00:00Z' });
    expect(todayView(env).sum.eaten).toBe(295);
  });
});
