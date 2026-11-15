// A personal plan for a new user, built offline from onboarding answers: meals from a catalog of Korean
// everyday foods (convenience store and Coupang staples), a workout week, a shopping list with Coupang search
// links, and the few rules that matter. The AI step may refine it; this always works without network or login.
import { MEALS, ROUTINES, type MealKey, type PlanItem, type RoutineDef, type ShopItem, type WeekType } from './data';
import type { MealOverride, PlanOverride } from './rebalance';
import { computeTargets, type BodyInput, type Targets } from './targets';

export type Allergen = 'egg' | 'dairy' | 'nuts' | 'seafood' | 'wheat' | 'soy';
export const ALLERGEN_LABEL: Record<Allergen, string> = { egg: '달걀', dairy: '우유·유제품', nuts: '견과류', seafood: '해산물', wheat: '밀가루', soy: '콩·두부' };
export type Cooking = 'none' | 'microwave' | 'basic';
export const COOKING_LABEL: Record<Cooking, string> = { none: '조리는 안 합니다', microwave: '전자레인지 정도', basic: '간단한 요리는 합니다' };
export type EatingOut = 'rarely' | 'lunch' | 'dinner' | 'often';
export const EATING_OUT_LABEL: Record<EatingOut, string> = { rarely: '거의 안 합니다', lunch: '점심은 밖에서', dinner: '저녁은 밖에서', often: '자주 합니다' };
export type WorkoutPlace = 'home' | 'gym' | 'walk';
export const WORKOUT_PLACE_LABEL: Record<WorkoutPlace, string> = { home: '집에서 맨몸으로', gym: '헬스장에서', walk: '걷기만' };

export interface OnboardingAnswers extends BodyInput {
  name?: string;
  /** usual wake time, minutes since midnight */
  wakeMin: number;
  eatingOut: EatingOut;
  cooking: Cooking;
  allergies: Allergen[];
  /** free words; foods whose name contains one are left out */
  dislikes: string[];
  workoutPlace: WorkoutPlace;
  /** strength sessions per week, 0-6 */
  workoutDays: number;
  /** grocery budget per week, KRW */
  budgetWeek: number;
}

export interface GeneratedPlan {
  targets: Targets;
  plan: PlanOverride;
  /** totals of the generated day */
  day: { kcal: number; protein: number };
  /** estimated grocery cost per week */
  weeklyCost: number;
  /** short notes for the review screen, e.g. pace was capped */
  notes: string[];
}

// ---------------- catalog ----------------

interface Food {
  id: string;
  name: string;
  amount: string;
  kcal: number;
  protein: number;
  tags?: Allergen[];
  cook?: Cooking;
  /** what to buy: Coupang search words, package size in servings, package price (KRW) */
  buy?: { q: string; label: string; servings: number; price: number; fresh?: boolean };
}

const F = (id: string, name: string, amount: string, kcal: number, protein: number, o: Partial<Food> = {}): Food => ({ id, name, amount, kcal, protein, ...o });

