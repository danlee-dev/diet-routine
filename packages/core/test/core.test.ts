import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRAM, dayCtx, decodeLegacyBackup, dueOrders, hhmm, legacyToRows, plan, previousWeight, schedule, sgn,
  stepsGoal, summary, trend, weightSeries, weightStats, type MealEntryRow,
} from '../src';

const P = DEFAULT_PROGRAM;

describe('schedule', () => {
  it('returns null without a wake time', () => {
    expect(schedule(null)).toBeNull();
  });

  it('matches the legacy page for a 09:40 wake', () => {
    const s = schedule(9 * 60 + 40)!;
    expect([s.b, s.l, s.s, s.d].map(hhmm)).toEqual(['10:10', '13:50', '16:50', '19:30']);
    expect(s.merge).toBe(false);
    expect(hhmm(s.workout!)).toBe('17:50');
  });

  it('merges snack into the first meal for a 13:56 wake', () => {
    const s = schedule(13 * 60 + 56)!;
    expect(s.merge).toBe(true);
    expect([s.b, s.l, s.d].map(hhmm)).toEqual(['14:30', '17:00', '19:30']);
    expect(s.workout).toBeNull();
  });

  it('keeps dinner by 19:00 on an early day and caps stretching', () => {
    const s = schedule(6 * 60)!;
    expect(s.d).toBeLessThanOrEqual(19 * 60 + 30);
    expect(s.b).toBe(6 * 60 + 30);
  });
});

describe('plan', () => {
  it('uses carry snack when going out', () => {
    const p = plan({ scen: 'out', eatout: 'lunch', wake: null });
    expect(p.find((m) => m.key === 'snack')!.name).toBe('간식 (밖에서)');
  });

  it('replaces the chosen slot when eating out', () => {
    const p = plan({ scen: 'eatout', eatout: 'dinner', wake: null });
    const d = p.find((m) => m.key === 'dinner')!;
    expect(d.name).toBe('저녁 (외식)');
    expect(d.est).toBe(true);
  });

  it('fixes late-home dinner at 19:00', () => {
    const p = plan({ scen: 'lateHome', eatout: 'lunch', wake: 8 * 60 });
    expect(p.find((m) => m.key === 'dinner')!.at).toBe(19 * 60);
  });

  it('totals 1,390 kcal / 129 g on a home day', () => {
    const s = summary(plan({ scen: 'home', eatout: 'lunch', wake: null }), []);
    expect([s.total, s.totalProtein, s.eaten]).toEqual([1390, 129, 0]);
  });
});

describe('summary with entries', () => {
  const base = { kind: 'plan' as const, deleted_at: null };
  it('counts replaced meals at their logged kcal and adds extras', () => {
    const p = plan({ scen: 'home', eatout: 'lunch', wake: null });
    const entries: Pick<MealEntryRow, 'slot' | 'kind' | 'kcal' | 'protein_g' | 'deleted_at'>[] = [
      { ...base, slot: 'breakfast', kcal: 295, protein_g: 21 },
      { ...base, slot: 'lunch', kind: 'replace', kcal: 800, protein_g: 35 },
      { ...base, slot: 'extra', kind: 'extra', kcal: 120, protein_g: 2 },
      { ...base, slot: 'snack', kcal: 250, protein_g: 29, deleted_at: '2026-11-15T10:00:00Z' },
    ];
    const s = summary(p, entries);
    expect(s.done).toBe(2);
    expect(s.eaten).toBe(295 + 800 + 120);
    expect(s.total).toBe(1390 - 450 + 800 + 120);
  });
});

describe('program', () => {
  it('computes day and week numbers', () => {
    const c = dayCtx(P, new Date(2026, 10, 22, 9, 0));
    expect([c.idx, c.no, c.week, c.key]).toEqual([7, 8, 2, '2026-11-22']);
    expect(stepsGoal(c.week)).toBe(5500);
  });
});

