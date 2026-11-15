// AI refinement of the onboarding plan: request and output schemas, and the server-side assembly that turns
// the model's draft into a GeneratedPlan. The model proposes foods and amounts; the numbers that matter
// (targets, meal and day totals, the kcal band, the protein floor, shop links) are computed here.
import { z } from 'zod';
import type { MealKey, PlanItem, ShopItem, WeekType } from '../data';
import { FOODS, generatePlan, type Allergen, type GeneratedPlan, type OnboardingAnswers } from '../onboarding';
import type { MealOverride, PlanOverride, RuleCard } from '../rebalance';
import type { Targets } from '../targets';
import { MealOverrideZ, RoutineItemZ, WeekTypeZ } from './schema';

const text = (max: number) => z.string().trim().max(max);
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const MEAL_KEYS: MealKey[] = ['breakfast', 'lunch', 'snack', 'post', 'dinner'];

// ---------------------------------------------------------------- request (client -> server)

export const OnboardingAnswersZ = z.object({
  name: text(30).optional(),
  sex: z.enum(['male', 'female']),
  age: z.number().int().min(14).max(100),
  heightCm: num(120, 230),
  weightKg: num(30, 250),
  goalWeightKg: num(30, 250),
  weeks: z.number().int().min(1).max(52),
  activity: z.enum(['sedentary', 'light', 'active']),
  wakeMin: z.number().int().min(0).max(1439),
  eatingOut: z.enum(['rarely', 'lunch', 'dinner', 'often']),
  cooking: z.enum(['none', 'microwave', 'basic']),
  allergies: z.array(z.enum(['egg', 'dairy', 'nuts', 'seafood', 'wheat', 'soy'])).max(6),
  dislikes: z.array(text(30)).max(15),
  workoutPlace: z.enum(['home', 'gym', 'walk']),
  workoutDays: z.number().int().min(0).max(6),
  budgetWeek: z.number().int().min(0).max(2_000_000),
});

const ShopItemZ = z.object({ id: text(80), name: text(80), qty: text(60), price: num(0, 1_000_000), url: z.url().max(400), optional: z.boolean().optional() });
const CycleItemZ = z.object({ id: text(80), name: text(80), sub: text(120), days: z.array(z.number().int().min(1).max(400)).max(20), url: z.url().max(400) });
const RuleCardZ = z.object({ icon: text(30), title: text(60), desc: text(160) });
const TargetsZ = z.object({
  bmr: num(0, 10000), tdee: num(0, 10000), kcal: num(0, 10000), proteinFloor: num(0, 500), deficit: num(0, 5000),
  weeklyLossKg: num(-10, 10), endWeightKg: num(0, 400), days: num(1, 1000), paceCapped: z.boolean(), floorApplied: z.boolean(),
});

/** Matches GeneratedPlan from core/onboarding. */
export const GeneratedPlanZ = z.object({
  targets: TargetsZ,
  plan: z.object({
    meals: z.partialRecord(z.enum(['breakfast', 'lunch', 'snack', 'post', 'dinner']), MealOverrideZ).optional(),
    workout: z.object({
      week: z.partialRecord(z.enum(['0', '1', '2', '3', '4', '5', '6']), WeekTypeZ).optional(),
      routines: z.partialRecord(z.enum(['A', 'B']), z.object({ items: z.array(RoutineItemZ).min(1).max(12), name: text(30).optional(), focus: text(40).optional() })).optional(),
    }).optional(),
    shop: z.object({ now: z.array(ShopItemZ).max(30), week: z.array(ShopItemZ).max(30), cycle: z.array(CycleItemZ).max(30) }).optional(),
    rules: z.array(RuleCardZ).max(6).optional(),
  }),
  day: z.object({ kcal: num(0, 10000), protein: num(0, 1000) }),
  weeklyCost: num(0, 5_000_000),
  notes: z.array(text(300)).max(10),
});

export const PlanGenerateRequestZ = z.object({ answers: OnboardingAnswersZ, baseline: GeneratedPlanZ });
export type PlanGenerateRequest = z.input<typeof PlanGenerateRequestZ>;

// ---------------------------------------------------------------- model output (submit_plan tool input)

