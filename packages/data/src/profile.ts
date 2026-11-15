// Who the user is: the profile row drives the program (dates, weights, kcal and protein targets) for every
// screen. New users get it from onboarding; the owner's pre-onboarding install gets it from their built-in plan.
import {
  DEFAULT_PROGRAM, keyOf, programFor, type GeneratedPlan, type OnboardingAnswers, type ProfileRow, type Program, type WeightRow,
} from '@diet/core';
import type { Env } from './model';
import type { DataStore, TableName } from './store';
import { savePlan } from './plan';

export const profileOf = (store: DataStore): ProfileRow | undefined => store.all<ProfileRow>('profiles')[0];

/** The program every screen uses. Falls back to the owner's built-in program only before any profile exists. */
export function programFromStore(store: DataStore): Program {
  const p = profileOf(store);
  if (!p) return DEFAULT_PROGRAM;
  const end = Number((p.onboarding as { endWeightKg?: number } | null | undefined)?.endWeightKg);
  return {
    startDate: p.start_date, days: Number(p.days ?? DEFAULT_PROGRAM.days), startWeight: Number(p.start_weight),
    goalWeight: Number(p.goal_weight), heightCm: Number(p.height_cm), baseKcal: Number(p.base_kcal),
    proteinFloor: Number(p.protein_floor), ...(Number.isFinite(end) && end > 0 ? { endWeight: end } : {}),
  };
}

const USAGE: TableName[] = ['days', 'meal_entries', 'weights', 'workouts', 'checklist'];

/**
 * - 'ready': a profile exists.
 * - 'legacy': no profile yet but this device already has records: the owner's install from before onboarding
 *   existed. Call adoptLegacyProfile to keep their plan exactly as it was.
 * - 'new': a fresh install: show welcome and onboarding (or sign in to bring an existing account).
 */
export function profileState(store: DataStore): 'ready' | 'legacy' | 'new' {
  if (profileOf(store)) return 'ready';
  return USAGE.some((t) => store.all(t).length > 0) ? 'legacy' : 'new';
}

/** The owner's first run of the multi-user app: their built-in plan becomes their profile. No plan rows are needed. */
export function adoptLegacyProfile(env: Env): void {
  if (profileOf(env.store)) return;
  const P = DEFAULT_PROGRAM;
  env.store.put<ProfileRow>('profiles', {
    user_id: env.store.currentUserId ?? 'local', display_name: null, height_cm: P.heightCm, start_weight: P.startWeight,
    goal_weight: P.goalWeight, start_date: P.startDate, base_kcal: P.baseKcal, protein_floor: P.proteinFloor, days: P.days,
    timezone: 'Asia/Seoul', preferences: {}, notification_prefs: {}, sex: 'male', birth_year: null, activity: 'sedentary',
    onboarding: null, onboarded_at: new Date().toISOString(), updated_at: '',
  });
}

/** Finish onboarding: profile, the generated plan as the first plan version, and today's weight. */
export function completeOnboarding(env: Env, a: OnboardingAnswers, g: GeneratedPlan, source: 'user' | 'ai' = 'user'): void {
  const today = env.now();
  const program = programFor(a, g.targets, today);
  env.store.put<ProfileRow>('profiles', {
    user_id: env.store.currentUserId ?? 'local', display_name: a.name?.trim() || null,
    height_cm: a.heightCm, start_weight: a.weightKg, goal_weight: a.goalWeightKg, start_date: program.startDate,
    base_kcal: program.baseKcal, protein_floor: program.proteinFloor, days: program.days, timezone: 'Asia/Seoul',
    preferences: {
      allergies: a.allergies, dislikes: a.dislikes, cooking: a.cooking, eatingOut: a.eatingOut,
      workoutPlace: a.workoutPlace, workoutDays: a.workoutDays, budgetWeek: a.budgetWeek, wakeMin: a.wakeMin,
    },
    notification_prefs: {}, sex: a.sex, birth_year: today.getFullYear() - a.age, activity: a.activity,
    onboarding: { ...a, endWeightKg: g.targets.endWeightKg, tdee: g.targets.tdee }, onboarded_at: today.toISOString(), updated_at: '',
  });
  savePlan(env, g.plan, { source, note: source === 'ai' ? '코치가 만든 내 계획' : '온보딩으로 만든 내 계획', from: program.startDate });
  env.store.put<WeightRow>('weights', { date: keyOf(today), kg: a.weightKg, source: 'manual', updated_at: '' } as WeightRow);
}

/** Replace the plan with a regenerated one (e.g. after changing answers in Settings). */
export function replacePlan(env: Env, g: GeneratedPlan, source: 'user' | 'ai'): () => void {
  return savePlan(env, g.plan, { source, note: source === 'ai' ? '코치가 다시 만든 계획' : '답을 바꿔 다시 만든 계획' });
}
