import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_PREFS, cupsDueAt, expectedCups, hhmm, inQuiet, plan, planReminders, routineMinutes, wakeFromSleep,
  type MealKey, type ReminderDay, type ReminderPrefs, type ScenId,
} from '../src';

const H = (h: number, m = 0) => h * 60 + m;

function day(o: { wake?: number | null; now?: number; scen?: ScenId; eaten?: MealKey[]; cups?: number; weight?: number | null; dow?: number; week?: number } = {}): ReminderDay {
  const scen = o.scen ?? 'home';
  const wake = o.wake === undefined ? H(7) : o.wake;
  return {
    ctx: { key: '2026-11-17', dow: o.dow ?? 2, week: o.week ?? 1 },
    nowMin: o.now ?? H(6),
    scen,
    day: { wake_min: wake, water_cups: o.cups ?? 0 },
    meals: plan({ scen, eatout: 'lunch', wake }),
    eaten: new Set(o.eaten ?? []),
    weight: o.weight === undefined ? null : o.weight,
  };
}

const prefs = (p: Partial<ReminderPrefs> = {}): ReminderPrefs => ({ ...DEFAULT_REMINDER_PREFS, ...p, kinds: { ...DEFAULT_REMINDER_PREFS.kinds, ...p.kinds } });

describe('planReminders', () => {
  it('puts each meal at its shifted time with the actual menu', () => {
    const r = planReminders(day({ wake: H(9, 40), now: H(9, 45), weight: 74 }), null, prefs({ kinds: { water: false } as never }));
    const meals = r.filter((x) => x.kind === 'meal');
    expect(meals.map((x) => hhmm(x.at))).toEqual(['10:10', '13:50', '16:50', '19:30']);
    expect(meals[1]!.title).toBe('점심 13:50');
    expect(meals[1]!.body).toContain('한끼통살 큐브 1팩');
    expect(meals[1]!.meals).toEqual(['lunch']);
  });

  it('never schedules the past or logged meals', () => {
    const r = planReminders(day({ wake: H(7), now: H(12), eaten: ['breakfast'] }), null);
    expect(r.every((x) => x.at > H(12))).toBe(true);
    expect(r.some((x) => x.meals?.includes('breakfast'))).toBe(false);
  });

  it('skips skipped meals too (they are in eaten)', () => {
    const r = planReminders(day({ now: H(6), eaten: ['lunch'] }), null);
    expect(r.some((x) => x.meals?.includes('lunch'))).toBe(false);
  });

  it('merges slots that share a time into one notification', () => {
    // 13:56 wake: snack moves to the first meal
    const r = planReminders(day({ wake: H(13, 56), now: H(14), weight: 74 }), null);
    const first = r.find((x) => x.kind === 'meal')!;
    expect(first.meals).toEqual(['breakfast', 'snack']);
    expect(first.title).toBe('아침 14:30 · 간식 같이');
    const ids = r.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('asks for the wake time once, only while nothing is known', () => {
    const r = planReminders(day({ wake: null, now: H(6) }), null);
    expect(r.filter((x) => x.kind === 'wake').map((x) => hhmm(x.at))).toEqual(['09:00']);
    expect(r.some((x) => x.kind === 'meal')).toBe(false);
    expect(planReminders(day({ wake: null, now: H(10) }), null).some((x) => x.kind === 'wake')).toBe(false);
    expect(planReminders(day({ wake: null, now: H(6), eaten: ['breakfast'] }), null).some((x) => x.kind === 'wake')).toBe(false);
    expect(planReminders(day({ wake: null, now: H(6) }), null, prefs({ wakePromptAt: H(8, 30) })).find((x) => x.kind === 'wake')!.at).toBe(H(8, 30));
  });

  it('schedules the workout with routine name and minutes', () => {
    const r = planReminders(day({ wake: H(9, 40), now: H(10), week: 3, dow: 2 }), { routine: 'B', at: H(17, 50), done: false });
    const w = r.find((x) => x.kind === 'workout')!;
    expect(w.title).toBe('홈트 B 17:50');
    expect(w.body).toBe('하체 · 전신 · 4라운드 · 약 25분');
    expect(planReminders(day({ wake: H(9, 40), now: H(10) }), { routine: 'B', at: H(17, 50), done: true }).some((x) => x.kind === 'workout')).toBe(false);
  });

  it('warns 30 minutes before the dinner cutoff while dinner is open', () => {
    const r = planReminders(day({ wake: H(7), now: H(12) }), null);
    expect(r.find((x) => x.kind === 'cutoff')!.at).toBe(H(19, 30));
    expect(planReminders(day({ wake: H(7), now: H(12), eaten: ['dinner'] }), null).some((x) => x.kind === 'cutoff')).toBe(false);
  });

  it('folds the cutoff into a 19:30 dinner instead of sending two', () => {
    const r = planReminders(day({ wake: H(9, 40), now: H(10) }), null);
    expect(r.some((x) => x.kind === 'cutoff')).toBe(false);
    expect(r.find((x) => x.meals?.includes('dinner'))!.title).toBe('저녁 19:30 · 20:00 마감');
  });

  it('asks for the morning weight 10 minutes after waking, only when not logged', () => {
    expect(planReminders(day({ wake: H(7), now: H(7, 2) }), null).find((x) => x.kind === 'weigh')!.at).toBe(H(7, 10));
    expect(planReminders(day({ wake: H(7), now: H(7, 2), weight: 74.2 }), null).some((x) => x.kind === 'weigh')).toBe(false);
  });

  it('still asks for the weight when the wake time is entered late, within three hours of waking', () => {
    // 09:00 prompt answered with 07:00
    expect(planReminders(day({ wake: H(7), now: H(9, 2) }), null).find((x) => x.kind === 'weigh')!.at).toBe(H(9, 30));
    expect(planReminders(day({ wake: H(7), now: H(9, 55) }), null).some((x) => x.kind === 'weigh')).toBe(false);
  });

  it('nudges water only when the pace would be two cups ahead, at most twice', () => {
    const r = planReminders(day({ wake: H(7), now: H(7, 5), cups: 0 }), null).filter((x) => x.kind === 'water');
    expect(r).toHaveLength(2);
    expect(expectedCups(r[0]!.at, H(7))).toBeGreaterThanOrEqual(2);
    expect(r[0]!.title).toBe('물 1잔째를 마실 시간입니다');
    // on pace: no nudge before the next milestone
    const caught = planReminders(day({ wake: H(7), now: H(12), cups: 7 }), null).filter((x) => x.kind === 'water');
    expect(caught).toHaveLength(0);
  });

  it('sends no water nudge in the last hour before 22:00', () => {
    const r = planReminders(day({ wake: null, now: H(17) }), null).filter((x) => x.kind === 'water');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.at <= H(21))).toBe(true);
  });

  it('keeps water milestones stable so a fired nudge is not re-armed', () => {
    const a = planReminders(day({ wake: H(7), now: H(7, 5), cups: 1 }), null).filter((x) => x.kind === 'water');
    const firstAt = a[0]!.at;
    const b = planReminders(day({ wake: H(7), now: firstAt + 5, cups: 1 }), null).filter((x) => x.kind === 'water');
    expect(b.every((x) => x.at > firstAt)).toBe(true);
    expect(b.map((x) => x.id)).not.toContain(a[0]!.id);
  });

  it('ends a quiet window that starts at midnight at the wake time too', () => {
    expect(inQuiet(H(5, 40), { quietStart: 0, quietEnd: H(7) }, H(5, 30))).toBe(false);
    expect(inQuiet(H(5, 20), { quietStart: 0, quietEnd: H(7) }, H(5, 30))).toBe(true);
  });

  it('respects quiet hours, ended early by a known wake time', () => {
    expect(inQuiet(H(23, 30), DEFAULT_REMINDER_PREFS, null)).toBe(true);
    expect(inQuiet(H(6, 50), DEFAULT_REMINDER_PREFS, null)).toBe(true);
    expect(inQuiet(H(6, 50), DEFAULT_REMINDER_PREFS, H(6))).toBe(false);
    expect(inQuiet(H(12), { quietStart: H(12), quietEnd: H(13) }, null)).toBe(true);
    const late = planReminders(day({ wake: null, now: H(6) }), null, prefs({ wakePromptAt: H(6, 30) }));
    expect(late.some((x) => x.kind === 'wake')).toBe(false);
    const early = planReminders(day({ wake: H(5, 30), now: H(5, 31) }), null);
    expect(early.find((x) => x.kind === 'meal')!.at).toBe(H(6));
  });

  it('honors per-kind switches, the off-for-today switch and the daily cap', () => {
    const v = day({ wake: H(7), now: H(7, 1) });
    expect(planReminders(v, null, prefs({ kinds: { meal: false } as never })).some((x) => x.kind === 'meal')).toBe(false);
    expect(planReminders(v, null, prefs({ mutedOn: '2026-11-17' }))).toEqual([]);
    expect(planReminders(v, null, prefs({ enabled: false }))).toEqual([]);
    const capped = planReminders(v, { routine: 'A', at: H(17), done: false }, prefs({ maxPerDay: 4 }));
    expect(capped).toHaveLength(4);
    expect(capped.every((x) => x.kind === 'meal')).toBe(true);
    expect(capped.map((x) => x.at)).toEqual([...capped.map((x) => x.at)].sort((a, b) => a - b));
  });

  it('never plans a delivered reminder again and counts it toward the limits', () => {
    const v = day({ wake: H(7), now: H(7, 1) });
    const all = planReminders(v, { routine: 'A', at: H(17), done: false });
    const lunch = all.find((x) => x.meals?.includes('lunch'))!;
    // wake time corrected after lunch was delivered: lunch moves but is not sent twice
    const moved = planReminders({ ...day({ wake: H(7, 40), now: lunch.at + 5 }) }, null, DEFAULT_REMINDER_PREFS, new Set([lunch.id]));
    expect(moved.some((x) => x.id === lunch.id)).toBe(false);
    // cap: 8 a day including what was already sent
    const sent = new Set(all.slice(0, 6).map((x) => x.id));
    expect(planReminders({ ...v, nowMin: all[5]!.at }, { routine: 'A', at: H(17), done: false }, DEFAULT_REMINDER_PREFS, sent).length).toBeLessThanOrEqual(2);
  });

  it('sends at most two water nudges over the whole day', () => {
    // simulate the day minute by minute, marking what fires
    const sent = new Set<string>();
    for (let t = H(7, 1); t < H(22); t += 5) {
      const due = planReminders(day({ wake: H(7), now: t, weight: 74 }), { routine: 'A', at: H(17, 50), done: false }, DEFAULT_REMINDER_PREFS, sent);
      for (const r of due) if (r.at <= t + 5) sent.add(r.id);
    }
    expect([...sent].filter((id) => id.includes(':water:'))).toHaveLength(2);
    expect(sent.size).toBeLessThanOrEqual(DEFAULT_REMINDER_PREFS.maxPerDay);
  });

  it('has unique ids that stay the same when nothing changed', () => {
    const v = day({ wake: H(7), now: H(7, 1) });
    const a = planReminders(v, { routine: 'A', at: H(17), done: false }).map((x) => x.id);
    const b = planReminders({ ...v, nowMin: H(7, 3) }, { routine: 'A', at: H(17), done: false }).map((x) => x.id);
    expect(new Set(a).size).toBe(a.length);
    expect(b).toEqual(a);
  });
});

