// What the iPhone's widgets, Live Activities and Siri answers read, and what they ask the app to write.
// The app writes a Glance (one small JSON in the App Group) on every store change; the Swift side only
// reads it. Writes made outside the app (a widget button, Siri, a Shortcut) come back as QueuedActions
// that the app applies through the same functions the screens use, so nothing is computed twice.
// Swift mirror: apps/mobile/targets/widget/_shared/Glance.swift (keep field names in sync).
import { DINNER_CUTOFF, keyOf, type MealKey } from '@diet/core';
import { dayRow, setWater, setWeight, todayView, toggleMeal, type Env } from './model';

export const GLANCE_VERSION = 1;
/** The same cap the water pace uses (core expectedCups). */
export const WATER_GOAL = 8;

export interface GlanceMeal {
  key: MealKey;
  name: string;
  /** minutes after midnight; null until the wake time is known */
  at: number | null;
  /** "닭가슴살 큐브 · 현미밥 반 공기" */
  items: string;
  kcal: number;
}

export interface Glance {
  v: typeof GLANCE_VERSION;
  /** epoch ms when the app wrote it */
  at: number;
  /** local day the numbers belong to; the widget treats another day as "open the app" */
  date: string;
  wake: number | null;
  kcal: { eaten: number; target: number; planned: number };
  water: { cups: number; goal: number };
  steps: { count: number; goal: number };
  /** the next meal not eaten yet; null when every meal is done or skipped */
  next: GlanceMeal | null;
  /** dinner cutoff in minutes (20:00) and whether dinner is already logged */
  cutoff: number;
  dinnerDone: boolean;
}

const mealOf = (m: { key: MealKey; name: string; at?: number; items: { name: string }[]; kcal: number }): GlanceMeal => ({
  key: m.key, name: m.name, at: m.at ?? null, items: m.items.map((x) => x.name).join(' · '), kcal: Math.round(m.kcal),
});

export function glance(env: Env): Glance {
  const v = todayView(env);
  return {
    v: GLANCE_VERSION,
    at: env.now().getTime(),
    date: v.ctx.key,
    wake: v.day.wake_min,
    kcal: { eaten: Math.round(v.sum.eaten), target: Math.round(v.target), planned: Math.round(v.sum.total) },
    water: { cups: v.day.water_cups, goal: WATER_GOAL },
    steps: { count: v.day.steps, goal: v.stepsGoal },
    next: v.next ? mealOf(v.next) : null,
    cutoff: DINNER_CUTOFF,
    dinnerDone: v.eaten.has('dinner') || !v.meals.some((m) => m.key === 'dinner'),
  };
}

/** The Glance without its timestamp, to skip writes (and widget reloads) when nothing a widget shows changed. */
export const glanceKey = (g: Glance): string => JSON.stringify({ ...g, at: 0 });

// ---------------- writes from outside the app ----------------
export type QueuedAction =
  | { id: string; at: number; kind: 'water'; delta: number }
  | { id: string; at: number; kind: 'weight'; kg: number }
  | { id: string; at: number; kind: 'eatNext' }
  | { id: string; at: number; kind: 'startRun'; mode: 'run' | 'walk' };

export type QueuedResult = 'applied' | 'ignored' | 'app';

/** Reads one queued action from untrusted JSON; null when it is not one we know. */
export function parseQueued(raw: unknown): QueuedAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : null;
  const at = typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : null;
  if (!id || at == null) return null;
  switch (o.kind) {
    case 'water': return { id, at, kind: 'water', delta: typeof o.delta === 'number' && Number.isFinite(o.delta) ? Math.round(o.delta) : 1 };
    case 'weight': return typeof o.kg === 'number' && Number.isFinite(o.kg) ? { id, at, kind: 'weight', kg: o.kg } : null;
    case 'eatNext': return { id, at, kind: 'eatNext' };
    case 'startRun': return { id, at, kind: 'startRun', mode: o.mode === 'walk' ? 'walk' : 'run' };
    default: return null;
  }
}

/**
 * Apply a data action on the day it was made (a glass tapped at 23:58 belongs to that day even if the app
 * opens after midnight). 'app' means the action is for the app itself (navigation), not for the store.
 */
export function applyQueued(env: Env, a: QueuedAction): QueuedResult {
  const date = keyOf(new Date(a.at));
  switch (a.kind) {
    case 'water':
      setWater(env, date, dayRow(env, date).water_cups + a.delta); // clamps to 0..8 like the screen
      return 'applied';
    case 'weight': {
      if (a.kg < 30 || a.kg > 250) return 'ignored';
      setWeight(env, date, Math.round(a.kg * 10) / 10);
      return 'applied';
    }
    case 'eatNext': {
      // only for today: the "next meal" of a past day is meaningless
      const v = todayView(env);
      if (v.ctx.key !== date || !v.next) return 'ignored';
      toggleMeal(env, date, v.next.key);
      return 'applied';
    }
    case 'startRun':
      return 'app';
  }
}
