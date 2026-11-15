import { describe, expect, it } from 'vitest';
import {
  CYCLE, effectiveShop, generatePlan, matchPantry, MEALS, ORDER, pantryItemOf, pantryItems, pantryStatus, plan, plannedDailyUse,
  quantities, SHOP_NOW, SHOP_WEEK, stockAlerts, stockText, useOf, type OnboardingAnswers, type PantryEntry, type PantryInput,
} from '../src';

const owner = effectiveShop(null);
const items = pantryItems(owner);
const byName = (part: string) => items.find((p) => p.name.includes(part))!;
const homeDay = plan({ scen: 'home', eatout: 'lunch', wake: 9 * 60 });

describe('reading sizes', () => {
  it('reads weights, volumes, counts, spoons and Korean numbers', () => {
    expect(quantities('냉동 브로콜리 1kg')).toEqual([{ n: 1000, kind: 'g', label: 'g' }]);
    expect(quantities('서울우유 저지방 1L')).toEqual([{ n: 1000, kind: 'ml', label: 'ml' }]);
    expect(quantities('30개입 · 30일치')).toEqual([{ n: 30, kind: 'ea', label: '개' }]);
    expect(quantities('조금 / 1큰술')).toEqual([{ n: 15, kind: 'g', label: 'g' }]);
    expect(quantities('반 공기')).toEqual([{ n: 0.5, kind: 'ea', label: '공기' }]);
    // words that only start like a number or unit are not sizes
    expect(quantities('한끼통살 큐브 깻잎맛')).toEqual([]);
    expect(quantities('두부 반 모')).toEqual([{ n: 0.5, kind: 'ea', label: '모' }]);
  });

  it('counts each built-in item the way it is bought', () => {
    expect(byName('헬로틴')).toMatchObject({ unit: 'ea', pack: 30 });
    expect(byName('햇반')).toMatchObject({ unit: 'ea', pack: 36, gPerEa: 130 });
    expect(byName('브로콜리')).toMatchObject({ unit: 'g', pack: 2000 });
    expect(byName('더블리치')).toMatchObject({ unit: 'g', pack: 899 });
    expect(byName('대란')).toMatchObject({ unit: 'ea', label: '구', pack: 30 });
    expect(byName('저지방')).toMatchObject({ unit: 'ml', pack: 2000 });
    expect(byName('데일리믹스')).toMatchObject({ unit: 'ea', pack: 7, gPerEa: 100 });
    expect(byName('감귤')).toMatchObject({ unit: 'g', pack: 3000 });
  });

  it('merges a 지금 item with its 날짜별 reorder (same product link)', () => {
    const hellotin = byName('헬로틴');
    expect(hellotin.ids).toEqual(['n1', 'hellotin']);
    expect(items).toHaveLength(SHOP_NOW.length + SHOP_WEEK.length + 1); // + tangerine, only in the cycle list
    expect(CYCLE.every((c) => items.some((p) => p.ids.includes(c.id)))).toBe(true);
  });
});

describe('matching plan items', () => {
  it('maps every owner plan item that comes from the pantry', () => {
    const pairs = ORDER.flatMap((k) => MEALS[k].items).map((it) => [it.name, matchPantry(it.name, items)?.name ?? null]);
    const m = Object.fromEntries(pairs);
    expect(m['달걀']).toContain('대란');
    expect(m['귤 (꼬마과)']).toContain('감귤');
    expect(m['헬로틴 저염 닭가슴살']).toContain('헬로틴');
    expect(m['한끼통살 큐브']).toContain('한끼통살');
    expect(m['샐러드 믹스']).toContain('데일리믹스');
    expect(m['프로틴 (더블리치초콜릿)']).toContain('더블리치');
    expect(m['저지방 우유']).toContain('서울우유');
    expect(m['방울토마토']).toContain('방울토마토');
    expect(m['김치 또는 저칼로리 드레싱']).toContain('드레싱');
  });

  it('leaves convenience-store food alone', () => {
    expect(matchPantry('편의점 닭가슴살', items)).toBeNull();
    expect(matchPantry('물', items)).toBeNull();
  });

  it('turns plan amounts into the item unit', () => {
    expect(useOf({ name: '달걀', amount: '2개' }, byName('대란'))).toBe(2);
    expect(useOf({ name: '냉동 브로콜리', amount: '150g' }, byName('브로콜리'))).toBe(150);
    expect(useOf({ name: '프로틴', amount: '1스쿱' }, byName('더블리치'))).toBe(30);
    expect(useOf({ name: '방울토마토', amount: '10개' }, byName('방울토마토'))).toBe(120);
    expect(useOf({ name: '귤', amount: '3개' }, byName('감귤'))).toBe(150);
    expect(useOf({ name: '햇반', amount: '반 공기' }, byName('햇반'))).toBe(0.5);
    expect(useOf({ name: '헬로틴', amount: '1팩 (없으면 구운란 2개)' }, byName('헬로틴'))).toBe(1);
  });

  it('knows what an ordinary owner day uses', () => {
    const d = plannedDailyUse(homeDay, items);
    expect(d.get(byName('헬로틴').id)).toBe(2); // snack + dinner
    expect(d.get(byName('대란').id)).toBe(2);
    expect(d.get(byName('브로콜리').id)).toBe(150);
    expect(d.get(byName('드레싱').id)).toBe(30); // lunch 1큰술 + dinner 1큰술
  });
});

