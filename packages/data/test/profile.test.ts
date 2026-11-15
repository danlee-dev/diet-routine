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

describe('signing in to an account that already has a profile', () => {
  // a tiny stand-in for the Supabase client: one stored profile, inserts recorded
  const fakeClient = (remoteProfile: Record<string, unknown> | null) => {
    const upserts: { table: string; rows: Record<string, unknown>[] }[] = [];
    const query = (table: string) => {
      const q = {
        select: () => q, eq: () => q, gt: () => q, order: () => q,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: table === 'profiles' ? remoteProfile : null, error: null }),
        upsert: async (rows: Record<string, unknown>[]) => { upserts.push({ table, rows }); return { error: null }; },
      };
      return q;
    };
    const channel = { on: () => channel, subscribe: () => channel };
    return { client: { from: query, channel: () => channel, removeChannel: async () => {} }, upserts };
  };

  it('keeps the account profile and drops a plan made by onboarding on this device', async () => {
    const env = await makeEnv();
    completeOnboarding(env, answers, generatePlan(answers));
    const remote = { user_id: 'u1', start_date: '2026-10-01', days: 30, start_weight: 80, goal_weight: 74, height_cm: 175, base_kcal: 1700, protein_floor: 120, onboarding: null, updated_at: '2026-10-01T00:00:00Z' };
    const { client, upserts } = fakeClient(remote);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await env.store.attach(client as any, 'u1');
    expect(upserts.some((u) => u.table === 'profiles' || u.table === 'plans')).toBe(false);
    expect(upserts.some((u) => u.table === 'weights')).toBe(true); // the device's records still upload
    expect(programFromStore(env.store).baseKcal).toBe(1700);
  });

  it('uploads the device profile when the account has none yet', async () => {
    const env = await makeEnv();
    completeOnboarding(env, answers, generatePlan(answers));
    const { client, upserts } = fakeClient(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await env.store.attach(client as any, 'u1');
    expect(upserts.some((u) => u.table === 'profiles')).toBe(true);
    expect(upserts.some((u) => u.table === 'plans')).toBe(true);
  });
});
