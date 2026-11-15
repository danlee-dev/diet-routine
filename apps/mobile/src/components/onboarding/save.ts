// Saving the plan. New users: completeOnboarding (profile + first plan + today's weight); the root layout's
// gate then moves them to Today. "내 정보 다시 입력": replacePlan for the plan, plus the profile fields that the
// targets come from, so Today's kcal and protein match the new meals. History and the start date are kept;
// the program is extended so it ends the chosen number of weeks from today. Both writes undo together.
// TODO(coordinator): move updateAnswers into @diet/data next to completeOnboarding when the web gets this flow.
import { daysBetween, parseKey, type GeneratedPlan, type OnboardingAnswers, type ProfileRow } from '@diet/core';
import { completeOnboarding, profileOf, replacePlan, type Env } from '@diet/data';

export function saveNew(env: Env, a: OnboardingAnswers, g: GeneratedPlan, source: 'user' | 'ai'): void {
  completeOnboarding(env, a, g, source);
}

export function updateAnswers(env: Env, a: OnboardingAnswers, g: GeneratedPlan, source: 'user' | 'ai'): () => void {
  const undoPlan = replacePlan(env, g, source);
  const prev = profileOf(env.store);
  if (!prev) return undoPlan;
  const before: ProfileRow = { ...prev };
  const elapsed = Math.max(0, daysBetween(parseKey(prev.start_date), env.now()));
  env.store.put<ProfileRow>('profiles', {
    ...prev,
    display_name: a.name?.trim() || null,
    height_cm: a.heightCm,
    goal_weight: a.goalWeightKg,
    base_kcal: g.targets.kcal,
    protein_floor: g.targets.proteinFloor,
    days: elapsed + g.targets.days,
    sex: a.sex,
    birth_year: env.now().getFullYear() - a.age,
    activity: a.activity,
    preferences: {
      ...(prev.preferences ?? {}),
      allergies: a.allergies, dislikes: a.dislikes, cooking: a.cooking, eatingOut: a.eatingOut,
      workoutPlace: a.workoutPlace, workoutDays: a.workoutDays, budgetWeek: a.budgetWeek, wakeMin: a.wakeMin,
    },
    onboarding: { ...a, endWeightKg: g.targets.endWeightKg, tdee: g.targets.tdee },
  });
  return () => {
    env.store.put<ProfileRow>('profiles', before);
    undoPlan();
  };
}
