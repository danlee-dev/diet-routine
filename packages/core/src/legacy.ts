// Import from the legacy site's backup code (base64 of { "dp:<key>": "<json>" }).
import { ROUTINES, SCEN, type EatoutSlot, type MealKey, type ScenId } from './data';
import type { ChecklistRow, DayRow, MealEntryRow, WeightRow, WorkoutRow } from './db';
import { plan } from './schedule';

export interface LegacyImport {
  days: Omit<DayRow, 'updated_at'>[];
  entries: Omit<MealEntryRow, 'updated_at'>[];
  weights: Omit<WeightRow, 'updated_at'>[];
  workouts: Omit<WorkoutRow, 'updated_at'>[];
  checklist: Omit<ChecklistRow, 'updated_at'>[];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 -> bytes without relying on atob (not guaranteed on every JS engine). */
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

/** UTF-8 bytes -> string without TextDecoder. */
export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++]!;
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (b[i++]! & 0x3f);
    else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f);
    else cp = ((c & 0x07) << 18) | ((b[i++]! & 0x3f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f);
    s += String.fromCodePoint(cp);
  }
  return s;
}

/** Decode a backup code from the legacy site. */
export function decodeLegacyBackup(code: string): Record<string, unknown> {
  const raw = JSON.parse(utf8Decode(base64ToBytes(code.trim()))) as Record<string, string>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith('dp:')) continue;
    try { out[k.slice(3)] = JSON.parse(v); } catch { /* skip broken value */ }
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn decoded legacy keys into table rows. `newId` makes client UUIDs. */
export function legacyToRows(data: Record<string, unknown>, newId: () => string): LegacyImport {
  const dayMap = new Map<string, Omit<DayRow, 'updated_at'>>();
  const day = (date: string) => {
    let d = dayMap.get(date);
    if (!d) {
      d = { date, scenario: null, eatout_slot: null, wake_min: null, water_cups: 0, steps: 0, steps_source: 'manual', kcal_target: null, note: null, deleted_at: null };
      dayMap.set(date, d);
    }
    return d;
  };
  const weights: LegacyImport['weights'] = [];
  const workouts: LegacyImport['workouts'] = [];
  const checksByDate = new Map<string, MealKey[]>();

  for (const [key, value] of Object.entries(data)) {
    const [field, date] = key.split(':');
    if (!field) continue;
    if (date && DATE_RE.test(date)) {
      if (field === 'scen' && typeof value === 'string' && value in SCEN) day(date).scenario = value as ScenId;
      else if (field === 'eatout' && (value === 'lunch' || value === 'dinner')) day(date).eatout_slot = value as EatoutSlot;
      else if (field === 'wake' && typeof value === 'number') day(date).wake_min = value;
      else if (field === 'water' && typeof value === 'number') day(date).water_cups = value;
      else if (field === 'steps' && typeof value === 'number') day(date).steps = value;
      else if (field === 'checks' && Array.isArray(value)) checksByDate.set(date, value.filter((x): x is MealKey => typeof x === 'string'));
      else if (field === 'weight' && typeof value === 'number' && value > 30 && value < 200) weights.push({ date, kg: value, source: 'manual', deleted_at: null });
      else if (field === 'workout' && typeof value === 'string' && value in ROUTINES) {
        workouts.push({ id: newId(), date, type: value === 'A' ? 'home_a' : 'home_b', started_at: null, ended_at: null, duration_s: null, rounds: null, kcal: null, source: 'app', run_id: null, note: null, deleted_at: null });
      }
    }
  }

  const entries: LegacyImport['entries'] = [];
  for (const [date, checks] of checksByDate) {
    const d = day(date);
    const meals = plan({ scen: d.scenario ?? 'home', eatout: d.eatout_slot ?? 'lunch', wake: null });
    for (const m of meals) {
      if (!checks.includes(m.key)) continue;
      entries.push({
        id: newId(), date, slot: m.key, kind: 'plan', eaten_at: null, food_id: null, name: m.name, servings: null, amount_text: null,
        items: m.items, kcal: m.kcal, protein_g: m.protein, carbs_g: null, fat_g: null, sugar_g: null, sodium_mg: null, fiber_g: null,
        source: 'plan', photo_path: null, confidence: m.est ? 0.6 : 1, note: 'imported', deleted_at: null,
      });
    }
  }

  const checklist: LegacyImport['checklist'] = [];
  if (Array.isArray(data.shop)) for (const k of data.shop) if (typeof k === 'string') checklist.push({ list: 'shop', item_key: k, checked: true, deleted_at: null });
  if (Array.isArray(data.cycle)) for (const k of data.cycle) if (typeof k === 'string') checklist.push({ list: 'cycle', item_key: k, checked: true, deleted_at: null });

  return { days: [...dayMap.values()], entries, weights, workouts, checklist };
}
