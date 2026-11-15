// The 30-day program and "what day is it" math. Everything takes `now` explicitly so it is testable.
import { WEEK, type RoutineKey, type ScenId } from './data';
import { addDays, dateLabel, daysBetween, keyOf, parseKey, startOfDay } from './util';

export interface Program {
  startDate: string; // YYYY-MM-DD
  days: number;
  startWeight: number;
  goalWeight: number;
  heightCm: number;
  /** Base daily target before any adjustment. */
  baseKcal: number;
  proteinFloor: number;
}

export const DEFAULT_PROGRAM: Program = {
  startDate: '2026-11-15',
  days: 30,
  startWeight: 76,
  goalWeight: 70,
  heightCm: 171,
  baseKcal: 1390,
  proteinFloor: 110,
};

export interface DayCtx {
  date: Date;
  key: string;
  /** 0-based index from program start (can be negative or >= days). */
  idx: number;
  /** 1-based day number. */
  no: number;
  /** 1..5 */
  week: number;
  dow: number;
  label: string;
}

export function dayCtx(program: Program, now: Date): DayCtx {
  const date = startOfDay(now);
  const idx = daysBetween(parseKey(program.startDate), date);
  return {
    date,
    key: keyOf(date),
    idx,
    no: idx + 1,
    week: Math.min(5, Math.max(1, Math.floor(Math.max(0, idx) / 7) + 1)),
    dow: date.getDay(),
    label: dateLabel(date),
  };
}

export const programDate = (program: Program, idx: number): Date => addDays(parseKey(program.startDate), idx);
export const programKey = (program: Program, idx: number): string => keyOf(programDate(program, idx));

export const stepsGoal = (week: number): number => (week === 1 ? 4000 : week === 2 ? 5500 : 7000);
export const workoutRounds = (week: number): number => (week === 1 ? 3 : 4);
export const repMultiplier = (week: number): number => (week >= 3 ? 1.2 : 1);

export const defaultScen = (dow: number): ScenId => (dow === 0 || dow === 3 ? 'rest' : 'home');

export const todaysRoutine = (dow: number): RoutineKey | null => {
  const t = WEEK[dow]?.t;
  return t === 'A' || t === 'B' ? t : null;
};
