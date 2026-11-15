// Zod schemas for the AI coach: the context snapshot the client sends, the request body,
// the tool inputs Claude produces, and the change cards the client applies.
// Everything that crosses a trust boundary (client -> server, model -> server, server -> client)
// is parsed with one of these before use.
import { z } from 'zod';

const dateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const clockZ = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const text = (max: number) => z.string().trim().max(max);
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const MealKeyZ = z.enum(['breakfast', 'lunch', 'snack', 'post', 'dinner']);
export const SlotZ = z.enum(['breakfast', 'lunch', 'snack', 'post', 'dinner', 'extra']);
export const ScenIdZ = z.enum(['home', 'late', 'out', 'eatout', 'lateHome', 'rest']);

export const PlanItemZ = z.object({
  name: text(60).min(1),
  amount: text(60),
  note: text(160).optional(),
});

export const MealOverrideZ = z.object({
  name: text(40).optional(),
  time: text(30).optional(),
  items: z.array(PlanItemZ).max(12).optional(),
  kcal: num(0, 3000).optional(),
  protein: num(0, 300).optional(),
  removed: z.boolean().optional(),
  note: text(160).optional(),
});

export const PlanOverrideZ = z.object({
  meals: z.partialRecord(MealKeyZ, MealOverrideZ).optional(),
});

export const WorkoutChangeZ = z.object({
  action: z.enum(['swap', 'lighter', 'skip', 'walk_instead']),
  routine: z.enum(['A', 'B']).optional(),
  rounds: z.number().int().min(1).max(6).optional(),
  minutes: z.number().int().min(5).max(180).optional(),
});

/** AdjustmentChange from core/rebalance plus the optional coach fields kept in the same jsonb column. */
export const AdjustmentChangeZ = z.object({
  kind: z.enum(['cut', 'add', 'carry', 'edit']),
  kcal_delta: num(-3000, 3000),
  protein_delta: num(-300, 300).optional(),
  label: text(80).min(1),
  cut_id: text(60).optional(),
  items: z.array(PlanItemZ).max(12).optional(),
  /** set when the adjustment changes today's workout instead of a meal */
  target: z.enum(['workout']).optional(),
  workout: WorkoutChangeZ.optional(),
  steps_delta: z.number().int().min(-20000).max(20000).optional(),
});

export const DayAdjustmentZ = z.object({
  id: text(64).optional(),
  slot: SlotZ.nullable(),
  change: AdjustmentChangeZ,
  reason: text(300).nullable().optional(),
  source: z.enum(['rebalance', 'ai', 'user']),
});

// ---------------------------------------------------------------- snapshot (client -> server)

export const SnapMealZ = z.object({
  key: MealKeyZ,
  name: text(40),
  /** 'HH:MM' when the wake time is known, otherwise the timing text ("점심 3시간 뒤") */
  time: text(40),
  items: z.array(PlanItemZ).max(12),
  kcal: num(0, 5000),
  protein: num(0, 400),
  state: z.enum(['pending', 'eaten', 'replaced', 'skipped']),
  /** what was actually logged for this slot (replace entries) */
  logged: z.array(z.object({ name: text(80), kcal: num(0, 5000), protein: num(0, 400) })).max(10).optional(),
  /** labels of today's adjustments on this meal */
  changes: z.array(text(80)).max(10).optional(),
  /** set when the template was edited */
  edited: text(160).optional(),
});

