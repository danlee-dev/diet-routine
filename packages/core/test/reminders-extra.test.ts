import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_PREFS, hhmm, nextReduced, overshootFor, plan, planReminders, reminderIdParts, sameReduced,
  type MealKey, type ReminderDay, type ReminderOutcome, type ReminderPrefs,
} from '../src';

const H = (h: number, m = 0) => h * 60 + m;
const prefs = (p: Partial<ReminderPrefs> = {}): ReminderPrefs => ({ ...DEFAULT_REMINDER_PREFS, ...p, kinds: { ...DEFAULT_REMINDER_PREFS.kinds, ...p.kinds } });

function day(o: { wake?: number | null; now?: number; eaten?: MealKey[]; steps?: number; goal?: number; dow?: number; key?: string; weight?: number | null; cups?: number } = {}): ReminderDay {
  const wake = o.wake === undefined ? H(7) : o.wake;
  return {
    ctx: { key: o.key ?? '2026-11-17', dow: o.dow ?? 2, week: 1 },
    nowMin: o.now ?? H(13),
    scen: 'home',
    day: { wake_min: wake, water_cups: o.cups ?? 8, ...(o.steps != null ? { steps: o.steps } : {}) },
    meals: plan({ scen: 'home', eatout: 'lunch', wake }),
    eaten: new Set(o.eaten ?? []),
    weight: o.weight === undefined ? 74 : o.weight,
    ...(o.goal != null ? { stepsGoal: o.goal } : {}),
  };
}
const ALL: MealKey[] = ['breakfast', 'lunch', 'snack', 'post', 'dinner'];

describe('18:30 steps nudge', () => {
  it('suggests a walk at 18:30 when under 60% of the goal, with steps left and minutes', () => {
    const r = planReminders(day({ steps: 1700, goal: 4000, eaten: ALL }), null).find((x) => x.kind === 'steps')!;
    expect(hhmm(r.at)).toBe('18:30');
    expect(r.title).toBe('2,300보 남았습니다');
    expect(r.body).toBe('지금 23분 걸으면 오늘 목표 4,000보를 채웁니다.');
  });

  it('stays quiet at 60% or more, before noon, and without a step count', () => {
    expect(planReminders(day({ steps: 2400, goal: 4000 }), null).some((x) => x.kind === 'steps')).toBe(false);
    expect(planReminders(day({ steps: 0, goal: 4000, now: H(9) }), null).some((x) => x.kind === 'steps')).toBe(false);
    expect(planReminders(day({ goal: 4000 }), null).some((x) => x.kind === 'steps')).toBe(false);
    expect(planReminders(day({ steps: 100, goal: 4000, now: H(18, 40) }), null).some((x) => x.kind === 'steps')).toBe(false);
  });
});

describe('21:30 wrap-up', () => {
  it('lists the unlogged meals and carries them for "다 먹었어요"', () => {
    const r = planReminders(day({ now: H(18), eaten: ['breakfast', 'lunch', 'snack'] }), null).find((x) => x.kind === 'wrap')!;
    expect(hhmm(r.at)).toBe('21:30');
    expect(r.title).toBe('오늘 기록 마무리');
    expect(r.body).toBe('운동 후, 저녁 기록이 비어 있습니다. 계획대로 먹었으면 다 먹었어요 한 번으로 끝납니다.');
    expect(r.meals).toEqual(['post', 'dinner']);
  });

  it('says "모두" instead of listing every meal', () => {
    expect(planReminders(day({ now: H(18) }), null).find((x) => x.kind === 'wrap')!.body).toBe('오늘 끼니 기록이 모두 비어 있습니다. 계획대로 먹었으면 다 먹었어요 한 번으로 끝납니다.');
  });

  it('is not planned once every meal is logged', () => {
    expect(planReminders(day({ now: H(18), eaten: ALL }), null).some((x) => x.kind === 'wrap')).toBe(false);
  });

  it('gives its cap slot to the day reminders until the evening', () => {
    // a full morning: meals, weigh-in and water fill the cap, the wrap-up waits
    const morning = planReminders(day({ now: H(7, 5), weight: null, cups: 0 }), null);
    expect(morning).toHaveLength(DEFAULT_REMINDER_PREFS.maxPerDay);
    expect(morning.filter((x) => x.kind === 'water').length).toBeGreaterThan(0);
    expect(morning.some((x) => x.kind === 'wrap')).toBe(false);
    const evening = planReminders(day({ now: H(17, 10) }), null, prefs(), new Set());
    expect(evening.some((x) => x.kind === 'wrap')).toBe(true);
  });
});

