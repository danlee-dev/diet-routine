// Tool definitions for the coach, generated from the same zod schemas the server validates with.
// Plain objects (no SDK types) so core stays dependency-light; apps/web maps them onto the Anthropic SDK.
import { z } from 'zod';
import { TOOL_INPUTS } from './execute';
import type { CoachToolName } from './types';

export interface CoachToolDef {
  name: CoachToolName;
  description: string;
  input_schema: { type: 'object'; [k: string]: unknown };
}

const DESCRIPTIONS: Record<CoachToolName, string> = {
  log_food:
    'Record something the user ate. Use a meal slot when it replaced that planned meal, or "extra" when it was eaten on top of the plan. '
    + 'For a nutrition label, pass the label numbers with their basis (per 100 g or per serving) and the amount eaten; the server does the multiplication. '
    + 'Check whether the label is per 100 g, per serving or per whole package before choosing the basis. Returns the new projected day total. Does not save: it shows a change card the user approves.',
  propose_plan_change:
    'Change the meal plan template from today or tomorrow on: remove a meal, replace or rename items, edit amounts or how-to-eat notes, change the time ("18:30" sets the clock time, other text only the label). '
    + 'Pass the full item list for a meal whose items change, and new kcal/protein when the change alters them (keep them when only notes change). '
    + 'Returns the plan totals before and after and whether protein drops under the floor. Does not save: it shows a change card.',
  propose_day_adjustment:
    'Change today only, without touching the template: trim or add to one pending meal (kind cut/add), swap its items for today (kind edit), or move today\'s kcal target (slot null). Does not save: it shows a change card.',
  rebalance_today:
    'Rebalance the rest of today with the app\'s rules after the day goes over or under: trims carbs and extras first, never protein, keeps protein above the floor, and spreads what cannot fit today over the next three days. '
    + 'Call it after log_food or skip_meal in the same turn when the projected total is off target. Returns the proposed cuts, protein top-ups and carry-over. Does not save: it shows a change card.',
  skip_meal:
    'Mark a planned meal as skipped (0 kcal). Returns the protein gap and what to do about it. Does not save: it shows a change card.',
  propose_shop_change:
    'Change the shopping list: add an item, remove one, or replace one with another product (cheaper, a different food, a bigger pack). Refer to existing items by their context.shop id. '
    + 'When a meal swaps a food, change the matching shop item in the same turn. The server builds the Coupang search link. Does not save: it shows a change card.',
  adjust_workout:
    'Change the workout plan. scope "today": today\'s session only ("오늘 하체 대신 걷기"). scope "week": which session each weekday gets from today on (A upper body and core, B lower body, walk, light = A with 3 rounds, rest). '
    + 'scope "routine": the exercises and base reps of routine A or B (pass the full list in order; the app scales reps by week). Does not save: it shows a change card.',
};

const toSchema = (s: z.ZodType): CoachToolDef['input_schema'] => {
  const { $schema: _s, ...rest } = z.toJSONSchema(s, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return { ...rest, type: 'object' };
};

export const COACH_TOOLS: CoachToolDef[] = (Object.keys(TOOL_INPUTS) as CoachToolName[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  input_schema: toSchema(TOOL_INPUTS[name]),
}));
