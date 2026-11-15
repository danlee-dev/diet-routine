import { describe, expect, it } from 'vitest';
import { addDays, DEFAULT_PROGRAM, keyOf, parseKey, rebalance, type WeightRow } from '@diet/core';
import {
  applyOvershootCarry, applyRebalance, DataStore, dayIntake, logFood, mealsFor, overshootInfo, programFromStore, reminderDone, reminderExtras,
  reminderOutcomes, setWater, setWeight, skipMeal, skipProposal, todaySuggestions, todayView, toggleMeal, weeklyRecapFor, weightInsight,
  adaptiveProposal, completeWorkout, rebalanceToday, type Env,
} from '../src';

// 2026-12-01 is a Tuesday; the built-in program starts 2026-11-15
const makeEnv = async (now = new Date(2026, 11, 1, 12, 0), withProfile = false) => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  const env: Env = withProfile
    ? { store, get program() { return programFromStore(store); }, now: () => now, newId: () => `id-${++n}` }
    : { store, program: DEFAULT_PROGRAM, now: () => now, newId: () => `id-${++n}` };
  return env;
};
const key = (env: Env, n: number) => keyOf(addDays(env.now(), n));
const eatAll = (env: Env, date: string) => { for (const m of mealsFor(env, date)) toggleMeal(env, date, m.key); };

describe('day intake', () => {
  it('adds up a day and knows when every meal was logged', async () => {
    const env = await makeEnv();
    const y = key(env, -1);
    expect(dayIntake(env, y).complete).toBe(false);
    eatAll(env, y);
    const d = dayIntake(env, y);
    expect(d.complete).toBe(true);
    expect(d.kcal).toBe(mealsFor(env, y).reduce((s, m) => s + m.kcal, 0));
    expect(d.target).toBe(DEFAULT_PROGRAM.baseKcal);
  });
});

describe('the morning after an overshoot', () => {
  it('proposes splitting yesterday\'s excess from today and writes it on accept', async () => {
    const env = await makeEnv();
    const y = key(env, -1);
    eatAll(env, y);
    logFood(env, { date: y, slot: 'extra', name: '후라이드 치킨', amount: '반 마리', kcal: 900, protein: 50, source: 'preset' });
    const o = overshootInfo(env)!;
    // the planned day adds up to the target, so the chicken is the whole excess
    expect(dayIntake(env, y, { beforeCarry: true }).target).toBe(DEFAULT_PROGRAM.baseKcal);
    expect(o.over).toBe(dayIntake(env, y).kcal - DEFAULT_PROGRAM.baseKcal);
    expect(o.applied).toBe(false);
    expect(o.carry).toEqual([{ offset: 0, kcal: 190 }, { offset: 1, kcal: 190 }, { offset: 2, kcal: 190 }]);
    const s = todaySuggestions(env).find((x) => x.kind === 'carry')!;
    expect(s.accept).toBe('3일에 나누기');
    const undo = s.apply();
    expect(todayView(env).target).toBe(DEFAULT_PROGRAM.baseKcal - 190);
    expect(overshootInfo(env)!.applied).toBe(true);
    expect(todaySuggestions(env).some((x) => x.kind === 'carry')).toBe(false);
    // pressing it twice (card and notification) writes nothing more
    applyOvershootCarry(env);
    expect(todayView(env).target).toBe(DEFAULT_PROGRAM.baseKcal - 190);
    undo();
    expect(todayView(env).target).toBe(DEFAULT_PROGRAM.baseKcal);
  });

  it('describes a carry-over already applied by yesterday\'s rebalance card', async () => {
    const y = new Date(2026, 10, 30, 21, 0);
    const env = await makeEnv(y);
    const yk = keyOf(y);
    eatAll(env, yk);
    logFood(env, { date: yk, slot: 'extra', name: '짜장면', amount: '1그릇', kcal: 800, protein: 20, source: 'preset' });
    applyRebalance(env, rebalanceToday(env, todayView(env)));
    const next = { ...env, now: () => new Date(2026, 11, 1, 8, 0) };
    const o = overshootInfo(next)!;
    expect(o.applied).toBe(true);
    expect(o.over).toBe(800);
    expect(o.carry.map((c) => c.offset)).toEqual([0, 1, 2]);
    expect(todaySuggestions(next).some((x) => x.kind === 'carry')).toBe(false);
    expect(reminderExtras(next, todayView(next)).overshoot?.applied).toBe(true);
    // the rebalance proposal and the morning-after split agree on the amounts
    expect(o.carry.map((c) => c.kcal)).toEqual(rebalance({ meals: [], logged: new Set(), eatenKcal: 2190, eatenProtein: 200, target: 1390, proteinFloor: 110, appliedCuts: new Set() }).carry.map((c) => c.kcal));
  });

  it('says nothing after an ordinary day or an unlogged one', async () => {
    const env = await makeEnv();
    expect(overshootInfo(env)).toBeNull();
    eatAll(env, key(env, -1));
    expect(overshootInfo(env)).toBeNull();
  });
});