describe('morning after a big overshoot', () => {
  it('explains the three-day split half an hour after waking', () => {
    const o = overshootFor(900, 1390)!;
    const r = planReminders(day({ wake: H(7), now: H(7, 5), eaten: ALL }), null, prefs(), new Set(), { overshoot: o }).find((x) => x.kind === 'carry')!;
    expect(hhmm(r.at)).toBe('07:30');
    expect(r.title).toBe('어제 목표보다 900kcal 많았습니다');
    expect(r.body).toContain('오늘부터 3일 동안 하루 190kcal씩 줄이면 맞춰집니다');
    expect(r.canApply).toBe(true);
  });

  it('describes cuts already in the plan without offering to apply them again', () => {
    const o = overshootFor(0, 1390, [{ offset: 0, kcal: 200 }, { offset: 1, kcal: 200 }, { offset: 2, kcal: 200 }])!;
    const r = planReminders(day({ wake: H(8), now: H(8, 1), eaten: ALL }), null, prefs(), new Set(), { overshoot: o }).find((x) => x.kind === 'carry')!;
    expect(r.body).toBe('오늘부터 3일 동안 하루 200kcal씩 덜 먹어 나눠 갚습니다. 한 번에 굶지 않아도 됩니다.');
    expect(r.canApply).toBe(false);
  });

  it('only in the morning, and not for small overshoots', () => {
    expect(overshootFor(250, 1390)).toBeNull();
    const o = overshootFor(600, 1390)!;
    expect(planReminders(day({ now: H(12, 30), eaten: ALL }), null, prefs(), new Set(), { overshoot: o }).some((x) => x.kind === 'carry')).toBe(false);
    // wake time entered late: the next half hour
    const late = planReminders(day({ wake: H(7), now: H(9, 50), eaten: ALL }), null, prefs(), new Set(), { overshoot: o }).find((x) => x.kind === 'carry')!;
    expect(hhmm(late.at)).toBe('10:00');
  });
});

describe('Sunday weekly report', () => {
  const weekly = { title: '이번 주 리포트', body: '추세 74.2kg (−0.6) · 지킨 날 5/7일.' };
  it('goes out at 20:00 on Sundays only', () => {
    const sun = planReminders(day({ dow: 0, key: '2026-11-22', now: H(13), eaten: ALL }), null, prefs(), new Set(), { weekly }).find((x) => x.kind === 'weekly')!;
    expect(hhmm(sun.at)).toBe('20:00');
    expect(sun.body).toBe(weekly.body);
    expect(planReminders(day({ dow: 2, now: H(13), eaten: ALL }), null, prefs(), new Set(), { weekly }).some((x) => x.kind === 'weekly')).toBe(false);
  });
});

