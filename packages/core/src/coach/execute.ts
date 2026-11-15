// Coach tools run here, on the server, as pure functions of (validated input, working snapshot).
// None of them writes data: each returns a change card (rows to write when the user taps 적용) and a
// small numeric result for the model. Within one turn the working snapshot assumes earlier cards are
// applied, so "log lunch -> rebalance" sees the logged lunch.
import type { z } from 'zod';
import { SKIP_ADVICE } from '../schedule';
import { CUTS, type MealKey, type RoutineDef, type WeekType } from '../data';
import { drinkText, eventKindFor, planEvent } from '../event';
import { proposalToAdjustments, rebalance, WEEK_LABEL, type AdjustedMeal, type MealOverride } from '../rebalance';
import { addDays, fmt, keyOf, parseKey } from '../util';
import {
  AdjustWorkoutInputZ, BlockZ, CardZ, GetTrendsInputZ, LogFoodInputZ, PlanEventInputZ, ProposeDayAdjustmentInputZ, ProposePlanChangeInputZ, ProposeShopChangeInputZ,
  RebalanceTodayInputZ, SkipMealInputZ,
} from './schema';
import { summarizeTrends } from './trends';
import type {
  AdjustWorkoutInput, CardRow, CoachBlock, CoachCard, CoachSnapshot, CoachToolName, GetTrendsInput, LogFoodInput, PlanEventInput, ProposeDayAdjustmentInput,
  ProposePlanChangeInput, ProposeShopChangeInput, RebalanceTodayInput, SkipMealInput, SnapMeal, TrendBlock,
} from './types';

export const TOOL_INPUTS: Record<CoachToolName, z.ZodType> = {
  log_food: LogFoodInputZ,
  propose_plan_change: ProposePlanChangeInputZ,
  propose_day_adjustment: ProposeDayAdjustmentInputZ,
  rebalance_today: RebalanceTodayInputZ,
  skip_meal: SkipMealInputZ,
  adjust_workout: AdjustWorkoutInputZ,
  propose_shop_change: ProposeShopChangeInputZ,
  plan_event: PlanEventInputZ,
  get_trends: GetTrendsInputZ,
};

export const isCoachTool = (name: string): name is CoachToolName => Object.hasOwn(TOOL_INPUTS, name);

export type ParseResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Validate a tool input from the model. The streaming parser is tolerant, so never run a tool on unparsed input. */
export function parseToolInput(name: string, raw: unknown): ParseResult {
  if (!isCoachTool(name)) return { ok: false, error: `unknown tool ${name}` };
  const r = TOOL_INPUTS[name].safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const issues = r.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  return { ok: false, error: `invalid input: ${issues}` };
}

export interface ToolOutcome {
  /** JSON result for the model */
  result: Record<string, unknown>;
  card?: CoachCard;
  /** a read-only block for the chat (get_trends) */
  block?: CoachBlock;
  /** final label of this tool's step line */
  doneLabel: string;
  isError?: boolean;
}

const SLOT_NAME: Record<string, string> = { breakfast: '아침', lunch: '점심', snack: '간식', post: '운동 후', dinner: '저녁', extra: '추가로 먹은 것' };
const R = Math.round;
const kcalText = (k: number) => `${fmt(R(k))}kcal`;
const itemsText = (items: { name: string; amount: string }[]) => items.map((x) => `${x.name} ${x.amount}`.trim()).join(' · ');
const APPLY_NOTE = '변경 카드로 보여줬습니다. 사용자가 적용을 눌러야 저장됩니다. 저장됐다고 말하지 마세요.';
/** no planned or adjusted day goes under this (PLAN.md: 하루 1,200kcal 아래로는 안 내린다) */
export const DAY_FLOOR_KCAL = 1200;
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** kcal/protein this slot currently adds to today's projected total */
function contribution(m: SnapMeal): { kcal: number; protein: number } {
  if (m.state === 'skipped') return { kcal: 0, protein: 0 };
  if (m.state === 'replaced' && m.logged?.length) {
    return { kcal: m.logged.reduce((s, x) => s + x.kcal, 0), protein: m.logged.reduce((s, x) => s + x.protein, 0) };
  }
  return { kcal: m.kcal, protein: m.protein };
}

/** Tool status lines for the step list (Korean, shown while streaming). */
export function toolStatusLabel(name: string, input?: Record<string, unknown>): string {
  const slot = typeof input?.slot === 'string' ? SLOT_NAME[input.slot] : undefined;
  switch (name) {
    case 'log_food': return typeof input?.name === 'string' ? `${input.name} 칼로리 계산 중` : '칼로리 계산 중';
    case 'propose_plan_change': return '식단표 바꿀 안 만드는 중';
    case 'propose_day_adjustment': return slot ? `오늘 ${slot} 조정안 만드는 중` : '오늘 식단 조정안 만드는 중';
    case 'rebalance_today': return '남은 끼니 다시 맞추는 중';
    case 'skip_meal': return slot ? `${slot} 건너뛰기 정리 중` : '건너뛴 끼니 정리 중';
    case 'adjust_workout': return input?.scope === 'routine' ? '홈트 구성 바꿀 안 만드는 중' : input?.scope === 'week' ? '주간 운동 계획 바꿀 안 만드는 중' : input?.scope === 'today' ? '오늘 운동 조정안 만드는 중' : '운동 계획 살펴보는 중';
    case 'propose_shop_change': return '장보기 목록 바꿀 안 만드는 중';
    case 'plan_event': return input?.day === 'today' ? '오늘 약속에 맞춰 식단 조정하는 중' : input?.day === 'tomorrow' ? '내일 약속에 맞춰 식단 조정하는 중' : '약속에 맞춰 식단 조정하는 중';
    case 'get_trends': return input?.range === 'last_week' ? '지난주 기록 모으는 중' : input?.range === 'this_week' ? '이번 주 기록 모으는 중' : '최근 기록 모으는 중';
    case 'web_search': return typeof input?.query === 'string' ? `웹 검색 중: ${input.query}` : '웹 검색 중';
    default: return '처리 중';
  }
}

