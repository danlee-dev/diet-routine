// Optional AI pass over the offline plan, for signed-in users.
// POST {API}/api/plan/generate with { answers, baseline } -> a GeneratedPlan, as JSON or as an event stream
// (`status` frames with step labels, then the plan in a `plan` / `result` / `done` frame).
// Anything unexpected (no session, 404, timeout, bad shape) returns null and the offline plan stays.
import { fetch } from 'expo/fetch';
import type { GeneratedPlan, OnboardingAnswers } from '@diet/core';
import { getSupabase } from '@/lib/env';

export const PLAN_URL = `${(process.env.EXPO_PUBLIC_API_URL ?? 'https://diet-routine.vercel.app').replace(/\/$/, '')}/api/plan/generate`;

export interface RefineStep { id: string; label: string; done: boolean }

export async function signedInToken(): Promise<string | null> {
  const supa = getSupabase();
  if (!supa) return null;
  const { data } = await supa.auth.getSession();
  return data.session?.access_token ?? null;
}

const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const MEAL_KEYS = new Set(['breakfast', 'lunch', 'snack', 'post', 'dinner']);

/** Strict enough that a saved AI plan cannot break Today: known meal keys, items with text and numbers. */
const isPlan = (x: unknown): x is GeneratedPlan => {
  const g = x as Partial<GeneratedPlan> | null;
  if (!g || typeof g !== 'object' || !g.plan || typeof g.plan !== 'object') return false;
  const meals = g.plan.meals;
  if (!meals || typeof meals !== 'object' || !Object.keys(meals).length) return false;
  return Object.entries(meals).every(([k, m]) =>
    MEAL_KEYS.has(k) && !!m && typeof m === 'object' && (m.removed === true || (
      num(m.kcal) && num(m.protein) && Array.isArray(m.items) && m.items.length > 0
      && m.items.every((it) => !!it && typeof it.name === 'string' && typeof it.amount === 'string' && (it.kcal == null || num(it.kcal)))
    )));
};

/** The plan inside a response body: the GeneratedPlan itself, or wrapped as { plan | result | generated }. */
function planIn(x: unknown): GeneratedPlan | null {
  if (isPlan(x)) return x;
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  for (const k of ['plan', 'result', 'generated']) if (isPlan(o[k])) return o[k] as GeneratedPlan;
  return null;
}

/**
 * Keep what the offline plan computed from body numbers (targets come from core, never from the model) and take
 * the model's meals, workout, shopping list, rules, totals and notes.
 */
function merged(ai: GeneratedPlan, base: GeneratedPlan): GeneratedPlan {
  const p = ai.plan;
  const str = (v: unknown) => typeof v === 'string' && v.length > 0;
  const shopOk = !!p.shop && [p.shop.now, p.shop.week].every((list) => Array.isArray(list)
    && list.every((it) => !!it && str(it.id) && str(it.name) && str(it.url) && typeof it.qty === 'string' && num(it.price)));
  const WEEK = new Set(['rest', 'A', 'B', 'walk', 'light']);
  const workoutOk = !!p.workout?.week && Object.values(p.workout.week).every((w) => WEEK.has(String(w)))
    && Object.values(p.workout.routines ?? {}).every((r) => !!r && Array.isArray(r.items) && r.items.every((x) => str(x?.name) && num(x?.n) && typeof x?.unit === 'string'));
  const rulesOk = Array.isArray(p.rules) && p.rules.every((r) => !!r && str(r.icon) && str(r.title) && typeof r.desc === 'string');
  return {
    targets: base.targets,
    // anything the model sent in a shape the screens cannot draw falls back to the offline plan's part
    plan: {
      meals: p.meals,
      workout: workoutOk ? p.workout : base.plan.workout,
      shop: shopOk ? { ...p.shop!, cycle: Array.isArray(p.shop!.cycle) ? p.shop!.cycle : [] } : base.plan.shop,
      rules: rulesOk ? p.rules : base.plan.rules,
    },
    day: num(ai.day?.kcal) && num(ai.day?.protein) ? ai.day : base.day,
    weeklyCost: num(ai.weeklyCost) ? ai.weeklyCost : base.weeklyCost,
    notes: Array.isArray(ai.notes) ? ai.notes.filter((n) => typeof n === 'string') : base.notes,
  };
}

/** Minimal SSE frame splitter: returns complete frames and keeps the remainder. */
function frames(buf: string): { out: { event: string; data: string }[]; rest: string } {
  const parts = buf.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  const out = parts.map((p) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of p.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return { event, data: data.join('\n') };
  }).filter((f) => f.data);
  return { out, rest };
}

export async function refinePlan(
  answers: OnboardingAnswers,
  baseline: GeneratedPlan,
  onStep: (s: RefineStep) => void,
  signal: AbortSignal,
): Promise<GeneratedPlan | null> {
  const token = await signedInToken();
  if (!token || signal.aborted) return null;
  try {
    const res = await fetch(PLAN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ answers, baseline }),
      signal,
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/event-stream') || !res.body) {
      const plan = planIn(await res.json().catch(() => null));
      return plan ? merged(plan, baseline) : null;
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    let found: GeneratedPlan | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const { out, rest } = frames(buf + value);
      buf = rest;
      for (const f of out) {
        let data: unknown;
        try { data = JSON.parse(f.data); } catch { continue; }
        if (f.event === 'error') return null;
        if (f.event === 'status') {
          const s = data as { id?: string | number; label?: string; state?: string };
          if (s.label) onStep({ id: String(s.id ?? s.label), label: s.label, done: s.state === 'done' });
          continue;
        }
        found = planIn(data) ?? found;
      }
    }
    return found ? merged(found, baseline) : null;
  } catch {
    return null;
  }
}
