import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM, plan, type DayRow, type MealEntryRow } from '../src';
import {
  buildSnapshot, CardZ, ChatRequestZ, COACH_TOOLS, CoachSession, parseToolInput, SnapshotZ, snapshotForModel, type CoachSnapshot,
} from '../src/coach';

const day = (patch: Partial<DayRow> = {}): DayRow => ({
  date: '2026-11-16', scenario: 'home', eatout_slot: 'lunch', wake_min: 8 * 60, water_cups: 3, steps: 2100, steps_source: 'manual',
  kcal_target: null, note: null, updated_at: '', ...patch,
});

const entry = (slot: MealEntryRow['slot'], kind: MealEntryRow['kind'], kcal: number, protein: number, name = 'x'): MealEntryRow => ({
  id: `${slot}-${kind}`, date: '2026-11-16', slot, kind, eaten_at: null, food_id: null, name, servings: null, amount_text: null, items: null,
  kcal, protein_g: protein, source: 'plan', photo_path: null, confidence: 1, note: null, updated_at: '2026-11-16T01:00:00Z',
});

/** Monday 2026-11-16 12:30, home day, woke at 08:00, breakfast eaten as planned. */
const snap = (entries: MealEntryRow[] = [entry('breakfast', 'plan', 295, 21)]): CoachSnapshot => {
  const d = day();
  return buildSnapshot({
    now: new Date(2026, 10, 16, 12, 30),
    program: DEFAULT_PROGRAM,
    day: d,
    baseMeals: plan({ scen: 'home', eatout: 'lunch', wake: d.wake_min }),
    override: null,
    adjustments: [],
    entries,
    weights: [{ date: '2026-11-15', kg: 76, source: 'manual', updated_at: '' }, { date: '2026-11-16', kg: 75.6, source: 'manual', updated_at: '' }],
    workouts: [],
    workoutPlan: { routine: 'A', at: 17 * 60 + 50, done: false },
    stepsGoal: 4000,
  });
};

describe('coach snapshot', () => {
  it('describes today with the same totals as the screens and passes its own schema', () => {
    const s = snap();
    expect(SnapshotZ.safeParse(s).success).toBe(true);
    expect(s.now).toMatchObject({ date: '2026-11-16', time: '12:30', dayNo: 2 });
    expect(s.meals.map((m) => [m.key, m.state])).toEqual([['breakfast', 'eaten'], ['lunch', 'pending'], ['snack', 'pending'], ['post', 'pending'], ['dinner', 'pending']]);
    expect(s.totals).toEqual({ eatenKcal: 295, eatenProtein: 21, projectedKcal: 1390, projectedProtein: 129 });
    expect(s.target.kcal).toBe(1390);
    expect(s.weight.today).toBe(75.6);
    expect(snapshotForModel(s)).toMatch(/^<context>\n\{.*\}\n<\/context>$/s);
  });

  it('applies template overrides and day adjustments before reporting meals', () => {
    const d = day();
    const s = buildSnapshot({
      now: new Date(2026, 10, 16, 9, 0), program: DEFAULT_PROGRAM, day: d,
      baseMeals: plan({ scen: 'home', eatout: 'lunch', wake: d.wake_min }),
      override: { meals: { snack: { removed: true } } },
      adjustments: [{ slot: 'lunch', source: 'rebalance', change: { kind: 'cut', kcal_delta: -100, protein_delta: -2, label: '햇반 반 공기만', cut_id: 'lunch-rice-half' } }],
      entries: [], weights: [], workouts: [], workoutPlan: null, stepsGoal: 4000,
    });
    expect(s.meals.map((m) => m.key)).toEqual(['breakfast', 'lunch', 'post', 'dinner']);
    expect(s.meals.find((m) => m.key === 'lunch')).toMatchObject({ kcal: 350, changes: ['햇반 반 공기만'] });
  });
});

