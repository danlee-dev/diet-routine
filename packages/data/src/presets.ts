// The food list behind "다르게 먹었어요", per user and synced. Rows live in `foods` with source 'preset'
// (the group goes in `note`). Until the user edits anything, the built-in list shows; the first edit copies the
// built-in list into their rows (stable ids, so two devices copying at once make the same rows).
import { PRESETS, stableId, type FoodPreset, type FoodRow } from '@diet/core';
import type { Env, Undo } from './model';

export type PresetGroup = FoodPreset['group'];
export const PRESET_GROUPS: [PresetGroup, string][] = [['delivery', '배달·외식'], ['meal', '식사'], ['drink', '마실 것'], ['snack', '간식']];
const GROUP_IDS = PRESET_GROUPS.map(([g]) => g);

const builtinId = (id: string) => stableId(`preset:${id}`);
const BUILTIN_ORDER = new Map(PRESETS.map((p, i) => [builtinId(p.id), i]));

const presetRows = (env: Env, withDeleted = false) =>
  (withDeleted ? env.store.allWithDeleted<FoodRow>('foods') : env.store.all<FoodRow>('foods')).filter((r) => r.source === 'preset');

/** Has the user made the list their own (even if they then removed everything)? */
export const presetsCustomized = (env: Env): boolean => presetRows(env, true).length > 0;

const toPreset = (r: FoodRow): FoodPreset => ({
  id: r.id, name: r.name, serving: r.serving_desc, kcal: Math.round(Number(r.kcal) || 0), protein: Math.round(Number(r.protein_g) || 0),
  group: (GROUP_IDS as string[]).includes(r.note ?? '') ? (r.note as PresetGroup) : 'meal',
});

const toRow = (p: Omit<FoodPreset, 'id'> & { id: string }): Omit<FoodRow, 'updated_at'> => ({
  id: p.id, name: p.name.trim(), brand: null, serving_desc: p.serving.trim() || '1인분', serving_g: null,
  kcal: Math.max(0, Math.round(p.kcal)), protein_g: Math.max(0, Math.round(p.protein)), carbs_g: null, fat_g: null, sugar_g: null, sodium_mg: null, fiber_g: null,
  source: 'preset', image_path: null, barcode: null, label_lang: null, note: p.group, use_count: 0, last_used_at: null, deleted_at: null,
});

/** The user's list: built-in order first (edited items keep their place), then their own additions by name. */
export function foodPresets(env: Env): FoodPreset[] {
  if (!presetsCustomized(env)) return PRESETS;
  const rows = presetRows(env);
  return rows
    .sort((a, b) => (BUILTIN_ORDER.get(a.id) ?? 1e6) - (BUILTIN_ORDER.get(b.id) ?? 1e6) || a.name.localeCompare(b.name, 'ko'))
    .map(toPreset);
}

/** Copy the built-in list into the user's rows (once). */
function adopt(env: Env): void {
  if (presetsCustomized(env)) return;
  env.store.putMany('foods', PRESETS.map((p) => ({ ...toRow({ ...p, id: builtinId(p.id) }) })));
}

export interface PresetInput { name: string; serving: string; kcal: number; protein: number; group: PresetGroup }

/** Add (no id) or change a preset. Returns its id and an undo. */
export function savePreset(env: Env, input: PresetInput & { id?: string }): { id: string; undo: Undo } {
  adopt(env);
  // a built-in id from before adoption maps to its copied row
  const id = input.id ? (PRESETS.some((p) => p.id === input.id) ? builtinId(input.id) : input.id) : env.newId();
  const prev = env.store.get<FoodRow>('foods', id);
  env.store.put<FoodRow>('foods', toRow({ ...input, id }) as FoodRow);
  return { id, undo: () => { if (prev) env.store.put<FoodRow>('foods', { ...prev, deleted_at: null }); else env.store.remove('foods', id); } };
}

export function removePreset(env: Env, id: string): Undo {
  adopt(env);
  const rid = PRESETS.some((p) => p.id === id) ? builtinId(id) : id;
  const prev = env.store.get<FoodRow>('foods', rid);
  if (!prev) return () => {};
  env.store.remove('foods', rid);
  return () => env.store.put<FoodRow>('foods', { ...prev, deleted_at: null });
}

/** Back to the built-in list: built-in rows restored as shipped, the user's own additions removed. */
export function resetPresets(env: Env): Undo {
  const before = presetRows(env, true).map((r) => ({ ...r }));
  for (const r of presetRows(env)) if (!BUILTIN_ORDER.has(r.id)) env.store.remove('foods', r.id);
  env.store.putMany('foods', PRESETS.map((p) => toRow({ ...p, id: builtinId(p.id) })));
  return () => env.store.putMany('foods', before);
}