const AiItemZ = z.object({
  name: text(40).min(1),
  amount: text(40).min(1).describe('먹는 양, 예: "1팩 (100g)", "반 공기", "2개"'),
  kcal: num(0, 1500),
  protein: num(0, 120),
  note: text(80).optional().describe('먹는 법 한 줄 (선택)'),
});
const AiMealZ = z.object({
  name: text(20).min(1).describe('끼니 이름, 예: "아침", "점심", "간식", "운동 후", "저녁"'),
  items: z.array(AiItemZ).min(1).max(8),
  note: text(80).optional(),
});
const AiShopZ = z.object({
  name: text(60).min(1).describe('살 상품, 예: "저염 닭가슴살 100g 30팩"'),
  qty: text(40).min(1).describe('몇 개 · 며칠치, 예: "1박스 · 15일치"'),
  price: z.number().int().min(0).max(300_000).describe('대략 가격 (원)'),
  lastsDays: z.number().int().min(1).max(180).describe('이 계획대로 먹으면 이 양이 며칠 가는지'),
  query: text(60).min(1).describe('쿠팡 검색어 (한국어, 구체적으로)'),
});
const ICONS = ['clock', 'drumstick', 'ban', 'glass-water', 'footprints', 'moon', 'utensils', 'apple', 'dumbbell', 'bed'] as const;

export const AiPlanZ = z.object({
  meals: z.object({ breakfast: AiMealZ, lunch: AiMealZ, snack: AiMealZ, post: AiMealZ, dinner: AiMealZ }),
  workout: z.object({
    week: z.array(WeekTypeZ).length(7).describe('일요일(0)부터 토요일(6)까지. A 상체·복근, B 하체·전신, walk 걷기만, light 가볍게, rest 쉬기'),
    routines: z.object({
      A: z.object({ name: text(20), focus: text(30), items: z.array(RoutineItemZ).min(3).max(8) }),
      B: z.object({ name: text(20), focus: text(30), items: z.array(RoutineItemZ).min(3).max(8) }),
    }),
  }),
  shop: z.object({
    now: z.array(AiShopZ).min(1).max(15).describe('처음에 한 번 사 두는 것 (오래 가는 것)'),
    week: z.array(AiShopZ).max(10).describe('매주 사는 신선식품'),
  }),
  rules: z.array(z.object({ icon: z.enum(ICONS), title: text(30).min(1), desc: text(80).min(1) })).length(3),
  notes: z.array(text(120)).max(3).describe('검토 화면에 보일 짧은 메모. 비용·칼로리 숫자는 쓰지 않습니다 (앱이 계산해 보여 줍니다)'),
});
export type AiPlan = z.infer<typeof AiPlanZ>;

