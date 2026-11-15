import { describe, expect, it } from 'vitest';
import {
  adaptiveTarget, adaptiveText, addDays, applyPlanChanges, arrivalText, carryDays, eul, estimateMaintenance, goalArrival, keyOf, keptDay,
  overshootFor, overshootText, parseKey, plan, recapRange, saltyDay, skipPattern, skipPlanChange, skipText, trendByDate, trendOn,
  waterNoteText, waterWeightNote, weeklyRecap, weeklyReportText,
  type DatedWeight, type IntakeDay, type MealEntryRow, type MealKey, type RecapDay, type SlotDay,
} from '../src';

const key = (start: string, i: number) => keyOf(addDays(parseKey(start), i));
/** Weights on a straight line, `perDay` kg per day, with an optional daily wobble. */
const line = (start: string, days: number, from: number, perDay: number, wobble = 0): DatedWeight[] =>
  Array.from({ length: days }, (_, i) => ({ key: key(start, i), kg: Math.round((from + perDay * i + (i % 2 ? wobble : -wobble)) * 10) / 10 }));

describe('trend and arrival date', () => {
  it('smooths daily noise: the trend moves less than the points', () => {
    const w = line('2026-11-01', 14, 76, -0.1, 0.4);
    const t = trendByDate(w);
    const jumps = (a: DatedWeight[]) => Math.max(...a.slice(1).map((p, i) => Math.abs(p.kg - a[i]!.kg)));
    expect(jumps(t)).toBeLessThan(jumps(w) / 3);
    expect(trendOn(t, '2026-10-30')).toBeNull();
    expect(trendOn(t, '2026-11-20')).toBe(t[t.length - 1]!.kg);
  });

  it('dates the goal at the current rate', () => {
    const w = line('2026-11-01', 21, 76, -0.1);
    const a = goalArrival(w, 70);
    expect(a.kind).toBe('eta');
    if (a.kind !== 'eta') return;
    expect(a.ratePerWeek).toBe(-0.7);
    // the smoothed trend lags the line by about a kilogram, so arrival is roughly (trend - 70) / 0.1 days out
    expect(a.days).toBeGreaterThan(40);
    expect(a.days).toBeLessThan(60);
    expect(arrivalText(a, 70)).toMatch(/^지금 추세면 70\.0kg에 \d+\/\d+ \(.\)쯤 닿습니다 · 주 0\.7kg$/);
  });

  it('gives no date when flat or gaining, or with too few weigh-ins', () => {
    expect(goalArrival(line('2026-11-01', 21, 75, 0.02), 70).kind).toBe('flat');
    expect(arrivalText(goalArrival(line('2026-11-01', 21, 75, 0.05), 70), 70)).toContain('오르고');
    expect(goalArrival(line('2026-11-01', 3, 75, -0.2), 70).kind).toBe('unknown');
    expect(goalArrival([{ key: '2026-11-01', kg: 69.8 }], 70).kind).toBe('reached');
  });
});

describe('water weight after a salty day', () => {
  const e = (name: string, kind: MealEntryRow['kind'] = 'replace', sodium_mg: number | null = null) => ({ name, kind, sodium_mg, deleted_at: null });

  it('finds eating out by name, by sodium, or by the situation', () => {
    expect(saltyDay([e('짜장면'), e('달걀', 'plan')])).toEqual({ names: ['짜장면'] });
    expect(saltyDay([e('닭가슴살 샐러드', 'replace', 1800), e('김치', 'extra', 1400)])).toEqual({ names: ['닭가슴살 샐러드', '김치'] });
    expect(saltyDay([e('달걀', 'plan')], 'eatout')).toEqual({ names: ['외식'] });
    expect(saltyDay([e('달걀', 'plan'), e('짜장면', 'skip')])).toBeNull();
  });

  it('explains a jump of 0.4 kg or more after it, with the trend that did not move', () => {
    const n = waterWeightNote(74.9, 74.1, { names: ['짜장면'] }, 74.2)!;
    expect(n.jump).toBe(0.8);
    expect(waterNoteText(n)).toEqual({
      title: '외식 다음 날의 물 무게입니다',
      body: '어제 먹은 짜장면 때문에 소금이 많아 물이 0.8kg 붙었습니다. 2~3일이면 빠지고, 추세는 74.2kg 그대로입니다.',
    });
    expect(waterWeightNote(74.3, 74.1, { names: ['짜장면'] }, 74.2)).toBeNull();
    expect(waterWeightNote(74.9, 74.1, null, 74.2)).toBeNull();
  });
});

