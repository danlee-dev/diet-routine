// Pantry: how much of each shopping item is left, and when to reorder.
// A purchase or a hand count sets a number at a moment. Every meal logged after that moment takes away what
// its items use (plan items are matched to shopping items by name), so the count falls as meals are eaten and
// comes back when a logged meal is undone. Days left use what the plan eats on an ordinary day.
// Pure: the data layer passes rows in; the reminders planner can call stockAlerts with the same input.
import type { PlanItem } from './data';
import { FOODS } from './onboarding';
import type { ShopPlan } from './rebalance';

export type PantryUnit = 'ea' | 'g' | 'ml';

export interface PantryItem {
  /** the first list entry's id (지금 → 매주 → 날짜별) */
  id: string;
  /** every list entry for this product, e.g. the 지금 item and its 날짜별 reorder */
  ids: string[];
  name: string;
  url: string;
  unit: PantryUnit;
  /** what one 'ea' is called (팩, 개, 구); 'g' / 'ml' otherwise */
  label: string;
  /** units one purchase adds */
  pack: number;
  /** packages in one purchase ("2개 옵션"), for per-package catalog servings */
  packages: number;
  /** grams (or ml) per piece, to turn a weight into pieces */
  gPerEa?: number;
}

/** Stored per item: a count that was true at `at`. Meals logged later subtract from it. */
export interface PantryRecord {
  count: number;
  /** ISO time */
  at: string;
  /** the record a purchase replaced, so un-marking the purchase can put it back */
  prev?: { count: number; at: string } | null;
}

/** The parts of a meal_entries row the pantry reads. */
export interface PantryEntry {
  eaten_at: string | null;
  kind: string;
  items: { name: string; amount: string }[] | null;
  confidence?: number | null;
  source?: string;
}

export interface PantryInput {
  shop: ShopPlan;
  /** by pantry item id (any of its ids works) */
  records: Record<string, PantryRecord>;
  entries: PantryEntry[];
  /** an ordinary day of the plan, for the daily rate */
  meals: { items: PlanItem[]; est?: boolean }[];
}

export interface PantryStatus {
  item: PantryItem;
  record: PantryRecord | null;
  /** units left now; null = never counted */
  stock: number | null;
  /** units the plan uses on an ordinary day */
  daily: number;
  /** whole days left at that rate; null when not counted or the plan does not use it */
  daysLeft: number | null;
}

export interface StockAlert {
  id: string;
  name: string;
  url: string;
  daysLeft: number;
  stock: number;
  /** "헬로틴 저염 스팀 닭가슴살 3일분 남았습니다" */
  title: string;
  /** "6개 남음 · 하루 2개" */
  detail: string;
}

/** Reorder when this many days or fewer are left. */
export const STOCK_ALERT_DAYS = 3;

// ---------------- reading sizes and amounts ----------------

const NUM_WORD: Record<string, number> = { 반: 0.5, 한: 1, 두: 2, 세: 3, 네: 4 };
// longer units first so 개입 is not read as 개, kg not as g
const UNIT = '(kg|g|ml|mL|L|l|리터|큰술|작은술|스쿱|컵|개입|개|구|팩|봉지|봉|캔|입|포|병|알|공기|모|마리)';
const QTY = new RegExp(`(\\d+(?:[.,]\\d+)?|반|한|두|세|네)\\s*${UNIT}(?![a-zA-Z가-힣])`, 'g');
// a size inside a product name; 'L'/'l' and Korean units must not run into a following word
const SPOON: Record<string, number> = { 큰술: 15, 작은술: 5, 스쿱: 30 };

interface Qty { n: number; kind: PantryUnit; label: string }

