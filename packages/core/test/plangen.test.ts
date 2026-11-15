import { describe, expect, it } from 'vitest';
import { computeTargets, generatePlan, type OnboardingAnswers, type PlanItem } from '../src';
import {
  AiPlanZ, assemblePlan, baselineFallback, blockedBy, dayOk, GeneratedPlanZ, KCAL_BAND, OnboardingAnswersZ, PlanGenerateRequestZ,
  repairDay, submitPlanSchema, type AiPlan,
} from '../src/coach';

const answers = (o: Partial<OnboardingAnswers> = {}): OnboardingAnswers => ({
  sex: 'male', age: 30, heightCm: 175, weightKg: 80, goalWeightKg: 72, weeks: 12, activity: 'light',
  wakeMin: 7 * 60, eatingOut: 'rarely', cooking: 'microwave', allergies: [], dislikes: [],
  workoutPlace: 'home', workoutDays: 3, budgetWeek: 80000, ...o,
});

const KEYS = ['breakfast', 'lunch', 'snack', 'post', 'dinner'] as const;
const item = (name: string, kcal: number, protein: number, amount = '1개') => ({ name, amount, kcal, protein });

/** A draft the model might send: the baseline's foods, as AI items. */
function draftFrom(a: OnboardingAnswers): AiPlan {
  const g = generatePlan(a);
  const meals = Object.fromEntries(KEYS.map((k) => {
    const m = g.plan.meals![k]!;
    return [k, { name: m.name ?? k, items: (m.items ?? []).map((x: PlanItem) => item(x.name, x.kcal ?? 0, x.protein ?? 0, x.amount)) }];
  })) as AiPlan['meals'];
  return {
    meals,
    workout: {
      week: ['rest', 'A', 'walk', 'B', 'walk', 'A', 'walk'],
      routines: {
        A: { name: '홈트 A', focus: '상체', items: [{ name: '푸시업', n: 12, unit: '회' }, { name: '플랭크', n: 40, unit: '초' }, { name: '크런치', n: 20, unit: '회' }] },
        B: { name: '홈트 B', focus: '하체', items: [{ name: '스쿼트', n: 20, unit: '회' }, { name: '런지', n: 10, unit: '회' }, { name: '브릿지', n: 20, unit: '회' }] },
      },
    },
    shop: { now: [{ name: '저염 닭가슴살 30팩', qty: '1박스 · 15일치', price: 35000, lastsDays: 15, query: '저염 닭가슴살 30팩' }], week: [{ name: '방울토마토 1kg', qty: '1팩', price: 9000, lastsDays: 7, query: '방울토마토 1kg' }] },
    rules: [
      { icon: 'clock', title: '저녁은 8시 전', desc: '그 뒤에는 물만' },
      { icon: 'drumstick', title: '단백질 먼저', desc: '끼니마다 한 가지' },
      { icon: 'ban', title: '안 먹는 것', desc: '술, 단 음료' },
    ],
    notes: ['점심은 전자레인지로 데워 먹습니다', '주당 장보기 비용은 약 5만 6천 원입니다'],
  };
}

describe('plan generate: schemas', () => {
  it('accepts the offline baseline as a GeneratedPlan and validates the request', () => {
    const a = answers();
    const g = generatePlan(a);
    expect(GeneratedPlanZ.safeParse(g).success).toBe(true);
    expect(PlanGenerateRequestZ.safeParse({ answers: a, baseline: g }).success).toBe(true);
    expect(OnboardingAnswersZ.safeParse({ ...a, age: 7 }).success).toBe(false);
    expect(OnboardingAnswersZ.safeParse({ ...a, allergies: ['gluten'] }).success).toBe(false);
    expect(PlanGenerateRequestZ.safeParse({ answers: a, baseline: { ...g, plan: { meals: { brunch: {} } } } }).success).toBe(false);
  });

  it('validates the model draft and keeps the tool schema a plain object', () => {
    const d = draftFrom(answers());
    expect(AiPlanZ.safeParse(d).success).toBe(true);
    expect(AiPlanZ.safeParse({ ...d, rules: d.rules.slice(0, 2) }).success).toBe(false);
    expect(AiPlanZ.safeParse({ ...d, workout: { ...d.workout, week: d.workout.week.slice(0, 6) } }).success).toBe(false);
    const { dinner: _d, ...noDinner } = d.meals;
    expect(AiPlanZ.safeParse({ ...d, meals: noDinner }).success).toBe(false);
    const schema = submitPlanSchema();
    expect(schema.type).toBe('object');
    for (const k of ['oneOf', 'anyOf', 'allOf', '$schema']) expect(schema).not.toHaveProperty(k);
  });
});