describe('reduced kinds', () => {
  const o = (date: string, kind: ReminderOutcome['kind'], acted: boolean): ReminderOutcome => ({ date, kind, acted });

  it('reduces a kind ignored on each of the last three days', () => {
    const out = [o('2026-11-14', 'water', false), o('2026-11-15', 'water', false), o('2026-11-15', 'water', false), o('2026-11-16', 'water', false)];
    expect(nextReduced({}, out, '2026-11-17')).toEqual({ water: '2026-11-17' });
  });

  it('needs three days in a row and no reaction on any of them', () => {
    expect(nextReduced({}, [o('2026-11-14', 'water', false), o('2026-11-16', 'water', false)], '2026-11-17')).toEqual({});
    expect(nextReduced({}, [o('2026-11-14', 'meal', false), o('2026-11-15', 'meal', true), o('2026-11-15', 'meal', false), o('2026-11-16', 'meal', false)], '2026-11-17')).toEqual({});
  });

  it('never reduces the weekly report or the morning-after note', () => {
    const out = ['2026-11-14', '2026-11-15', '2026-11-16'].map((d) => o(d, 'carry', false));
    expect(nextReduced({}, out, '2026-11-17')).toEqual({});
  });

  it('goes back to normal after a reaction, and ignores days before a manual reset', () => {
    const ignored = ['2026-11-14', '2026-11-15', '2026-11-16'].map((d) => o(d, 'water', false));
    expect(nextReduced({ water: '2026-11-17' }, [...ignored, o('2026-11-18', 'water', true)], '2026-11-18')).toEqual({});
    expect(nextReduced({}, ignored, '2026-11-17', { water: '2026-11-17' })).toEqual({});
    expect(sameReduced({ water: 'a' }, { water: 'a' })).toBe(true);
    expect(sameReduced({ water: 'a' }, {})).toBe(false);
  });

  it('sends a reduced frequent kind once a day', () => {
    const v = day({ now: H(7, 1), weight: 74 });
    const meals = planReminders(v, null, prefs({ reduced: { meal: '2026-11-17' } })).filter((x) => x.kind === 'meal');
    expect(meals).toHaveLength(1);
    expect(meals[0]!.meals).toEqual(['breakfast']);
    // one already delivered today: no more
    const after = planReminders({ ...v, nowMin: meals[0]!.at + 1 }, null, prefs({ reduced: { meal: '2026-11-17' } }), new Set([meals[0]!.id]));
    expect(after.some((x) => x.kind === 'meal')).toBe(false);
  });

  it('sends a reduced once-a-day kind every other day', () => {
    const p = prefs({ reduced: { cutoff: '2026-11-16' } });
    const a = planReminders(day({ key: '2026-11-17', now: H(12) }), null, p).some((x) => x.kind === 'cutoff');
    const b = planReminders(day({ key: '2026-11-18', now: H(12) }), null, p).some((x) => x.kind === 'cutoff');
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('parses kinds back from ids', () => {
    expect(reminderIdParts('2026-11-17:meal:breakfast+snack')).toEqual({ date: '2026-11-17', kind: 'meal', subject: 'breakfast+snack' });
    expect(reminderIdParts('preview:x')).toBeNull();
  });
});

describe('caps and switches with the new kinds', () => {
  it('keeps the daily cap with every kind in play', () => {
    const r = planReminders(day({ now: H(12, 5), steps: 100, goal: 7000, weight: null }), { routine: 'A', at: H(17), done: false }, prefs(), new Set(),
      { overshoot: overshootFor(800, 1390), weekly: { title: 't', body: 'b' } });
    expect(r.length).toBeLessThanOrEqual(DEFAULT_REMINDER_PREFS.maxPerDay);
  });

  it('honors the switch of each new kind and quiet hours', () => {
    const v = day({ now: H(18), steps: 100, goal: 4000, eaten: ['breakfast'] });
    expect(planReminders(v, null, prefs({ kinds: { steps: false, wrap: false } as never })).some((x) => x.kind === 'steps' || x.kind === 'wrap')).toBe(false);
    expect(planReminders(v, null, prefs({ quietStart: H(21), quietEnd: H(7) })).some((x) => x.kind === 'wrap')).toBe(false);
  });

  it('treats kinds missing from saved preferences as on', () => {
    const old = { ...DEFAULT_REMINDER_PREFS, kinds: { meal: true, cutoff: true, workout: true, weigh: true, wake: true, water: true } } as unknown as ReminderPrefs;
    expect(planReminders(day({ now: H(18), eaten: ['breakfast'] }), null, old).some((x) => x.kind === 'wrap')).toBe(true);
  });
});