export const FOODS: Record<string, Food> = Object.fromEntries([
  F('egg2', '달걀', '2개', 140, 12, { tags: ['egg'], cook: 'microwave', buy: { q: '구운란 30구', label: '구운란 30구', servings: 15, price: 11000 } }),
  F('yogurt', '무가당 그릭요거트', '100g', 95, 9, { tags: ['dairy'], buy: { q: '무가당 그릭요거트 대용량', label: '무가당 그릭요거트 800g', servings: 8, price: 12000, fresh: true } }),
  F('banana', '바나나', '1개', 90, 1, { buy: { q: '바나나', label: '바나나 1송이', servings: 6, price: 4500, fresh: true } }),
  F('apple', '사과', '반 개', 50, 0, { buy: { q: '사과 소과', label: '사과 소과 2kg', servings: 16, price: 16000, fresh: true } }),
  F('tangerine', '귤', '2개', 50, 1, { buy: { q: '감귤 꼬마과 3kg', label: '감귤 3kg', servings: 18, price: 17000, fresh: true } }),
  F('oat', '오트밀', '40g', 150, 5, { tags: ['wheat'], buy: { q: '퀵오트밀', label: '퀵오트밀 1kg', servings: 25, price: 9000 } }),
  F('soymilk', '무가당 두유', '1팩', 90, 7, { tags: ['soy'], buy: { q: '무가당 두유 190ml 24팩', label: '무가당 두유 24팩', servings: 24, price: 14000 } }),
  F('milk', '저지방 우유', '200ml', 90, 6, { tags: ['dairy'], buy: { q: '저지방 우유 1L', label: '저지방 우유 1L 2개', servings: 10, price: 6000, fresh: true } }),
  F('sweetpotato', '고구마', '1개 (150g)', 170, 2, { cook: 'microwave', buy: { q: '냉동 군고구마', label: '냉동 군고구마 1kg', servings: 7, price: 11000 } }),
  F('chicken', '닭가슴살', '1팩 (100g)', 110, 23, { buy: { q: '저염 닭가슴살 30팩', label: '저염 닭가슴살 30팩', servings: 30, price: 35000 } }),
  F('chickenHalf', '닭가슴살', '반 팩', 55, 12, { buy: { q: '저염 닭가슴살 30팩', label: '저염 닭가슴살 30팩', servings: 60, price: 35000 } }),
  F('cube', '닭가슴살 큐브', '1팩', 165, 18, { buy: { q: '닭가슴살 큐브 30팩', label: '닭가슴살 큐브 30팩', servings: 30, price: 39000 } }),
  F('sausage', '닭가슴살 소시지', '1개', 120, 12, { buy: { q: '닭가슴살 소시지 30개', label: '닭가슴살 소시지 30개', servings: 30, price: 30000 } }),
  F('tofu', '두부', '반 모 (150g)', 120, 13, { tags: ['soy'], cook: 'microwave', buy: { q: '부침두부 300g', label: '두부 300g 4개', servings: 8, price: 7000, fresh: true } }),
  F('tuna', '참치캔 (라이트)', '1캔', 130, 22, { tags: ['seafood'], buy: { q: '라이트 참치 100g 10캔', label: '라이트 참치 10캔', servings: 10, price: 17000 } }),
  F('salmon', '훈제연어', '80g', 140, 17, { tags: ['seafood'], buy: { q: '훈제연어 슬라이스', label: '훈제연어 500g', servings: 6, price: 22000, fresh: true } }),
  F('beef', '소고기 우둔', '100g', 160, 22, { cook: 'basic', buy: { q: '소고기 우둔 1kg', label: '소고기 우둔 1kg', servings: 10, price: 33000, fresh: true } }),
  F('riceSmall', '즉석밥 작은공기', '130g', 200, 4, { cook: 'microwave', buy: { q: '흑미밥 작은공기 130g 36개', label: '작은공기 즉석밥 36개', servings: 36, price: 30000 } }),
  F('riceHalf', '즉석밥', '반 공기', 100, 2, { cook: 'microwave', buy: { q: '흑미밥 작은공기 130g 36개', label: '작은공기 즉석밥 36개', servings: 72, price: 30000 } }),
  F('broccoli', '냉동 브로콜리', '150g', 50, 3, { cook: 'microwave', buy: { q: '냉동 브로콜리 1kg', label: '냉동 브로콜리 1kg', servings: 7, price: 7000 } }),
  F('salad', '샐러드 채소', '1봉', 20, 2, { buy: { q: '샐러드 채소 믹스', label: '샐러드 채소 10봉', servings: 10, price: 15000, fresh: true } }),
  F('tomato', '방울토마토', '10개', 35, 2, { buy: { q: '방울토마토 1kg', label: '방울토마토 1kg', servings: 6, price: 9000, fresh: true } }),
  F('dressing', '저칼로리 드레싱', '1큰술', 20, 0, { buy: { q: '저칼로리 오리엔탈 드레싱', label: '저칼로리 드레싱 1병', servings: 15, price: 5000 } }),
  F('kimchi', '김치', '조금', 15, 1),
  F('nuts', '하루견과', '1봉', 140, 6, { tags: ['nuts'], buy: { q: '하루견과 30봉', label: '하루견과 30봉', servings: 30, price: 22000 } }),
  F('shake', '프로틴', '1스쿱', 120, 24, { tags: ['dairy'], buy: { q: '웨이프로틴 2kg', label: '웨이 프로틴 2kg', servings: 66, price: 55000 } }),
  F('shakeSoy', '식물성 프로틴', '1스쿱', 120, 22, { tags: ['soy'], buy: { q: '식물성 단백질 파우더', label: '식물성 프로틴 1kg', servings: 33, price: 39000 } }),
  F('convSalad', '편의점 닭가슴살 샐러드', '1팩', 230, 20),
  F('eatoutLunch', '밖에서 먹는 점심', '정식 · 밥 반 공기 · 국물 남기기', 550, 30),
  F('eatoutDinner', '밖에서 먹는 저녁', '생선구이·샤브샤브 · 밥 반 공기', 550, 30),
  F('water', '물', '300ml', 0, 0),
  F('coffee', '블랙커피', '마시고 싶으면', 0, 0),
].map((f) => [f.id, f]));