export const submitPlanSchema = (): { type: 'object'; [k: string]: unknown } => {
  const { $schema: _s, ...rest } = z.toJSONSchema(AiPlanZ, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return { ...rest, type: 'object' };
};

// ---------------------------------------------------------------- safety filters

/** Words that mark an allergen in a Korean food or product name. */
export const ALLERGEN_WORDS: Record<Allergen, string[]> = {
  egg: ['달걀', '계란', '구운란', '맥반석', '에그', '마요'],
  dairy: ['우유', '요거트', '요구르트', '치즈', '유청', '웨이', '라떼', '버터', '크림', '분유'],
  nuts: ['견과', '아몬드', '땅콩', '호두', '캐슈', '피스타치오', '피칸', '마카다미아'],
  seafood: ['참치', '연어', '새우', '오징어', '고등어', '생선', '멸치', '꽃게', '게살', '대게', '조개', '굴', '명태', '황태', '어묵', '해산물', '크래미', '맛살'],
  wheat: ['빵', '밀가루', '통밀', '파스타', '오트', '시리얼', '라면', '국수', '우동', '또띠아', '베이글', '크래커', '그래놀라'],
  soy: ['두부', '두유', '대두', '된장', '청국장', '유부', '에다마메', '콩물'],
};

export function blockedBy(name: string, a: Pick<OnboardingAnswers, 'allergies' | 'dislikes'>): string | null {
  for (const al of a.allergies) if (ALLERGEN_WORDS[al].some((w) => name.includes(w))) return al;
  for (const d of a.dislikes) if (d.trim() && name.includes(d.trim())) return d.trim();
  return null;
}

const coupang = (q: string) => `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}`;

// ---------------------------------------------------------------- repair

type Meals = Record<MealKey, { name: string; items: PlanItem[]; note?: string }>;
const R = Math.round;
const mealSum = (items: PlanItem[]) => items.reduce((s, x) => ({ kcal: s.kcal + (x.kcal ?? 0), protein: s.protein + (x.protein ?? 0) }), { kcal: 0, protein: 0 });
const daySum = (m: Meals) => MEAL_KEYS.reduce((s, k) => { const x = mealSum(m[k].items); return { kcal: s.kcal + x.kcal, protein: s.protein + x.protein }; }, { kcal: 0, protein: 0 });

/** Catalog foods the repair may add, in preference order (no allergen or disliked ones). */
function addable(ids: string[], a: OnboardingAnswers): PlanItem[] {
  return ids
    .map((id) => FOODS[id])
    .filter((f): f is NonNullable<typeof f> => !!f && !(f.tags ?? []).some((t) => a.allergies.includes(t)) && !blockedBy(f.name, a))
    .map((f) => ({ name: f.name, amount: f.amount, kcal: f.kcal, protein: f.protein }));
}

export const KCAL_BAND = 80;

/**
 * Bring a day within ±80 kcal of the target with protein at or above the floor, by adding catalog protein or
 * small carbs and trimming low-protein extras. Returns notes for what changed; mutates `meals`.
 */
export function repairDay(meals: Meals, t: Pick<Targets, 'kcal' | 'proteinFloor'>, a: OnboardingAnswers): string[] {
  const notes: string[] = [];
  const proteins = addable(['chickenHalf', 'chicken', 'egg2', 'tofu', 'tuna', 'sausage'], a);
  const fillers = addable(['banana', 'riceHalf', 'sweetpotato', 'apple', 'tangerine', 'soymilk'], a);
  const slots: MealKey[] = ['dinner', 'snack', 'breakfast', 'lunch'];
  // 1. protein floor
  for (let i = 0; i < 6 && daySum(meals).protein < t.proteinFloor && proteins.length; i++) {
    const p = proteins[i % proteins.length]!;
    const slot = slots[i % slots.length]!;
    meals[slot].items.push({ ...p });
    notes.push(`단백질이 모자라 ${meals[slot].name}에 ${p.name} ${p.amount}을 더했습니다`);
  }
  // 2. too little energy: the filler that best closes the gap without overshooting the band
  for (let i = 0; i < 8; i++) {
    const gap = t.kcal - daySum(meals).kcal;
    if (gap <= KCAL_BAND) break;
    const fit = fillers.filter((f) => (f.kcal ?? 0) <= gap + KCAL_BAND).sort((x, y) => Math.abs(gap - (y.kcal ?? 0)) - Math.abs(gap - (x.kcal ?? 0))).pop();
    if (!fit) break;
    const slot = (['snack', 'breakfast', 'lunch', 'dinner'] as MealKey[]).find((k) => !meals[k].items.some((x) => x.name === fit.name)) ?? 'snack';
    meals[slot].items.push({ ...fit });
    notes.push(`칼로리가 모자라 ${meals[slot].name}에 ${fit.name}을 더했습니다`);
  }
  // 3. too much energy: drop the low-protein extra that lands closest to the target, keeping the protein floor
  for (let i = 0; i < 8; i++) {
    const day = daySum(meals);
    const excess = day.kcal - t.kcal;
    if (excess <= KCAL_BAND) break;
    let best: { k: MealKey; idx: number; after: number } | null = null;
    for (const k of MEAL_KEYS) {
      const items = meals[k].items;
      if (items.length < 2) continue;
      items.forEach((x, idx) => {
        if ((x.protein ?? 0) > 4 || day.protein - (x.protein ?? 0) < t.proteinFloor) return;
        const after = day.kcal - (x.kcal ?? 0);
        if (after < t.kcal - KCAL_BAND) return;
        if (!best || Math.abs(after - t.kcal) < Math.abs(best.after - t.kcal)) best = { k, idx, after };
      });
    }
    if (!best) break;
    const { k, idx } = best as { k: MealKey; idx: number; after: number };
    const [gone] = meals[k].items.splice(idx, 1);
    notes.push(`칼로리가 넘쳐 ${meals[k].name}에서 ${gone!.name}을 뺐습니다`);
  }
  return notes;
}

export const dayOk = (meals: Meals, t: Pick<Targets, 'kcal' | 'proteinFloor'>): boolean => {
  const d = daySum(meals);
  return Math.abs(d.kcal - t.kcal) <= KCAL_BAND && d.protein >= t.proteinFloor && MEAL_KEYS.every((k) => meals[k].items.length > 0);
};

// ---------------------------------------------------------------- assembly

export type AssembleResult =
  | { ok: true; plan: GeneratedPlan; repairs: string[] }
  | { ok: false; reason: string };

/**
 * Turn the model's draft into a GeneratedPlan. Targets come from the server; every total is recomputed;
 * allergen and disliked items are dropped; the day is repaired into the band or the draft is rejected.
 */
export function assemblePlan(ai: AiPlan, a: OnboardingAnswers, targets: Targets, baseline: GeneratedPlan): AssembleResult {
  const repairs: string[] = [];
  const meals = {} as Meals;
  for (const k of MEAL_KEYS) {
    const m = ai.meals[k];
    const items: PlanItem[] = [];
    for (const x of m.items) {
      const why = blockedBy(`${x.name} ${x.amount}`, a);
      if (why) { repairs.push(`${x.name}은 ${why} 때문에 뺐습니다`); continue; }
      items.push({ name: x.name, amount: x.amount, kcal: R(x.kcal), protein: R(x.protein), ...(x.note ? { note: x.note } : {}) });
    }
    meals[k] = { name: m.name, items, ...(m.note ? { note: m.note } : {}) };
  }
  repairs.push(...repairDay(meals, targets, a));
  if (!dayOk(meals, targets)) {
    const d = daySum(meals);
    return { ok: false, reason: `하루 ${R(d.kcal)}kcal · 단백질 ${R(d.protein)}g 으로 목표(${targets.kcal}kcal, 단백질 ${targets.proteinFloor}g 이상)에 맞추지 못했습니다` };
  }

  const mealsOut: Partial<Record<MealKey, MealOverride>> = {};
  for (const k of MEAL_KEYS) {
    const s = mealSum(meals[k].items);
    mealsOut[k] = { name: meals[k].name, items: meals[k].items, kcal: s.kcal, protein: s.protein, note: meals[k].note ?? '코치가 맞춘 식단' };
  }

  // workout: the model's week unless it ignores the place or the number of days asked for
  const strength = ai.workout.week.filter((t) => t === 'A' || t === 'B' || t === 'light').length;
  const wantStrength = a.workoutPlace === 'walk' ? 0 : a.workoutDays;
  const weekOk = Math.abs(strength - wantStrength) <= 1 && ai.workout.week.includes('rest');
  const week: Record<string, WeekType> = weekOk ? Object.fromEntries(ai.workout.week.map((t, i) => [String(i), t])) : { ...(baseline.plan.workout?.week as Record<string, WeekType> | undefined) };
  if (!weekOk) repairs.push('운동 요일은 고른 횟수에 맞게 기본 계획으로 두었습니다');

  const shopItem = (x: AiPlan['shop']['now'][number], i: number, list: 'n' | 'w'): ShopItem =>
    ({ id: `ai-${list}${i + 1}`, name: x.name, qty: x.qty, price: x.price, url: coupang(x.query) });
  const okShop = (x: AiPlan['shop']['now'][number]) => !blockedBy(`${x.name} ${x.query}`, a);
  const now = ai.shop.now.filter(okShop).map((x, i) => shopItem(x, i, 'n'));
  const weekly = ai.shop.week.filter(okShop).map((x, i) => shopItem(x, i, 'w'));
  // cost per week from how long each package lasts on this plan
  const lasts = new Map([...ai.shop.now, ...ai.shop.week].map((x) => [x.name, x.lastsDays]));
  const weeklyCost = Math.round([...now, ...weekly].reduce((s, x) => s + (x.price * 7) / Math.max(1, lasts.get(x.name) ?? 7), 0) / 100) * 100;

  const rules: RuleCard[] = ai.rules.map((r) => ({ icon: r.icon, title: r.title, desc: r.desc }));
  const plan: PlanOverride = {
    meals: mealsOut,
    workout: { week, routines: { A: ai.workout.routines.A, B: ai.workout.routines.B } },
    shop: { now, week: weekly, cycle: [] },
    rules,
  };
  const day = daySum(meals);
  // the pace and floor notes come from the targets, not the model
  const paceNotes = baseline.notes.filter((n) => n.includes('속도') || n.includes('최소 섭취량'));
  // money and calorie figures come from the server; a model note quoting its own would contradict them
  const notes = [...paceNotes, ...ai.notes.filter((n) => !/\d[\d,.]*\s*(만\s*)?(천\s*)?원|kcal|칼로리/.test(n)).slice(0, 3)];
  if (a.budgetWeek > 0 && weeklyCost > a.budgetWeek) notes.push(`예상 장보기 비용이 주 ${weeklyCost.toLocaleString('ko-KR')}원으로 예산보다 많습니다. 코치에게 "더 싸게"라고 하면 바꿔 줍니다.`);
  return { ok: true, plan: { targets, plan, day: { kcal: R(day.kcal), protein: R(day.protein) }, weeklyCost, notes: notes.slice(0, 6) }, repairs };
}

/** The plan to send when the AI step fails: the server's own offline plan, with a note saying so. */
export function baselineFallback(a: OnboardingAnswers, why: string): GeneratedPlan {
  const g = generatePlan(a);
  return { ...g, notes: [`AI 다듬기를 하지 못해 기본 계획을 보여 드립니다 (${why}).`, ...g.notes].slice(0, 6) };
}

/**
 * Server-sent events of POST /api/plan/generate (`event: <type>` + `data: <json>`):
 * - status: a step line, same shape as the coach's (ids: targets, meals, workout, shop, review, search ids)
 * - plan: the final plan. source 'ai' = refined and checked; 'baseline' = the offline plan (AI step failed), with a note
 * - done / error: as in the coach stream
 */
export type PlanGenEvent =
  | { type: 'status'; id: string; label: string; state: 'running' | 'done' | 'error'; kind: 'context' | 'tool' | 'search' | 'note' }
  | { type: 'plan'; plan: GeneratedPlan; source: 'ai' | 'baseline' }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; code: 'auth' | 'forbidden' | 'rate_limit' | 'bad_request' | 'upstream'; message: string };
