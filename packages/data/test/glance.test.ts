import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM, type WeightRow } from '@diet/core';
import { applyQueued, DataStore, dayRow, glance, glanceKey, parseQueued, setDay, setWake, todayView, type Env } from '../src';

const makeEnv = async (at = new Date(2026, 10, 15, 12, 0)) => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  let now = at;
  const env: Env & { setNow: (d: Date) => void } = {
    store, program: DEFAULT_PROGRAM, now: () => now, newId: () => `id-${++n}`, setNow: (d) => { now = d; },
  };
  return env;
};

describe('glance', () => {
  it('mirrors the day the Today screen shows', async () => {
    const env = await makeEnv();
    setWake(env, 7 * 60, { lateRule: false });
    setDay(env, '2026-11-15', { water_cups: 3, steps: 4200 });
    const v = todayView(env);
    const g = glance(env);
    expect(g).toMatchObject({ v: 1, date: '2026-11-15', wake: 420, water: { cups: 3, goal: 8 }, steps: { count: 4200, goal: v.stepsGoal }, cutoff: 1200 });
    expect(g.kcal.target).toBe(Math.round(v.target));
    expect(g.next?.key).toBe(v.next?.key);
    expect(g.next?.at).toBe(v.next?.at ?? null);
    expect(g.next?.items).toContain(v.next!.items[0]!.name);
  });

  it('ignores the timestamp when deciding whether anything changed', async () => {
    const env = await makeEnv();
    const a = glance(env);
    env.setNow(new Date(2026, 10, 15, 12, 1));
    expect(glanceKey(glance(env))).toBe(glanceKey(a));
    setDay(env, '2026-11-15', { water_cups: 1 });
    expect(glanceKey(glance(env))).not.toBe(glanceKey(a));
  });
});

describe('queued actions', () => {
  it('rejects malformed entries', () => {
    expect(parseQueued(null)).toBeNull();
    expect(parseQueued({ id: 'a', kind: 'water' })).toBeNull(); // no time
    expect(parseQueued({ id: 'a', at: 1, kind: 'weight', kg: 'x' })).toBeNull();
    expect(parseQueued({ id: 'a', at: 1, kind: 'dance' })).toBeNull();
    expect(parseQueued({ id: 'a', at: 1, kind: 'water' })).toEqual({ id: 'a', at: 1, kind: 'water', delta: 1 });
    expect(parseQueued({ id: 'a', at: 1, kind: 'startRun', mode: 'walk' })).toMatchObject({ mode: 'walk' });
  });

  it('adds water on the day the glass was tapped, capped like the screen', async () => {
    const env = await makeEnv(new Date(2026, 10, 16, 0, 10));
    const lateTap = new Date(2026, 10, 15, 23, 58).getTime();
    setDay(env, '2026-11-15', { water_cups: 7 });
    expect(applyQueued(env, { id: '1', at: lateTap, kind: 'water', delta: 1 })).toBe('applied');
    expect(applyQueued(env, { id: '2', at: lateTap, kind: 'water', delta: 1 })).toBe('applied');
    expect(dayRow(env, '2026-11-15').water_cups).toBe(8);
    expect(dayRow(env, '2026-11-16').water_cups).toBe(0);
  });

  it('logs a spoken weight rounded to 0.1 and refuses nonsense', async () => {
    const env = await makeEnv();
    const at = env.now().getTime();
    expect(applyQueued(env, { id: '1', at, kind: 'weight', kg: 75.43 })).toBe('applied');
    expect(env.store.get<WeightRow>('weights', '2026-11-15')?.kg).toBe(75.4);
    expect(applyQueued(env, { id: '2', at, kind: 'weight', kg: 7.5 })).toBe('ignored');
    expect(env.store.get<WeightRow>('weights', '2026-11-15')?.kg).toBe(75.4);
  });

  it('marks the next meal eaten only for today', async () => {
    const env = await makeEnv();
    setWake(env, 7 * 60, { lateRule: false });
    const first = todayView(env).next!.key;
    expect(applyQueued(env, { id: '1', at: env.now().getTime(), kind: 'eatNext' })).toBe('applied');
    expect(todayView(env).eaten.has(first)).toBe(true);
    expect(applyQueued(env, { id: '2', at: new Date(2026, 10, 14, 9).getTime(), kind: 'eatNext' })).toBe('ignored');
  });

  it('hands navigation back to the app', async () => {
    const env = await makeEnv();
    expect(applyQueued(env, { id: '1', at: env.now().getTime(), kind: 'startRun', mode: 'run' })).toBe('app');
  });
});