/** Every size or amount in a text: "1kg" -> 1000 g, "30개입" -> 30 개, "1큰술" -> 15 g, "반 팩" -> 0.5 팩. */
export function quantities(text: string): Qty[] {
  const out: Qty[] = [];
  for (const m of text.matchAll(QTY)) {
    const raw = m[1]!;
    const n = NUM_WORD[raw] ?? Number(raw.replace(',', '.'));
    const u = m[2]!;
    if (!Number.isFinite(n) || n <= 0) continue;
    if (u === 'kg') out.push({ n: n * 1000, kind: 'g', label: 'g' });
    else if (u === 'g') out.push({ n, kind: 'g', label: 'g' });
    else if (u === 'L' || u === 'l' || u === '리터') out.push({ n: n * 1000, kind: 'ml', label: 'ml' });
    else if (u === 'ml' || u === 'mL') out.push({ n, kind: 'ml', label: 'ml' });
    else if (u === '컵') out.push({ n: n * 200, kind: 'ml', label: 'ml' });
    else if (SPOON[u]) out.push({ n: n * SPOON[u]!, kind: 'g', label: 'g' });
    else out.push({ n, kind: 'ea', label: u === '개입' ? '개' : u });
  }
  return out;
}

const isWeight = (q: Qty) => q.kind !== 'ea';
/** A piece this heavy or more is a bulk bag/bottle counted by weight (브로콜리 1kg), lighter is a portion (햇반 130g). */
const BULK_G = 250;

type Listed = { id: string; name: string; qty?: string; url: string };

const catalogFor = (label: string) => Object.values(FOODS).find((f) => f.buy?.label === label);

/** How a shopping entry is counted: by piece or by weight, and how much one purchase adds. */
export function pantryItemOf(x: Listed): PantryItem {
  const nameQ = quantities(x.name);
  const qtyQ = quantities(x.qty ?? '');
  const w = nameQ.find(isWeight) ?? qtyQ.find(isWeight);
  const cn = nameQ.find((q) => q.kind === 'ea');
  const qtyCounts = qtyQ.filter((q) => q.kind === 'ea');
  const cq = qtyCounts.reduce((a, q) => a + q.n, 0) || 1;
  const base = { id: x.id, ids: [x.id], name: x.name, url: x.url, packages: cq };
  if (w && w.n >= BULK_G) return { ...base, unit: w.kind, label: w.kind, pack: w.n * (cn?.n ?? 1) * cq };
  if (w) return { ...base, unit: 'ea', label: cn?.label ?? qtyCounts[0]?.label ?? '개', pack: (cn?.n ?? 1) * cq, gPerEa: w.n };
  if (cn) return { ...base, unit: 'ea', label: cn.label, pack: cn.n * cq };
  // a generated list names the package without a size ("바나나 1송이"): the catalog knows its servings
  const cat = catalogFor(x.name);
  if (cat?.buy) return { ...base, unit: 'ea', label: '개', pack: cat.buy.servings * cq };
  return { ...base, unit: 'ea', label: qtyCounts[0]?.label ?? '개', pack: cq };
}

/** One pantry item per product: the 지금 entry and its 날짜별 reorder share a link (or a name). */
export function pantryItems(shop: ShopPlan): PantryItem[] {
  const out: PantryItem[] = [];
  const listed: Listed[] = [
    ...shop.now.map((s) => ({ id: s.id, name: s.name, qty: s.qty, url: s.url })),
    ...shop.week.map((s) => ({ id: s.id, name: s.name, qty: s.qty, url: s.url })),
    ...shop.cycle.map((c) => ({ id: c.id, name: c.name, url: c.url })),
  ];
  for (const x of listed) {
    const same = out.find((p) => (x.url && p.url === x.url) || p.name === x.name);
    if (same) { if (!same.ids.includes(x.id)) same.ids.push(x.id); continue; }
    out.push(pantryItemOf(x));
  }
  return out;
}

// ---------------- matching plan items to shopping items ----------------

const SYN: string[][] = [
  ['달걀', '계란', '대란', '특란', '구운란', '맥반석란'],
  ['귤', '감귤', '꼬마과', '황감', '밀감'],
  ['프로틴', '웨이', '골드스탠다드', '단백질파우더'],
  ['샐러드', '데일리믹스', '샐러드믹스', '채소믹스', '양상추'],
  ['커피', '블랙커피', '아메리카노', '카누'],
  ['밥', '햇반', '즉석밥', '흑미밥', '현미밥'],
  ['우유', '서울우유'],
];
const STOP = new Set(['또는', '조금', '선택', '없으면', '가방에', '있으면', '마시고', '싶으면']);

