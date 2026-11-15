// Planned events ("내일 저녁 회식이야"): reshape that day ahead of time instead of paying it back afterwards.
// The day's target stays the same: carbs come off the meals before the event, protein goes in before leaving,
// and what was freed becomes the event meal's budget, with drink guidance from the table below.
// Pure; the coach turns the result into plan_adjustments rows plus an `events` row (the morning reminder reads it).
import { CUTS, PROTEIN_ADDS, type Cut, type MealKey, type PlanItem } from './data';
import type { DayAdjustment } from './rebalance';
import { fmt } from './util';

export type EventSlot = 'lunch' | 'dinner';
export type EventKind = 'dinner_out' | 'drinks' | 'other';

/** One glass as served in Korea. kcal = alcohol (ml x ABV x 0.789 g/ml x 7 kcal/g) + carbs x 4. */
export interface Drink { id: string; name: string; serving: string; ml: number; abv: number; carbs: number }

export const DRINKS: Drink[] = [
  { id: 'highball', name: '하이볼 (탄산수)', serving: '1잔', ml: 30, abv: 0.4, carbs: 0 },
  { id: 'soju', name: '소주', serving: '1잔', ml: 50, abv: 0.165, carbs: 0 },
  { id: 'wine', name: '와인', serving: '1잔', ml: 150, abv: 0.13, carbs: 4 },
  { id: 'makgeolli', name: '막걸리', serving: '1잔', ml: 200, abv: 0.06, carbs: 6 },
  { id: 'beer', name: '맥주', serving: '500cc', ml: 500, abv: 0.045, carbs: 15 },
];

export const drinkKcal = (d: Pick<Drink, 'ml' | 'abv' | 'carbs'>): number => Math.round(d.ml * d.abv * 0.789 * 7 + d.carbs * 4);

/** Most kcal moved from earlier meals to the event meal. */
export const EVENT_FREE_MAX = 400;
/** Share of the event budget drinks may take, and its cap. */
export const DRINK_SHARE = 0.35;
export const DRINK_CAP = 300;

/** The meals that come before the event and can be lightened. */
const BEFORE: Record<EventSlot, MealKey[]> = { lunch: ['breakfast'], dinner: ['breakfast', 'lunch', 'snack', 'post'] };
/** Where the "protein before going" goes: the last meal before the event. */
const PRE_PROTEIN_SLOT: Record<EventSlot, MealKey[]> = { lunch: ['breakfast'], dinner: ['snack', 'post', 'lunch'] };

const SLOT_NAME: Record<MealKey, string> = { breakfast: '아침', lunch: '점심', snack: '간식', post: '운동 후', dinner: '저녁' };

export interface EventMeal {
  key: MealKey;
  name: string;
  kcal: number;
  protein: number;
  items: Pick<PlanItem, 'name' | 'amount'>[];
  /** pending meals can still change; logged ones count with what was logged (kcal/protein are then the logged values) */
  pending: boolean;
}

export interface PlanEventInput {
  /** the day's meals after that day's plan version and adjustments */
  meals: EventMeal[];
  slot: EventSlot;
  alcohol: boolean;
  target: number;
  proteinFloor: number;
  /** cut ids already applied on that day */
  appliedCuts?: ReadonlySet<string>;
  /** words to avoid in the protein suggestion (allergies, dislikes) */
  avoid?: string[];
  /** short name of the event, e.g. "회식" */
  label: string;
}

export interface EventDrinkOption { id: string; name: string; serving: string; kcalEach: number; count: number; kcal: number }

export interface EventPlan {
  cuts: Cut[];
  proteinAdd: { slot: MealKey; id: string; label: string; kcal: number; protein: number } | null;
  /** kcal moved to the event meal (cuts minus the protein before going) */
  freed: number;
  /** planned kcal of the event slot before, and its budget after (drinks included) */
  planned: number;
  budget: number;
  /** protein the event meal should still bring so the day stays at the floor */
  eventProtein: number;
  drinkBudget: number;
  /** what fits in the drink budget, lightest per glass first; empty without alcohol */
  drinks: EventDrinkOption[];
  /** food rules for the event meal */
  tips: string[];
  /** rows for plan_adjustments on the event day (source 'ai') */
  adjustments: DayAdjustment[];
  /** event meal items shown on that day's timeline */
  items: PlanItem[];
  /** one line for the morning reminder and the events row */
  summary: string;
  /** the day as planned after the change */
  dayKcal: number;
  dayProtein: number;
}

