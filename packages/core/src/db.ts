// Row shapes of the Supabase tables (snake_case, same as SQL in supabase/migrations).
// Every synced row carries updated_at (last write wins) and soft-deletes with deleted_at.
import type { EatoutSlot, MealKey, ScenId } from './data';

export type Slot = MealKey | 'extra';

export interface Synced {
  updated_at: string; // ISO
  deleted_at?: string | null;
}

export interface ProfileRow extends Synced {
  user_id: string;
  display_name: string | null;
  height_cm: number;
  start_weight: number;
  goal_weight: number;
  start_date: string;
  base_kcal: number;
  protein_floor: number;
  timezone: string;
  /** likes, dislikes, allergies, notes - free form for the AI coach */
  preferences: Record<string, unknown>;
  notification_prefs: Record<string, unknown>;
}

export interface DayRow extends Synced {
  date: string;
  scenario: ScenId | null;
  eatout_slot: EatoutSlot | null;
  wake_min: number | null;
  water_cups: number;
  steps: number;
  steps_source: 'manual' | 'health';
  kcal_target: number | null;
  note: string | null;
}

export type FoodSource = 'plan' | 'label_photo' | 'ai_estimate' | 'manual' | 'preset';

export interface Nutrients {
  kcal: number;
  protein_g: number;
  carbs_g?: number | null;
  fat_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
  fiber_g?: number | null;
}

export interface FoodRow extends Synced, Nutrients {
  id: string;
  name: string;
  brand: string | null;
  /** e.g. '1봉 (40g)', '100g' - the amount the nutrients above refer to */
  serving_desc: string;
  serving_g: number | null;
  source: FoodSource;
  image_path: string | null;
  barcode: string | null;
  label_lang: string | null;
  note: string | null;
  use_count: number;
  last_used_at: string | null;
}

export type EntryKind = 'plan' | 'replace' | 'extra' | 'skip';
export type EntrySource = 'plan' | 'preset' | 'ai_text' | 'ai_photo' | 'label' | 'manual';

export interface MealEntryRow extends Synced, Nutrients {
  id: string;
  date: string;
  slot: Slot;
  kind: EntryKind;
  eaten_at: string | null;
  food_id: string | null;
  name: string;
  /** servings of food_id, or free amount text when no food */
  servings: number | null;
  amount_text: string | null;
  items: { name: string; amount: string }[] | null;
  source: EntrySource;
  photo_path: string | null;
  confidence: number | null;
  note: string | null;
}

export interface WeightRow extends Synced {
  date: string;
  kg: number;
  source: 'manual' | 'health';
}

export type WorkoutType = 'home_a' | 'home_b' | 'walk' | 'run' | 'other';

export interface WorkoutRow extends Synced {
  id: string;
  date: string;
  type: WorkoutType;
  started_at: string | null;
  ended_at: string | null;
  duration_s: number | null;
  rounds: number | null;
  kcal: number | null;
  source: 'app' | 'health';
  run_id: string | null;
  note: string | null;
}

export interface ChecklistRow extends Synced {
  list: 'shop' | 'cycle';
  item_key: string;
  checked: boolean;
}

export interface MemoryRow extends Synced {
  id: string;
  category: 'preference' | 'habit' | 'health' | 'food' | 'other';
  content: string;
  source: 'ai' | 'user';
  active: boolean;
}

export interface EventRow extends Synced {
  id: string;
  date: string;
  slot: Slot | null;
  kind: 'dinner_out' | 'drinks' | 'travel' | 'other';
  note: string | null;
}