describe('maintenance and adaptive target', () => {
  const start = '2026-11-01';
  const intake = (n: number, kcal: number, complete = true): IntakeDay[] => Array.from({ length: n }, (_, i) => ({ key: key(start, i), kcal, complete }));

  it('adds the energy of the weight change to the average intake', () => {
    // 1,400 kcal a day while losing 0.1 kg a day: 1,400 + 770 = 2,170
    const est = estimateMaintenance(intake(14, 1400), line(start, 14, 76, -0.1))!;
    expect(est.kcal).toBe(2170);
    expect(est.days).toBe(14);
    expect(est.ratePerWeek).toBe(-0.7);
  });

  it('waits for 10 complete days and enough weigh-ins', () => {
    expect(estimateMaintenance(intake(9, 1400), line(start, 14, 76, -0.1))).toBeNull();
    expect(estimateMaintenance(intake(14, 1400, false), line(start, 14, 76, -0.1))).toBeNull();
    expect(estimateMaintenance(intake(14, 1400), line(start, 4, 76, -0.1))).toBeNull();
  });

  it('proposes a lower target when losing too slowly, aiming inside 0.7-1.0 kg a week', () => {
    // 1,800 kcal at 2,300 maintenance is 0.45 kg/week; 0.75 would be 1,480, held at the male minimum 1,500
    const p = adaptiveTarget({ kcal: 2300, days: 14, intake: 1800, ratePerWeek: -0.45 }, 1800, 'male')!;
    expect(p.next).toBe(1500);
    expect(p.nextPace).toBeGreaterThanOrEqual(0.7);
    expect(p.nextPace).toBeLessThanOrEqual(1.0);
    expect(adaptiveText(p).title).toBe('하루 목표를 1,500kcal로 바꿀까요?');
    expect(adaptiveText(p).body).toContain('주 0.5kg씩 빠져 느립니다');
  });

  it('raises a target that loses too fast, and stays quiet on pace', () => {
    // 1,200 at 2,400 maintenance is 1.1 kg/week
    const fast = adaptiveTarget({ kcal: 2400, days: 12, intake: 1200, ratePerWeek: -1.1 }, 1200, 'female')!;
    expect(fast.next).toBe(1360);
    expect(fast.nextPace).toBeLessThanOrEqual(1.0);
    expect(adaptiveText(fast).body).toContain('너무 빠릅니다');
    // big gaps move 300 at a time
    expect(adaptiveTarget({ kcal: 3000, days: 12, intake: 1200, ratePerWeek: -1.6 }, 1200, 'female')!.next).toBe(1500);
    expect(adaptiveTarget({ kcal: 2200, days: 12, intake: 1400, ratePerWeek: -0.7 }, 1400, 'male')).toBeNull();
  });

  it('never goes under the sex minimum, or under a current target already below it', () => {
    const p = adaptiveTarget({ kcal: 1900, days: 12, intake: 1600, ratePerWeek: -0.3 }, 1600, 'female')!;
    expect(p.next).toBeGreaterThanOrEqual(1200);
    // the owner's 1,390 is under the male 1,500 minimum: no lower proposal
    expect(adaptiveTarget({ kcal: 1800, days: 12, intake: 1390, ratePerWeek: -0.4 }, 1390, 'male')).toBeNull();
  });
});

describe('skip pattern', () => {
  const days = (n: number, skip: (dow: number) => boolean, slot: MealKey = 'breakfast'): SlotDay[] =>
    Array.from({ length: n }, (_, i) => {
      const k = key('2026-11-02', i); // a Monday
      const dow = parseKey(k).getDay();
      return { key: k, dow, planned: ['breakfast', 'lunch', 'snack', 'post', 'dinner'], slots: { [slot]: skip(dow) ? 'skip' : 'eaten', lunch: 'eaten' } };
    });

  it('finds a meal skipped on weekdays only', () => {
    const p = skipPattern(days(14, (d) => d >= 1 && d <= 5))!;
    expect(p).toEqual({ slot: 'breakfast', into: 'lunch', weekdays: true, skips: 10 });
  });

  it('needs four skips and half of the logged days', () => {
    expect(skipPattern(days(14, (d) => d === 1 || d === 3))).toBeNull();
    expect(skipPattern(days(14, () => true))).toMatchObject({ slot: 'breakfast', weekdays: false, skips: 14 });
  });

  it('moves dinner into the meal before it, never into 운동 후', () => {
    expect(skipPattern(days(14, () => true, 'dinner'))).toMatchObject({ slot: 'dinner', into: 'snack' });
  });

  it('turns the pattern into a plan that keeps the day total, on weekdays only', () => {
    const p = skipPattern(days(14, (d) => d >= 1 && d <= 5))!;
    const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }));
    const c = skipPlanChange(p, meals, null)!;
    const tue = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }), c.override, [], 2);
    const sun = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }), c.override, [], 0);
    const total = (ms: { kcal: number }[]) => ms.reduce((s, m) => s + m.kcal, 0);
    expect(tue.some((m) => m.key === 'breakfast')).toBe(false);
    expect(total(tue)).toBe(total(meals));
    expect(tue.find((m) => m.key === 'lunch')!.items.map((x) => x.name)).toContain('달걀');
    expect(sun.some((m) => m.key === 'breakfast')).toBe(true);
    expect(skipText(p, c)).toEqual({
      title: '평일 아침 빼고 점심 늘릴까요?',
      body: '최근 2주 동안 아침을 10번 건너뛰었습니다. 점심에 아침 몫 295kcal, 단백질 21g을 더해 하루 합계는 그대로입니다.',
    });
  });

  it('falls back to every day when either meal already has its own change', () => {
    const p = skipPattern(days(14, (d) => d >= 1 && d <= 5))!;
    const override = { meals: { lunch: { kcal: 500, note: '내가 바꿈' } } };
    const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }), override);
    const c = skipPlanChange(p, meals, override)!;
    expect(c.weekdays).toBe(false);
    expect(c.override.meals!.lunch!.dows).toBeUndefined();
    expect(c.override.meals!.lunch!.kcal).toBe(500 + 295);
  });

  it('merges the same item into one line', () => {
    const p = { slot: 'snack' as const, into: 'dinner' as const, weekdays: false, skips: 5 };
    const meals = applyPlanChanges(plan({ scen: 'home', eatout: 'lunch', wake: null }));
    const c = skipPlanChange(p, meals, null)!;
    const chicken = c.override.meals!.dinner!.items!.filter((x) => x.name.includes('닭가슴살'));
    expect(chicken).toEqual([expect.objectContaining({ amount: '2팩', kcal: 220 })]);
  });
});