export class CoachSession {
  readonly snap: CoachSnapshot;
  private seq = 0;
  /** cards of this turn that changed today's numbers; a later rebalance card depends on them */
  private affecting: string[] = [];

  /** @param messageId the assistant chat_messages row id; cards carry it so applied plan rows link back to the chat */
  constructor(snapshot: CoachSnapshot, private readonly cardPrefix: string, private readonly messageId?: string) {
    this.snap = structuredClone(snapshot);
  }

  /** Run a tool whose input already passed parseToolInput. A card that would not pass the client's check is never sent. */
  run(name: CoachToolName, input: unknown): ToolOutcome {
    const before = structuredClone(this.snap);
    const out = this.exec(name, input);
    // a refused or dropped card must not leave its effect on the working day
    if (out.isError) { Object.assign(this.snap, before); return out; }
    if (out.card && !CardZ.safeParse(out.card).success) {
      Object.assign(this.snap, before);
      return this.err('카드를 만들지 못했습니다. 항목 이름이나 설명을 짧게 해서 다시 시도하세요.');
    }
    if (out.block && !BlockZ.safeParse(out.block).success) return this.err('기록 요약을 만들지 못했습니다.');
    if (out.card && ['log_food', 'skip_meal', 'day_adjustment', 'plan_change', 'event'].includes(out.card.kind) && out.card.delta.kcal !== 0) this.affecting.push(out.card.id);
    return out;
  }

  private exec(name: CoachToolName, input: unknown): ToolOutcome {
    switch (name) {
      case 'log_food': return this.logFood(input as LogFoodInput);
      case 'skip_meal': return this.skipMeal(input as SkipMealInput);
      case 'rebalance_today': return this.rebalanceToday(input as RebalanceTodayInput);
      case 'propose_day_adjustment': return this.dayAdjustment(input as ProposeDayAdjustmentInput);
      case 'propose_plan_change': return this.planChange(input as ProposePlanChangeInput);
      case 'adjust_workout': return this.adjustWorkout(input as AdjustWorkoutInput);
      case 'propose_shop_change': return this.shopChange(input as ProposeShopChangeInput);
      case 'plan_event': return this.planEvent(input as PlanEventInput);
      case 'get_trends': return this.getTrends(input as GetTrendsInput);
    }
  }

  // ------------------------------------------------------------ helpers
  private get today(): string { return this.snap.now.date; }
  private dateAt(offset: number): string { return keyOf(addDays(parseKey(this.today), offset)); }
  private nextId(): string { this.seq += 1; return `${this.cardPrefix}-${this.seq}`; }
  private meal(slot: MealKey): SnapMeal | undefined { return this.snap.meals.find((m) => m.key === slot); }
  private totals() { return { kcal: R(this.snap.totals.projectedKcal), protein: R(this.snap.totals.projectedProtein) }; }
  private shift(dk: number, dp: number, eaten = false) {
    const t = this.snap.totals;
    t.projectedKcal = Math.max(0, t.projectedKcal + dk);
    t.projectedProtein = Math.max(0, t.projectedProtein + dp);
    if (eaten) { t.eatenKcal = Math.max(0, t.eatenKcal + dk); t.eatenProtein = Math.max(0, t.eatenProtein + dp); }
  }
  private dayResult(before: { kcal: number; protein: number }) {
    const after = this.totals();
    return {
      projected_kcal_before: before.kcal,
      projected_kcal_after: after.kcal,
      target_kcal: R(this.snap.target.kcal),
      over_target_after: after.kcal - R(this.snap.target.kcal),
      projected_protein_after: after.protein,
      protein_floor: this.snap.target.proteinFloor,
      pending_meals: this.snap.meals.filter((m) => m.state === 'pending').map((m) => m.key),
    };
  }
  private card(c: Omit<CoachCard, 'id' | 'totals' | 'delta' | 'messageId' | 'day'>, before: { kcal: number; protein: number }, after = this.totals()): CoachCard {
    return {
      id: this.nextId(),
      day: this.today,
      ...(this.messageId ? { messageId: this.messageId } : {}),
      ...c,
      title: clip(c.title, 100),
      lines: c.lines.map((l) => ({ label: clip(l.label, 40), ...(l.before != null ? { before: clip(l.before) } : {}), after: clip(l.after) })),
      delta: { kcal: after.kcal - before.kcal, protein: after.protein - before.protein },
      totals: { before: { kcal: Math.max(0, before.kcal), protein: Math.max(0, before.protein) }, after: { kcal: Math.max(0, after.kcal), protein: Math.max(0, after.protein) }, target: R(this.snap.target.kcal), proteinFloor: this.snap.target.proteinFloor },
    };
  }
  private err(message: string): ToolOutcome {
    return { result: { error: message }, doneLabel: '이 단계는 건너뛰었습니다', isError: true };
  }