describe('tool input validation', () => {
  it('accepts a well-formed log_food input', () => {
    const r = parseToolInput('log_food', { slot: 'lunch', name: '순대국', amount: '1그릇 + 밥 반 공기', nutrition: { basis: 'estimate', kcal: 750, protein: 32 }, confidence: 0.6, source: 'text' });
    expect(r.ok).toBe(true);
  });

  it('rejects missing fields, wrong enums, out-of-range numbers and unknown tools', () => {
    const missing = parseToolInput('log_food', { slot: 'lunch', name: '순대국' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/nutrition/);
    expect(parseToolInput('log_food', { slot: 'brunch', name: 'a', amount: '1', nutrition: { basis: 'estimate', kcal: 1, protein: 1 }, confidence: 1, source: 'text' }).ok).toBe(false);
    expect(parseToolInput('log_food', { slot: 'lunch', name: 'a', amount: '1', nutrition: { basis: 'estimate', kcal: 99999, protein: 1 }, confidence: 1, source: 'text' }).ok).toBe(false);
    expect(parseToolInput('skip_meal', { slot: 'dinner', reason: 'x'.repeat(500) }).ok).toBe(false);
    expect(parseToolInput('delete_everything', {}).ok).toBe(false);
  });

  it('treats a silently truncated streaming input as invalid', () => {
    // what a tolerant partial-JSON parser returns when the input was cut off mid-object
    expect(parseToolInput('propose_plan_change', { changes: [{ slot: 'snack' }], effective: 'today' }).ok).toBe(false);
  });

  it('exposes JSON schemas without $schema and with required fields', () => {
    const t = COACH_TOOLS.find((x) => x.name === 'log_food')!;
    expect(t.input_schema.type).toBe('object');
    expect(t.input_schema).not.toHaveProperty('$schema');
    expect(t.input_schema.required).toEqual(expect.arrayContaining(['slot', 'name', 'nutrition']));
    expect(COACH_TOOLS.map((x) => x.name).sort()).toEqual(['adjust_workout', 'log_food', 'propose_day_adjustment', 'propose_plan_change', 'rebalance_today', 'skip_meal']);
  });

  it('validates the chat request body', () => {
    const ok = ChatRequestZ.safeParse({ threadId: '0b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c', message: '점심에 순대국 먹었어', snapshot: snap() });
    expect(ok.success).toBe(true);
    expect(ChatRequestZ.safeParse({ threadId: 'nope', message: 'hi', snapshot: snap() }).success).toBe(false);
    expect(ChatRequestZ.safeParse({ threadId: '0b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c', message: '', snapshot: snap() }).success).toBe(false);
    expect(ChatRequestZ.safeParse({ threadId: '0b8f8c52-6c55-4a3f-9f43-1c1f1d1a2b3c', message: 'x', images: [{ media_type: 'image/gif', data: 'AAAAAAAAAAAAAAAAAAAA' }], snapshot: snap() }).success).toBe(false);
  });
});

describe('cards to rows', () => {
  const run = (s: CoachSession, name: Parameters<CoachSession['run']>[0], input: unknown) => {
    const p = parseToolInput(name, input);
    if (!p.ok) throw new Error(p.error);
    const out = s.run(name, p.data);
    if (out.card) expect(CardZ.safeParse(out.card).success).toBe(true);
    return out;
  };

  it('log_food replaces the slot and moves the projected total', () => {
    const s = new CoachSession(snap(), 't');
    const out = run(s, 'log_food', { slot: 'lunch', name: '순대국', amount: '1그릇', nutrition: { basis: 'estimate', kcal: 750, protein: 32 }, confidence: 0.6, source: 'text' });
    expect(out.card!.rows).toEqual([{ op: 'meal_entry', date: '2026-11-16', slot: 'lunch', name: '순대국', amount: '1그릇', kcal: 750, protein: 32, source: 'ai_text', confidence: 0.6, note: null }]);
    expect(out.card!.delta).toEqual({ kcal: 300, protein: 10 }); // planned lunch was 450 kcal / 22 g
    expect(out.card!.focus).toEqual({ slot: 'lunch' });
    expect(out.result).toMatchObject({ day: { projected_kcal_after: 1690, over_target_after: 300 } });
  });

  it('computes label nutrition on the server: per 100 g vs per serving', () => {
    const a = run(new CoachSession(snap(), 't'), 'log_food', { slot: 'extra', name: 'Protein bar', amount: '45g', nutrition: { basis: 'label_per_100g', per100: { kcal: 380, protein: 30 }, grams: 45 }, confidence: 0.95, source: 'label' });
    expect(a.card!.rows[0]).toMatchObject({ slot: 'extra', kcal: 171, protein: 14, source: 'label', note: '100g당 380kcal × 45g' });
    const b = run(new CoachSession(snap(), 't'), 'log_food', { slot: 'extra', name: '그래놀라', amount: '2봉', nutrition: { basis: 'label_per_serving', perServing: { kcal: 180, protein: 4 }, servingDesc: '1봉 (40g)', servings: 2 }, confidence: 0.95, source: 'label' });
    expect(b.card!.rows[0]).toMatchObject({ kcal: 360, protein: 8 });
  });

  it('rebalance after an over-target lunch trims carbs, not protein, and keeps the floor', () => {
    const s = new CoachSession(snap(), 't');
    run(s, 'log_food', { slot: 'lunch', name: '순대국', amount: '1그릇', nutrition: { basis: 'estimate', kcal: 750, protein: 32 }, confidence: 0.6, source: 'text' });
    const out = run(s, 'rebalance_today', { reason: '점심 순대국' });
    const rows = out.card!.rows;
    expect(rows.every((r) => r.op === 'adjustment')).toBe(true);
    const today = rows.filter((r) => r.op === 'adjustment' && r.date === '2026-11-16');
    expect(today.map((r) => r.op === 'adjustment' && r.change.cut_id)).toEqual(['snack-nuts', 'post-water', 'dinner-dressing']);
    expect(out.card!.totals.after.protein).toBeGreaterThanOrEqual(110);
    // what could not fit today is carried to tomorrow
    expect(rows.some((r) => r.op === 'adjustment' && r.date === '2026-11-17' && r.change.kind === 'carry')).toBe(true);
  });

  it('skip_meal writes one skip row and reports the protein gap', () => {
    const out = run(new CoachSession(snap(), 't'), 'skip_meal', { slot: 'snack' });
    expect(out.card!.rows).toEqual([{ op: 'skip_meal', date: '2026-11-16', slot: 'snack' }]);
    expect(out.card!.delta).toEqual({ kcal: -250, protein: -29 });
    expect(out.result).toMatchObject({ protein_gap: 10 });
  });

  it('plan change merges into the active override and warns when protein drops under the floor', () => {
    const out = run(new CoachSession(snap(), 't'), 'propose_plan_change', {
      changes: [{ slot: 'snack', remove: true }], effective: 'tomorrow', title: '간식 빼기', reason: '배가 안 고픔',
    });
    expect(out.card!.rows).toEqual([{ op: 'plan', effective_from: '2026-11-17', override: { meals: { snack: { removed: true } } }, note: '배가 안 고픔' }]);
    expect(out.result).toMatchObject({ protein_below_floor: true, plan_day_protein_after: 100 });
  });

  it('item-level edit keeps kcal when only the how-to-eat note changes', () => {
    const items = [{ name: '프로틴 (더블리치초콜릿)', amount: '1스쿱', note: '저지방 우유 200ml 에 타서 흔들기 · 물이면 300ml' }, { name: '저지방 우유', amount: '200ml' }];
    const out = run(new CoachSession(snap(), 't'), 'propose_plan_change', { changes: [{ slot: 'post', items }], effective: 'today', title: '프로틴 먹는 법', reason: '질문' });
    const row = out.card!.rows[0]!;
    expect(row.op === 'plan' && row.override.meals?.post).toMatchObject({ items, note: '프로틴 먹는 법' });
    expect(out.card!.delta.kcal).toBe(0);
  });

  it('day adjustment and workout change write plan_adjustments rows for today', () => {
    const s = new CoachSession(snap(), 't');
    const a = run(s, 'propose_day_adjustment', { slot: 'dinner', kind: 'add', label: '닭가슴살 +1', kcal_delta: 120, protein_delta: 24, reason: '간식 건너뜀' });
    expect(a.card!.rows[0]).toMatchObject({ op: 'adjustment', date: '2026-11-16', slot: 'dinner', change: { kind: 'add', kcal_delta: 120, protein_delta: 24 } });
    const w = run(s, 'adjust_workout', { action: 'walk_instead', minutes: 30, steps_delta: 3000, label: '홈트 대신 30분 걷기', reason: '무릎' });
    expect(w.card!.rows[0]).toMatchObject({ op: 'adjustment', slot: null, change: { target: 'workout', kcal_delta: 0, workout: { action: 'walk_instead', minutes: 30 }, steps_delta: 3000 } });
    expect(w.card!.focus).toEqual({ slot: null, workout: true });
    expect(a.card!.id).not.toBe(w.card!.id);
  });

  it('refuses to adjust a meal that is already logged', () => {
    const out = new CoachSession(snap(), 't').run('propose_day_adjustment', { slot: 'breakfast', kind: 'cut', label: 'x', kcal_delta: -50, protein_delta: 0, reason: 'x' });
    expect(out.isError).toBe(true);
    expect(out.card).toBeUndefined();
  });
});

describe('client stream', () => {
  it('parses split SSE frames and skips pings', async () => {
    const { createSSEParser } = await import('../src/coach');
    const feed = createSSEParser();
    expect(feed(': ping\n\nid: 1\nevent: text\ndata: {"type":"te')).toEqual([]);
    expect(feed('xt","delta":"안녕"}\n\nid: 2\nevent: done\ndata: {"type":"done","stopReason":"end_turn"}\n\n')).toEqual([
      { type: 'text', delta: '안녕' }, { type: 'done', stopReason: 'end_turn' },
    ]);
  });

  it('folds events into ordered parts and updates steps in place', async () => {
    const { newAssistantTurn, reduceTurn, historyFor, setCardState } = await import('../src/coach');
    let t = newAssistantTurn('a', 0);
    t = reduceTurn(t, { type: 'status', id: 'ctx', label: '오늘 기록 확인 중', state: 'running', kind: 'context' });
    t = reduceTurn(t, { type: 'status', id: 'ctx', label: '오늘 기록 확인함', state: 'done', kind: 'context' });
    t = reduceTurn(t, { type: 'status', id: 'tu1', label: '칼로리 계산 중', state: 'running', kind: 'tool' });
    t = reduceTurn(t, { type: 'text', delta: '점심을 ' });
    t = reduceTurn(t, { type: 'text', delta: '기록합니다.' });
    const s = new CoachSession(snap(), 'x');
    const card = s.run('skip_meal', { slot: 'snack' }).card!;
    t = reduceTurn(t, { type: 'card', card });
    t = reduceTurn(t, { type: 'status', id: 'tu1', label: '계산함', state: 'done', kind: 'tool' });
    t = reduceTurn(t, { type: 'done', stopReason: 'end_turn' }, 9000);
    expect(t.parts.map((p) => p.kind)).toEqual(['steps', 'text', 'card']);
    expect(t.parts[0]).toEqual({ kind: 'steps', steps: [{ id: 'ctx', label: '오늘 기록 확인함', state: 'done', kind: 'context' }, { id: 'tu1', label: '계산함', state: 'done', kind: 'tool' }] });
    expect(t.status).toBe('done');
    t = setCardState(t, card.id, 'applied');
    const h = historyFor([{ role: 'user', id: 'u', text: '간식 건너뛸래', images: [] }, t]);
    expect(h[1]!.text).toBe('점심을 기록합니다.\n\n[변경 카드: 간식 건너뛰기 · 사용자가 적용함]');
  });
});