describe('skip pattern', () => {
  it('proposes dropping weekday breakfast and applies it to weekdays only', async () => {
    const env = await makeEnv();
    for (let i = 1; i <= 14; i++) {
      const d = key(env, -i);
      const dow = parseKey(d).getDay();
      for (const m of mealsFor(env, d)) {
        if (m.key === 'breakfast' && dow >= 1 && dow <= 5) skipMeal(env, d, m.key);
        else toggleMeal(env, d, m.key);
      }
    }
    const p = skipProposal(env)!;
    expect(p.pattern).toMatchObject({ slot: 'breakfast', into: 'lunch', weekdays: true });
    const s = todaySuggestions(env).find((x) => x.kind === 'skip')!;
    expect(s.title).toBe('평일 아침 빼고 점심 늘릴까요?');
    const before = todayView(env).meals.reduce((a, m) => a + m.kcal, 0);
    const undo = s.apply();
    const tue = todayView(env);
    expect(tue.meals.some((m) => m.key === 'breakfast')).toBe(false);
    expect(tue.meals.reduce((a, m) => a + m.kcal, 0)).toBe(before);
    expect(tue.meals.find((m) => m.key === 'lunch')!.edited).toBe('아침 몫을 더했습니다');
    const sat = mealsFor(env, key(env, 4)); // Saturday
    expect(sat.some((m) => m.key === 'breakfast')).toBe(true);
    undo();
    expect(todayView(env).meals.some((m) => m.key === 'breakfast')).toBe(true);
  });
});

describe('adaptive target', () => {
  it('estimates maintenance from complete days, and never proposes going lower from under the minimum', async () => {
    const env = await makeEnv(new Date(2026, 11, 1, 12, 0), true);
    // the owner's install: profile adopted on first change
    for (let i = 1; i <= 14; i++) {
      const d = key(env, -i);
      eatAll(env, d);
      env.store.put<WeightRow>('weights', { date: d, kg: Math.round((75 - 0.03 * (14 - i)) * 10) / 10, source: 'manual' } as WeightRow);
    }
    const w = weightInsight(env);
    expect(w.maintenance!.days).toBe(14);
    // losing about 0.2 kg a week on ~1,390: maintenance near 1,600, so the plan is too slow
    // 1,390 is already under the 1,500 minimum: never proposed lower
    expect(adaptiveProposal(env)).toBeNull();
  });

  it('writes the new target to the profile, with undo', async () => {
    const env = await makeEnv(new Date(2026, 11, 1, 12, 0), true);
    const { setBaseKcal } = await import('../src');
    const undo = setBaseKcal(env, 1500);
    expect(env.program.baseKcal).toBe(1500);
    expect(todayView(env).target).toBe(1500);
    undo();
    expect(env.program.baseKcal).toBe(DEFAULT_PROGRAM.baseKcal);
  });

  it('suggests a change when the record shows the target is off', async () => {
    const env = await makeEnv(new Date(2026, 11, 1, 12, 0), true);
    const { setBaseKcal } = await import('../src');
    setBaseKcal(env, 1900);
    for (let i = 1; i <= 14; i++) {
      const d = key(env, -i);
      eatAll(env, d);
      logFood(env, { date: d, slot: 'extra', name: '현미밥', amount: '1공기', kcal: 510, protein: 6, source: 'manual' });
      env.store.put<WeightRow>('weights', { date: d, kg: Math.round((76 - 0.02 * (14 - i)) * 10) / 10, source: 'manual' } as WeightRow);
    }
    const s = todaySuggestions(env).find((x) => x.kind === 'target')!;
    expect(s).toBeDefined();
    expect(s.title).toMatch(/^하루 목표를 1,\d{3}kcal로 바꿀까요\?$/);
    const undo = s.apply();
    expect(env.program.baseKcal).toBeLessThan(1900);
    undo();
    expect(env.program.baseKcal).toBe(1900);
  });
});

