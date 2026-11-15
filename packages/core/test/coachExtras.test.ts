// plan_event, get_trends, trend blocks, saved conversations, the event reminder and workout voice lines.
import { describe, expect, it } from 'vitest';
import {
  adjustedTarget, applyPlanChanges, cueAmount, cueAmrapMark, cueCountdown, cueMove, DEFAULT_PROGRAM, DEFAULT_REMINDER_PREFS, drinkKcal, DRINKS,
  effectiveRoutines, effectiveRules, effectiveShop, effectiveWeek, hhmm, plan, planEvent, planReminders, sessionFor,
  type DayRow, type MealEntryRow, type ReminderDay,
} from '../src';
import {
  BlockZ, buildSnapshot, CardZ, ChatRequestZ, CoachSession, GetTrendsInputZ, newAssistantTurn, parseToolInput, PlanEventInputZ, reduceTurn,
  snapshotForModel, SnapshotZ, summarizeTrends, trendDates, turnsFromMessages, type CoachEvent, type CoachSnapshot, type DayStat,
} from '../src/coach';

const H = (h: number, m = 0) => h * 60 + m;
const homeMeals = (wake = H(8)) => applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake }), null, []);

const day = (date: string, patch: Partial<DayRow> = {}): DayRow => ({
  date, scenario: 'home', eatout_slot: 'lunch', wake_min: H(8), water_cups: 3, steps: 2100, steps_source: 'manual',
  kcal_target: null, note: null, updated_at: '', ...patch,
});

const entry = (slot: MealEntryRow['slot'], kind: MealEntryRow['kind'], kcal: number, protein: number): MealEntryRow => ({
  id: `${slot}-${kind}`, date: '2026-11-18', slot, kind, eaten_at: null, food_id: null, name: 'x', servings: null, amount_text: null, items: null,
  kcal, protein_g: protein, source: 'plan', photo_path: null, confidence: 1, note: null, updated_at: '2026-11-18T01:00:00Z',
});

const stat = (date: string, p: Partial<DayStat> = {}): DayStat => ({
  date, planned: 5, logged: 5, skipped: 0, kcal: 1380, protein: 125, target: 1390, steps: 4500, water: 6,
  weight: null, trend: null, workout: null, workoutMin: null, runs: 0, runKm: 0, runMin: 0, ...p,
});

/** Wednesday 2026-11-18 10:00, breakfast eaten, with tomorrow's plan and two weeks of history. */
function snap(o: { entries?: MealEntryRow[]; history?: DayStat[]; events?: CoachSnapshot['events'] } = {}): CoachSnapshot {
  const now = new Date(2026, 10, 18, 10, 0);
  const meals = homeMeals();
  return buildSnapshot({
    now, program: DEFAULT_PROGRAM, day: day('2026-11-18'), meals, override: null, planMeta: null, adjustments: [], target: adjustedTarget(1390, []),
    week: effectiveWeek(null), routines: effectiveRoutines(null), session: sessionFor(now.getDay(), null, []), shop: effectiveShop(null), rules: effectiveRules(null),
    profile: { onboarding: { dislikes: ['오이'] } },
    entries: o.entries ?? [entry('breakfast', 'plan', 295, 21)],
    weights: [], workouts: [], workoutPlan: null, stepsGoal: 4000,
    events: (o.events ?? []).map((e) => ({ ...e })),
    tomorrow: { date: '2026-11-19', target: 1390, meals: homeMeals() },
    history: o.history ?? [],
  });
}

const run = (s: CoachSession, name: Parameters<CoachSession['run']>[0], input: unknown) => {
  const p = parseToolInput(name, input);
  if (!p.ok) throw new Error(p.error);
  const out = s.run(name, p.data);
  if (out.card) expect(CardZ.safeParse(out.card).success).toBe(true);
  return out;
};