  // ------------------------------------------------------------ log_food
  private logFood(input: LogFoodInput): ToolOutcome {
    const n = input.nutrition;
    let kcal: number, protein: number, basisNote: string | null = null;
    if (n.basis === 'estimate') { kcal = n.kcal; protein = n.protein; }
    else if (n.basis === 'label_per_100g') {
      kcal = (n.per100.kcal * n.grams) / 100;
      protein = (n.per100.protein * n.grams) / 100;
      basisNote = `100g당 ${fmt(n.per100.kcal)}kcal × ${fmt(n.grams)}g`;
    } else {
      kcal = n.perServing.kcal * n.servings;
      protein = n.perServing.protein * n.servings;
      basisNote = `${n.servingDesc}당 ${fmt(n.perServing.kcal)}kcal × ${fmt(n.servings)}`;
    }
    kcal = R(kcal);
    protein = R(protein);
    if (kcal > 4000) return this.err(`${fmt(kcal)}kcal 는 한 번 기록으로 너무 큽니다. 양(g)이나 기준(100g당/1회 제공량)을 다시 확인하세요.`);
    const before = this.totals();
    const lines: CoachCard['lines'] = [];
    if (input.slot === 'extra') {
      this.snap.extras.push({ name: input.name, kcal, protein });
      this.shift(kcal, protein, true);
      lines.push({ label: SLOT_NAME.extra!, after: `${input.name} · ${input.amount} · ${kcalText(kcal)} · 단백질 ${protein}g` });
    } else {
      const m = this.meal(input.slot);
      if (!m) return this.err(`오늘 식단에 ${SLOT_NAME[input.slot]} 끼니가 없습니다. extra 로 기록하세요.`);
      const prev = contribution(m);
      const wasLogged = m.state !== 'pending';
      lines.push({
        label: m.name,
        before: m.state === 'replaced' && m.logged ? `${m.logged.map((x) => x.name).join(', ')} · ${kcalText(prev.kcal)}` : m.state === 'skipped' ? '건너뜀' : `계획 ${kcalText(m.kcal)} · 단백질 ${m.protein}g`,
        after: `${input.name} · ${input.amount} · ${kcalText(kcal)} · 단백질 ${protein}g`,
      });
      const t = this.snap.totals;
      t.projectedKcal = Math.max(0, t.projectedKcal - prev.kcal + kcal);
      t.projectedProtein = Math.max(0, t.projectedProtein - prev.protein + protein);
      t.eatenKcal = Math.max(0, t.eatenKcal - (wasLogged ? prev.kcal : 0) + kcal);
      t.eatenProtein = Math.max(0, t.eatenProtein - (wasLogged ? prev.protein : 0) + protein);
      m.state = 'replaced';
      m.logged = [{ name: input.name, kcal, protein }];
    }
    const after = this.totals();
    lines.push({ label: '오늘 합계', before: kcalText(before.kcal), after: `${kcalText(after.kcal)} / 목표 ${kcalText(this.snap.target.kcal)}` });
    const row: CardRow = {
      op: 'meal_entry', date: this.today, slot: input.slot, name: input.name, amount: input.amount, kcal, protein,
      source: input.source === 'photo' ? 'ai_photo' : input.source === 'label' ? 'label' : 'ai_text',
      confidence: input.confidence, note: basisNote,
    };
    const card = this.card({
      kind: 'log_food',
      title: `${SLOT_NAME[input.slot]} 기록: ${input.name}`,
      lines,
      target: `today:meal:${input.slot}`,
      ...(basisNote ? { note: `${basisNote}로 계산했습니다` } : input.confidence < 0.6 ? { note: '사진과 설명으로 추정한 값이라 오차가 클 수 있습니다' } : {}),
      rows: [row],
    }, before, after);
    return {
      card,
      doneLabel: `${input.name} ${kcalText(kcal)} 계산함`,
      result: { card_id: card.id, logged: { slot: input.slot, name: input.name, amount: input.amount, kcal, protein, basis: basisNote }, day: this.dayResult(before), note: APPLY_NOTE },
    };
  }

  // ------------------------------------------------------------ skip_meal
  private skipMeal(input: SkipMealInput): ToolOutcome {
    const m = this.meal(input.slot);
    if (!m) return this.err(`오늘 식단에 ${SLOT_NAME[input.slot]} 끼니가 없습니다.`);
    if (m.state === 'skipped') return this.err(`${m.name}은 이미 건너뜀으로 기록돼 있습니다.`);
    const before = this.totals();
    const prev = contribution(m);
    const wasLogged = m.state !== 'pending';
    this.shift(-prev.kcal, -prev.protein, wasLogged);
    m.state = 'skipped';
    delete m.logged;
    const after = this.totals();
    const floor = this.snap.target.proteinFloor;
    const advice = SKIP_ADVICE[input.slot];
    const card = this.card({
      kind: 'skip_meal',
      title: `${m.name} 건너뛰기`,
      lines: [
        { label: m.name, before: `${kcalText(prev.kcal)} · 단백질 ${R(prev.protein)}g`, after: '건너뜀 · 0kcal' },
        { label: '오늘 단백질', before: `${before.protein}g`, after: `${after.protein}g / 하한 ${floor}g` },
      ],
      target: `today:meal:${input.slot}`,
      note: advice,
      rows: [{ op: 'skip_meal', date: this.today, slot: input.slot }],
    }, before, after);
    return {
      card,
      doneLabel: `${m.name} 건너뛰기 정리함`,
      result: { card_id: card.id, skipped: input.slot, protein_gap: Math.max(0, floor - after.protein), advice, day: this.dayResult(before), note: APPLY_NOTE },
    };
  }

