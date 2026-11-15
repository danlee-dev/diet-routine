import { describe, expect, it } from 'vitest';
import { computeTargets, generatePlan, weekFor, type OnboardingAnswers } from '../src';

const base: OnboardingAnswers = {
  sex: 'female', age: 28, heightCm: 162, weightKg: 64, goalWeightKg: 58, weeks: 8, activity: 'light',
  wakeMin: 7 * 60, eatingOut: 'lunch', cooking: 'microwave', allergies: [], dislikes: [], workoutPlace: 'home', workoutDays: 3, budgetWeek: 80000,
};

describe('targets', () => {
  it('keeps a safe deficit and a minimum intake', () => {
    const t = computeTargets(base);
    expect(t.tdee).toBeGreaterThan(1700);
    expect(t.kcal).toBeGreaterThanOrEqual(1200);
    expect(t.deficit).toBeLessThanOrEqual(750);
    expect(t.proteinFloor).toBe(95); // 58 * 1.6 = 92.8 -> 95
  });

  it('caps an unsafe pace and says so', () => {
    const t = computeTargets({ ...base, goalWeightKg: 50, weeks: 4 });
    expect(t.paceCapped).toBe(true);
    expect(t.endWeightKg).toBeGreaterThan(50);
  });
});

describe('generatePlan', () => {
  it('builds five meals near the target with per-item numbers', () => {
    const g = generatePlan(base);
    const meals = Object.values(g.plan.meals ?? {});
    expect(meals).toHaveLength(5);
    expect(Math.abs(g.day.kcal - g.targets.kcal)).toBeLessThanOrEqual(200);
    for (const m of meals) for (const it of m!.items ?? []) expect(it.kcal).toBeTypeOf('number');
    expect(g.plan.shop?.now.length).toBeGreaterThan(0);
    expect(g.plan.shop?.now[0]!.url).toContain('coupang.com/np/search');
  });

  it('respects allergies and dislikes', () => {
    const g = generatePlan({ ...base, allergies: ['egg', 'dairy'], dislikes: ['두부'] });
    const names = Object.values(g.plan.meals ?? {}).flatMap((m) => (m!.items ?? []).map((x) => x.name));
    expect(names.some((n) => n.includes('달걀') || n.includes('요거트') || n.includes('우유') || n === '프로틴' || n.includes('두부'))).toBe(false);
  });

  it('reaches the protein floor', () => {
    const g = generatePlan({ ...base, sex: 'male', weightKg: 90, goalWeightKg: 80, heightCm: 180 });
    expect(g.day.protein).toBeGreaterThanOrEqual(g.targets.proteinFloor - 10);
  });

  it('uses gym routines and a spread-out week', () => {
    const g = generatePlan({ ...base, workoutPlace: 'gym', workoutDays: 3 });
    expect(g.plan.workout?.routines?.A?.name).toBe('헬스 A');
    expect(weekFor('gym', 3)).toEqual({ 0: 'rest', 1: 'A', 2: 'walk', 3: 'B', 4: 'walk', 5: 'A', 6: 'walk' });
    expect(Object.values(weekFor('walk', 4)).every((t) => t === 'walk' || t === 'rest')).toBe(true);
  });
});

describe('carry-over floor', () => {
  it('never plans a day under 1,200 kcal', async () => {
    const { rebalance, MEALS } = await import('../src');
    const meals = (['breakfast', 'lunch', 'snack', 'post', 'dinner'] as const).map((k) => ({ key: k, ...MEALS[k] }));
    const p = rebalance({ meals, logged: new Set(), eatenKcal: 1500, eatenProtein: 60, target: 1290, proteinFloor: 110, appliedCuts: new Set() });
    for (const c of p.carry) expect(1290 - c.kcal).toBeGreaterThanOrEqual(1200);
  });
});