const FOOD_TIPS = [
  '고기·회·두부 같은 단백질과 채소를 먼저 먹습니다',
  '밥·면·전·튀김과 마무리 볶음밥은 건너뜁니다',
  '국물과 찌개는 건더기 위주로 먹습니다',
];

const DRINK_TIPS_ON = '술은 한 잔마다 물 한 잔을 같이 마십니다';
const DRINK_TIPS_OFF = '음료는 물, 탄산수, 제로 음료로 마십니다';

/** Plan the day around an event at lunch or dinner. Throws nothing; an event already eaten is the caller's check. */
export function planEvent(i: PlanEventInput): EventPlan {
  const applied = i.appliedCuts ?? new Set<string>();
  const event = i.meals.find((m) => m.key === i.slot);
  const planned = event?.kcal ?? 0;
  const before = new Set(BEFORE[i.slot]);
  const pending = new Map(i.meals.filter((m) => m.pending && before.has(m.key)).map((m) => [m.key, m]));
  const dayProtein0 = i.meals.reduce((s, m) => s + m.protein, 0);

  // carbs first (same table and order as the day rebalance), never under the protein floor
  const cuts: Cut[] = [];
  let freed = 0;
  let lostProtein = 0;
  for (const c of CUTS) {
    if (freed >= EVENT_FREE_MAX) break;
    const m = pending.get(c.slot);
    if (!m || applied.has(c.id)) continue;
    if (c.item && !m.items.some((x) => x.name.includes(c.item!))) continue;
    const prevAt = c.replaces ? cuts.findIndex((x) => x.id === c.replaces) : -1;
    const prev = prevAt >= 0 ? cuts[prevAt]! : null;
    if (c.replaces && !prev && applied.has(c.replaces)) continue;
    const gain = c.kcal - (prev?.kcal ?? 0);
    const lose = c.protein - (prev?.protein ?? 0);
    if (freed + gain > EVENT_FREE_MAX + 50) continue;
    if (lose > 0 && dayProtein0 - lostProtein - lose < i.proteinFloor) continue;
    if (prev) cuts.splice(prevAt, 1);
    cuts.push(c);
    freed += gain;
    lostProtein += lose;
  }

  // a plan without the built-in items (generated plans): trim the main carb of the meal before the event
  if (freed < 100) {
    const main = pending.get(i.slot === 'dinner' ? 'lunch' : 'breakfast');
    if (main && !cuts.some((c) => c.slot === main.key)) {
      const kcal = Math.round((main.kcal * 0.15) / 10) * 10;
      if (kcal >= 30) {
        cuts.push({ id: `event-trim-${main.key}`, slot: main.key, label: '밥·빵·면 양 1/3 줄이기', kcal, protein: 0 });
        freed += kcal;
      }
    }
  }

  // protein before leaving keeps the event meal from turning into a carb meal
  const preSlot = PRE_PROTEIN_SLOT[i.slot].find((k) => pending.has(k));
  const avoid = (i.avoid ?? []).map((w) => w.trim()).filter(Boolean);
  const avoids = (label: string) => avoid.some((w) => label.includes(w) || (w.includes('닭') && label.includes('닭')) || (w.includes('계란') && label.includes('란')));
  const add = preSlot ? PROTEIN_ADDS.find((a) => !avoids(a.label)) : undefined;
  const proteinAdd = preSlot && add
    ? { slot: preSlot, id: `pre-${add.id}`, label: `가기 전 ${add.label.replace(/ 추가$/, '')}`, kcal: add.kcal, protein: add.protein }
    : null;
  const net = freed - (proteinAdd?.kcal ?? 0);
  const budget = Math.max(planned, planned + net);

  const others = i.meals.filter((m) => m.key !== i.slot);
  const othersKcal = others.reduce((s, m) => s + m.kcal, 0) - freed + (proteinAdd?.kcal ?? 0);
  const othersProtein = others.reduce((s, m) => s + m.protein, 0) - lostProtein + (proteinAdd?.protein ?? 0);
  const eventProtein = Math.max(event?.protein ?? 0, i.proteinFloor - othersProtein);

  const drinkBudget = i.alcohol ? Math.min(DRINK_CAP, Math.round((budget * DRINK_SHARE) / 10) * 10) : 0;
  const drinks: EventDrinkOption[] = i.alcohol
    ? DRINKS.map((d) => {
      const each = drinkKcal(d);
      const count = Math.floor(drinkBudget / each);
      return { id: d.id, name: d.name, serving: d.serving, kcalEach: each, count, kcal: count * each };
    }).filter((d) => d.count >= 1).sort((a, b) => a.kcalEach - b.kcalEach)
    : [];

  const drinkLine = drinkText(drinks);
  const items: PlanItem[] = [
    { name: i.label, amount: `약 ${fmt(budget)}kcal 안에서`, note: `단백질 ${Math.round(eventProtein)}g 이상` },
    { name: '먼저', amount: '고기·회·두부, 채소' },
    { name: '건너뛰기', amount: '밥·면·전·튀김, 마무리 볶음밥' },
    i.alcohol ? { name: '술', amount: drinkLine ? `${drinkLine}까지` : '되도록 마시지 않기', note: '하이볼은 토닉 대신 탄산수로. 맥주·막걸리보다 하이볼·소주가 가볍습니다' } : { name: '음료', amount: '물, 탄산수, 제로 음료' },
  ];

  const reason = `${SLOT_NAME[i.slot]} ${i.label}에 맞춰 미리 조정`;
  const adjustments: DayAdjustment[] = [
    ...cuts.map((c): DayAdjustment => ({ slot: c.slot, source: 'ai', reason, change: { kind: 'cut', kcal_delta: -c.kcal, protein_delta: -c.protein, label: c.label, ...(c.id.startsWith('event-trim') ? {} : { cut_id: c.id }) } })),
    ...(proteinAdd ? [{ slot: proteinAdd.slot, source: 'ai' as const, reason, change: { kind: 'add' as const, kcal_delta: proteinAdd.kcal, protein_delta: proteinAdd.protein, label: proteinAdd.label } }] : []),
    { slot: i.slot, source: 'ai', reason, change: { kind: 'edit', kcal_delta: budget - planned, protein_delta: Math.round(eventProtein - (event?.protein ?? 0)), label: `${i.label} · 약 ${fmt(budget)}kcal`, items } },
  ];

  const order: MealKey[] = ['breakfast', 'lunch', 'snack', 'post', 'dinner'];
  const parts = [
    ...[...cuts].sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot)).map((c) => `${SLOT_NAME[c.slot]} ${c.label}`),
    ...(proteinAdd ? [proteinAdd.label] : []),
    `${i.label}은 약 ${fmt(budget)}kcal`,
    ...(i.alcohol && drinkLine ? [`술은 ${drinkLine}까지`] : []),
  ];
  return {
    cuts, proteinAdd, freed, planned, budget, eventProtein: Math.round(eventProtein), drinkBudget, drinks,
    tips: [...FOOD_TIPS, i.alcohol ? DRINK_TIPS_ON : DRINK_TIPS_OFF],
    adjustments, items,
    summary: `${parts.join(', ')}.`.slice(0, 300),
    dayKcal: Math.round(othersKcal + budget),
    dayProtein: Math.round(othersProtein + eventProtein),
  };
}

/** "하이볼 2잔 또는 소주 3잔": highball and soju first (the lighter choices to suggest), else the lightest two. */
export function drinkText(drinks: EventDrinkOption[]): string {
  const pick = ['highball', 'soju'].map((id) => drinks.find((d) => d.id === id)).filter((d): d is EventDrinkOption => !!d);
  const list = (pick.length ? pick : drinks).slice(0, 2);
  return list.map((d) => `${d.name.replace(/ \(.+\)$/, '')} ${d.count}${d.serving === '1잔' ? '잔' : `잔(${d.serving})`}`).join(' 또는 ');
}

export const eventKindFor = (slot: EventSlot, alcohol: boolean): EventKind => (alcohol ? 'drinks' : slot === 'dinner' ? 'dinner_out' : 'other');
