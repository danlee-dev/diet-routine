import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM, generatePlan, type OnboardingAnswers } from '@diet/core';
import { adoptLegacyProfile, completeOnboarding, DataStore, profileState, programFromStore, toggleMeal, todayView, type Env } from '../src';

const makeEnv = async () => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  const env = { store, now: () => new Date(2026, 10, 15, 12, 0), newId: () => `id-${++n}`, get program() { return programFromStore(store); } } as Env;
  return env;
};

const answers: OnboardingAnswers = {
  sex: 'female', age: 28, heightCm: 162, weightKg: 64, goalWeightKg: 58, weeks: 8, activity: 'light',
  wakeMin: 7 * 60, eatingOut: 'rarely', cooking: 'microwave', allergies: ['nuts'], dislikes: [], workoutPlace: 'gym', workoutDays: 3, budgetWeek: 80000,
};

describe('profiles', () => {
  it('a fresh install is new; the owner install with records is legacy and keeps the built-in program', async () => {
    const env = await makeEnv();
    expect(profileState(env.store)).toBe('new');
    toggleMeal(env, '2026-11-15', 'breakfast');
    expect(profileState(env.store)).toBe('legacy');
    adoptLegacyProfile(env);
    expect(profileState(env.store)).toBe('ready');
    expect(programFromStore(env.store)).toEqual(DEFAULT_PROGRAM);
  });

  it('onboarding writes a profile and plan that every screen then uses', async () => {
    const env = await makeEnv();
    const g = generatePlan(answers);
    completeOnboarding(env, answers, g);
    const v = todayView(env);
    expect(env.program.baseKcal).toBe(g.targets.kcal);
    expect(env.program.endWeight).toBe(g.targets.endWeightKg);
    expect(v.meals.map((m) => m.items.map((x) => x.name)).flat()).not.toContain('하루견과');
    expect(v.routines.A.name).toBe('헬스 A');
    expect(v.shop.cycle).toHaveLength(0);
    expect(v.weight).toBe(64);
  });
});
