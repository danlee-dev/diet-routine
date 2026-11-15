// Coach extras on the device: snapshot extras, event cards and their reminder, applied state across
// devices, "코치가 바꿈" marks, day stats and loading saved conversations.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_PROGRAM, hhmm, planReminders } from '@diet/core';
import { CoachSession, parseToolInput, SnapshotZ, type CoachCard } from '@diet/core/coach';
import {
  applyCard, cardApplied, coachMarks, coachSnapshot, completeWorkout, DataStore, loadConversation, patchContained, recentDayStats, setDay, setWeight,
  TABLES, todayView, toggleMeal, undoByRows, undoableByRows, effectivePlan, workoutPlan, type Env, type Row,
} from '../src';

const MSG = '0b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c';

const makeEnv = async (now = new Date(2026, 10, 18, 10, 0)) => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  // Wednesday 2026-11-18 10:00
  const env: Env = { store, program: DEFAULT_PROGRAM, now: () => now, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
  setDay(env, '2026-11-18', { scenario: 'home', wake_min: 8 * 60 });
  toggleMeal(env, '2026-11-18', 'breakfast');
  return env;
};

const cardFor = (env: Env, name: Parameters<CoachSession['run']>[0], input: unknown, messageId = MSG): CoachCard => {
  const s = new CoachSession(coachSnapshot(env, undefined, { extras: true }), 'c', messageId);
  const p = parseToolInput(name, input);
  if (!p.ok) throw new Error(p.error);
  const out = s.run(name, p.data);
  if (!out.card) throw new Error(JSON.stringify(out.result));
  return out.card;
};

/** The other device after sync: same rows, its own store (keys reordered as Postgres jsonb returns them). */
const otherDevice = async (env: Env): Promise<Env> => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || a.localeCompare(b)).map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v);
  for (const t of TABLES) store.putMany(t, env.store.all<Row>(t).map((r) => sortKeys(r) as Row));
  return { ...env, store };
};

const eventInput = { day: 'tomorrow', slot: 'dinner', label: '회식', alcohol: true, title: '내일 저녁 회식에 맞춰 미리 조정', reason: '내일 저녁 회식' };

