// Zod schemas for the AI coach: the context snapshot the client sends, the request body,
// the tool inputs Claude produces, and the change cards the client applies.
// Everything that crosses a trust boundary (client -> server, model -> server, server -> client)
// is parsed with one of these before use.
import { z } from 'zod';

const dateZ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').refine((d) => {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, day!));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m! - 1 && t.getUTCDate() === day;
}, 'not a calendar date');
/** clock-looking times ("18:30") must be real clock times; other text is a label */
const timeText = (max: number) => text(max).refine((s) => !/^\d{1,2}:\d{2}$/.test(s) || (Number(s.split(':')[0]) < 24 && Number(s.split(':')[1]) < 60), 'invalid clock time');
const clockZ = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const text = (max: number) => z.string().trim().max(max);
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const MealKeyZ = z.enum(['breakfast', 'lunch', 'snack', 'post', 'dinner']);
export const SlotZ = z.enum(['breakfast', 'lunch', 'snack', 'post', 'dinner', 'extra']);
export const ScenIdZ = z.enum(['home', 'late', 'out', 'eatout', 'lateHome', 'rest']);

export const WeekTypeZ = z.enum(['A', 'B', 'walk', 'light', 'rest']);
export const RoutineKeyZ = z.enum(['A', 'B']);
const DOW = ['0', '1', '2', '3', '4', '5', '6'] as const;

export const PlanItemZ = z.object({
  name: text(60).min(1),
  amount: text(60),
  note: text(160).optional(),
  kcal: num(0, 3000).optional(),
  protein: num(0, 300).optional(),
});