  // ------------------------------------------------------------ rebalance_today
  private rebalanceToday(input: RebalanceTodayInput): ToolOutcome {
    const s = this.snap;
    const meals: AdjustedMeal[] = s.meals.map((m) => ({ key: m.key, icon: '', name: m.name, time: m.time, items: m.items, kcal: m.kcal, protein: m.protein, swaps: [] }));
    const appliedCuts = new Set(s.adjustments.map((a) => a.change.cut_id).filter((x): x is string => !!x));
    const p = rebalance({
      meals,
      logged: new Set(s.meals.filter((m) => m.state !== 'pending').map((m) => m.key)),
      eatenKcal: s.totals.eatenKcal,
      eatenProtein: s.totals.eatenProtein,
      target: s.target.kcal,
      proteinFloor: s.target.proteinFloor,
      appliedCuts,
      nowMin: s.now.minutes,
    });
    if (!p.cuts.length && !p.carry.length && !p.proteinAdds.length && !p.stepsBonus) {
      return { doneLabel: '남은 끼니 확인함 · 바꿀 것 없음', result: { over_target: p.over, summary: p.summary, card: null } };
    }
    const before = this.totals();
    const rows: CardRow[] = proposalToAdjustments(p, input.reason).map(({ offset, adj }) => ({
      op: 'adjustment' as const,
      date: this.dateAt(offset),
      slot: adj.slot === 'extra' ? null : adj.slot,
      change: adj.change,
      reason: input.reason,
    }));
    const lines: CoachCard['lines'] = [];
    for (const c of p.cuts) {
      const m = this.meal(c.slot);
      lines.push({ label: m?.name ?? SLOT_NAME[c.slot]!, after: `${c.label} · -${c.kcal}kcal` });
      if (m) { m.kcal = Math.max(0, m.kcal - c.kcal); m.protein = Math.max(0, m.protein - c.protein); m.changes = [...(m.changes ?? []), c.label]; }
    }
    for (const a of p.proteinAdds) {
      const m = this.meal(a.slot);
      lines.push({ label: m?.name ?? SLOT_NAME[a.slot]!, after: `${a.label} · +${a.kcal}kcal · 단백질 +${a.protein}g` });
      if (m) { m.kcal += a.kcal; m.protein += a.protein; m.changes = [...(m.changes ?? []), a.label]; }
    }
    const dayName = ['오늘', '내일', '모레', '글피'];
    for (const c of p.carry) lines.push({ label: dayName[c.offset] ?? `${c.offset}일 뒤`, after: `${c.kcal}kcal 덜 먹기` });
    for (const r of rows) if (r.op === 'adjustment' && r.date === this.today) s.adjustments.push({ slot: r.slot, change: r.change, reason: r.reason, source: 'rebalance' });
    s.totals.projectedKcal = p.after.total;
    s.totals.projectedProtein = p.after.protein;
    // carried kcal is a loan against today (see proposalToAdjustments)
    s.target.kcal += p.carry.reduce((a, c) => a + c.kcal, 0);
    const after = this.totals();
    const card = this.card({
      kind: 'rebalance',
      title: '남은 끼니 다시 맞추기',
      lines,
      ...(this.affecting.length ? { dependsOn: [...this.affecting] } : {}),
      target: `today:meal:${p.cuts[0]?.slot ?? p.proteinAdds[0]?.slot ?? 'dinner'}`,
      note: p.summary,
      rows,
    }, before, after);
    return {
      card,
      doneLabel: '남은 끼니 다시 맞춤',
      result: {
        card_id: card.id, over_target_before: p.over, summary: p.summary,
        cuts: p.cuts.map((c) => ({ slot: c.slot, label: c.label, kcal: -c.kcal })),
        protein_adds: p.proteinAdds.map((a) => ({ slot: a.slot, label: a.label, kcal: a.kcal, protein: a.protein })),
        carry_next_days: p.carry,
        ...(p.stepsBonus ? { suggestion: `내일 ${fmt(p.stepsBonus)}보 더 걷기를 말로 권하세요 (카드에는 없음)` } : {}),
        day: this.dayResult(before), note: APPLY_NOTE,
      },
    };
  }

