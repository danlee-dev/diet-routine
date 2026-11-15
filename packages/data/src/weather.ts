// Rain on a walking day: suggest the home workout that is due instead. Each app fetches the forecast
// (Open-Meteo, no key) for the device's coarse location when the user allows it, otherwise for the city in Settings.
import { cityById, DEFAULT_CITY, rainCheck, rainText, type City, type HourRain, type ProfileRow, type RainCheck, type RoutineKey, type WorkoutRow } from '@diet/core';
import type { Env, TodayView, Undo } from './model';
import { setTodaySession } from './plan';

const prefs = (env: Env) => (env.store.get<ProfileRow>('profiles', 'me')?.preferences ?? {}) as Record<string, unknown>;

/** The city for forecasts when the device location is not used (synced with the profile). */
export const weatherCity = (env: Env): City => cityById(typeof prefs(env).weather_city === 'string' ? (prefs(env).weather_city as string) : DEFAULT_CITY);

export function setWeatherCity(env: Env, id: string): void {
  const p = env.store.get<ProfileRow>('profiles', 'me');
  if (!p) return;
  env.store.put<ProfileRow>('profiles', { ...p, preferences: { ...(p.preferences ?? {}), weather_city: cityById(id).id } });
}

/** The routine done longer ago (A when neither has been done). */
export function dueRoutine(env: Env): RoutineKey {
  const last = (type: WorkoutRow['type']) => env.store.where<WorkoutRow>('workouts', (w) => w.type === type).reduce((a, w) => (w.date > a ? w.date : a), '');
  return last('home_b') < last('home_a') ? 'B' : 'A';
}

export interface RainSuggestion { routine: RoutineKey; text: string; check: RainCheck }

/** On a walking day with rain while one would walk, the home workout to do instead. */
export function rainSuggestion(env: Env, v: TodayView, hours: HourRain[]): RainSuggestion | null {
  if (v.session !== 'walk' || v.nowMin >= 20 * 60) return null;
  const check = rainCheck(hours, v.ctx.key, v.nowMin);
  if (!check.rain) return null;
  return { routine: dueRoutine(env), text: rainText(check, v.nowMin), check };
}

/** Swap today's walk for a home workout (one day only). */
export const swapWalkForWorkout = (env: Env, routine: RoutineKey): Undo =>
  setTodaySession(env, routine, 'user', '비 예보가 있어 걷기 대신 홈트를 합니다');