// meal options per slot: food ids. The generator keeps the ones the user can eat and cook.
const OPTIONS: Record<MealKey, string[][]> = {
  breakfast: [
    ['egg2', 'yogurt', 'tangerine', 'coffee'],
    ['egg2', 'soymilk', 'apple'],
    ['yogurt', 'oat', 'banana'],
    ['chicken', 'sweetpotato'],
    ['soymilk', 'oat', 'banana'],
    ['tofu', 'riceHalf', 'kimchi'],
  ],
  lunch: [
    ['riceSmall', 'cube', 'broccoli', 'kimchi'],
    ['riceSmall', 'chicken', 'broccoli', 'kimchi'],
    ['riceSmall', 'tuna', 'salad', 'kimchi'],
    ['riceSmall', 'tofu', 'broccoli', 'kimchi'],
    ['riceSmall', 'beef', 'salad'],
    ['convSalad', 'egg2', 'banana'],
    ['convSalad', 'sausage', 'banana'],
    ['chicken', 'salad', 'banana', 'dressing'],
  ],
  snack: [
    ['chicken', 'nuts'],
    ['egg2', 'tomato'],
    ['yogurt', 'banana'],
    ['sausage', 'tomato'],
    ['sweetpotato', 'soymilk'],
    ['chicken', 'apple'],
  ],
  post: [
    ['shake', 'milk'],
    ['shake', 'water'],
    ['shakeSoy', 'water'],
    ['chicken'],
  ],
  dinner: [
    ['chicken', 'salad', 'tomato', 'dressing'],
    ['tofu', 'salad', 'tomato', 'dressing'],
    ['salmon', 'salad', 'tomato'],
    ['tuna', 'salad', 'tomato', 'dressing'],
    ['beef', 'salad', 'tomato'],
    ['sausage', 'salad', 'tomato', 'dressing'],
  ],
};

// share of the day per slot (sums to 1)
const SPLIT: Record<MealKey, number> = { breakfast: 0.22, lunch: 0.3, snack: 0.18, post: 0.12, dinner: 0.18 };
const COOK_RANK: Record<Cooking, number> = { none: 0, microwave: 1, basic: 2 };

const eatable = (f: Food, a: OnboardingAnswers): boolean =>
  !(f.tags ?? []).some((t) => a.allergies.includes(t)) &&
  COOK_RANK[f.cook ?? 'none'] <= COOK_RANK[a.cooking] &&
  !a.dislikes.some((d) => d.trim() && f.name.includes(d.trim()));