  // ------------------------------------------------------------ propose_day_adjustment
  private dayAdjustment(input: ProposeDayAdjustmentInput): ToolOutcome {
    const before = this.totals();
    const lines: CoachCard['lines'] = [];
    const kcalDelta = R(input.kcal_delta);
    const proteinDelta = R(input.protein_delta);
    if (input.slot) {
      const m = this.meal(input.slot);
      if (!m) return this.err(`오늘 식단에 ${SLOT_NAME[input.slot]} 끼니가 없습니다.`);
      if (m.state !== 'pending') return this.err(`${m.name}은 이미 기록돼 있어 조정할 수 없습니다. log_food 로 고치세요.`);
      const nextItems = input.kind === 'edit' && input.items ? input.items : m.items;
      lines.push({
        label: m.name,
        before: `${itemsText(m.items)} · ${kcalText(m.kcal)}`,
        after: `${itemsText(nextItems)} · ${kcalText(Math.max(0, m.kcal + kcalDelta))}`,
      });
      m.items = nextItems;
      m.kcal = Math.max(0, m.kcal + kcalDelta);
      m.protein = Math.max(0, m.protein + proteinDelta);
      m.changes = [...(m.changes ?? []), input.label];
      this.shift(kcalDelta, proteinDelta);
    } else {
      const t = this.snap.target;
      if (t.kcal + kcalDelta < DAY_FLOOR_KCAL) return this.err(`오늘 목표를 ${fmt(DAY_FLOOR_KCAL)}kcal 아래로 내릴 수 없습니다 (지금 ${fmt(t.kcal)}kcal).`);
      lines.push({ label: '오늘 목표', before: kcalText(t.kcal), after: kcalText(t.kcal + kcalDelta) });
      t.kcal += kcalDelta;
    }
    const change = { kind: input.kind, kcal_delta: kcalDelta, protein_delta: proteinDelta, label: input.label, ...(input.kind === 'edit' && input.items ? { items: input.items } : {}) };
    this.snap.adjustments.push({ slot: input.slot, change, reason: input.reason, source: 'ai' });
    const after = this.totals();
    const card = this.card({
      kind: 'day_adjustment',
      title: input.slot ? `오늘 ${SLOT_NAME[input.slot]}: ${input.label}` : `오늘 목표: ${input.label}`,
      lines,
      target: `today:meal:${input.slot ?? 'dinner'}`,
      note: '오늘만 바뀌고 식단표는 그대로입니다',
      rows: [{ op: 'adjustment', date: this.today, slot: input.slot, change, reason: input.reason }],
    }, before, after);
    return { card, doneLabel: '오늘 조정안 만듦', result: { card_id: card.id, day: this.dayResult(before), note: APPLY_NOTE } };
  }

  // ------------------------------------------------------------ propose_plan_change
  private planChange(input: ProposePlanChangeInput): ToolOutcome {
    const s = this.snap;
    const effectiveFrom = input.effective === 'today' ? this.today : this.dateAt(1);
    const prevMeals = { ...(s.planOverride?.meals ?? {}) };
    const patch: Partial<Record<MealKey, MealOverride>> = {};
    const lines: CoachCard['lines'] = [];
    let planDelta = { kcal: 0, protein: 0 };
    let todayDelta = { kcal: 0, protein: 0 };
    const planBefore = { kcal: R(s.meals.reduce((a, m) => a + m.kcal, 0)), protein: R(s.meals.reduce((a, m) => a + m.protein, 0)) };

    for (const c of input.changes) {
      const m = this.meal(c.slot);
      const prev: MealOverride = prevMeals[c.slot] ?? {};
      // only the fields this change sets; the client merges them onto the meal as it is when 적용 is tapped
      const fields: MealOverride = c.remove
        ? { removed: true, ...(c.note ? { note: c.note } : {}) }
        : {
          ...(prev.removed ? { removed: false } : {}),
          ...(c.name ? { name: c.name } : {}),
          ...(c.time ? { time: c.time } : {}),
          ...(c.items ? { items: c.items } : {}),
          ...(c.kcal != null ? { kcal: R(c.kcal) } : {}),
          ...(c.protein != null ? { protein: R(c.protein) } : {}),
          note: c.note ?? input.title,
        };
      const next: MealOverride = { ...prev, ...fields };
      patch[c.slot] = fields;
      prevMeals[c.slot] = next;

      const curK = m?.kcal ?? 0, curP = m?.protein ?? 0;
      const newK = c.remove ? 0 : c.kcal != null ? R(c.kcal) : curK;
      const newP = c.remove ? 0 : c.protein != null ? R(c.protein) : curP;
      planDelta = { kcal: planDelta.kcal + newK - curK, protein: planDelta.protein + newP - curP };
      lines.push({
        label: m?.name ?? SLOT_NAME[c.slot]!,
        before: m ? `${itemsText(m.items)} · ${kcalText(curK)}` : '식단에 없음',
        after: c.remove ? '식단에서 뺌' : `${itemsText(c.items ?? m?.items ?? [])} · ${kcalText(newK)}${c.time ? ` · ${c.time}` : ''}`,
      });
      if (input.effective === 'today' && m && m.state === 'pending') {
        todayDelta = { kcal: todayDelta.kcal + newK - curK, protein: todayDelta.protein + newP - curP };
        if (c.remove) s.meals = s.meals.filter((x) => x.key !== c.slot);
        else Object.assign(m, { ...(c.name ? { name: c.name } : {}), ...(c.time ? { time: c.time } : {}), ...(c.items ? { items: c.items } : {}), kcal: newK, protein: newP, edited: next.note });
      }
    }
    s.planOverride = { ...s.planOverride, meals: prevMeals };

    const before = input.effective === 'today' ? this.totals() : planBefore;
    if (input.effective === 'today') this.shift(todayDelta.kcal, todayDelta.protein);
    const after = input.effective === 'today' ? this.totals() : { kcal: planBefore.kcal + planDelta.kcal, protein: planBefore.protein + planDelta.protein };
    const planProteinAfter = Math.max(0, planBefore.protein + planDelta.protein);
    const floor = s.target.proteinFloor;
    if (planBefore.kcal + planDelta.kcal < DAY_FLOOR_KCAL) {
      return this.err(`이렇게 바꾸면 하루 계획이 ${fmt(planBefore.kcal + planDelta.kcal)}kcal 로 ${fmt(DAY_FLOOR_KCAL)}kcal 아래가 됩니다. 다른 끼니를 늘리는 변경을 같이 넣으세요.`);
    }
    const low = planProteinAfter < floor;
    lines.push({ label: '하루 계획', before: `${kcalText(planBefore.kcal)} · 단백질 ${planBefore.protein}g`, after: `${kcalText(planBefore.kcal + planDelta.kcal)} · 단백질 ${planProteinAfter}g` });

    const card = this.card({
      kind: 'plan_change',
      title: input.title,
      lines,
      target: `plan:meal:${input.changes[0]!.slot}`,
      note: low
        ? `단백질이 하한 ${floor}g 아래(${planProteinAfter}g)로 내려갑니다. ${input.effective === 'today' ? '오늘부터' : '내일부터'} 식단표에 적용됩니다`
        : `${input.effective === 'today' ? '오늘부터' : '내일부터'} 식단표에 적용됩니다`,
      rows: [{ op: 'plan', effective_from: effectiveFrom, meals: patch, note: input.title }],
    }, before, after);
    return {
      card,
      doneLabel: '식단표 변경안 만듦',
      result: {
        card_id: card.id, effective_from: effectiveFrom,
        plan_day_kcal_before: planBefore.kcal, plan_day_kcal_after: planBefore.kcal + planDelta.kcal,
        plan_day_protein_after: planProteinAfter, protein_floor: floor, protein_below_floor: low,
        ...(low ? { hint: '단백질이 하한 아래입니다. 다른 끼니에 단백질을 옮기는 변경을 같이 제안하세요.' } : {}),
        day: this.dayResult(before), note: APPLY_NOTE,
      },
    };
  }