describe('wakeFromSleep', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 17, h, m);
  const now = at(9);
  it('takes the end of the last asleep stage of the morning', () => {
    const s = [{ start: at(0, 30), end: at(3, 40), asleep: true }, { start: at(3, 55), end: at(7, 12), asleep: true }, { start: at(0, 10), end: at(7, 30), asleep: false }];
    expect(wakeFromSleep(s, now)).toBe(H(7, 12));
  });
  it('falls back to in-bed and ignores naps and unsettled nights', () => {
    expect(wakeFromSleep([{ start: at(0), end: at(7, 5), asleep: false }], now)).toBe(H(7, 5));
    expect(wakeFromSleep([{ start: at(14), end: at(15), asleep: true }], at(16))).toBeNull();
    expect(wakeFromSleep([{ start: at(0), end: at(8, 55), asleep: true }], now)).toBeNull();
    expect(wakeFromSleep([], now)).toBeNull();
  });
});

describe('water pace and workout length', () => {
  it('has no pace for an evening wake', () => {
    expect(expectedCups(H(21, 30), H(21, 10))).toBe(0);
    expect(cupsDueAt(2, H(21, 10))).toBe(Infinity);
  });

  it('cupsDueAt is the first time expectedCups reaches the count', () => {
    for (const k of [1, 2, 4, 8]) {
      const at = cupsDueAt(k, H(7));
      expect(expectedCups(at, H(7))).toBeGreaterThanOrEqual(k);
      expect(expectedCups(at - 10, H(7))).toBeLessThan(k);
    }
  });

  it('estimates routine minutes from rounds and reps', () => {
    expect(routineMinutes('A', 1, 1)).toBe(15);
    expect(routineMinutes('B', 3, 2)).toBe(25);
    expect(routineMinutes('A', 3, 6)).toBe(20); // Saturday light day: 3 rounds
  });
});