const itemOf = (f: Food): PlanItem => ({ name: f.name, amount: f.amount, kcal: f.kcal, protein: f.protein });
const sum = (ids: string[]) => ids.reduce((s, id) => ({ kcal: s.kcal + FOODS[id]!.kcal, protein: s.protein + FOODS[id]!.protein }), { kcal: 0, protein: 0 });
const dailyCost = (ids: string[]) => ids.reduce((s, id) => { const b = FOODS[id]!.buy; return s + (b ? b.price / b.servings : 0); }, 0);

const PROTEINS = new Set(['egg2', 'chicken', 'chickenHalf', 'cube', 'sausage', 'tofu', 'tuna', 'salmon', 'beef', 'yogurt']);

function pick(slot: MealKey, target: number, a: OnboardingAnswers, tight: boolean, used: Map<string, number>): string[] | null {
  // eating out at this meal: one rule-based restaurant meal instead of groceries
  if (slot === 'lunch' && (a.eatingOut === 'lunch' || a.eatingOut === 'often')) return ['eatoutLunch'];
  if (slot === 'dinner' && a.eatingOut === 'dinner') return ['eatoutDinner'];
  const ok = OPTIONS[slot].filter((ids) => ids.every((id) => eatable(FOODS[id]!, a)));
  if (!ok.length) return null;
  // closest to the slot's kcal share, protein as tie-breaker, variety (the same protein food twice costs),
  // and cost when the budget is tight
  return ok
    .map((ids) => {
      const s = sum(ids);
      const repeat = ids.reduce((n, id) => n + (PROTEINS.has(id) ? (used.get(id) ?? 0) : 0), 0);
      return { ids, score: Math.abs(s.kcal - target) - s.protein * 2 + repeat * 70 + (tight ? dailyCost(ids) / 20 : 0) };
    })
    .sort((x, y) => x.score - y.score)[0]!.ids;
}

/** Same food twice in a meal becomes one line ("닭가슴살 반 팩 × 2"). */
function itemsOf(ids: string[]): PlanItem[] {
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n].map(([id, c]) => {
    const f = FOODS[id]!;
    return c === 1 ? itemOf(f) : { name: f.name, amount: `${f.amount} × ${c}`, kcal: f.kcal * c, protein: f.protein * c };
  });
}

// ---------------- workout ----------------

const GYM_A: RoutineDef = { name: '헬스 A', focus: '상체 · 복근', items: [{ name: '랫풀다운', n: 12, unit: '회' }, { name: '체스트 프레스', n: 12, unit: '회' }, { name: '시티드 로우', n: 12, unit: '회' }, { name: '숄더 프레스', n: 10, unit: '회' }, { name: '플랭크', n: 40, unit: '초' }] };
const GYM_B: RoutineDef = { name: '헬스 B', focus: '하체 · 전신', items: [{ name: '레그 프레스', n: 15, unit: '회' }, { name: '레그 컬', n: 12, unit: '회' }, { name: '힙 어브덕션', n: 15, unit: '회' }, { name: '케이블 크런치', n: 15, unit: '회' }, { name: '러닝머신 빠르게 걷기', n: 10, unit: '분' }] };

/** Weekly schedule: strength days spread out, the rest walking, Sunday off unless six sessions are asked for. */
export function weekFor(place: WorkoutPlace, days: number): Record<string, WeekType> {
  const n = place === 'walk' ? 0 : Math.max(0, Math.min(6, Math.round(days)));
  const slots: Record<number, number[]> = { 0: [], 1: [2], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] };
  const strength = slots[n]!;
  const out: Record<string, WeekType> = {};
  let ab: 'A' | 'B' = 'A';
  for (let d = 0; d < 7; d++) {
    if (strength.includes(d)) { out[String(d)] = ab; ab = ab === 'A' ? 'B' : 'A'; }
    else out[String(d)] = d === 0 && n < 6 ? 'rest' : 'walk';
  }
  return out;
}

// ---------------- shopping ----------------

