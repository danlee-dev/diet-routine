import { describe, expect, it } from 'vitest';
import { DEFAULT_PROGRAM, parseForecast, PRESETS, type ChecklistRow, type FoodRow } from '@diet/core';
import {
  adoptLegacyProfile, completeWorkout, countedIds, DataStore, foodPresets, intakeSeries, logFood, markBought, ordersDue, pantryFor, pantryRecords,
  presetsCustomized, rainSuggestion, recommendation, removePreset, resetPresets, savePreset, setDay, setStock, setTodaySession, setWeatherCity,
  stockAlertsFor, stopCounting, swapWalkForWorkout, todayView, toggleBought, toggleMeal, unmarkBought, weatherCity, dueRoutine, type Env,
} from '../src';

/** The owner's built-in program starts on 2026-11-15 (day 1). */
const makeEnv = async (at = new Date(2026, 10, 15, 9, 0)) => {
  const store = new DataStore({ load: async () => null, save: async () => {} });
  await store.init();
  let n = 0;
  let now = at;
  const env: Env & { setNow: (d: Date) => void } = {
    store, program: DEFAULT_PROGRAM, now: () => now, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    setNow: (d: Date) => { now = d; },
  };
  adoptLegacyProfile(env);
  return env;
};

describe('pantry', () => {
  it('starts uncounted, then a hand count falls with meals eaten on the plan', async () => {
    const env = await makeEnv();
    expect(pantryFor(env, 'n1')!.stock).toBeNull();
    setStock(env, 'n1', 8);
    expect(pantryFor(env, 'n1')).toMatchObject({ stock: 8, daily: 2, daysLeft: 4 });
    env.setNow(new Date(2026, 10, 15, 15, 0));
    toggleMeal(env, '2026-11-15', 'snack'); // 헬로틴 1팩
    expect(pantryFor(env, 'n1')).toMatchObject({ stock: 7, daysLeft: 3 });
    // unchecking the meal gives it back
    toggleMeal(env, '2026-11-15', 'snack');
    expect(pantryFor(env, 'n1')!.stock).toBe(8);
  });

  it('a 날짜별 id counts the same product', async () => {
    const env = await makeEnv();
    setStock(env, 'hellotin', 5);
    expect(pantryFor(env, 'n1')!.stock).toBe(5);
    expect(Object.keys(pantryRecords(env))).toEqual(['n1']);
  });

  it('buying adds a full pack to what is left, and un-marking puts the count back', async () => {
    const env = await makeEnv();
    setStock(env, 'n1', 4);
    env.setNow(new Date(2026, 10, 15, 10, 0));
    markBought(env, 'n1');
    expect(pantryFor(env, 'n1')!.stock).toBe(34);
    expect(unmarkBought(env, 'n1')).toBe(true);
    expect(pantryFor(env, 'n1')!.stock).toBe(4);
    // nothing bought on an uncounted item: un-marking removes the count again
    markBought(env, 'n8');
    expect(pantryFor(env, 'n8')!.stock).toBe(30);
    unmarkBought(env, 'n8');
    expect(pantryFor(env, 'n8')!.stock).toBeNull();
  });

  it('the 장보기 checkbox refills, unchecking reverts, and the toast undo restores both', async () => {
    const env = await makeEnv();
    setStock(env, 'n1', 2);
    env.setNow(new Date(2026, 10, 15, 10, 0));
    const on = toggleBought(env, 'n1');
    expect(on.checked).toBe(true);
    expect(on.status!.stock).toBe(32);
    expect(env.store.get<ChecklistRow>('checklist', 'shop:n1')!.checked).toBe(true);
    on.undo();
    expect(pantryFor(env, 'n1')!.stock).toBe(2);
    expect(env.store.get<ChecklistRow>('checklist', 'shop:n1')!.checked).toBe(false);
    toggleBought(env, 'n1');
    const off = toggleBought(env, 'n1');
    expect(off.checked).toBe(false);
    expect(pantryFor(env, 'n1')!.stock).toBe(2);
  });

  it('alerts at three days and puts the alert on the Today tip line with the Coupang link', async () => {
    const env = await makeEnv();
    setStock(env, 'n1', 6);
    const alerts = stockAlertsFor(env);
    expect(alerts.map((a) => a.id)).toEqual(['n1']);
    const r = recommendation(env, todayView(env));
    expect(r.id).toBe('stock:n1');
    expect(r.title).toBe('헬로틴 저염 스팀 닭가슴살 3일분 남았습니다');
    expect(r.action).toMatchObject({ kind: 'order', label: '쿠팡 열기' });
    expect(r.action!.url).toContain('coupang.com');
  });

  it('a counted product leaves the date-based reminders; stopping brings them back', async () => {
    // day 13 (2026-11-27): eggs and 헬로틴 are due by date
    const env = await makeEnv(new Date(2026, 10, 27, 9, 0));
    const due = () => ordersDue(env).map((d) => d.id.split('@')[0]);
    expect(due()).toContain('hellotin');
    setStock(env, 'n1', 30);
    expect(countedIds(env).has('hellotin')).toBe(true);
    expect(due()).not.toContain('hellotin');
    expect(due()).toContain('eggs');
    stopCounting(env, 'n1');
    expect(due()).toContain('hellotin');
  });

  it('ignores food logged instead of the plan (no items to take from the pantry)', async () => {
    const env = await makeEnv();
    setStock(env, 'n1', 8);
    env.setNow(new Date(2026, 10, 15, 19, 0));
    logFood(env, { date: '2026-11-15', slot: 'dinner', name: '짜장면', amount: '1그릇', kcal: 800, protein: 20, source: 'preset' });
    expect(pantryFor(env, 'n1')!.stock).toBe(8);
  });
});