  // ------------------------------------------------------------ adjust_workout
  private adjustWorkout(input: AdjustWorkoutInput): ToolOutcome {
    const s = this.snap;
    const before = this.totals();
    const DAY = ['일', '월', '화', '수', '목', '금', '토'];
    const sessionText = (t: WeekType) => (t === 'A' || t === 'B' ? `홈트 ${t} · ${s.routines[t].focus}` : t === 'light' ? '가볍게 (홈트 A 3라운드)' : WEEK_LABEL[t]);
    const itemsLine = (items: RoutineDef['items']) => items.map((x) => `${x.name} ${x.n}${x.unit}`).join(' · ');

    if (input.scope === 'today') {
      const next = input.session!;
      const was = s.session;
      if (was === next) return this.err(`오늘은 이미 ${sessionText(was)} 입니다.`);
      s.session = next;
      const card = this.card({
        kind: 'workout',
        title: input.title,
        lines: [{ label: '오늘 운동', before: sessionText(was), after: sessionText(next) }],
        target: 'today:workout',
        note: '오늘만 바뀌고 주간 계획은 그대로입니다',
        rows: [{ op: 'session', date: this.today, session: next, reason: input.reason }],
      }, before);
      return { card, doneLabel: '오늘 운동 조정안 만듦', result: { card_id: card.id, session_before: was, session_after: next, note: APPLY_NOTE } };
    }

    if (input.scope === 'week') {
      const week: Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', WeekType>> = {};
      const lines: CoachCard['lines'] = [];
      const days = input.days!;
      for (const d of days) {
        const was = s.week[d.dow]!.t;
        if (was === d.session) continue;
        week[String(d.dow) as '0'] = d.session;
        lines.push({ label: `${DAY[d.dow]}요일`, before: sessionText(was), after: sessionText(d.session) });
        s.week[d.dow] = { t: d.session, label: WEEK_LABEL[d.session] };
        if (d.dow === s.now.dow && !s.adjustments.some((a) => a.change.kind === 'workout')) s.session = d.session;
      }
      if (!lines.length) return this.err('바뀌는 요일이 없습니다. 지금 주간 계획과 같습니다.');
      s.planOverride = { ...s.planOverride, workout: { ...s.planOverride?.workout, week: { ...s.planOverride?.workout?.week, ...week } } };
      const first = days.find((d) => week[String(d.dow) as '0'])!.dow;
      const card = this.card({
        kind: 'workout',
        title: input.title,
        lines,
        target: `plan:workout:week:${first}`,
        note: '오늘부터 주간 운동 계획에 적용됩니다',
        rows: [{ op: 'plan', effective_from: this.today, week, note: input.title }],
      }, before);
      return { card, doneLabel: '주간 운동 계획 변경안 만듦', result: { card_id: card.id, week_after: s.week.map((d) => d.t), note: APPLY_NOTE } };
    }

    const key = input.routine!;
    const items = input.items!;
    const was = s.routines[key].items;
    const wasMin = s.routines[key].amrapMin ?? null;
    const min = input.amrap_minutes === undefined ? wasMin : input.amrap_minutes;
    s.routines[key] = { ...s.routines[key], items, amrapMin: min };
    s.planOverride = { ...s.planOverride, workout: { ...s.planOverride?.workout, routines: { ...s.planOverride?.workout?.routines, [key]: { ...s.planOverride?.workout?.routines?.[key], items, amrapMin: min } } } };
    const fmtLine = (m: number | null) => (m ? `${m}분 동안 반복` : '정해진 라운드');
    const lines: CoachCard['lines'] = [{ label: `홈트 ${key}`, before: itemsLine(was), after: itemsLine(items) }];
    if (min !== wasMin) lines.push({ label: '방식', before: fmtLine(wasMin), after: fmtLine(min) });
    const card = this.card({
      kind: 'workout',
      title: input.title,
      lines,
      target: `plan:workout:routine:${key}`,
      note: min ? `${min}분 타이머 동안 목록을 계속 반복하고 바퀴 수를 셉니다` : '기본 횟수입니다. 3주차부터는 앱이 1.2배로 늘립니다',
      rows: [{ op: 'plan', effective_from: this.today, routines: { [key]: items }, ...(min !== wasMin ? { amrap: { [key]: min } } : {}), note: input.title }],
    }, before);
    return { card, doneLabel: '홈트 구성 변경안 만듦', result: { card_id: card.id, routine: key, items_after: items, note: APPLY_NOTE } };
  }