export const SnapshotZ = z.object({
  v: z.literal(1),
  now: z.object({
    date: dateZ,
    time: clockZ,
    minutes: z.number().int().min(0).max(1439),
    dow: z.number().int().min(0).max(6),
    /** 1-based program day (can be <= 0 before the start) */
    dayNo: z.number().int().min(-400).max(4000),
    week: z.number().int().min(1).max(60),
    tz: text(60).optional(),
  }),
  scenario: z.object({ id: ScenIdZ, name: text(40) }),
  wakeTime: clockZ.nullable(),
  target: z.object({ kcal: num(600, 5000), base: num(600, 5000), proteinFloor: num(0, 300) }),
  meals: z.array(SnapMealZ).max(5),
  extras: z.array(z.object({ name: text(80), kcal: num(0, 5000), protein: num(0, 400) })).max(20),
  totals: z.object({
    eatenKcal: num(0, 20000),
    eatenProtein: num(0, 2000),
    /** eaten + planned for the slots not logged yet */
    projectedKcal: num(0, 20000),
    projectedProtein: num(0, 2000),
  }),
  steps: z.object({ count: z.number().int().min(0).max(200000), goal: z.number().int().min(0).max(100000) }),
  water: z.object({ cups: z.number().int().min(0).max(30), goal: z.number().int().min(0).max(30) }),
  workout: z.object({
    planned: z.object({ routine: z.enum(['A', 'B']), name: text(30), focus: text(40), time: clockZ.nullable() }).nullable(),
    done: z.boolean(),
    recent: z.array(z.object({
      date: dateZ,
      type: z.enum(['home_a', 'home_b', 'walk', 'run', 'other']),
      minutes: num(0, 1000).nullable(),
      rounds: num(0, 50).nullable(),
    })).max(14),
  }),
  weight: z.object({
    today: num(20, 400).nullable(),
    start: num(20, 400),
    goal: num(20, 400),
    series: z.array(z.object({ date: dateZ, kg: num(20, 400) })).max(30),
    trend: num(20, 400).nullable(),
    ratePerWeek: num(-20, 20).nullable(),
  }),
  planOverride: PlanOverrideZ.nullable(),
  adjustments: z.array(DayAdjustmentZ).max(40),
});

// ---------------------------------------------------------------- request body (client -> server)

export const ImageInputZ = z.object({
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** base64 without the data: prefix; the client re-encodes until a photo fits (see apps/web/components/coach/image.ts) */
  data: z.string().min(16).max(1_400_000).regex(/^[A-Za-z0-9+/=]+$/, 'base64'),
});

export const HistoryTurnZ = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(6000),
});

export const ChatRequestZ = z.object({
  /** client conversation id (uuid); also the chat_threads row id */
  threadId: z.uuid(),
  message: z.string().trim().max(2000),
  images: z.array(ImageInputZ).max(3).default([]),
  history: z.array(HistoryTurnZ).max(24).default([]),
  snapshot: SnapshotZ,
}).refine((b) => b.message.length > 0 || b.images.length > 0, { message: 'message or image required' });

// ---------------------------------------------------------------- tool inputs (model -> server)

export const NutritionZ = z.discriminatedUnion('basis', [
  z.object({
    basis: z.literal('estimate').describe('사진·글로 추정한 값. kcal/protein 은 먹은 양 전체 기준'),
    kcal: num(0, 4000),
    protein: num(0, 300),
  }),
  z.object({
    basis: z.literal('label_per_100g').describe('영양성분표가 100g(또는 100ml) 기준일 때. 서버가 grams 에 맞춰 계산'),
    per100: z.object({ kcal: num(0, 950), protein: num(0, 100) }),
    grams: num(1, 3000).describe('실제로 먹은 g (ml)'),
  }),
  z.object({
    basis: z.literal('label_per_serving').describe('영양성분표가 1회 제공량(1봉, 1개, 1스쿱 등) 기준일 때'),
    perServing: z.object({ kcal: num(0, 3000), protein: num(0, 300) }),
    servingDesc: text(40).describe('표에 적힌 1회 제공량, 예: "1봉 (40g)"'),
    servings: num(0.1, 20).describe('먹은 제공량 수'),
  }),
]);

export const LogFoodInputZ = z.object({
  slot: SlotZ.describe('끼니 대신 먹었으면 그 끼니, 끼니 밖에 더 먹었으면 extra'),
  name: text(60).min(1).describe('음식 이름 (한국어)'),
  amount: text(60).describe('먹은 양, 예: "1그릇", "반 공기", "45g"'),
  nutrition: NutritionZ,
  confidence: num(0, 1).describe('추정 확신도 0~1. 영양성분표에서 읽었으면 0.9 이상'),
  source: z.enum(['text', 'photo', 'label']),
});

export const PlanChangeZ = z.object({
  slot: MealKeyZ,
  remove: z.boolean().optional().describe('true 면 이 끼니를 식단표에서 뺀다'),
  name: text(30).optional(),
  time: text(30).optional().describe('끼니 시간 문구, 예: "저녁 먹기 전", "18:30"'),
  items: z.array(PlanItemZ).min(1).max(10).optional().describe('끼니의 음식 전체 목록 (바뀌지 않는 항목도 포함)'),
  kcal: num(0, 2500).optional().describe('items 를 바꿔 칼로리가 달라질 때 새 끼니 합계'),
  protein: num(0, 250).optional(),
  note: text(120).optional().describe('끼니 아래에 보일 한 줄 설명'),
});