describe('snapshot extras', () => {
  it('adds tomorrow, two weeks of day stats and planned events only when asked', async () => {
    const env = await makeEnv();
    expect(coachSnapshot(env).history).toBeUndefined();
    const s = coachSnapshot(env, undefined, { extras: true });
    expect(SnapshotZ.safeParse(s).success).toBe(true);
    expect(s.tomorrow).toMatchObject({ date: '2026-11-19', target: 1390 });
    expect(s.tomorrow!.meals.map((m) => m.key)).toEqual(['breakfast', 'lunch', 'snack', 'post', 'dinner']);
    expect(s.history).toHaveLength(15);
    expect(s.history!.at(-1)).toMatchObject({ date: '2026-11-18', logged: 1, kcal: 295, target: 1390 });
    expect(s.events).toEqual([]);
  });

  it('day stats follow the records: weigh-ins with the trend, workouts, logged meals', async () => {
    const env = await makeEnv();
    setWeight(env, '2026-11-16', 75.8);
    setWeight(env, '2026-11-17', 75.4);
    completeWorkout(env, '2026-11-17', 'A', { rounds: 3, startedAt: new Date(2026, 10, 17, 18, 0), endedAt: new Date(2026, 10, 17, 18, 24) });
    const stats = recentDayStats(env, 3);
    expect(stats.map((d) => d.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
    expect(stats[0]).toMatchObject({ weight: 75.8, trend: 75.8, logged: 0 });
    expect(stats[1]).toMatchObject({ weight: 75.4, workout: 'home_a', workoutMin: 24 });
    expect(stats[1]!.trend).toBeCloseTo(75.76, 2);
  });
});

describe('plan_event card on the device', () => {
  it('writes tomorrow\'s adjustments and an events row; tomorrow\'s view and its morning reminder pick it up', async () => {
    const env = await makeEnv();
    const card = cardFor(env, 'plan_event', eventInput);
    const r = applyCard(env, card);
    expect(r.ok).toBe(true);
    const tomorrow: Env = { ...env, now: () => new Date(2026, 10, 19, 0, 0) };
    const vt = todayView(tomorrow);
    expect(vt.events).toHaveLength(1);
    expect(vt.events[0]).toMatchObject({ date: '2026-11-19', slot: 'dinner', kind: 'drinks' });
    expect(vt.meals.find((m) => m.key === 'dinner')).toMatchObject({ kcal: 495, changes: ['회식 · 약 495kcal'] });
    expect(vt.sum.total).toBe(1390);
    expect(vt.adjustments.every((a) => a.source === 'ai')).toBe(true);
    // today is untouched
    expect(todayView(env).sum.total).toBe(1390);
    const reminders = planReminders(vt, workoutPlan(tomorrow, vt));
    const morning = reminders.find((x) => x.kind === 'event')!;
    expect(morning.title).toBe('오늘 저녁 술자리가 있습니다');
    expect(hhmm(morning.at)).toBe('08:00');
    expect(morning.body).toContain('회식은 약 495kcal');
    if (r.ok) r.undo();
    expect(todayView(tomorrow).events).toHaveLength(0);
    expect(todayView(tomorrow).meals.find((m) => m.key === 'dinner')!.kcal).toBe(185);
  });

  it('the next snapshot knows the event, so the coach does not plan it twice', async () => {
    const env = await makeEnv();
    applyCard(env, cardFor(env, 'plan_event', eventInput));
    const s = new CoachSession(coachSnapshot(env, undefined, { extras: true }), 'd');
    expect(s.run('plan_event', eventInput).isError).toBe(true);
  });
});

describe('applied state across devices', () => {
  it('a card applied on one device reads as applied on the other, plan patches included', async () => {
    const env = await makeEnv();
    const event = cardFor(env, 'plan_event', eventInput);
    const planCard = cardFor(env, 'propose_plan_change', { changes: [{ slot: 'snack', items: [{ name: '그릭요거트', amount: '150g' }], kcal: 150, protein: 15 }], effective: 'tomorrow', title: '간식을 요거트로', reason: 'x' }, '1b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c');
    expect(cardApplied(env, event)).toBe(false);
    expect(cardApplied(env, planCard)).toBe(false);
    applyCard(env, event);
    applyCard(env, planCard);
    const phone = await otherDevice(env);
    expect(cardApplied(phone, event)).toBe(true);
    expect(cardApplied(phone, planCard)).toBe(true);
    // the card itself comes back from chat_messages jsonb with reordered keys
    expect(cardApplied(phone, JSON.parse(JSON.stringify(planCard)) as CoachCard)).toBe(true);
  });

  it('undo from the other device works for one-day rows only', async () => {
    const env = await makeEnv();
    const event = cardFor(env, 'plan_event', eventInput);
    applyCard(env, event);
    const phone = await otherDevice(env);
    expect(undoableByRows(event)).toBe(true);
    expect(undoByRows(phone, event)).toBe(true);
    expect(cardApplied(phone, event)).toBe(false);
    const food = cardFor(env, 'log_food', { slot: 'lunch', name: '순대국', amount: '1그릇', nutrition: { basis: 'estimate', kcal: 700, protein: 30 }, confidence: 0.6, source: 'text' });
    expect(undoableByRows(food)).toBe(false);
    expect(undoByRows(phone, food)).toBe(false);
  });

  it('patch containment checks every field the patch sets', () => {
    const row = { op: 'plan' as const, effective_from: '2026-11-18', meals: { snack: { kcal: 150, note: '요거트' } }, week: { '3': 'walk' as const }, note: 'x' };
    expect(patchContained({ meals: { snack: { kcal: 150, note: '요거트', items: [] } }, workout: { week: { '3': 'walk' } } }, row)).toBe(true);
    expect(patchContained({ meals: { snack: { kcal: 150 } }, workout: { week: { '3': 'walk' } } }, row)).toBe(false);
    expect(patchContained(null, row)).toBe(false);
  });
});

describe('코치가 바꿈 marks', () => {
  it('marks meals changed by coach cards with the message, not the user\'s own edits', async () => {
    const env = await makeEnv();
    const plan = cardFor(env, 'propose_plan_change', { changes: [{ slot: 'snack', items: [{ name: '그릭요거트', amount: '150g' }], kcal: 150, protein: 15 }], effective: 'today', title: '간식을 요거트로', reason: 'x' });
    const r = applyCard(env, plan);
    const cut = cardFor(env, 'propose_day_adjustment', { slot: 'lunch', kind: 'cut', label: '햇반 반 공기만', kcal_delta: -100, protein_delta: -2, reason: 'x' }, '2b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c');
    applyCard(env, cut);
    const m = coachMarks(env, '2026-11-18');
    expect(m.meals.snack).toEqual({ messageId: MSG, note: '간식을 요거트로' });
    expect(m.meals.lunch).toEqual({ messageId: '2b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c', note: '햇반 반 공기만' });
    expect(m.meals.dinner).toBeUndefined();
    expect(m.workout).toBeNull();
    if (r.ok) r.undo();
    expect(coachMarks(env, '2026-11-18').meals.snack).toBeUndefined();
    expect(effectivePlan(env, '2026-11-18')?.meals?.snack).toBeUndefined();
  });

  it('marks today\'s workout changed by the coach', async () => {
    const env = await makeEnv();
    applyCard(env, cardFor(env, 'adjust_workout', { scope: 'today', session: 'rest', title: '오늘은 쉬기', reason: '무릎' }));
    expect(coachMarks(env, '2026-11-18').workout).toEqual({ messageId: MSG, note: '오늘 운동 변경' });
  });
});

describe('loading saved conversations', () => {
  const t1 = '11111111-1111-4111-8111-111111111111';
  const t2 = '22222222-2222-4222-8222-222222222222';

  /** Just enough of the Supabase query builder: filters, order, limit, maybeSingle. */
  function fakeClient(tables: Record<string, Record<string, unknown>[]>) {
    const asked: string[] = [];
    const from = (t: string) => {
      asked.push(t);
      let rows = [...(tables[t] ?? [])];
      let single = false;
      const q = {
        select: () => q,
        is: (c: string, v: unknown) => { rows = rows.filter((r) => (r[c] ?? null) === v); return q; },
        eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; },
        order: (c: string, o: { ascending: boolean }) => { rows.sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (o.ascending ? 1 : -1)); return q; },
        limit: (n: number) => { rows = rows.slice(0, n); return q; },
        maybeSingle: () => { single = true; return q; },
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(ok, bad),
      };
      return q;
    };
    return { client: { from } as unknown as SupabaseClient, asked };
  }

  const db = async () => {
    const env = await makeEnv();
    const card = cardFor(env, 'skip_meal', { slot: 'snack' }, '33333333-3333-4333-8333-333333333333');
    return fakeClient({
      chat_threads: [
        { id: t1, title: '간식', created_at: '2026-11-17T01:00:00Z', updated_at: '2026-11-17T01:05:00Z', deleted_at: null },
        { id: t2, title: '이번 주', created_at: '2026-11-18T00:00:00Z', updated_at: '2026-11-18T00:10:00Z', deleted_at: null },
        { id: 'gone', title: 'x', created_at: '2026-11-18T02:00:00Z', updated_at: '2026-11-18T02:00:00Z', deleted_at: '2026-11-18T03:00:00Z' },
      ],
      chat_messages: [
        { id: 'u1', thread_id: t1, role: 'user', content: { text: '간식 건너뛸래' }, created_at: '2026-11-17T01:00:00Z', deleted_at: null },
        { id: '33333333-3333-4333-8333-333333333333', thread_id: t1, role: 'assistant', content: { text: '건너뜁니다.', cards: [card], parts: [{ k: 'text', text: '건너뜁니다.' }, { k: 'card', id: card.id }] }, created_at: '2026-11-17T01:00:05Z', deleted_at: null },
        { id: 'u2', thread_id: t2, role: 'user', content: { text: '이번 주 어땠어?' }, created_at: '2026-11-18T00:00:00Z', deleted_at: null },
        { id: 'a2', thread_id: t2, role: 'assistant', content: { text: '잘 지켰습니다.' }, created_at: '2026-11-18T00:00:09Z', deleted_at: null },
      ],
    });
  };

  it('opens the most recently updated thread, with the list newest first', async () => {
    const { client } = await db();
    const c = await loadConversation(client);
    expect(c.threads.map((t) => t.id)).toEqual([t2, t1]);
    expect(c.threadId).toBe(t2);
    expect(c.turns.map((t) => (t.role === 'user' ? t.text : t.parts.map((p) => p.kind).join('+')))).toEqual(['이번 주 어땠어?', 'text']);
  });

  it('opens the conversation a card came from (the Today tag), or a chosen thread', async () => {
    const { client } = await db();
    const c = await loadConversation(client, { messageId: '33333333-3333-4333-8333-333333333333' });
    expect(c.threadId).toBe(t1);
    const a = c.turns[1]!;
    expect(a.role === 'assistant' && a.parts.map((p) => p.kind)).toEqual(['text', 'card']);
    expect((await loadConversation(client, { threadId: t1 })).turns).toHaveLength(2);
  });

  it('starts empty when there is no thread yet', async () => {
    const { client } = fakeClient({});
    expect(await loadConversation(client)).toEqual({ threads: [], threadId: null, turns: [] });
  });
});
