import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM } from '@diet/core';
import { CoachSession, parseToolInput, type CoachCard } from '@diet/core/coach';
import { activePlanOverride, applyCard, coachSnapshot, dayAdjustments, DataStore, setDay, todayView, toggleMeal, type Env } from '../src';

const makeEnv = async () => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  // Monday 2026-11-16 12:30
  const env: Env = { store, program: DEFAULT_PROGRAM, now: () => new Date(2026, 10, 16, 12, 30), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
  setDay(env, '2026-11-16', { scenario: 'home', wake_min: 8 * 60 });
  toggleMeal(env, '2026-11-16', 'breakfast');
  return env;
};

const cardFor = (env: Env, name: Parameters<CoachSession['run']>[0], input: unknown): CoachCard => {
  const s = new CoachSession(coachSnapshot(env), 'c');
  const p = parseToolInput(name, input);
  if (!p.ok) throw new Error(p.error);
  return s.run(name, p.data).card!;
};

describe('coach cards on the device', () => {
  it('builds the snapshot from the store', async () => {
    const env = await makeEnv();
    const s = coachSnapshot(env);
    expect(s.now.date).toBe('2026-11-16');
    expect(s.totals.eatenKcal).toBe(295);
    expect(s.meals[0]!.state).toBe('eaten');
  });

  it('applies a log_food card as a replace entry and undoes it', async () => {
    const env = await makeEnv();
    const card = cardFor(env, 'log_food', { slot: 'lunch', name: '순대국', amount: '1그릇', nutrition: { basis: 'estimate', kcal: 750, protein: 32 }, confidence: 0.6, source: 'text' });
    const r = applyCard(env, card);
    expect(r.ok).toBe(true);
    let v = todayView(env);
    expect(v.entries.find((e) => e.slot === 'lunch')).toMatchObject({ kind: 'replace', name: '순대국', kcal: 750, source: 'ai_text' });
    expect(v.sum.eaten).toBe(295 + 750);
    if (r.ok) r.undo();
    v = todayView(env);
    expect(v.entries.find((e) => e.slot === 'lunch')).toBeUndefined();
  });

  it('applies a plan change as a new plans row that the snapshot then reads', async () => {
    const env = await makeEnv();
    const card = cardFor(env, 'propose_plan_change', { changes: [{ slot: 'snack', remove: true }], effective: 'today', title: '간식 빼기', reason: '배가 안 고픔' });
    const r = applyCard(env, card);
    expect(r.ok).toBe(true);
    expect(activePlanOverride(env, '2026-11-16')).toEqual({ meals: { snack: { removed: true } } });
    expect(activePlanOverride(env, '2026-11-15')).toBeNull();
    expect(coachSnapshot(env).meals.map((m) => m.key)).not.toContain('snack');
    // a second change merges on top of the first instead of replacing it
    const card2 = cardFor(env, 'propose_plan_change', { changes: [{ slot: 'dinner', kcal: 305, protein: 51, items: [{ name: '헬로틴 저염 닭가슴살', amount: '2팩' }, { name: '샐러드 믹스', amount: '1봉' }] }], effective: 'today', title: '저녁 닭가슴살 +1', reason: '단백질' });
    applyCard(env, card2);
    expect(Object.keys(activePlanOverride(env, '2026-11-16')!.meals!).sort()).toEqual(['dinner', 'snack']);
    if (r.ok) r.undo();
    // undoing the first card leaves the second (newest) row active
    expect(Object.keys(activePlanOverride(env, '2026-11-16')!.meals!).sort()).toEqual(['dinner', 'snack']);
  });

  it('applies rebalance rows for today and the following days', async () => {
    const env = await makeEnv();
    applyCard(env, cardFor(env, 'log_food', { slot: 'lunch', name: '순대국', amount: '1그릇', nutrition: { basis: 'estimate', kcal: 950, protein: 32 }, confidence: 0.6, source: 'text' }));
    const card = cardFor(env, 'rebalance_today', { reason: '점심 초과' });
    const r = applyCard(env, card);
    expect(r.ok).toBe(true);
    expect(dayAdjustments(env, '2026-11-16').length).toBeGreaterThan(0);
    expect(dayAdjustments(env, '2026-11-17').some((a) => a.change.kind === 'carry')).toBe(true);
    if (r.ok) r.undo();
    expect(dayAdjustments(env, '2026-11-16')).toEqual([]);
    expect(dayAdjustments(env, '2026-11-17')).toEqual([]);
  });

  it('refuses a malformed card without writing anything', async () => {
    const env = await makeEnv();
    const before = env.store.pendingCount();
    const r = applyCard(env, { id: 'x', kind: 'log_food', title: 't', lines: [], delta: { kcal: 0, protein: 0 }, rows: [{ op: 'drop_table' }] });
    expect(r.ok).toBe(false);
    expect(env.store.pendingCount()).toBe(before);
  });
});
