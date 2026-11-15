// Onboarding answers while they are being filled in: defaults, prefill from an existing profile, the step list
// grouped into chapters, and the running summary line. All numbers come from @diet/core.
import {
  computeTargets, fmt, hhmm, type Activity, type Allergen, type Cooking, type EatingOut, type OnboardingAnswers,
  type ProfileRow, type Sex, type WeightRow, type WorkoutPlace,
} from '@diet/core';
import { profileOf, type Env } from '@diet/data';

export type Draft = Omit<OnboardingAnswers, 'sex'> & { sex: Sex | null };

export type StepId =
  | 'name' | 'sex' | 'age' | 'height' | 'weight' | 'weeks' | 'activity' | 'wake' | 'eatout' | 'cooking' | 'avoid' | 'workout' | 'budget';

export const CHAPTERS: { label: string; steps: StepId[] }[] = [
  // activity comes before the goal so the period step already shows the real kcal
  { label: '나', steps: ['name', 'sex', 'age', 'height', 'activity'] },
  { label: '목표', steps: ['weight', 'weeks'] },
  { label: '생활', steps: ['wake', 'eatout'] },
  { label: '식사·운동', steps: ['cooking', 'avoid', 'workout', 'budget'] },
];
export const STEPS: StepId[] = CHAPTERS.flatMap((c) => c.steps);
export const chapterOf = (s: StepId): number => CHAPTERS.findIndex((c) => c.steps.includes(s));

/** Typical starting values; height and weight move to the chosen sex's average until the user touches them. */
export const BODY_DEFAULT: Record<Sex, { heightCm: number; weightKg: number; goalWeightKg: number }> = {
  male: { heightCm: 174, weightKg: 78, goalWeightKg: 72 },
  female: { heightCm: 161, weightKg: 60, goalWeightKg: 55 },
};

export const emptyDraft = (): Draft => ({
  name: '', sex: null, age: 30, heightCm: 168, weightKg: 70, goalWeightKg: 64, weeks: 8, activity: 'light',
  wakeMin: 7 * 60, eatingOut: 'rarely', cooking: 'microwave', allergies: [], dislikes: [],
  workoutPlace: 'home', workoutDays: 3, budgetWeek: 80000,
});

export const answersOf = (d: Draft): OnboardingAnswers => ({ ...d, sex: d.sex ?? 'male', name: d.name?.trim() || undefined });

const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const oneOf = <T extends string>(x: unknown, all: readonly T[], d: T): T => (all.includes(x as T) ? (x as T) : d);

/** "내 정보 다시 입력": the saved answers, with today's weight from the latest record. */
export function draftFromProfile(env: Env): Draft {
  const d = emptyDraft();
  const p: ProfileRow | undefined = profileOf(env.store);
  if (!p) return d;
  const a = (p.onboarding ?? {}) as Partial<OnboardingAnswers>;
  const pref = (p.preferences ?? {}) as Partial<OnboardingAnswers>;
  const latest = env.store.all<WeightRow>('weights').sort((x, y) => (x.date < y.date ? 1 : -1))[0];
  const year = env.now().getFullYear();
  return {
    name: a.name ?? p.display_name ?? '',
    sex: oneOf<Sex>(a.sex ?? p.sex, ['male', 'female'], 'male'),
    age: num(a.age, p.birth_year ? year - Number(p.birth_year) : d.age),
    heightCm: num(a.heightCm, Number(p.height_cm) || d.heightCm),
    weightKg: latest ? Number(latest.kg) : num(a.weightKg, Number(p.start_weight) || d.weightKg),
    goalWeightKg: num(a.goalWeightKg, Number(p.goal_weight) || d.goalWeightKg),
    weeks: [4, 8, 12].includes(num(a.weeks, 8)) ? num(a.weeks, 8) : 8,
    activity: oneOf<Activity>(a.activity ?? p.activity, ['sedentary', 'light', 'active'], 'light'),
    wakeMin: num(a.wakeMin ?? pref.wakeMin, d.wakeMin),
    eatingOut: oneOf<EatingOut>(a.eatingOut ?? pref.eatingOut, ['rarely', 'lunch', 'dinner', 'often'], d.eatingOut),
    cooking: oneOf<Cooking>(a.cooking ?? pref.cooking, ['none', 'microwave', 'basic'], d.cooking),
    allergies: (Array.isArray(a.allergies ?? pref.allergies) ? (a.allergies ?? pref.allergies)! : []) as Allergen[],
    dislikes: Array.isArray(a.dislikes ?? pref.dislikes) ? (a.dislikes ?? pref.dislikes)! : [],
    workoutPlace: oneOf<WorkoutPlace>(a.workoutPlace ?? pref.workoutPlace, ['home', 'gym', 'walk'], d.workoutPlace),
    workoutDays: num(a.workoutDays ?? pref.workoutDays, d.workoutDays),
    budgetWeek: num(a.budgetWeek ?? pref.budgetWeek, d.budgetWeek),
  };
}

export const kg1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');

/** The running summary under each question: what the plan already knows, ending in the day's target once it can. */
export function summaryOf(d: Draft, reached: number): string[] {
  const seen = (s: StepId) => STEPS.indexOf(s) < reached;
  const parts: string[] = [];
  // the day's target leads once it is known, so it never falls off the two visible lines
  if (d.sex && seen('weeks')) parts.push(`하루 ${fmt(computeTargets(answersOf(d)).kcal)}kcal`);
  if (d.name?.trim() && seen('name')) parts.push(d.name.trim());
  if (d.sex && seen('sex')) parts.push(d.sex === 'male' ? '남성' : '여성');
  if (seen('age')) parts.push(`${d.age}세`);
  if (seen('height')) parts.push(`${d.heightCm}cm`);
  if (seen('weight')) parts.push(`${kg1(d.weightKg)} → ${kg1(d.goalWeightKg)}kg`);
  if (seen('weeks')) parts.push(`${d.weeks}주`);
  if (seen('wake')) parts.push(`${hhmm(d.wakeMin)} 기상`);
  if (seen('budget') && d.budgetWeek > 0) parts.push(`주 ${fmt(Math.round(d.budgetWeek / 10000))}만 원`);
  return parts;
}