describe('presets', () => {
  it('shows the built-in list until the first edit, then the user list (synced rows in foods)', async () => {
    const env = await makeEnv();
    expect(foodPresets(env)).toBe(PRESETS);
    expect(presetsCustomized(env)).toBe(false);
    const { id } = savePreset(env, { name: '포케', serving: '1볼', kcal: 520, protein: 30, group: 'meal' });
    expect(presetsCustomized(env)).toBe(true);
    const list = foodPresets(env);
    expect(list).toHaveLength(PRESETS.length + 1);
    expect(list.find((p) => p.id === id)).toMatchObject({ name: '포케', serving: '1볼', kcal: 520, protein: 30, group: 'meal' });
    const rows = env.store.all<FoodRow>('foods');
    expect(rows.every((r) => r.source === 'preset')).toBe(true);
    expect(rows.every((r) => /^[0-9a-f-]{36}$/.test(r.id))).toBe(true);
  });

  it('edits a built-in in place, removes, and keeps an empty list empty', async () => {
    const env = await makeEnv();
    savePreset(env, { id: 'jjajang', name: '짜장면', serving: '곱빼기', kcal: 1100, protein: 28, group: 'delivery' });
    const list = foodPresets(env);
    expect(list).toHaveLength(PRESETS.length);
    expect(list[1]).toMatchObject({ name: '짜장면', serving: '곱빼기', kcal: 1100 }); // same place as the built-in
    const undo = removePreset(env, list[0]!.id);
    expect(foodPresets(env)).toHaveLength(PRESETS.length - 1);
    undo();
    expect(foodPresets(env)).toHaveLength(PRESETS.length);
    for (const p of foodPresets(env)) removePreset(env, p.id);
    expect(foodPresets(env)).toEqual([]);
    resetPresets(env);
    expect(foodPresets(env).map((p) => p.name)).toEqual(PRESETS.map((p) => p.name));
  });

  it('two devices adopting at once write the same rows', async () => {
    const a = await makeEnv();
    const b = await makeEnv();
    savePreset(a, { name: 'A', serving: '1', kcal: 1, protein: 0, group: 'snack' });
    savePreset(b, { name: 'B', serving: '1', kcal: 1, protein: 0, group: 'snack' });
    const ids = (e: Env) => e.store.all<FoodRow>('foods').filter((r) => r.name !== 'A' && r.name !== 'B').map((r) => r.id).sort();
    expect(ids(a)).toEqual(ids(b));
  });
});

describe('rain on a walking day', () => {
  const wet = (date: string) => parseForecast({
    hourly: {
      time: Array.from({ length: 24 }, (_, h) => `${date}T${String(h).padStart(2, '0')}:00`),
      precipitation_probability: Array.from({ length: 24 }, (_, h) => (h >= 15 && h <= 17 ? 80 : 0)),
      precipitation: Array.from({ length: 24 }, (_, h) => (h >= 15 && h <= 17 ? 1.5 : 0)),
      weather_code: Array.from({ length: 24 }, (_, h) => (h >= 15 && h <= 17 ? 63 : 0)),
    },
  });

  it('suggests the routine done longer ago, and swapping makes today a home-workout day', async () => {
    // Wednesday 2026-11-18 is a walking day in the owner's week
    const env = await makeEnv(new Date(2026, 10, 18, 10, 0));
    completeWorkout(env, '2026-11-16', 'A', { rounds: 3, startedAt: new Date(2026, 10, 16, 18), endedAt: new Date(2026, 10, 16, 18, 25) });
    const v = todayView(env);
    expect(v.session).toBe('walk');
    const s = rainSuggestion(env, v, wet('2026-11-18'))!;
    expect(s.routine).toBe('B');
    expect(s.text).toBe('15시부터 비 소식이 있습니다 (최대 80%)');
    const undo = swapWalkForWorkout(env, s.routine);
    expect(todayView(env).session).toBe('B');
    expect(rainSuggestion(env, todayView(env), wet('2026-11-18'))).toBeNull();
    undo();
    expect(todayView(env).session).toBe('walk');
  });

  it('stays quiet on dry days, other sessions, and late in the evening', async () => {
    const env = await makeEnv(new Date(2026, 10, 18, 10, 0));
    expect(rainSuggestion(env, todayView(env), wet('2026-11-19'))).toBeNull();
    setTodaySession(env, 'A');
    expect(rainSuggestion(env, todayView(env), wet('2026-11-18'))).toBeNull();
    const late = await makeEnv(new Date(2026, 10, 18, 20, 30));
    expect(rainSuggestion(late, todayView(late), wet('2026-11-18'))).toBeNull();
    expect(dueRoutine(late)).toBe('A');
  });

  it('keeps the chosen city with the profile', async () => {
    const env = await makeEnv();
    expect(weatherCity(env).id).toBe('seoul');
    setWeatherCity(env, 'busan');
    expect(weatherCity(env).name).toBe('부산');
  });
});

describe('intake series', () => {
  it('lists eaten kcal against each day target, with empty days marked', async () => {
    const env = await makeEnv(new Date(2026, 10, 16, 21, 0));
    toggleMeal(env, '2026-11-16', 'breakfast');
    toggleMeal(env, '2026-11-16', 'lunch');
    setDay(env, '2026-11-15', { water_cups: 3 });
    const s = intakeSeries(env, 1);
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ key: '2026-11-16', eaten: 295 + 450, logged: true, target: DEFAULT_PROGRAM.baseKcal });
    expect(s[0]).toMatchObject({ key: '2026-11-15', eaten: 0, logged: false });
  });
});