describe('plan generate: assembly and repair', () => {
  it('recomputes every total from items and lands within the band', () => {
    const a = answers();
    const t = computeTargets(a);
    const r = assemblePlan(draftFrom(a), a, t, generatePlan(a));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meals = r.plan.plan.meals!;
    for (const k of KEYS) {
      const m = meals[k]!;
      expect(m.kcal).toBe((m.items ?? []).reduce((s, x) => s + (x.kcal ?? 0), 0));
      expect(m.protein).toBe((m.items ?? []).reduce((s, x) => s + (x.protein ?? 0), 0));
    }
    expect(Math.abs(r.plan.day.kcal - t.kcal)).toBeLessThanOrEqual(KCAL_BAND);
    expect(r.plan.day.protein).toBeGreaterThanOrEqual(t.proteinFloor);
    expect(r.plan.targets).toEqual(t); // server targets, never the client's
    expect(r.plan.weeklyCost).toBe(Math.round((35000 * 7 / 15 + 9000) / 100) * 100);
    expect(r.plan.notes.some((n) => n.includes('원'))).toBe(false); // the model's own cost figure is dropped
    expect(r.plan.notes).toContain('점심은 전자레인지로 데워 먹습니다');
    expect(GeneratedPlanZ.safeParse(r.plan).success).toBe(true);
  });

  it('builds Coupang search links itself and drops allergen products', () => {
    const a = answers({ allergies: ['egg'] });
    const d = draftFrom(answers()); // drafted without the allergy
    d.shop.now.push({ name: '구운란 30구', qty: '1판', price: 11000, lastsDays: 15, query: '구운란 30구' });
    const r = assemblePlan(d, a, computeTargets(a), generatePlan(a));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const shop = r.plan.plan.shop!;
    expect(shop.now.every((x) => x.url.startsWith('https://www.coupang.com/np/search?q='))).toBe(true);
    expect(shop.now.map((x) => x.name)).not.toContain('구운란 30구');
    const names = KEYS.flatMap((k) => (r.plan.plan.meals![k]!.items ?? []).map((x) => x.name));
    expect(names.some((n) => blockedBy(n, a))).toBe(false);
  });

  it('adds protein when the draft is short and trims carbs when it is over', () => {
    const a = answers();
    const t = computeTargets(a);
    const low = draftFrom(a);
    low.meals.dinner.items = [item('샐러드 채소', 20, 2, '1봉')];
    const r1 = assemblePlan(low, a, t, generatePlan(a));
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.repairs.some((x) => x.includes('단백질'))).toBe(true);

    const high = draftFrom(a);
    high.meals.snack.items.push(item('바나나', 90, 1), item('고구마', 170, 2, '1개 (150g)'), item('즉석밥', 200, 4, '130g'));
    const r2 = assemblePlan(high, a, t, generatePlan(a));
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(Math.abs(r2.plan.day.kcal - t.kcal)).toBeLessThanOrEqual(KCAL_BAND);
      expect(r2.repairs.some((x) => x.includes('넘쳐'))).toBe(true);
    }
  });

  it('rejects a draft that cannot be repaired', () => {
    const a = answers();
    const d = draftFrom(a);
    for (const k of KEYS) d.meals[k].items = [item('닭가슴살 스테이크', 1400, 100, '5팩')];
    const r = assemblePlan(d, a, computeTargets(a), generatePlan(a));
    expect(r.ok).toBe(false);
  });

  it('keeps the baseline week when the draft ignores the days asked for', () => {
    const a = answers({ workoutPlace: 'walk', workoutDays: 0 });
    const d = draftFrom(a);
    const r = assemblePlan(d, a, computeTargets(a), generatePlan(a));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.values(r.plan.plan.workout!.week!).some((x) => x === 'A' || x === 'B')).toBe(false);
  });

  it('repairDay leaves an in-band day alone and the fallback says why', () => {
    const a = answers();
    const t = { kcal: 1600, proteinFloor: 110 };
    const meals = Object.fromEntries(KEYS.map((k) => [k, { name: k, items: [item('닭가슴살', 320, 22)] }])) as Parameters<typeof repairDay>[0];
    expect(repairDay(meals, t, a)).toEqual([]);
    expect(dayOk(meals, t)).toBe(true);
    const fb = baselineFallback(a, '시간 초과');
    expect(fb.notes[0]).toContain('기본 계획');
    expect(GeneratedPlanZ.safeParse(fb).success).toBe(true);
  });
});
