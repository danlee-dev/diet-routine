// Checks that rows produced by @diet/data match the Supabase tables, without creating users.
// Rows are sent with a random user_id using the secret key: a foreign-key error (23503) means every
// column and type was accepted; any other error points at a mismatch.
// Run: pnpm dlx tsx scripts/check-schema-shape.ts
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROGRAM, generatePlan } from '@diet/core';
import { completeOnboarding, completeWorkout, DataStore, logFood, setDay, setMealOverride, setRoutineItems, setTodaySession, setWeekDay, setWeight, skipMeal, toggleChecklist, toggleMeal, type Env } from '@diet/data';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2]!.replace(/^'|'$/g, '')]),
) as Record<string, string>;

const snapshot: { value: string | null } = { value: null };
const store = new DataStore({ load: async () => null, save: async (j) => { snapshot.value = j; } });
await store.init();
const e: Env = { store, program: DEFAULT_PROGRAM, now: () => new Date(2026, 10, 15, 13, 0), newId: () => randomUUID() };
const d = '2026-11-15';
setDay(e, d, { wake_min: 9 * 60, water_cups: 3, steps: 4200 });
toggleMeal(e, d, 'breakfast');
skipMeal(e, d, 'snack');
logFood(e, { date: d, slot: 'lunch', name: '후라이드 치킨', amount: '반 마리 · 보통', kcal: 1150, protein: 70, source: 'preset' });
setWeight(e, d, 75.4);
toggleChecklist(e, 'shop', 'n1');
completeWorkout(e, d, 'B', { rounds: 3, startedAt: new Date(), endedAt: new Date() });
setWeekDay(e, 0, 'walk');
setRoutineItems(e, 'A', [{ name: '푸시업', n: 15, unit: '회' }]);
setMealOverride(e, 'snack', { removed: true, note: '간식 빼기' }, 'ai');
setTodaySession(e, 'A');
const answers = { sex: 'female', age: 28, heightCm: 162, weightKg: 64, goalWeightKg: 58, weeks: 8, activity: 'light', wakeMin: 420, eatingOut: 'rarely', cooking: 'microwave', allergies: [], dislikes: [], workoutPlace: 'gym', workoutDays: 3, budgetWeek: 80000 } as const;
completeOnboarding(e, { ...answers, allergies: [], dislikes: [] }, generatePlan({ ...answers, allergies: [], dislikes: [] }));
await store.flush();

const snap = JSON.parse(snapshot.value!) as { tables: Record<string, Record<string, Record<string, unknown>>> };
const fakeUser = randomUUID();
let ok = true;
for (const [table, rows] of Object.entries(snap.tables)) {
  const list = Object.values(rows);
  if (!list.length) continue;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(list.map((r) => ({ ...r, user_id: fakeUser }))),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  const pass = body.code === '23503';
  ok &&= pass;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${table.padEnd(13)} rows=${list.length} -> ${res.status} ${body.code ?? ''} ${pass ? '' : body.message ?? ''}`);
}
process.exit(ok ? 0 : 1);