export const RoutineItemZ = z.object({
  name: text(40).min(1),
  n: z.number().int().min(1).max(500),
  unit: text(20).min(1),
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

export const WorkoutOverrideZ = z.object({
  week: z.partialRecord(z.enum(DOW), WeekTypeZ).optional(),
  routines: z.partialRecord(RoutineKeyZ, z.object({ items: z.array(RoutineItemZ).min(1).max(12) })).optional(),
});

export const PlanOverrideZ = z.object({
  meals: z.partialRecord(MealKeyZ, MealOverrideZ).optional(),
  workout: WorkoutOverrideZ.optional(),
});

/** AdjustmentChange from core/rebalance. */
export const AdjustmentChangeZ = z.object({
  kind: z.enum(['cut', 'add', 'carry', 'edit', 'workout']),
  kcal_delta: num(-3000, 3000),
  protein_delta: num(-300, 300).optional(),
  label: text(80).min(1),
  cut_id: text(60).optional(),
  items: z.array(PlanItemZ).max(12).optional(),
  /** kind 'workout': today's session instead of the weekly plan */
  workout: WeekTypeZ.optional(),
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

export const EventKindZ = z.enum(['dinner_out', 'drinks', 'travel', 'other']);
export const EventSnapZ = z.object({ date: dateZ, slot: SlotZ.nullable(), kind: EventKindZ, note: text(300).nullable() });

export const DayStatZ = z.object({
  date: dateZ,
  planned: z.number().int().min(0).max(10),
  logged: z.number().int().min(0).max(10),
  skipped: z.number().int().min(0).max(10),
  kcal: num(0, 20000),
  protein: num(0, 2000),
  target: num(0, 20000),
  steps: z.number().int().min(0).max(200000),
  water: z.number().int().min(0).max(30),
  weight: num(20, 400).nullable(),
  trend: num(20, 400).nullable(),
  workout: z.enum(['home_a', 'home_b']).nullable(),
  workoutMin: num(0, 1000).nullable(),
  runs: z.number().int().min(0).max(20),
  runKm: num(0, 500),
  runMin: num(0, 2000),
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
  /** where the plan in effect came from ("코치가 바꿈" + note) */
  planMeta: z.object({ from: dateZ, source: z.enum(['default', 'ai', 'user']), note: text(200).nullable() }).nullable(),
  /** weekly schedule after edits, index = weekday (0 = Sunday) */
  week: z.array(z.object({ t: WeekTypeZ, label: text(10) })).length(7),
  routines: z.record(RoutineKeyZ, z.object({ name: text(30), focus: text(40), items: z.array(RoutineItemZ).max(12), amrapMin: z.number().nullable().optional() })),
  /** today's session after one-day changes */
  session: WeekTypeZ,
  adjustments: z.array(DayAdjustmentZ).max(40),
  /** who the user is (onboarding answers and preferences); null for the owner's pre-onboarding install */
  profile: z.object({
    name: text(30).optional(),
    sex: z.enum(['male', 'female']).optional(),
    age: z.number().int().min(10).max(110).optional(),
    heightCm: num(100, 250).optional(),
    goalWeightKg: num(30, 300).optional(),
    activity: z.enum(['sedentary', 'light', 'active']).optional(),
    allergies: z.array(text(20)).max(10).optional(),
    dislikes: z.array(text(30)).max(20).optional(),
    cooking: text(20).optional(),
    eatingOut: text(20).optional(),
    workoutPlace: text(20).optional(),
    workoutDays: z.number().int().min(0).max(7).optional(),
    budgetWeek: num(0, 5_000_000).optional(),
    note: text(300).optional(),
  }).nullable(),
  /** the user's shopping list (ids are what propose_shop_change refers to) and rule cards */
  shop: z.object({
    now: z.array(z.object({ id: text(80), name: text(80), qty: text(60), price: num(0, 1_000_000) })).max(30),
    week: z.array(z.object({ id: text(80), name: text(80), qty: text(60), price: num(0, 1_000_000) })).max(30),
  }),
  rules: z.array(z.object({ icon: text(30), title: text(60), desc: text(160) })).max(6),
  /** planned events from today on (`events` rows: "저녁 회식"), so the coach does not plan one twice */
  events: z.array(EventSnapZ).max(10).optional(),
  /** tomorrow as planned (plan version, situation and adjustments of that day), for plan_event; not shown to the model */
  tomorrow: z.object({ date: dateZ, target: num(600, 5000), meals: z.array(SnapMealZ).max(5) }).nullable().optional(),
  /** per-day stats of today and the 14 days before, for get_trends; not shown to the model */
  history: z.array(DayStatZ).max(15).optional(),
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
  /** what this client can render beyond text and cards ('blocks' = trend blocks); older clients send nothing */
  features: z.array(z.string().max(20)).max(10).default([]),
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
  time: timeText(30).optional().describe('끼니 시간 문구, 예: "저녁 먹기 전", "18:30"'),
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
}).refine((v) => (v.kind !== 'cut' || v.kcal_delta <= 0) && (v.kind !== 'add' || v.kcal_delta >= 0), { message: 'cut needs kcal_delta <= 0, add needs >= 0', path: ['kcal_delta'] });

export const RebalanceTodayInputZ = z.object({
  reason: text(200).describe('왜 다시 맞추는지, 예: "점심 순대국으로 450kcal 초과"'),
});

export const SkipMealInputZ = z.object({
  slot: MealKeyZ,
  reason: text(200).optional(),
});

// One flat object (the API does not accept oneOf/anyOf at the top level of a tool schema); the refinement
// below enforces which fields each scope needs before the server runs it.
export const AdjustWorkoutInputZ = z.object({
  scope: z.enum(['today', 'week', 'routine']).describe('today: 오늘 하루만 다른 운동 (주간 계획은 그대로). week: 요일별 주간 계획 (오늘부터 계속). routine: 홈트 A 또는 B 의 동작과 기본 횟수'),
  session: WeekTypeZ.optional().describe('scope=today 일 때 오늘 할 것. A 상체·복근, B 하체·전신, walk 걷기만, light 가볍게(A 3라운드), rest 쉬기'),
  days: z.array(z.object({ dow: z.number().int().min(0).max(6).describe('0=일요일 ... 6=토요일'), session: WeekTypeZ })).min(1).max(7).optional().describe('scope=week 일 때 바꿀 요일들'),
  routine: RoutineKeyZ.optional().describe('scope=routine 일 때 바꿀 루틴'),
  items: z.array(RoutineItemZ).min(1).max(12).optional().describe('scope=routine 일 때 루틴의 동작 전체 목록, 순서대로 (주차별 배율은 앱이 적용)'),
  amrap_minutes: z.number().int().min(5).max(60).nullable().optional().describe('scope=routine: 정해진 라운드 대신 이 시간 동안 목록을 계속 반복하고 바퀴 수를 셉니다 (예: "풀업 5, 푸시업 10, 스쿼트 15를 20분 동안" -> 20). null 이면 라운드 방식으로 되돌립니다. 생략하면 지금 방식 유지'),
  title: text(60).min(1).describe('카드 제목, 예: "오늘은 하체 대신 걷기"'),
  reason: text(200),
}).superRefine((v, ctx) => {
  if (v.scope === 'today' && !v.session) ctx.addIssue({ code: 'custom', path: ['session'], message: 'scope today needs session' });
  if (v.scope === 'week' && !v.days?.length) ctx.addIssue({ code: 'custom', path: ['days'], message: 'scope week needs days' });
  if (v.scope === 'routine' && (!v.routine || !v.items?.length)) ctx.addIssue({ code: 'custom', path: ['items'], message: 'scope routine needs routine and items' });
});

export const ShopChangeZ = z.object({
  action: z.enum(['add', 'remove', 'replace']),
  id: text(80).optional().describe('remove/replace: context.shop 의 항목 id'),
  list: z.enum(['now', 'week']).optional().describe('add: now = 한 번 사 두는 것, week = 매주 사는 신선식품'),
  name: text(60).optional().describe('add/replace: 상품 이름, 예: "냉동 닭가슴살 1kg"'),
  qty: text(40).optional().describe('add/replace: 몇 개 · 며칠치'),
  price: z.number().int().min(0).max(300_000).optional().describe('add/replace: 대략 가격 (원)'),
  query: text(60).optional().describe('add/replace: 쿠팡 검색어'),
}).superRefine((c, ctx) => {
  if (c.action !== 'add' && !c.id) ctx.addIssue({ code: 'custom', path: ['id'], message: `${c.action} needs id` });
  if (c.action === 'add' && !c.list) ctx.addIssue({ code: 'custom', path: ['list'], message: 'add needs list' });
  if (c.action !== 'remove' && (!c.name || !c.qty || c.price == null || !c.query)) ctx.addIssue({ code: 'custom', path: ['name'], message: `${c.action} needs name, qty, price and query` });
});

export const ProposeShopChangeInputZ = z.object({
  changes: z.array(ShopChangeZ).min(1).max(8),
  title: text(60).min(1).describe('카드 제목, 예: "닭가슴살을 더 싼 냉동 제품으로"'),
  reason: text(200),
});

export const PlanEventInputZ = z.object({
  day: z.enum(['today', 'tomorrow']).describe('약속이 오늘인지 내일인지'),
  slot: z.enum(['lunch', 'dinner']).describe('약속이 대신하는 끼니'),
  label: text(20).min(1).describe('약속 이름, 예: "회식", "친구 저녁", "가족 외식"'),
  alcohol: z.boolean().describe('술을 마시는 자리인지'),
  title: text(60).min(1).describe('카드 제목, 예: "내일 저녁 회식에 맞춰 미리 조정"'),
  reason: text(200),
});

export const GetTrendsInputZ = z.object({
  range: z.enum(['this_week', 'last_week', 'last_7', 'last_14']).describe('this_week: 이번 주 월요일부터 오늘까지. last_week: 지난주 월~일. last_7 / last_14: 오늘까지 최근 7일 / 14일'),
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
  /** a patch folded onto the plan in effect at apply time, saved as a plan version from `effective_from` */
  z.object({
    op: z.literal('plan'),
    effective_from: dateZ,
    /** full override per changed meal (null clears it back to the built-in meal) */
    meals: z.partialRecord(MealKeyZ, MealOverrideZ.nullable()).optional(),
    week: z.partialRecord(z.enum(DOW), WeekTypeZ).optional(),
    routines: z.partialRecord(RoutineKeyZ, z.array(RoutineItemZ).min(1).max(12)).optional(),
    amrap: z.partialRecord(RoutineKeyZ, z.number().int().min(5).max(60).nullable()).optional(),
    /** shopping list edits, applied to the list as it is at apply time */
    shopOps: z.array(z.object({
      action: z.enum(['add', 'remove', 'replace']),
      id: text(80),
      list: z.enum(['now', 'week']).optional(),
      item: z.object({ id: text(80), name: text(80), qty: text(60), price: num(0, 1_000_000), url: z.url().max(400).refine((u) => u.startsWith('https://www.coupang.com/'), 'coupang link') }).optional(),
    })).max(10).optional(),
    note: text(80),
  }),
  z.object({ op: z.literal('adjustment'), date: dateZ, slot: SlotZ.nullable(), change: AdjustmentChangeZ, reason: text(300) }),
  /** today's session only (setTodaySession) */
  z.object({ op: z.literal('session'), date: dateZ, session: WeekTypeZ, reason: text(300) }),
  /** a planned event (`events` row); the reminder planner sends a morning notification for it */
  z.object({ op: z.literal('event'), date: dateZ, slot: SlotZ.nullable(), kind: EventKindZ, note: text(300) }),
]);

/** Where "보기" goes: plan:meal:<key>, plan:workout:week:<dow>, plan:workout:routine:<A|B>, today:meal:<key>, today:workout */
export const CardTargetZ = z.string().regex(/^(plan:meal:(breakfast|lunch|snack|post|dinner)|plan:workout:week:[0-6]|plan:workout:routine:[AB]|plan:shop|today:meal:(breakfast|lunch|snack|post|dinner|extra)|today:workout)$/);

export const CardZ = z.object({
  id: text(64).min(1),
  kind: z.enum(['log_food', 'plan_change', 'day_adjustment', 'rebalance', 'skip_meal', 'workout', 'shop', 'event']),
  title: text(100).min(1),
  lines: z.array(z.object({ label: text(40), before: text(300).optional(), after: text(300) })).max(12),
  /** the day the card was made for (the snapshot date); plan and adjustment cards from an earlier day are refused */
  day: dateZ,
  /** cards from the same turn this card's numbers assume are applied */
  dependsOn: z.array(text(64)).max(10).optional(),
  /** change of today's projected totals if the card is applied */
  delta: z.object({ kcal: num(-20000, 20000), protein: num(-2000, 2000) }),
  totals: z.object({
    before: z.object({ kcal: num(0, 20000), protein: num(0, 2000) }),
    after: z.object({ kcal: num(0, 20000), protein: num(0, 2000) }),
    target: num(0, 20000),
    proteinFloor: num(0, 300),
  }),
  /** what the "보기" link opens and highlights */
  target: CardTargetZ,
  /** the assistant chat_messages row this card belongs to (stored as chat_message_id on plan rows) */
  messageId: z.uuid().optional(),
  note: text(300).optional(),
  rows: z.array(CardRowZ).min(1).max(12),
});

// ---------------------------------------------------------------- blocks (server -> client, read-only)

const kgZ = num(20, 400);
/** get_trends result drawn as a small card in the chat. Numbers come from summarizeTrends only. */
export const TrendBlockZ = z.object({
  id: text(64).min(1),
  kind: z.literal('trends'),
  label: text(20),
  from: dateZ,
  to: dateZ,
  days: z.number().int().min(1).max(31),
  finished: z.number().int().min(0).max(31),
  kept: z.object({ days: z.number().int().min(0).max(31), of: z.number().int().min(0).max(31) }),
  intake: z.object({ loggedDays: z.number().int().min(0).max(31), avgKcal: num(0, 20000).nullable(), avgTarget: num(0, 20000).nullable(), avgProtein: num(0, 2000).nullable(), proteinFloor: num(0, 300), proteinDays: z.number().int().min(0).max(31) }),
  weight: z.object({
    first: kgZ.nullable(), last: kgZ.nullable(), change: num(-50, 50).nullable(),
    trendFirst: kgZ.nullable(), trendLast: kgZ.nullable(), trendChange: num(-50, 50).nullable(),
    ratePerWeek: num(-20, 20).nullable(),
    points: z.array(z.object({ date: dateZ, kg: kgZ.nullable(), trend: kgZ.nullable() })).max(31),
  }),
  workouts: z.object({ home: z.number().int().min(0).max(31), minutes: num(0, 10000) }),
  runs: z.object({ count: z.number().int().min(0).max(100), km: num(0, 2000), minutes: num(0, 20000) }),
  steps: z.object({ avg: num(0, 200000).nullable(), goal: num(0, 100000), daysAtGoal: z.number().int().min(0).max(31) }),
});

export const BlockZ = z.discriminatedUnion('kind', [TrendBlockZ]);