describe('morning-after carry-over', () => {
  it('splits from today, 200 a day at most, never under 1,200', () => {
    expect(carryDays(900, 1390, 0)).toEqual([{ offset: 0, kcal: 190 }, { offset: 1, kcal: 190 }, { offset: 2, kcal: 190 }]);
    expect(carryDays(300, 1600, 0)).toEqual([{ offset: 0, kcal: 200 }, { offset: 1, kcal: 100 }]);
    expect(carryDays(500, 1200, 0)).toEqual([]);
  });

  it('suggests walking for what does not fit', () => {
    const o = overshootFor(1500, 1600)!;
    expect(o.stepsBonus).toBe(3000);
    expect(overshootText(o).body).toBe('오늘부터 3일 동안 하루 200kcal씩 줄이면 맞춰집니다. 나머지는 걸음 3,000보를 더 걸어 채웁니다. 한 번에 굶지 않아도 됩니다.');
    expect(overshootText(overshootFor(500, 1200)!).body).toContain('더 줄이지 않습니다');
  });
});

describe('weekly recap', () => {
  const d = (i: number, o: Partial<RecapDay> = {}): RecapDay => ({
    key: key('2026-11-16', i), eaten: 1380, target: 1390, complete: true, meals: 5, workout: false, runs: [], steps: 5000, stepsGoal: 7000, ...o,
  });

  it('uses this week from Wednesday, last week on Monday and Tuesday', () => {
    expect(recapRange('2026-11-19')).toEqual({ from: '2026-11-16', to: '2026-11-22' }); // Thursday
    expect(recapRange('2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' }); // Sunday
    expect(recapRange('2026-11-17')).toEqual({ from: '2026-11-09', to: '2026-11-15' }); // Tuesday
  });

  it('counts kept days, workouts and runs, and picks the best day', () => {
    const days = [
      d(0), d(1, { eaten: 1900 }), d(2, { workout: true, runs: [{ kind: 'run', km: 3.2 }], steps: 9100 }), d(3, { complete: false, eaten: 800 }),
      d(4, { runs: [{ kind: 'walk', km: 2.1 }] }), d(5), d(6),
    ];
    const weights = line('2026-11-10', 13, 75.4, -0.1);
    const r = weeklyRecap(days, { from: '2026-11-16', to: '2026-11-22' }, '2026-11-22', weights);
    expect(r.days).toBe(7);
    expect(r.kept).toBe(5);
    expect(keptDay(days[1]!)).toBe(false);
    expect(r.workouts).toBe(1);
    expect(r).toMatchObject({ runs: 1, runKm: 3.2, walks: 1, walkKm: 2.1 });
    expect(r.best).toEqual({ key: '2026-11-18', eaten: 1380, target: 1390, notes: ['1,380kcal', '홈트', '3.2km 달리기', '9,100보'] });
    expect(r.trend.delta).toBeLessThan(0);
    const t = weeklyReportText(r, '73.5~74.5kg');
    expect(t.title).toBe('이번 주 리포트');
    expect(t.body).toMatch(/^추세 \d+\.\dkg \(−\d\.\d\) · 지킨 날 5\/7일 · 홈트 1회 · 달리기 3\.2km\. 다음 주 목표는 73\.5~74\.5kg입니다\.$/);
  });

  it('names no best day in a week without a kept day', () => {
    const r = weeklyRecap([d(0, { eaten: 2000 }), d(1, { complete: false })], { from: '2026-11-16', to: '2026-11-22' }, '2026-11-17', []);
    expect(r.kept).toBe(0);
    expect(r.best).toBeNull();
  });

  it('only counts days up to today', () => {
    const r = weeklyRecap([d(0), d(1), d(2), d(3), d(4)], { from: '2026-11-16', to: '2026-11-22' }, '2026-11-18', []);
    expect(r.days).toBe(3);
    expect(r.trend).toEqual({ start: null, end: null, delta: null });
  });
});

describe('particles', () => {
  it('picks 을 or 를', () => {
    expect(eul('아침')).toBe('아침을');
    expect(eul('간식')).toBe('간식을');
    expect(eul('저녁')).toBe('저녁을');
    expect(eul('운동 후')).toBe('운동 후를');
  });
});
