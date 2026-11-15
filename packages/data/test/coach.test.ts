import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM } from '@diet/core';
import { CoachSession, parseToolInput, type CoachCard } from '@diet/core/coach';
import { adjustmentsFor as dayAdjustments, applyCard, coachSnapshot, DataStore, effectivePlan, planMeta, setDay, todayView, toggleMeal, type Env } from '../src';

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

  it('applies plan changes through savePlan, folding each patch onto the plan in effect', async () => {
    const env = await makeEnv();
    const card = cardFor(env, 'propose_plan_change', { changes: [{ slot: 'snack', remove: true }], effective: 'today', title: '간식 빼기', reason: '배가 안 고픔' });
    const r1 = applyCard(env, card);
    expect(r1.ok).toBe(true);
    expect(effectivePlan(env, '2026-11-16')?.meals).toEqual({ snack: { removed: true } });
    expect(planMeta(env, '2026-11-16')).toMatchObject({ source: 'ai', note: '간식 빼기' });
    expect(coachSnapshot(env).meals.map((m) => m.key)).not.toContain('snack');
    // the second card was proposed from the original snapshot; applying it keeps the first change
    const card2 = new CoachSession(coachSnapshot(env), 'd').run('propose_plan_change', { changes: [{ slot: 'dinner', kcal: 305, protein: 51, items: [{ name: '헬로틴 저염 닭가슴살', amount: '2팩' }, { name: '샐러드 믹스', amount: '1봉' }] }], effective: 'today', title: '저녁 닭가슴살 +1', reason: '단백질' }).card!;
    const r2 = applyCard(env, card2);
    expect(Object.keys(effectivePlan(env, '2026-11-16')!.meals!).sort()).toEqual(['dinner', 'snack']);
    expect(env.store.all('plans')).toHaveLength(1); // one version per day
    if (r2.ok) r2.undo();
    expect(effectivePlan(env, '2026-11-16')?.meals).toEqual({ snack: { removed: true } });
    if (r1.ok) r1.undo();
    expect(effectivePlan(env, '2026-11-16')).toBeNull();
  });

  it('applies workout cards: weekday, routine and today-only session', async () => {
    const env = await makeEnv();
    const week = applyCard(env, cardFor(env, 'adjust_workout', { scope: 'week', days: [{ dow: 3, session: 'A' }], title: '수요일에도 홈트 A', reason: '심심함' }));
    expect(week.ok).toBe(true);
    expect(todayView(env).week[3]!.t).toBe('A');
    const items = [{ name: '스쿼트', n: 15, unit: '회' }];
    applyCard(env, cardFor(env, 'adjust_workout', { scope: 'routine', routine: 'B', items, title: '하체 줄이기', reason: '무릎' }));
    expect(todayView(env).routines.B.items).toEqual(items);
    expect(todayView(env).week[3]!.t).toBe('A'); // still there
    const today = applyCard(env, cardFor(env, 'adjust_workout', { scope: 'today', session: 'walk', title: '오늘은 걷기', reason: '무릎' }));
    expect(todayView(env).session).toBe('walk');
    if (today.ok) today.undo();
    expect(todayView(env).session).toBe('A');
  });

  it('refuses a today-only session card after the date has passed', async () => {
    const env = await makeEnv();
    const card = cardFor(env, 'adjust_workout', { scope: 'today', session: 'rest', title: '쉬기', reason: '피곤' });
    const later: Env = { ...env, now: () => new Date(2026, 10, 17, 9, 0) };
    const r = applyCard(later, card);
    expect(r.ok).toBe(false);
    expect(env.store.where('plan_adjustments', () => true)).toHaveLength(0);
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