  // ------------------------------------------------------------ propose_shop_change
  private shopChange(input: ProposeShopChangeInput): ToolOutcome {
    const shop = this.snap.shop;
    const before = this.totals();
    const won = (n: number) => `${fmt(R(n))}원`;
    const find = (id: string) => (['now', 'week'] as const).map((list) => ({ list, at: shop[list].findIndex((x) => x.id === id) })).find((x) => x.at >= 0);
    const ops: NonNullable<Extract<CardRow, { op: 'plan' }>['shopOps']> = [];
    const lines: CoachCard['lines'] = [];
    let n = 0;
    for (const c of input.changes) {
      const item = c.action === 'remove' ? undefined : {
        id: `${this.cardPrefix}-s${this.seq + 1}-${++n}`, name: c.name!, qty: c.qty!, price: c.price!,
        url: `https://www.coupang.com/np/search?q=${encodeURIComponent(c.query!)}`,
      };
      if (c.action === 'add') {
        shop[c.list!].push({ id: item!.id, name: item!.name, qty: item!.qty, price: item!.price });
        ops.push({ action: 'add', id: item!.id, list: c.list!, item });
        lines.push({ label: c.list === 'now' ? '한 번 살 것' : '매주 살 것', after: `${item!.name} · ${item!.qty} · ${won(item!.price)}` });
        continue;
      }
      const at = find(c.id!);
      if (!at) return this.err(`장보기 목록에 ${c.id} 항목이 없습니다. context.shop 의 id 를 쓰세요.`);
      const old = shop[at.list][at.at]!;
      if (c.action === 'remove') {
        shop[at.list].splice(at.at, 1);
        ops.push({ action: 'remove', id: old.id });
        lines.push({ label: '빼기', before: `${old.name} · ${won(old.price)}`, after: '목록에서 뺌' });
      } else {
        shop[at.list][at.at] = { id: item!.id, name: item!.name, qty: item!.qty, price: item!.price };
        ops.push({ action: 'replace', id: old.id, item });
        lines.push({ label: '바꾸기', before: `${old.name} · ${won(old.price)}`, after: `${item!.name} · ${item!.qty} · ${won(item!.price)}` });
      }
    }
    const total = (l: typeof shop.now) => l.reduce((s, x) => s + x.price, 0);
    const card = this.card({
      kind: 'shop',
      title: input.title,
      lines,
      target: 'plan:shop',
      note: `한 번 살 것 ${won(total(shop.now))} · 매주 ${won(total(shop.week))}`,
      rows: [{ op: 'plan', effective_from: this.today, shopOps: ops, note: input.title }],
    }, before);
    return { card, doneLabel: '장보기 변경안 만듦', result: { card_id: card.id, now_total_won: total(shop.now), week_total_won: total(shop.week), shop_after: shop, note: APPLY_NOTE } };
  }