const coupang = (q: string) => `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}`;

function shopFor(dayIds: string[], days = 14): { now: ShopItem[]; week: ShopItem[]; weeklyCost: number } {
  const per = new Map<string, { label: string; q: string; price: number; servings: number; fresh: boolean; used: number }>();
  for (const id of dayIds) {
    const b = FOODS[id]!.buy;
    if (!b) continue;
    const r = per.get(b.label) ?? { label: b.label, q: b.q, price: b.price, servings: b.servings, fresh: !!b.fresh, used: 0 };
    r.used += 1;
    per.set(b.label, r);
  }
  const now: ShopItem[] = [];
  const week: ShopItem[] = [];
  let weeklyCost = 0;
  for (const r of per.values()) {
    weeklyCost += (r.price / r.servings) * r.used * 7;
    const span = r.fresh ? 7 : days;
    const packs = Math.max(1, Math.ceil((r.used * span) / r.servings));
    const lasts = Math.floor((packs * r.servings) / r.used);
    const item: ShopItem = { id: `g-${r.q}`, name: r.label, qty: `${packs}개 · ${lasts}일치`, price: packs * r.price, url: coupang(r.q) };
    (r.fresh ? week : now).push(item);
  }
  return { now, week, weeklyCost: Math.round(weeklyCost / 100) * 100 };
}

// ---------------- generate ----------------

