// Types for the AI coach. Data shapes come from the zod schemas so validation and types never drift.
import type { z } from 'zod';
import type {
  AdjustWorkoutInputZ, CardRowZ, CardZ, ChatRequestZ, LogFoodInputZ, ProposeDayAdjustmentInputZ, ProposePlanChangeInputZ,
  RebalanceTodayInputZ, SkipMealInputZ, SnapMealZ, SnapshotZ,
} from './schema';

export type CoachSnapshot = z.infer<typeof SnapshotZ>;
export type SnapMeal = z.infer<typeof SnapMealZ>;
export type ChatRequest = z.input<typeof ChatRequestZ>;
export type CoachCard = z.infer<typeof CardZ>;
export type CardRow = z.infer<typeof CardRowZ>;

export type LogFoodInput = z.infer<typeof LogFoodInputZ>;
export type ProposePlanChangeInput = z.infer<typeof ProposePlanChangeInputZ>;
export type ProposeDayAdjustmentInput = z.infer<typeof ProposeDayAdjustmentInputZ>;
export type RebalanceTodayInput = z.infer<typeof RebalanceTodayInputZ>;
export type SkipMealInput = z.infer<typeof SkipMealInputZ>;
export type AdjustWorkoutInput = z.infer<typeof AdjustWorkoutInputZ>;

/**
 * Server-sent events of POST /api/ai/chat (`event: <type>` + `data: <json>`).
 * - status: one line in the step list. The same id is sent again when the step finishes or its label gets more specific.
 * - text: answer tokens as they stream.
 * - card: a change card. Never applied by the server; the client writes `rows` when the user taps 적용.
 * - sources: web search results the answer is based on.
 * - done: the turn ended normally.
 * - error: the turn failed; `code` tells the client what to show.
 */
export type CoachEvent =
  | { type: 'status'; id: string; label: string; state: 'running' | 'done' | 'error'; kind: 'context' | 'tool' | 'search' | 'note' }
  | { type: 'text'; delta: string }
  | { type: 'card'; card: CoachCard }
  | { type: 'sources'; items: { title: string; url: string }[] }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; code: CoachErrorCode; message: string };

export type CoachErrorCode = 'auth' | 'forbidden' | 'rate_limit' | 'bad_request' | 'upstream' | 'refusal' | 'too_long';

export type CoachToolName = 'log_food' | 'propose_plan_change' | 'propose_day_adjustment' | 'rebalance_today' | 'skip_meal' | 'adjust_workout';