describe('planEvent (core)', () => {
  const input = (alcohol = true) => ({
    meals: homeMeals().map((m) => ({ key: m.key, name: m.name, kcal: m.kcal, protein: m.protein, items: m.items, pending: true })),
    slot: 'dinner' as const, alcohol, target: 1390, proteinFloor: 110, label: '회식',
  });

  it('moves carbs from the meals before dinner to the event budget and keeps the day at the target', () => {
    const p = planEvent(input());
    // rice half 100, nuts 120, tangerine 60, protein with water 90; the stronger rice cut would pass 400 + 50
    expect(p.cuts.map((c) => c.id)).toEqual(['lunch-rice-half', 'snack-nuts', 'breakfast-tangerine', 'post-water']);
    expect(p.freed).toBe(370);
    expect(p.proteinAdd).toMatchObject({ slot: 'snack', label: '가기 전 닭가슴살 반 팩', kcal: 60, protein: 12 });
    expect(p.planned).toBe(185);
    expect(p.budget).toBe(185 + 370 - 60);
    expect(p.dayKcal).toBe(1390);
    expect(p.dayProtein).toBeGreaterThanOrEqual(110);
    // one cut per meal before, the protein, and the event meal edit
    expect(p.adjustments.map((a) => [a.slot, a.change.kind])).toEqual([['lunch', 'cut'], ['snack', 'cut'], ['breakfast', 'cut'], ['post', 'cut'], ['snack', 'add'], ['dinner', 'edit']]);
    expect(p.adjustments.every((a) => a.source === 'ai')).toBe(true);
    expect(p.summary).toContain('회식은 약 495kcal');
  });

  it('works out drinks from the table: highball and soju before beer', () => {
    expect(DRINKS.map((d) => [d.id, drinkKcal(d)])).toEqual([['highball', 66], ['soju', 46], ['wine', 124], ['makgeolli', 90], ['beer', 184]]);
    const p = planEvent(input());
    expect(p.drinkBudget).toBe(170); // 35% of 495, rounded to 10
    expect(p.drinks.map((d) => [d.id, d.count])).toEqual([['soju', 3], ['highball', 2], ['makgeolli', 1], ['wine', 1]]);
    expect(p.items.find((x) => x.name === '술')!.amount).toBe('하이볼 2잔 또는 소주 3잔까지');
    const dry = planEvent(input(false));
    expect(dry.drinks).toEqual([]);
    expect(dry.items.find((x) => x.name === '음료')).toBeTruthy();
  });

  it('skips the chicken top-up for someone who dislikes it, and trims generated plans without built-in items', () => {
    const p = planEvent({ ...input(), avoid: ['닭가슴살'] });
    expect(p.proteinAdd!.label).toBe('가기 전 프로틴 1스쿱을 물에 타서');
    const generated = planEvent({
      ...input(),
      meals: [
        { key: 'breakfast', name: '아침', kcal: 300, protein: 25, items: [{ name: '오트밀', amount: '40g' }], pending: true },
        { key: 'lunch', name: '점심', kcal: 500, protein: 35, items: [{ name: '현미밥', amount: '1공기' }], pending: true },
        { key: 'dinner', name: '저녁', kcal: 450, protein: 40, items: [{ name: '연어', amount: '120g' }], pending: true },
      ],
    });
    expect(generated.cuts).toEqual([{ id: 'event-trim-lunch', slot: 'lunch', label: '밥·빵·면 양 1/3 줄이기', kcal: 80, protein: 0 }]);
    expect(generated.adjustments[0]!.change).not.toHaveProperty('cut_id');
  });
});