  // ------------------------------------------------------------ plan_event
  private planEvent(input: PlanEventInput): ToolOutcome {
    const s = this.snap;
    const today = input.day === 'today';
    const date = today ? this.today : this.dateAt(1);
    const dayWord = today ? '오늘' : '내일';
    const slotName = SLOT_NAME[input.slot]!;
    if ((s.events ?? []).some((e) => e.date === date && e.slot === input.slot)) {
      return this.err(`${dayWord} ${slotName}에 이미 약속이 잡혀 있습니다. 바꾸려면 그 카드를 먼저 되돌리세요.`);
    }
    const day = today ? { meals: s.meals, target: s.target.kcal } : s.tomorrow;
    if (!day) return this.err('내일 식단 정보가 없습니다. 앱을 새로 연 뒤 다시 물어봐 주세요.');
    const event = day.meals.find((m) => m.key === input.slot);
    if (!event) return this.err(`${dayWord} 식단에 ${slotName} 끼니가 없습니다.`);
    if (event.state !== 'pending') return this.err(`${dayWord} ${slotName}은 이미 기록돼 있습니다. log_food 로 기록을 고치세요.`);

    // cuts already on that day: by id today, by label on tomorrow's meals (the snapshot has only today's rows)
    const applied = new Set([
      ...(today ? s.adjustments.map((a) => a.change.cut_id).filter((x): x is string => !!x) : []),
      ...CUTS.filter((c) => day.meals.find((m) => m.key === c.slot)?.changes?.includes(c.label)).map((c) => c.id),
    ]);
    const p = planEvent({
      meals: day.meals.map((m) => ({ key: m.key, name: m.name, items: m.items, pending: m.state === 'pending', ...contribution(m) })),
      slot: input.slot, alcohol: input.alcohol, target: day.target, proteinFloor: s.target.proteinFloor, appliedCuts: applied,
      avoid: [...(s.profile?.allergies ?? []), ...(s.profile?.dislikes ?? [])], label: input.label,
    });

    const dayBefore = R(day.meals.reduce((a, m) => a + contribution(m).kcal, 0));
    const before = this.totals();
    const lines: CoachCard['lines'] = [];
    for (const m of day.meals) {
      const mine = p.adjustments.filter((a) => a.slot === m.key);
      if (!mine.length) continue;
      const dk = mine.reduce((a, x) => a + x.change.kcal_delta, 0);
      const dp = mine.reduce((a, x) => a + (x.change.protein_delta ?? 0), 0);
      if (m.key === input.slot) {
        lines.push({ label: m.name, before: `${itemsText(m.items)} · ${kcalText(m.kcal)}`, after: `${input.label} · 약 ${kcalText(p.budget)} · 단백질 ${p.eventProtein}g 이상` });
      } else {
        lines.push({ label: m.name, before: kcalText(m.kcal), after: `${mine.map((x) => x.change.label).join(', ')} · ${kcalText(m.kcal + dk)}` });
      }
      // the working day assumes the card is applied
      const edit = mine.find((x) => x.change.kind === 'edit');
      if (edit?.change.items) m.items = edit.change.items;
      m.kcal = Math.max(0, m.kcal + dk);
      m.protein = Math.max(0, m.protein + dp);
      m.changes = [...(m.changes ?? []), ...mine.map((x) => x.change.label)];
      if (today) this.shift(dk, dp);
    }
    if (input.alcohol) lines.push({ label: '술', after: p.drinks.length ? `${drinkText(p.drinks)}까지 · 약 ${kcalText(p.drinkBudget)} 안에서` : '이 예산에서는 마시지 않는 편이 좋습니다' });
    lines.push({ label: `${dayWord} 계획`, before: kcalText(dayBefore), after: `${kcalText(p.dayKcal)} / 목표 ${kcalText(day.target)}` });
    if (today) for (const a of p.adjustments) s.adjustments.push(a);
    (s.events ??= []).push({ date, slot: input.slot, kind: eventKindFor(input.slot, input.alcohol), note: p.summary });

    const rows: CardRow[] = [
      ...p.adjustments.map((a): CardRow => ({ op: 'adjustment', date, slot: a.slot, change: a.change, reason: input.reason })),
      { op: 'event', date, slot: input.slot, kind: eventKindFor(input.slot, input.alcohol), note: p.summary },
    ];
    const card = this.card({
      kind: 'event',
      title: input.title,
      lines,
      target: today ? `today:meal:${input.slot}` : `plan:meal:${input.slot}`,
      note: today ? '오늘만 바뀌고 식단표는 그대로입니다' : '내일만 바뀌고 식단표는 그대로입니다. 내일 아침 알림으로 한 번 더 알려드립니다',
      rows,
    }, before);
    return {
      card,
      doneLabel: `${dayWord} ${slotName} ${input.label}에 맞춰 조정안 만듦`,
      result: {
        card_id: card.id, date,
        event: { slot: input.slot, label: input.label, budget_kcal: p.budget, planned_kcal: p.planned, protein_min_g: p.eventProtein },
        moved_from_other_meals_kcal: p.freed,
        changes: p.adjustments.filter((a) => a.slot !== input.slot).map((a) => ({ slot: a.slot, label: a.change.label, kcal: a.change.kcal_delta, protein: a.change.protein_delta ?? 0 })),
        drinks: input.alcohol ? { budget_kcal: p.drinkBudget, options: p.drinks.map((d) => ({ name: d.name, glasses: d.count, serving: d.serving, kcal: d.kcal })) } : null,
        tips: p.tips,
        day_kcal_after: p.dayKcal, day_protein_after: p.dayProtein, target_kcal: R(day.target),
        reminder: today ? null : `${date} 아침에 알림`,
        note: APPLY_NOTE,
      },
    };
  }

  // ------------------------------------------------------------ get_trends
  private getTrends(input: GetTrendsInput): ToolOutcome {
    const s = this.snap;
    if (!s.history?.length) return this.err('기간 기록이 앱에서 오지 않았습니다. 앱을 최신으로 업데이트하면 볼 수 있다고 말하세요.');
    const t = summarizeTrends(s.history, input.range, this.today, { proteinFloor: s.target.proteinFloor, stepsGoal: s.steps.goal, ratePerWeek: s.weight.ratePerWeek });
    const block: TrendBlock = {
      id: this.nextId(), kind: 'trends', label: t.label, from: t.from, to: t.to, days: t.days, finished: t.finished,
      kept: { days: t.kept.days, of: t.kept.of },
      intake: t.intake,
      weight: {
        first: t.weight.first?.kg ?? null, last: t.weight.last?.kg ?? null, change: t.weight.change,
        trendFirst: t.weight.trendFirst, trendLast: t.weight.trendLast, trendChange: t.weight.trendChange,
        ratePerWeek: t.weight.ratePerWeek, points: t.weight.points,
      },
      workouts: { home: t.workouts.home, minutes: t.workouts.minutes },
      runs: t.runs,
      steps: t.steps,
    };
    const { points: _p, ...weight } = t.weight;
    return {
      block,
      doneLabel: `${t.label} 기록 정리함`,
      result: {
        ...t, weight,
        note: '이 결과의 숫자만 말하세요. 같은 내용이 채팅에 작은 카드로 함께 보입니다. 체중은 하루 값보다 추세(trendFirst -> trendLast)를 기준으로 말하고, 외식 다음 날 오른 체중은 소금 때문에 생긴 물 무게일 수 있다고 설명하세요.',
      },
    };
  }
}
