// Daily targets for any user: energy needs from body stats, a safe deficit, a protein floor, and the
// weekly weight band the charts draw. Pure functions; the owner's own numbers stay in their profile.
import { TARGET_BAND, TARGETS } from './data';
import { addDays, keyOf } from './util';
import type { Program } from './program';

export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'active';

export interface BodyInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  goalWeightKg: number;
  /** program length in weeks */
  weeks: number;
  activity: Activity;
}

export interface Targets {
  bmr: number;
  tdee: number;
  kcal: number;
  proteinFloor: number;
  /** kcal below maintenance per day */
  deficit: number;
  /** expected loss per week at this deficit */
  weeklyLossKg: number;
  /** expected weight at the end of the program */
  endWeightKg: number;
  days: number;
  /** the goal is faster than is safe; the plan uses the safe pace instead */
  paceCapped: boolean;
  /** the computed intake fell under the minimum and was raised */
  floorApplied: boolean;
}

export const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, active: 1.55 };
export const ACTIVITY_LABEL: Record<Activity, string> = { sedentary: '거의 앉아서 지냅니다', light: '하루 30분쯤 걷습니다', active: '서서 일하거나 운동을 자주 합니다' };
const KCAL_PER_KG = 7700;
export const MIN_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

const round10 = (n: number) => Math.round(n / 10) * 10;
const round5 = (n: number) => Math.round(n / 5) * 5;

/** Mifflin-St Jeor resting energy. */
export const bmrOf = (b: Pick<BodyInput, 'sex' | 'age' | 'heightCm' | 'weightKg'>): number =>
  10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age + (b.sex === 'male' ? 5 : -161);

export function computeTargets(b: BodyInput): Targets {
  const bmr = bmrOf(b);
  const tdee = bmr * ACTIVITY_FACTOR[b.activity];
  const days = Math.max(7, Math.round(b.weeks * 7));
  const toLose = Math.max(0, b.weightKg - b.goalWeightKg);
  const needed = (toLose * KCAL_PER_KG) / days;
  // safe ceiling: at most 25% under maintenance, 750 kcal, or about 1% of body weight a week
  const maxDeficit = Math.min(tdee * 0.25, 750, (b.weightKg * 0.01 * KCAL_PER_KG) / 7);
  const paceCapped = needed > maxDeficit;
  let kcal = round10(tdee - Math.min(needed, maxDeficit));
  const floor = MIN_KCAL[b.sex];
  const floorApplied = kcal < floor;
  kcal = Math.max(kcal, floor);
  const deficit = Math.max(0, Math.round(tdee - kcal));
  const weeklyLossKg = Math.round(((deficit * 7) / KCAL_PER_KG) * 10) / 10;
  const endWeightKg = Math.round((b.weightKg - (deficit * days) / KCAL_PER_KG) * 10) / 10;
  // 1.6 g per kg of goal weight keeps muscle during a cut; bounded for very small or large bodies
  const proteinFloor = round5(Math.min(160, Math.max(60, b.goalWeightKg * 1.6)));
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), kcal, proteinFloor, deficit, weeklyLossKg, endWeightKg, days, paceCapped, floorApplied };
}

/** Program for a new user starting today. */
export function programFor(b: BodyInput, t: Targets, start: Date): Program {
  return {
    startDate: keyOf(start), days: t.days, startWeight: b.weightKg, goalWeight: b.goalWeightKg, heightCm: b.heightCm,
    baseKcal: t.kcal, proteinFloor: t.proteinFloor, endWeight: t.endWeightKg,
  };
}

/**
 * Weekly target band for the chart: a straight line from the start weight to the end weight the program aims
 * for, ±0.5 kg. Same [dayIndex, kg][] shape as the owner's built-in band.
 */
export function targetBandFor(p: Program): { upper: [number, number][]; lower: [number, number][] } {
  const end = Math.max(p.goalWeight, p.endWeight ?? p.startWeight - expectedLoss(p));
  const pts: number[] = [];
  for (let i = 0; i < p.days; i += 7) pts.push(i);
  if (pts[pts.length - 1] !== p.days - 1) pts.push(p.days - 1);
  const at = (i: number) => p.startWeight + ((end - p.startWeight) * i) / Math.max(1, p.days - 1);
  return {
    upper: pts.map((i) => [i, Math.round((at(i) + (i === 0 ? 0 : 0.5)) * 10) / 10]),
    lower: pts.map((i) => [i, Math.round((at(i) - (i === 0 ? 0 : 0.5)) * 10) / 10]),
  };
}

/** Text for "이번 주 목표" (week is 1-based). */
export function weekTargetText(p: Program, week: number): string {
  const band = targetBandFor(p);
  const i = Math.min(band.upper.length - 1, Math.max(0, week));
  const lo = band.lower[i]![1], hi = band.upper[i]![1];
  return lo === hi ? `${lo}kg` : `${lo}~${hi}kg`;
}

/** Rough total loss the program's own calorie target implies (used when the goal is beyond reach). */
function expectedLoss(p: Program): number {
  // without body stats here, assume the base target sits ~500 kcal under maintenance
  return (500 * p.days) / KCAL_PER_KG;
}

/** The chart band for any program: the owner's hand-made band, or a straight line for new users. */
export const bandFor = (p: Program): { upper: [number, number][]; lower: [number, number][] } =>
  p.endWeight == null ? { upper: [...TARGET_BAND.upper] as [number, number][], lower: [...TARGET_BAND.lower] as [number, number][] } : targetBandFor(p);

/** "이번 주 목표" text for any program. */
export const weekGoalText = (p: Program, week: number): string =>
  p.endWeight == null ? TARGETS[Math.min(week, TARGETS.length - 1)]!.text : weekTargetText(p, week);

export const programEnd = (p: Program): string => {
  const [y, m, d] = p.startDate.split('-').map(Number);
  return keyOf(addDays(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1), p.days - 1));
};