describe('plan_event tool', () => {
  it('validates its input', () => {
    expect(PlanEventInputZ.safeParse({ day: 'tomorrow', slot: 'dinner', label: '회식', alcohol: true, title: '내일 회식', reason: '회식' }).success).toBe(true);
    expect(PlanEventInputZ.safeParse({ day: 'friday', slot: 'dinner', label: '회식', alcohol: true, title: 't', reason: '' }).success).toBe(false);
    expect(PlanEventInputZ.safeParse({ day: 'today', slot: 'snack', label: '회식', alcohol: true, title: 't', reason: '' }).success).toBe(false);
  });

  it('tomorrow: writes plan_adjustments for that date and an events row, without touching today', () => {
    const s = new CoachSession(snap(), 't', '0b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c');
    const before = structuredClone(s.snap.totals);
    const out = run(s, 'plan_event', { day: 'tomorrow', slot: 'dinner', label: '회식', alcohol: true, title: '내일 저녁 회식에 맞춰 미리 조정', reason: '내일 저녁 회식' });
    const card = out.card!;
    expect(card.kind).toBe('event');
    expect(card.day).toBe('2026-11-18');
    expect(card.target).toBe('plan:meal:dinner');
    expect(card.delta).toEqual({ kcal: 0, protein: 0 });
    expect(card.rows.filter((r) => r.op === 'adjustment').every((r) => r.op === 'adjustment' && r.date === '2026-11-19')).toBe(true);
    expect(card.rows.at(-1)).toMatchObject({ op: 'event', date: '2026-11-19', slot: 'dinner', kind: 'drinks' });
    expect(card.lines.find((l) => l.label === '술')!.after).toMatch(/^하이볼 2잔 또는 소주 3잔까지/);
    expect(card.lines.at(-1)).toMatchObject({ label: '내일 계획', before: '1,390kcal', after: '1,390kcal / 목표 1,390kcal' });
    expect(s.snap.totals).toEqual(before);
    expect(out.result).toMatchObject({ date: '2026-11-19', event: { budget_kcal: 495 }, reminder: '2026-11-19 아침에 알림' });
    // asking again for the same evening is refused while that card stands
    const again = s.run('plan_event', { day: 'tomorrow', slot: 'dinner', label: '회식', alcohol: true, title: 'x', reason: 'x' });
    expect(again.isError).toBe(true);
  });

  it('today: only pending meals change and the projected total moves with the card', () => {
    const s = new CoachSession(snap(), 't');
    const out = run(s, 'plan_event', { day: 'today', slot: 'dinner', label: '친구 저녁', alcohol: false, title: '오늘 저녁 약속', reason: '약속' });
    const slots = out.card!.rows.flatMap((r) => (r.op === 'adjustment' ? [r.slot] : []));
    expect(slots).not.toContain('breakfast'); // already eaten
    expect(out.card!.target).toBe('today:meal:dinner');
    expect(s.snap.meals.find((m) => m.key === 'dinner')!.changes?.[0]).toMatch(/^친구 저녁 · 약 /);
    expect(s.snap.totals.projectedKcal).toBe(1390 + out.card!.delta.kcal);
  });

  it('refuses an event meal that is already logged, and an existing event', () => {
    const logged = new CoachSession(snap({ entries: [entry('dinner', 'plan', 185, 27)] }), 't');
    expect(logged.run('plan_event', { day: 'today', slot: 'dinner', label: '회식', alcohol: true, title: 'x', reason: 'x' }).isError).toBe(true);
    const booked = new CoachSession(snap({ events: [{ date: '2026-11-19', slot: 'dinner', kind: 'drinks', note: null }] }), 't');
    expect(booked.run('plan_event', { day: 'tomorrow', slot: 'dinner', label: '회식', alcohol: true, title: 'x', reason: 'x' }).isError).toBe(true);
    expect(booked.run('plan_event', { day: 'tomorrow', slot: 'lunch', label: '점심 약속', alcohol: false, title: 'x', reason: 'x' }).isError).toBeFalsy();
  });
});