describe('weight insight', () => {
  it('explains a jump after eating out yesterday', async () => {
    const env = await makeEnv();
    for (let i = 7; i >= 1; i--) setWeight(env, key(env, -i), 74.4 - 0.05 * (7 - i));
    logFood(env, { date: key(env, -1), slot: 'lunch', name: '짬뽕', amount: '1그릇', kcal: 750, protein: 30, source: 'preset' });
    setWeight(env, key(env, 0), 75.0);
    const w = weightInsight(env);
    expect(w.water!.title).toBe('외식 다음 날의 물 무게입니다');
    expect(w.water!.body).toContain('어제 먹은 짬뽕 때문에');
    expect(w.now).not.toBeNull();
  });
});

describe('weekly recap', () => {
  it('summarizes the week: kept days, workouts, runs and the trend', async () => {
    const env = await makeEnv(new Date(2026, 10, 29, 20, 0)); // Sunday
    for (let i = 0; i < 7; i++) {
      const d = key(env, -i);
      if (i !== 3) eatAll(env, d);
      setWeight(env, d, 75 - 0.1 * (6 - i));
    }
    completeWorkout(env, key(env, -2), 'A', { rounds: 3, startedAt: new Date(2026, 10, 27, 18), endedAt: new Date(2026, 10, 27, 18, 25) });
    env.store.put('runs', { id: 'r1', kind: 'run', started_at: new Date(2026, 10, 28, 7).toISOString(), ended_at: null, distance_m: 3200, moving_s: 1200, elapsed_s: 1250, avg_pace_s_per_km: 375, kcal: 220, elev_gain_m: null, avg_cadence: null, splits: null, polyline: null, bbox: null, new_distance_m: null, closed_area_m2: null, health_uuid: null });
    const r = weeklyRecapFor(env);
    expect(r.from).toBe('2026-11-23');
    expect(r.days).toBe(7);
    expect(r.kept).toBeGreaterThanOrEqual(5);
    expect(r.workouts).toBe(1);
    expect(r.runs).toBe(1);
    expect(r.runKm).toBe(3.2);
    expect(r.best).not.toBeNull();
    const ex = reminderExtras(env, todayView(env));
    expect(ex.weekly?.title).toBe('이번 주 리포트');
    expect(ex.weekly?.body).toContain('지킨 날');
  });
});

describe('reminder outcomes', () => {
  it('counts a reminder as acted on when its subject was done, even without a tap', async () => {
    const env = await makeEnv();
    const y = key(env, -1);
    toggleMeal(env, y, 'lunch');
    setWater(env, y, 3);
    expect(reminderDone(env, `${y}:meal:lunch`)).toBe(true);
    expect(reminderDone(env, `${y}:meal:breakfast`)).toBe(false);
    expect(reminderDone(env, `${y}:water:4`)).toBe(false);
    expect(reminderDone(env, `${y}:water:2`)).toBe(true);
    const at = (d: string) => parseKey(d).getTime() + 12 * 3600_000;
    const today = key(env, 0);
    const out = reminderOutcomes(env, {
      [`${y}:meal:lunch`]: at(y), [`${y}:meal:breakfast`]: at(y), [`${y}:water:4`]: at(y),
      [`${today}:water:2`]: at(today) - 3600_000, [`${today}:meal:dinner`]: at(today) + 7 * 3600_000,
    }, new Set([`${y}:water:4`]));
    expect(out).toEqual([
      { date: y, kind: 'meal', acted: true },
      { date: y, kind: 'meal', acted: false },
      { date: y, kind: 'water', acted: true },
    ]);
  });
});