export const ProposePlanChangeInputZ = z.object({
  changes: z.array(PlanChangeZ).min(1).max(5),
  effective: z.enum(['today', 'tomorrow']).describe('오늘부터 적용할지 내일부터 적용할지'),
  title: text(60).min(1).describe('변경 카드 제목, 예: "간식 빼고 저녁에 닭가슴살 추가"'),
  reason: text(200),
});

export const ProposeDayAdjustmentInputZ = z.object({
  slot: MealKeyZ.nullable().describe('null 이면 하루 목표 전체 조정'),
  kind: z.enum(['cut', 'add', 'edit']),
  label: text(60).min(1).describe('끼니 옆에 보일 짧은 문구, 예: "햇반 반 공기만"'),
  kcal_delta: num(-1500, 1500),
  protein_delta: num(-150, 150),
  items: z.array(PlanItemZ).min(1).max(10).optional().describe('kind=edit 일 때 오늘 그 끼니의 음식 전체 목록'),
  reason: text(200),
});

export const RebalanceTodayInputZ = z.object({
  reason: text(200).describe('왜 다시 맞추는지, 예: "점심 순대국으로 450kcal 초과"'),
});

export const SkipMealInputZ = z.object({
  slot: MealKeyZ,
  reason: text(200).optional(),
});

export const AdjustWorkoutInputZ = z.object({
  action: z.enum(['swap', 'lighter', 'skip', 'walk_instead']).describe('swap: 다른 루틴으로, lighter: 라운드·강도 낮춤, skip: 쉼, walk_instead: 걷기로'),
  routine: z.enum(['A', 'B']).optional().describe('swap 일 때 바꿀 루틴 (A 상체·복근, B 하체·전신)'),
  rounds: z.number().int().min(1).max(6).optional(),
  minutes: z.number().int().min(5).max(120).optional(),
  steps_delta: z.number().int().min(-5000).max(10000).optional().describe('오늘 걸음 목표 증감'),
  label: text(60).min(1).describe('카드에 보일 문구, 예: "홈트 B 대신 상체 A 2라운드"'),
  reason: text(200),
});

// ---------------------------------------------------------------- change cards (server -> client)

export const CardRowZ = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('meal_entry'),
    date: dateZ,
    slot: SlotZ,
    name: text(80).min(1),
    amount: text(80),
    kcal: num(0, 5000),
    protein: num(0, 400),
    source: z.enum(['ai_text', 'ai_photo', 'label']),
    confidence: num(0, 1),
    note: text(160).nullable(),
  }),
  z.object({ op: z.literal('skip_meal'), date: dateZ, slot: MealKeyZ }),
  z.object({ op: z.literal('plan'), effective_from: dateZ, override: PlanOverrideZ, note: text(200) }),
  z.object({ op: z.literal('adjustment'), date: dateZ, slot: MealKeyZ.nullable(), change: AdjustmentChangeZ, reason: text(300) }),
]);

export const CardZ = z.object({
  id: text(64).min(1),
  kind: z.enum(['log_food', 'plan_change', 'day_adjustment', 'rebalance', 'skip_meal', 'workout']),
  title: text(100).min(1),
  lines: z.array(z.object({ label: text(40), before: text(200).optional(), after: text(200) })).max(12),
  /** change of today's projected totals if the card is applied */
  delta: z.object({ kcal: num(-20000, 20000), protein: num(-2000, 2000) }),
  totals: z.object({
    before: z.object({ kcal: num(0, 20000), protein: num(0, 2000) }),
    after: z.object({ kcal: num(0, 20000), protein: num(0, 2000) }),
    target: num(0, 20000),
    proteinFloor: num(0, 300),
  }),
  /** what the "보기" link highlights on the today screen */
  focus: z.object({ slot: SlotZ.nullable(), workout: z.boolean().optional() }),
  note: text(300).optional(),
  rows: z.array(CardRowZ).min(1).max(12),
});