export function generatePlan(a: OnboardingAnswers): GeneratedPlan {
  const targets = computeTargets(a);
  const notes: string[] = [];
  if (targets.paceCapped) notes.push(`목표까지 ${a.weeks}주는 몸에 무리가 가서, 주 ${targets.weeklyLossKg}kg 속도로 잡았습니다. ${a.weeks}주 뒤 예상은 ${targets.endWeightKg}kg입니다.`);
  if (targets.floorApplied) notes.push(`하루 최소 섭취량보다 낮아지지 않게 ${targets.kcal}kcal로 맞췄습니다.`);
  const tight = a.budgetWeek > 0 && a.budgetWeek < 70000;
  const keys: MealKey[] = ['breakfast', 'lunch', 'snack', 'post', 'dinner'];
  const chosen: Partial<Record<MealKey, string[]>> = {};
  const used = new Map<string, number>();
  for (const k of keys) {
    const ids = pick(k, targets.kcal * SPLIT[k], a, tight, used) ?? undefined;
    chosen[k] = ids;
    for (const id of ids ?? []) used.set(id, (used.get(id) ?? 0) + 1);
  }

  // tune toward the day's kcal and protein: add or trim small things, never below the protein floor
  const total = () => keys.reduce((s, k) => { const x = sum(chosen[k] ?? []); return { kcal: s.kcal + x.kcal, protein: s.protein + x.protein }; }, { kcal: 0, protein: 0 });
  const canEat = (id: string) => eatable(FOODS[id]!, a);
  // protein first, spread over meals that are not eaten out, rotating the source
  const proteinAdds = ['chickenHalf', 'egg2', 'tofu', 'tuna', 'sausage'].filter(canEat);
  const proteinSlots: MealKey[] = (['dinner', 'breakfast', 'snack'] as MealKey[]).filter((k) => chosen[k] && !chosen[k]!.some((id) => id.startsWith('eatout')));
  for (let guard = 0, i = 0; guard < 6 && total().protein < targets.proteinFloor && proteinAdds.length && proteinSlots.length; guard++, i++) {
    const slot = proteinSlots[i % proteinSlots.length]!;
    chosen[slot] = [...chosen[slot]!, proteinAdds[Math.floor(i / proteinSlots.length) % proteinAdds.length]!];
  }
  // then energy: small carbs or fruit, each at most once per meal
  const fillers = ['riceHalf', 'sweetpotato', 'banana', 'oat', 'apple', 'soymilk', 'nuts', 'tangerine'].filter(canEat);
  const fillSlots: MealKey[] = (['snack', 'breakfast', 'dinner', 'lunch'] as MealKey[]).filter((k) => chosen[k] && !chosen[k]!.some((id) => id.startsWith('eatout')));
  for (let guard = 0; guard < 8 && total().kcal < targets.kcal - 120; guard++) {
    let placed = false;
    for (const f of fillers) {
      const slot = fillSlots.find((k) => !chosen[k]!.includes(f));
      if (slot && !keys.some((k) => (chosen[k] ?? []).filter((x) => x === f).length >= 1 && k === slot)) { chosen[slot] = [...chosen[slot]!, f]; placed = true; break; }
    }
    if (!placed) break;
    fillers.push(fillers.shift()!); // rotate so the next round uses something else
  }
  for (let guard = 0; guard < 4 && total().kcal > targets.kcal + 120; guard++) {
    // trim the heaviest carb first
    if ((chosen.lunch ?? []).includes('riceSmall')) chosen.lunch = chosen.lunch!.map((id) => (id === 'riceSmall' ? 'riceHalf' : id));
    else if ((chosen.snack ?? []).includes('nuts')) chosen.snack = chosen.snack!.filter((id) => id !== 'nuts');
    else if ((chosen.post ?? []).includes('milk')) chosen.post = chosen.post!.map((id) => (id === 'milk' ? 'water' : id));
    else break;
  }

  const meals: Partial<Record<MealKey, MealOverride>> = {};
  for (const k of keys) {
    const ids = chosen[k];
    if (!ids?.length) { meals[k] = { removed: true, note: '먹을 수 있는 구성이 없어 뺐습니다' }; continue; }
    const s = sum(ids);
    meals[k] = { name: k === 'post' && a.workoutPlace === 'walk' ? '프로틴' : MEALS[k].name, items: itemsOf(ids), kcal: s.kcal, protein: s.protein, note: '내게 맞춘 기본 식단' };
  }
  if (a.eatingOut === 'lunch' || a.eatingOut === 'often') notes.push('점심을 밖에서 먹는 날은 "밖에서 밥" 상황으로 바꾸면 메뉴 고르는 법이 나옵니다.');
  if (a.eatingOut === 'dinner') notes.push('저녁을 밖에서 먹는 날은 "밖에서 밥" 상황으로 바꾸면 됩니다.');

  const gym = a.workoutPlace === 'gym';
  const routines = gym ? { A: GYM_A, B: GYM_B } : { A: ROUTINES.A, B: ROUTINES.B };
  const allIds = keys.flatMap((k) => chosen[k] ?? []);
  const shop = shopFor(allIds);
  if (a.budgetWeek > 0 && shop.weeklyCost > a.budgetWeek) notes.push(`예상 장보기 비용이 주 ${shop.weeklyCost.toLocaleString('ko-KR')}원으로 예산보다 많습니다. 코치에게 "더 싸게" 라고 하면 바꿔 줍니다.`);
  const t = total();
  const dinnerBy = Math.min(21 * 60, a.wakeMin + 13 * 60);
  const hh = (m: number) => `${Math.floor(m / 60)}시${m % 60 ? ` ${m % 60}분` : ''}`;
  const plan: PlanOverride = {
    meals,
    workout: { week: weekFor(a.workoutPlace, a.workoutDays), routines: { A: routines.A, B: routines.B } },
    shop: { now: shop.now, week: shop.week, cycle: [] },
    rules: [
      { icon: 'clock', title: `저녁은 ${hh(dinnerBy)} 전`, desc: '그 뒤에는 물, 아메리카노, 제로 음료만' },
      { icon: 'drumstick', title: `단백질 하루 ${targets.proteinFloor}g`, desc: '끼니마다 단백질 한 가지는 꼭 먹습니다' },
      { icon: 'ban', title: '안 먹는 것', desc: '술, 단 음료, 과자, 빵, 야식' },
    ],
  };
  return { targets, plan, day: t, weeklyCost: shop.weeklyCost, notes };
}