describe('stock', () => {
  const at = '2026-11-15T00:00:00.000Z';
  const planEntry = (when: string, key: (typeof ORDER)[number]): PantryEntry => ({ eaten_at: when, kind: 'plan', items: MEALS[key].items, source: 'plan', confidence: 1 });
  const input = (entries: PantryEntry[], count = 8): PantryInput => ({ shop: owner, records: { n1: { count, at } }, entries, meals: homeDay });

  it('falls with every meal logged after the count and gives days left', () => {
    const s0 = pantryStatus(input([])).find((s) => s.item.id === 'n1')!;
    expect(s0).toMatchObject({ stock: 8, daily: 2, daysLeft: 4 });
    const s1 = pantryStatus(input([planEntry('2026-11-15T03:00:00.000Z', 'snack'), planEntry('2026-11-15T09:00:00.000Z', 'dinner')])).find((s) => s.item.id === 'n1')!;
    expect(s1).toMatchObject({ stock: 6, daysLeft: 3 });
  });

  it('ignores meals before the count, skipped or replaced meals, and meals eaten out', () => {
    const entries: PantryEntry[] = [
      planEntry('2026-11-14T09:00:00.000Z', 'dinner'), // before the count
      { eaten_at: '2026-11-15T03:00:00.000Z', kind: 'skip', items: null },
      { eaten_at: '2026-11-15T04:00:00.000Z', kind: 'replace', items: null },
      { eaten_at: '2026-11-15T09:00:00.000Z', kind: 'plan', items: [{ name: '헬로틴 저염 닭가슴살', amount: '1팩' }], source: 'plan', confidence: 0.6 },
    ];
    expect(pantryStatus(input(entries)).find((s) => s.item.id === 'n1')!.stock).toBe(8);
  });

  it('counts only what was kept from a partial meal', () => {
    const partial: PantryEntry = { eaten_at: '2026-11-15T05:00:00.000Z', kind: 'replace', items: [{ name: '하루견과', amount: '1봉' }], source: 'plan', confidence: 1 };
    const s = pantryStatus({ shop: owner, records: { n1: { count: 8, at }, n5: { count: 10, at } }, entries: [partial], meals: homeDay });
    expect(s.find((x) => x.item.id === 'n1')!.stock).toBe(8);
    expect(s.find((x) => x.item.id === 'n5')!.stock).toBe(9);
  });

  it('reads a record stored under any of the product ids', () => {
    const s = pantryStatus({ shop: owner, records: { hellotin: { count: 12, at } }, entries: [], meals: homeDay });
    expect(s.find((x) => x.item.id === 'n1')!.stock).toBe(12);
  });

  it('alerts at three days or fewer, fewest first, and never for uncounted items', () => {
    const records = { n1: { count: 6, at }, n8: { count: 2, at }, n2: { count: 20, at } };
    const alerts = stockAlerts({ shop: owner, records, entries: [], meals: homeDay });
    expect(alerts.map((a) => a.id)).toEqual(['n8', 'n1']);
    expect(alerts[0]).toMatchObject({ daysLeft: 1, title: '곰곰 무항생제 대란 1일분 남았습니다', detail: '2구 남음 · 하루 2구' });
    expect(alerts[1]!.url).toContain('coupang.com');
    expect(stockAlerts({ shop: owner, records: {}, entries: [], meals: homeDay })).toEqual([]);
  });

  it('formats counts and weights', () => {
    expect(stockText(12, byName('헬로틴'))).toBe('12개');
    expect(stockText(1350, byName('브로콜리'))).toBe('1.4kg');
    expect(stockText(300, byName('저지방'))).toBe('300ml');
  });
});

describe('generated shopping lists', () => {
  const answers: OnboardingAnswers = {
    sex: 'female', age: 30, heightCm: 163, weightKg: 68, goalWeightKg: 60, weeks: 12, activity: 'light',
    wakeMin: 7 * 60, eatingOut: 'rarely', cooking: 'microwave', allergies: [], dislikes: [], workoutPlace: 'home', workoutDays: 3, budgetWeek: 0,
  } as OnboardingAnswers;
  const g = generatePlan(answers);
  const shop = g.plan.shop!;
  const its = pantryItems(shop);

  it('maps every generated plan item with something to buy to its list entry', () => {
    const meals = Object.values(g.plan.meals ?? {}).filter((m) => m?.items);
    const names = meals.flatMap((m) => m!.items!.map((i) => i.name));
    expect(names.length).toBeGreaterThan(3);
    const matched = names.filter((n) => matchPantry(n, its));
    expect(matched.length).toBeGreaterThan(names.length / 2);
  });

  it('gives every generated item a positive pack and a days-left once counted', () => {
    for (const p of its) expect(p.pack).toBeGreaterThan(0);
    const meals = Object.values(g.plan.meals ?? {}).map((m) => ({ items: m!.items ?? [] }));
    const records = Object.fromEntries(its.map((p) => [p.id, { count: p.pack, at: '2026-11-15T00:00:00.000Z' }]));
    const used = pantryStatus({ shop, records, entries: [], meals }).filter((s) => s.daily > 0);
    expect(used.length).toBeGreaterThan(2);
    for (const s of used) expect(s.daysLeft).toBeGreaterThan(0);
  });

  it('reads a package without a size from the catalog (바나나 1송이)', () => {
    expect(pantryItemOf({ id: 'x', name: '바나나 1송이', qty: '2개 · 7일치', url: '' })).toMatchObject({ unit: 'ea', label: '개', pack: 12 });
  });
});
