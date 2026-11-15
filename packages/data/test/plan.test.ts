import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM } from '@diet/core';
import { DataStore, setMealOverride, setRoutineItems, setTodaySession, setWeekDay, todayView, workoutPlan, type Env } from '../src';

const makeEnv = async () => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  // 2026-11-15 is a Sunday (rest day in the built-in week)
  const env: Env = { store, program: DEFAULT_PROGRAM, now: () => new Date(2026, 10, 15, 12, 0), newId: () => `id-${++n}` };
  return env;
};

describe('editable plan', () => {
  it('changes the weekly schedule and undoes it', async () => {
    const env = await makeEnv();
    expect(todayView(env).session).toBe('rest');
    const undo = setWeekDay(env, 0, 'B');
    const v = todayView(env);
    expect(v.week[0]).toEqual({ t: 'B', label: 'B' });
    expect(v.session).toBe('B');
    expect(workoutPlan(env, v)?.routine).toBe('B');
    undo();
    expect(todayView(env).session).toBe('rest');
  });

  it('keeps one plan version per day and stacks edits', async () => {
    const env = await makeEnv();
    setWeekDay(env, 1, 'walk');
    setRoutineItems(env, 'A', [{ name: '푸시업', n: 15, unit: '회' }]);
    const v = todayView(env);
    expect(env.store.all('plans')).toHaveLength(1);
    expect(v.week[1]!.t).toBe('walk');
    expect(v.routines.A.items).toEqual([{ name: '푸시업', n: 15, unit: '회' }]);
    expect(v.routines.B.items.length).toBeGreaterThan(1);
  });

  it('a one-day session change beats the weekly plan only today', async () => {
    const env = await makeEnv();
    setTodaySession(env, 'A');
    setTodaySession(env, 'walk');
    const v = todayView(env);
    expect(v.session).toBe('walk');
    expect(env.store.all('plan_adjustments')).toHaveLength(1);
  });

  it('removing a meal drops it from the day and the totals', async () => {
    const env = await makeEnv();
    const before = todayView(env);
    setMealOverride(env, 'snack', { removed: true, note: '간식 빼기' });
    const after = todayView(env);
    expect(after.meals.find((m) => m.key === 'snack')).toBeUndefined();
    expect(after.sum.total).toBeLessThan(before.sum.total);
  });
});

describe('eating part of a meal', () => {
  it('drops the skipped item and its numbers, in one row per slot', async () => {
    const { eatPartial } = await import('../src');
    const env = await makeEnv();
    eatPartial(env, '2026-11-15', 'snack', [true, false]); // chicken yes, nuts no
    const v = todayView(env);
    expect(v.sum.eaten).toBe(110);
    expect(v.sum.eatenProtein).toBe(23);
    expect(v.entries.filter((e) => e.slot === 'snack')).toHaveLength(1);
    expect(v.eaten.has('snack')).toBe(true);
  });

  it('checks an edited meal with the edited numbers', async () => {
    const { toggleMeal } = await import('../src');
    const env = await makeEnv();
    setMealOverride(env, 'snack', { items: [{ name: '헬로틴 저염 닭가슴살', amount: '1팩' }], kcal: 110, protein: 23 });
    toggleMeal(env, '2026-11-15', 'snack');
    expect(todayView(env).sum.eaten).toBe(110);
  });
});

describe('rebalance today', () => {
  it('proposes cuts after a big extra meal and lands closer to target once applied', async () => {
    const { logFood, rebalanceToday, applyRebalance, rebalanceWorthShowing } = await import('../src');
    const env = await makeEnv();
    logFood(env, { date: '2026-11-15', slot: 'extra', name: '후라이드 치킨', amount: '반 마리', kcal: 600, protein: 35, source: 'preset' });
    const v = todayView(env);
    const p = rebalanceToday(env, v);
    expect(p.over).toBeGreaterThan(100);
    expect(rebalanceWorthShowing(p)).toBe(true);
    applyRebalance(env, p);
    const after = rebalanceToday(env, todayView(env));
    expect(after.over).toBeLessThan(p.over);
  });
});

describe('over causes', () => {
  it('names food logged on top of the plan, not partial meals', async () => {
    const { logFood, overCauses, eatPartial } = await import('../src');
    const env = await makeEnv();
    eatPartial(env, '2026-11-15', 'snack', [true, false]);
    logFood(env, { date: '2026-11-15', slot: 'extra', name: '후라이드 치킨', amount: '반 마리', kcal: 1150, protein: 70, source: 'preset' });
    expect(overCauses(todayView(env))).toEqual([{ name: '후라이드 치킨', kcal: 1150 }]);
  });
});
