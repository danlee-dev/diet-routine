import { describe, expect, it } from 'vitest';
import type { MealEntryRow } from '@diet/core';
import { loggedDetail } from '../src';

const entry = (x: Partial<MealEntryRow>): MealEntryRow => ({
  id: 'e', date: '2026-11-16', slot: 'breakfast', kind: 'replace', eaten_at: null, food_id: null, name: '', servings: null,
  amount_text: null, items: null, kcal: 0, protein_g: 0, source: 'manual', photo_path: null, confidence: null, note: null,
  updated_at: '', deleted_at: null, ...x,
} as MealEntryRow);

describe('loggedDetail', () => {
  it('lists the foods of a coach entry instead of the plan', () => {
    const d = loggedDetail([entry({
      name: '달걀 2개, 그릭요거트+꿀, 방울토마토', amount_text: '달걀 2개, 무가당 그릭요거트 100g + 꿀 2/3큰술, 방울토마토 5개',
      kcal: 290, protein_g: 22, source: 'ai_text', confidence: 0.75,
    })]);
    expect(d.lines).toEqual([
      { name: '달걀', amount: '2개' },
      { name: '무가당 그릭요거트 100g + 꿀 2/3큰술', amount: '' },
      { name: '방울토마토', amount: '5개' },
    ]);
    expect(d).toMatchObject({ kcal: 290, protein: 22, offPlan: true, est: true });
  });

  it('keeps a one-food entry as name and amount', () => {
    expect(loggedDetail([entry({ name: '바나나', amount_text: '1개', kcal: 90, protein_g: 1 })]).lines).toEqual([{ name: '바나나', amount: '1개' }]);
    expect(loggedDetail([entry({ name: '편의점 샐러드', kcal: 200 })]).lines).toEqual([{ name: '편의점 샐러드', amount: '' }]);
  });

  it('shows the planned items for a plan check and what was left for a partial meal', () => {
    const plan = loggedDetail([entry({ kind: 'plan', source: 'plan', items: [{ name: '달걀', amount: '2개' }], kcal: 140, protein_g: 12 })]);
    expect(plan).toMatchObject({ lines: [{ name: '달걀', amount: '2개' }], offPlan: false, est: false, notes: [] });
    const part = loggedDetail([entry({ name: '아침 (일부)', source: 'plan', items: [{ name: '달걀', amount: '2개' }], note: '안 먹음: 귤', kcal: 140, protein_g: 12 })]);
    expect(part).toMatchObject({ lines: [{ name: '달걀', amount: '2개' }], notes: ['안 먹음: 귤'], offPlan: true });
  });

  it('adds up several entries and leaves the skip marker out', () => {
    const d = loggedDetail([
      entry({ kind: 'plan', source: 'plan', items: [{ name: '달걀', amount: '2개' }], kcal: 140, protein_g: 12 }),
      entry({ kind: 'extra', name: '아메리카노', amount_text: '1잔', kcal: 10, protein_g: 0.4 }),
      entry({ kind: 'skip', name: '건너뜀' }),
    ]);
    expect(d.lines.map((x) => x.name)).toEqual(['달걀', '아메리카노']);
    expect(d).toMatchObject({ kcal: 150, protein: 12 });
  });
});