describe('weight', () => {
  const rows = [
    { date: '2026-11-15', kg: 76, deleted_at: null },
    { date: '2026-11-16', kg: 75.6, deleted_at: null },
    { date: '2026-11-17', kg: 75.8, deleted_at: null },
    { date: '2026-11-18', kg: 75.2, deleted_at: null },
    { date: '2026-11-19', kg: 75.0, deleted_at: null },
    { date: '2026-11-20', kg: 99, deleted_at: '2026-11-20T00:00:00Z' },
  ];
  it('builds a series, ignoring deleted rows', () => {
    expect(weightSeries(P, rows, 10).map((p) => p.w)).toEqual([76, 75.6, 75.8, 75.2, 75]);
  });
  it('projects with 5+ points and reports a losing rate', () => {
    const st = weightStats(P, weightSeries(P, rows, 10));
    expect(st.ratePerWeek!).toBeLessThan(0);
    expect(st.projection!).toBeLessThan(75);
  });
  it('smooths the trend', () => {
    const t = trend(weightSeries(P, rows, 10));
    expect(t[t.length - 1]!.w).toBeGreaterThan(75);
    expect(t[t.length - 1]!.w).toBeLessThan(76);
  });
  it('finds the previous weight', () => {
    expect(previousWeight(P, rows, 4)).toBe(75.2);
  });
  it('formats signed values', () => {
    expect([sgn(-0.04), sgn(0.26), sgn(-1)]).toEqual(['0.0', '+0.3', '-1.0']);
  });
});

describe('orders', () => {
  it('shows day-1 tangerine on day 0 and Monday weekly list', () => {
    const list = dueOrders({ dayIdx: 0, dow: 1, dayKey: '2026-11-16', done: new Set() });
    expect(list.map((x) => x.id)).toEqual(['tangerine@1', 'weekly@2026-11-16']);
  });
  it('hides done orders', () => {
    expect(dueOrders({ dayIdx: 0, dow: 0, dayKey: '2026-11-15', done: new Set(['tangerine@1']) })).toEqual([]);
  });
});

describe('legacy import', () => {
  it('converts a backup code into rows', () => {
    const raw = {
      'dp:checks:2026-11-15': JSON.stringify(['breakfast', 'lunch']),
      'dp:scen:2026-11-15': JSON.stringify('late'),
      'dp:wake:2026-11-15': JSON.stringify(582),
      'dp:water:2026-11-15': JSON.stringify(3),
      'dp:steps:2026-11-15': JSON.stringify(4200),
      'dp:weight:2026-11-15': JSON.stringify(75.4),
      'dp:workout:2026-11-15': JSON.stringify('B'),
      'dp:shop': JSON.stringify(['n1']),
      'dp:cycle': JSON.stringify(['tangerine@1']),
      'dp:sound': JSON.stringify(true),
      other: 'x',
    };
    // Same encoding as the legacy page: btoa(unescape(encodeURIComponent(json)))
    const code = Buffer.from(JSON.stringify(raw), 'utf8').toString('base64');
    let n = 0;
    const rows = legacyToRows(decodeLegacyBackup(code), () => `id-${++n}`);
    expect(rows.days).toHaveLength(1);
    expect(rows.days[0]).toMatchObject({ date: '2026-11-15', scenario: 'late', wake_min: 582, water_cups: 3, steps: 4200 });
    expect(rows.entries.map((e) => e.slot)).toEqual(['breakfast', 'lunch']);
    expect(rows.weights).toEqual([{ date: '2026-11-15', kg: 75.4, source: 'manual', deleted_at: null }]);
    expect(rows.workouts[0]!.type).toBe('home_b');
    expect(rows.checklist.map((c) => `${c.list}:${c.item_key}`)).toEqual(['shop:n1', 'cycle:tangerine@1']);
  });
});

