// Onboarding answers while they are being filled in: sex starts unanswered, everything else has a sensible default.
// Prefill for "내 정보 다시 입력" comes from the saved answers, or from the profile and program for the owner,
// whose profile was adopted from the built-in plan and has no saved answers.
import type { OnboardingAnswers, Sex } from '@diet/core';
import { profileOf, todayView, type Env } from '@diet/data';

export type Draft = Omit<OnboardingAnswers, 'sex'> & { sex: Sex | null };

export const DEFAULT_DRAFT: Draft = {
  name: '', sex: null, age: 30, heightCm: 170, weightKg: 75, goalWeightKg: 68, weeks: 8, activity: 'sedentary',
  wakeMin: 7 * 60, eatingOut: 'rarely', cooking: 'microwave', allergies: [], dislikes: [], workoutPlace: 'home', workoutDays: 3,
  budgetWeek: 70000,
};

const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const snapWeeks = (days: number) => [4, 8, 12].reduce((a, b) => (Math.abs(b * 7 - days) < Math.abs(a * 7 - days) ? b : a), 8);

export function draftFromProfile(env: Env): Draft {
  const p = profileOf(env.store);
  const saved = (p?.onboarding ?? null) as Partial<OnboardingAnswers> | null;
  const v = todayView(env);
  const P = env.program;
  const prefs = (p?.preferences ?? {}) as Partial<OnboardingAnswers>;
  const base: Draft = {
    ...DEFAULT_DRAFT,
    name: p?.display_name ?? '',
    sex: p?.sex ?? null,
    age: p?.birth_year ? new Date().getFullYear() - p.birth_year : DEFAULT_DRAFT.age,
    heightCm: P.heightCm,
    // re-entering mid-program: start from today's weight, not the day-one weight
    weightKg: v.weight ?? v.prevWeight ?? P.startWeight,
    goalWeightKg: P.goalWeight,
    weeks: snapWeeks(P.days),
    activity: p?.activity ?? DEFAULT_DRAFT.activity,
    wakeMin: num(prefs.wakeMin, v.day.wake_min ?? DEFAULT_DRAFT.wakeMin),
  };
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    name: saved.name ?? base.name,
    sex: saved.sex ?? base.sex,
    weightKg: base.weightKg,
    allergies: Array.isArray(saved.allergies) ? saved.allergies : [],
    dislikes: Array.isArray(saved.dislikes) ? saved.dislikes : [],
  };
}

/** Lowest goal we accept: the bottom of the healthy BMI range. */
export const minGoalFor = (heightCm: number) => Math.ceil(18.5 * (heightCm / 100) ** 2 * 10) / 10;

export const toAnswers = (d: Draft): OnboardingAnswers => ({ ...d, sex: d.sex ?? 'male', name: d.name?.trim() || undefined });