describe('get_trends', () => {
  // Mon 11-09 .. Wed 11-18; weigh-ins with a falling trend, two workouts and a run this week
  const history = [
    stat('2026-11-04'), stat('2026-11-05'), stat('2026-11-06'), stat('2026-11-07'), stat('2026-11-08'),
    stat('2026-11-09', { weight: 76.4, trend: 76.4 }), stat('2026-11-10', { kcal: 1900 }), stat('2026-11-11', { logged: 2, kcal: 700 }),
    stat('2026-11-12', { weight: 76.0, trend: 76.36 }), stat('2026-11-13'), stat('2026-11-14'), stat('2026-11-15'),
    stat('2026-11-16', { weight: 75.8, trend: 76.3, workout: 'home_a', workoutMin: 24, steps: 3000 }),
    stat('2026-11-17', { weight: 75.6, trend: 76.22, runs: 1, runKm: 3.46, runMin: 21.4, protein: 98 }),
    stat('2026-11-18', { logged: 1, kcal: 295, weight: 75.5, trend: 76.14, workout: 'home_b', workoutMin: 22 }),
  ];

  it('picks the right dates for each range (weeks start on Monday)', () => {
    expect(trendDates('this_week', '2026-11-18')).toEqual({ from: '2026-11-16', to: '2026-11-18' });
    expect(trendDates('last_week', '2026-11-18')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(trendDates('last_7', '2026-11-18')).toEqual({ from: '2026-11-12', to: '2026-11-18' });
    expect(trendDates('this_week', '2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' }); // Sunday
    expect(GetTrendsInputZ.safeParse({ range: 'month' }).success).toBe(false);
  });

  it('counts kept days over finished days only, and reports the trend rather than single weigh-ins', () => {
    const t = summarizeTrends(history, 'this_week', '2026-11-18', { proteinFloor: 110, stepsGoal: 4000, ratePerWeek: -0.6 });
    expect(t.days).toBe(3);
    expect(t.finished).toBe(2); // today is still going
    expect(t.kept).toEqual({ days: 2, of: 2, dates: ['2026-11-16', '2026-11-17'] });
    expect(t.intake).toMatchObject({ loggedDays: 2, avgKcal: 1380, proteinDays: 1 });
    expect(t.weight).toMatchObject({ first: { date: '2026-11-16', kg: 75.8 }, last: { date: '2026-11-18', kg: 75.5 }, change: -0.3, trendFirst: 76.3, trendLast: 76.1, trendChange: -0.2, ratePerWeek: -0.6 });
    expect(t.workouts).toEqual({ home: 2, minutes: 46, dates: ['2026-11-16', '2026-11-18'] });
    expect(t.runs).toEqual({ count: 1, km: 3.5, minutes: 21 });
    expect(t.steps).toEqual({ avg: 3750, goal: 4000, daysAtGoal: 1 });
    const last = summarizeTrends(history, 'last_week', '2026-11-18', { proteinFloor: 110, stepsGoal: 4000, ratePerWeek: null });
    expect(last.kept).toMatchObject({ days: 5, of: 7 }); // 11-10 over by 510, 11-11 only two meals logged
    expect(last.biggestOver).toEqual({ date: '2026-11-10', over: 510 });
  });

  it('returns a block that passes the schema, and refuses without history', () => {
    const s = new CoachSession(snap({ history }), 't');
    const out = run(s, 'get_trends', { range: 'this_week' });
    expect(out.card).toBeUndefined();
    expect(BlockZ.safeParse(out.block).success).toBe(true);
    expect(out.block).toMatchObject({ kind: 'trends', label: '이번 주', kept: { days: 2, of: 2 }, workouts: { home: 2, minutes: 46 } });
    expect(out.result).toMatchObject({ kept: { days: 2, of: 2 } });
    expect(out.result).not.toHaveProperty('weight.points');
    expect(new CoachSession(snap(), 't').run('get_trends', { range: 'this_week' }).isError).toBe(true);
  });
});

describe('snapshot extras', () => {
  it('passes the schema and keeps history and tomorrow out of the model context', () => {
    const s = snap({ history: [stat('2026-11-18')], events: [{ date: '2026-11-19', slot: 'dinner', kind: 'drinks', note: '회식' }] });
    expect(SnapshotZ.safeParse(s).success).toBe(true);
    expect(s.tomorrow!.meals.every((m) => m.state === 'pending')).toBe(true);
    const ctx = snapshotForModel(s);
    expect(ctx).not.toContain('"history"');
    expect(ctx).not.toContain('"tomorrow"');
    expect(ctx).toContain('"events"');
  });

  it('a request from an older client still parses (no features, no extras)', () => {
    const { events: _e, tomorrow: _t, history: _h, ...old } = snap();
    const r = ChatRequestZ.safeParse({ threadId: '0b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c', message: '이번 주 어땠어?', snapshot: old });
    expect(r.success && r.data.features).toEqual([]);
  });
});

describe('client: blocks and saved conversations', () => {
  it('adds a block part, and ignores event types it does not know', () => {
    let t = newAssistantTurn('a', 0);
    const s = new CoachSession(snap({ history: [stat('2026-11-18')] }), 't');
    const block = s.run('get_trends', { range: 'last_7' }).block!;
    t = reduceTurn(t, { type: 'block', block });
    t = reduceTurn(t, { type: 'future', x: 1 } as unknown as CoachEvent);
    expect(t.parts).toEqual([{ kind: 'block', block }]);
  });

  it('rebuilds turns in saved order, validates cards again and drops what it cannot read', () => {
    const s = new CoachSession(snap(), 't', '0b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c');
    const card = s.run('skip_meal', { slot: 'snack' }).card!;
    const turns = turnsFromMessages([
      { id: 'm2', role: 'assistant', created_at: '2026-11-18T01:00:02Z', content: { text: '간식을 건너뜁니다.', cards: [card, { id: 'bad' }], parts: [{ k: 'text', text: '간식을 건너뜁니다.' }, { k: 'card', id: card.id }, { k: 'card', id: 'bad' }, { k: 'sources', items: [{ title: 'x', url: 'javascript:alert(1)' }] }] } },
      { id: 'm1', role: 'user', created_at: '2026-11-18T01:00:00Z', content: { text: '간식 건너뛸래', images: 0 } },
      { id: 'm3', role: 'user', created_at: '2026-11-18T01:01:00Z', content: { text: '', images: 2 } },
      { id: 'm4', role: 'assistant', created_at: '2026-11-18T01:01:05Z', content: { text: '예전 형식', cards: [card] } },
      { id: 'm5', role: 'assistant', created_at: '2026-11-18T01:02:00Z', content: 'not an object' },
    ]);
    expect(turns.map((t) => [t.role, t.id])).toEqual([['user', 'm1'], ['assistant', 'm2'], ['user', 'm3'], ['assistant', 'm4']]);
    const a = turns[1]!;
    expect(a.role === 'assistant' && a.parts.map((p) => p.kind)).toEqual(['text', 'card']);
    expect(turns[2]).toMatchObject({ text: '', sentImages: 2 });
    const legacy = turns[3]!;
    expect(legacy.role === 'assistant' && legacy.parts.map((p) => p.kind)).toEqual(['text', 'card']);
  });
});

describe('event reminder', () => {
  const v = (o: { wake?: number | null; now?: number } = {}): ReminderDay => ({
    ctx: { key: '2026-11-19', dow: 4, week: 1 }, nowMin: o.now ?? 0, scen: 'home',
    day: { wake_min: o.wake === undefined ? H(7) : o.wake, water_cups: 0 },
    meals: plan({ scen: 'home', eatout: 'lunch', wake: o.wake === undefined ? H(7) : o.wake }), eaten: new Set(), weight: 75,
    events: [{ id: 'e1', slot: 'dinner', kind: 'drinks', note: '점심 햇반 반 공기만, 가기 전 닭가슴살 반 팩, 회식은 약 495kcal.' }],
  });

  it('comes 15 minutes after waking, or at 08:00 before the wake time is known', () => {
    const r = planReminders(v(), null).find((x) => x.kind === 'event')!;
    expect(r).toMatchObject({ id: '2026-11-19:event:dinner', title: '오늘 저녁 술자리가 있습니다' });
    expect(hhmm(r.at)).toBe('07:15');
    expect(r.body).toContain('회식은 약 495kcal');
    expect(hhmm(planReminders(v({ wake: null }), null).find((x) => x.kind === 'event')!.at)).toBe('08:00');
  });

  it('follows the kind switch and never lands in the past', () => {
    expect(planReminders(v(), null, { ...DEFAULT_REMINDER_PREFS, kinds: { ...DEFAULT_REMINDER_PREFS.kinds, event: false } }).some((x) => x.kind === 'event')).toBe(false);
    expect(planReminders(v({ now: H(9) }), null).some((x) => x.kind === 'event')).toBe(false);
  });
});

describe('workout voice lines', () => {
  it('says the move, both sides, and rounds', () => {
    expect(cueAmount({ name: '런지', n: 10, unit: '회 (양쪽)' })).toBe('런지 10회, 양쪽');
    expect(cueMove({ name: '푸시업', n: 12, unit: '회' }, { idx: 0, total: 5, round: 2, rounds: 3 })).toBe('2라운드. 푸시업 12회.');
    expect(cueMove({ name: '플랭크', n: 30, unit: '초' }, { idx: 4, total: 5, round: 1, rounds: 3 })).toBe('마지막 동작. 플랭크 30초. 준비되면 타이머를 누르세요.');
    expect(cueMove({ name: '스쿼트', n: 20, unit: '회' }, { idx: 0, total: 5, round: 3, rounds: 3 })).toBe('마지막 라운드. 스쿼트 20회.');
  });

  it('counts down the last three seconds and marks AMRAP minutes', () => {
    expect([4, 3, 2, 1, 0].map(cueCountdown)).toEqual([null, '셋', '둘', '하나', null]);
    const marks = Array.from({ length: 1200 }, (_, i) => 1200 - i).map((l) => cueAmrapMark(l, 1200)).filter(Boolean);
    expect(marks).toEqual(['15분 남았습니다.', '10분 남았습니다.', '5분 남았습니다.', '3분 남았습니다.', '2분 남았습니다.', '1분 남았습니다.', '30초 남았습니다.']);
  });
});