const tokens = (s: string): string[] =>
  s.replace(QTY, ' ').replace(/[()[\]·,/+~]/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t && !STOP.has(t) && !/^\d/.test(t));

const synOf = (t: string) => SYN.findIndex((g) => g.includes(t));

function tokenScore(a: string, b: string): number {
  if (a === b) return 3;
  if ((a.length >= 2 && b.includes(a)) || (b.length >= 2 && a.includes(b))) return 2;
  const sa = synOf(a);
  if (sa >= 0 && sa === synOf(b)) return 2;
  // "귤" inside "감귤": a one-letter word counts only through its synonym group, handled above
  for (const g of SYN) if (g.includes(a) && g.some((w) => w.length >= 2 && b.includes(w))) return 2;
  return 0;
}

/**
 * The shopping item a plan item comes from. Store-bought on the way (편의점) is not from the pantry.
 * Onboarding plans map exactly through the catalog; other names by shared words and synonyms.
 */
export function matchPantry(name: string, items: PantryItem[]): PantryItem | null {
  if (/편의점/.test(name) || !items.length) return null;
  for (const f of Object.values(FOODS)) {
    if (f.name !== name || !f.buy) continue;
    const hit = items.find((p) => p.name === f.buy!.label);
    if (hit) return hit;
  }
  const pt = tokens(name);
  if (!pt.length) return null;
  let best: PantryItem | null = null;
  let bestScore = 0;
  let bestRatio = 0;
  for (const p of items) {
    const st = tokens(p.name);
    if (!st.length) continue;
    const score = pt.reduce((a, t) => a + Math.max(0, ...st.map((s) => tokenScore(t, s))), 0);
    const ratio = score / st.length;
    if (score > bestScore || (score === bestScore && ratio > bestRatio)) { best = p; bestScore = score; bestRatio = ratio; }
  }
  return bestScore >= 2 ? best : null;
}

/** Typical weight of one piece of produce, for counts against a stock kept in grams. */
const PIECE_G: [RegExp, number][] = [
  [/방울토마토/, 12], [/귤/, 50], [/키위/, 90], [/바나나/, 120], [/토마토/, 150], [/고구마|감자/, 150],
  [/사과/, 250], [/달걀|계란|구운란/, 55], [/오렌지/, 200],
];
const pieceWeight = (name: string) => PIECE_G.find(([re]) => re.test(name))?.[1];

/** Units of the catalog food per serving, when the plan item came from onboarding. */
function catalogServing(name: string, p: PantryItem): number | null {
  const f = Object.values(FOODS).find((x) => x.name === name && x.buy?.label === p.name);
  if (!f?.buy) return null;
  return p.pack / p.packages / f.buy.servings;
}

/** How many of the item's units one plan item uses ("2개" eggs = 2, "150g" broccoli = 150 g, "1큰술" = 15 g). */
export function useOf(it: { name: string; amount: string }, p: PantryItem): number {
  const main = it.amount.replace(/\([^)]*\)/g, ' ');
  const cnt = quantities(main).find((q) => q.kind === 'ea');
  const wt = quantities(main).find(isWeight) ?? quantities(it.amount).find(isWeight);
  if (p.unit === 'ea') {
    if (cnt) return cnt.n;
    if (wt && p.gPerEa) return wt.n / p.gPerEa;
    return catalogServing(it.name, p) ?? 1;
  }
  if (wt) return wt.n;
  const per = p.gPerEa ?? pieceWeight(it.name) ?? pieceWeight(p.name);
  if (cnt && per) return cnt.n * per;
  return catalogServing(it.name, p) ?? 0;
}