describe('keypad', () => {
  it('replaces the shown value on the first digit, then appends', async () => {
    const { keypadReduce } = await import('../src');
    let s = { n: 3200, fresh: true };
    for (const k of ['5', '2', '0', '0']) s = keypadReduce(s, k);
    expect(s.n).toBe(5200);
    s = keypadReduce(s, '+1000');
    expect(s.n).toBe(6200);
    s = keypadReduce(s, 'b');
    expect(s.n).toBe(620);
    for (const k of ['1', '2', '3']) s = keypadReduce(s, k);
    expect(s.n).toBe(62012); // capped at 5 digits
    expect(keypadReduce({ n: 4000, fresh: true }, 'b').n).toBe(400);
    expect(keypadReduce(s, 'c').n).toBe(0);
  });
});

describe('plan changes and rebalance', () => {
  it('removes a meal and edits items from a template override', async () => {
    const { applyPlanChanges } = await import('../src');
    const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }), {
      meals: { snack: { removed: true }, post: { items: [{ name: '프로틴', amount: '1스쿱', note: '저지방 우유 200ml 에 타서 흔들기' }], note: '코치가 먹는 법 추가' } },
    });
    expect(meals.map((m) => m.key)).toEqual(['breakfast', 'lunch', 'post', 'dinner']);
    expect(meals.find((m) => m.key === 'post')!.items[0]!.note).toContain('우유');
    expect(meals.find((m) => m.key === 'post')!.edited).toBe('코치가 먹는 법 추가');
  });

  it('applies day adjustments and carried-over targets', async () => {
    const { applyPlanChanges, adjustedTarget } = await import('../src');
    const adj = [
      { slot: 'lunch' as const, source: 'rebalance' as const, change: { kind: 'cut' as const, kcal_delta: -100, protein_delta: -2, label: '햇반 반 공기만' } },
      { slot: null, source: 'rebalance' as const, change: { kind: 'carry' as const, kcal_delta: -150, label: '어제 넘친 만큼' } },
    ];
    const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }), null, adj);
    const lunch = meals.find((m) => m.key === 'lunch')!;
    expect([lunch.kcal, lunch.protein, lunch.changes]).toEqual([350, 20, ['햇반 반 공기만']]);
    expect(adjustedTarget(1390, adj)).toBe(1240);
  });

  it('trims carbs first, keeps protein, and carries the rest', async () => {
    const { rebalance, applyPlanChanges } = await import('../src');
    const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }));
    // breakfast as planned, lunch replaced by fried chicken (half): 1150 kcal / 70 g
    const p = rebalance({ meals, logged: new Set(['breakfast', 'lunch']), eatenKcal: 295 + 1150, eatenProtein: 21 + 70, target: 1390, proteinFloor: 110, appliedCuts: new Set() });
    expect(p.over).toBe(295 + 1150 + 250 + 210 + 185 - 1390);
    expect(p.cuts.map((c) => c.id)).toEqual(['snack-nuts', 'post-water', 'dinner-dressing']);
    expect(p.cuts.every((c) => c.slot !== 'lunch' && c.slot !== 'breakfast')).toBe(true);
    expect(p.carry.length).toBeGreaterThan(0);
    expect(p.carry.every((c) => c.kcal <= 200)).toBe(true);
    expect(p.after.protein).toBeGreaterThanOrEqual(110);
  });

  it('suggests a protein top-up after skipping meals', async () => {
    const { rebalance, applyPlanChanges } = await import('../src');
    const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }));
    const p = rebalance({ meals, logged: new Set(['breakfast', 'lunch', 'snack']), eatenKcal: 0, eatenProtein: 0, target: 1390, proteinFloor: 110, appliedCuts: new Set() });
    expect(p.over).toBeLessThan(0);
    expect(p.cuts).toEqual([]);
    expect(p.proteinAdds.length).toBeGreaterThan(0);
    expect(p.proteinAdds[0]!.slot).toBe('dinner');
  });
});