/** Meals eaten out (estimates) do not come from the pantry. */
const fromPantry = (e: PantryEntry) => (e.kind === 'plan' || e.kind === 'replace') && Array.isArray(e.items) && !(e.source === 'plan' && (e.confidence ?? 1) < 1);

/** Units used per item by the given plan items. */
function usage(lists: { name: string; amount: string }[][], items: PantryItem[]): Map<string, number> {
  const out = new Map<string, number>();
  const memo = new Map<string, PantryItem | null>();
  for (const list of lists) {
    for (const it of list) {
      if (!memo.has(it.name)) memo.set(it.name, matchPantry(it.name, items));
      const p = memo.get(it.name);
      if (!p) continue;
      out.set(p.id, (out.get(p.id) ?? 0) + useOf(it, p));
    }
  }
  return out;
}

/** What an ordinary day of the plan uses, per item. */
export const plannedDailyUse = (meals: PantryInput['meals'], items: PantryItem[]): Map<string, number> =>
  usage(meals.filter((m) => !m.est).map((m) => m.items), items);

const recordFor = (records: Record<string, PantryRecord>, p: PantryItem): PantryRecord | null => {
  for (const id of p.ids) { const r = records[id]; if (r && Number.isFinite(r.count)) return r; }
  return null;
};

export function pantryStatus(input: PantryInput): PantryStatus[] {
  const items = pantryItems(input.shop);
  const daily = plannedDailyUse(input.meals, items);
  const eaten = input.entries.filter(fromPantry);
  return items.map((item) => {
    const record = recordFor(input.records, item);
    const d = Math.round((daily.get(item.id) ?? 0) * 100) / 100;
    if (!record) return { item, record: null, stock: null, daily: d, daysLeft: null };
    const after = eaten.filter((e) => (e.eaten_at ?? '') > record.at);
    const used = usage(after.map((e) => e.items!), items).get(item.id) ?? 0;
    const stock = Math.max(0, Math.round((record.count - used) * 100) / 100);
    return { item, record, stock, daily: d, daysLeft: d > 0 ? Math.floor(stock / d + 1e-9) : null };
  });
}

// ---------------- words ----------------

const trim1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** "12개", "1.4kg", "350ml". */
export function stockText(n: number, p: Pick<PantryItem, 'unit' | 'label'>): string {
  if (p.unit === 'ea') return `${trim1(n)}${p.label}`;
  if (n >= 1000) return `${trim1(n / 1000)}${p.unit === 'g' ? 'kg' : 'L'}`;
  return `${Math.round(n)}${p.unit}`;
}

/** Product name without sizes and "(선택)": "헬로틴 저염 스팀 닭가슴살". */
export const pantryName = (name: string): string => name.replace(QTY, '').replace(/\((선택|optional)\)/g, '').replace(/\s+/g, ' ').trim();

export function daysLeftText(d: number): string {
  return d <= 0 ? '오늘 떨어집니다' : `${d}일분 남았습니다`;
}

/** Items to reorder: counted, used by the plan, and at most `days` days left. Fewest days first. */
export function stockAlerts(input: PantryInput | PantryStatus[], opts: { days?: number } = {}): StockAlert[] {
  const days = opts.days ?? STOCK_ALERT_DAYS;
  const status = Array.isArray(input) ? input : pantryStatus(input);
  return status
    .filter((s): s is PantryStatus & { stock: number; daysLeft: number } => s.stock != null && s.daysLeft != null && s.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map((s) => ({
      id: s.item.id, name: pantryName(s.item.name), url: s.item.url, daysLeft: s.daysLeft, stock: s.stock,
      title: `${pantryName(s.item.name)} ${daysLeftText(s.daysLeft)}`,
      detail: `${stockText(s.stock, s.item)} 남음 · 하루 ${stockText(s.daily, s.item)}`,
    }));
}

/** The count after buying `packs` purchases on top of what is left (unknown counts as empty). */
export const afterPurchase = (s: Pick<PantryStatus, 'stock' | 'item'>, packs = 1): number => (s.stock ?? 0) + s.item.pack * packs;
