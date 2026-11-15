import 'server-only';
// The coach turn: a manual streaming tool loop over the Messages API.
// - Client tools (log_food, ...) run here as pure functions and return change cards; nothing is written server side.
// - web_search is Anthropic's server tool.
// - Every model event becomes a CoachEvent (status lines, text deltas, cards, sources).
import Anthropic from '@anthropic-ai/sdk';
import {
  COACH_TOOLS, CoachSession, parseToolInput, snapshotForModel, toolStatusLabel,
  type ChatRequestZ, type CoachCard, type CoachEvent, type CoachToolName,
} from '@diet/core/coach';
import type { z } from 'zod';
import { LIMITS } from './limits';
import { COACH_SYSTEM } from './prompt';

type Req = z.output<typeof ChatRequestZ>;
type Emit = (e: CoachEvent) => void;

export const COACH_MODEL = process.env.COACH_MODEL?.trim() || 'claude-opus-5-5';
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['thinking-display-updates-2026-08-18', 'server-side-fallback-2026-07-01'];
const INTERRUPTED = 'This part of the response was interrupted before it finished.';

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic()); // ANTHROPIC_API_KEY from the server env only

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...COACH_TOOLS.map((t): Anthropic.Beta.BetaTool => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
    // stream tool input as it is generated; the server then validates each input itself (parseToolInput)
    eager_input_streaming: true,
  })),
  { type: 'web_search_20260209', name: 'web_search', max_uses: LIMITS.webSearchesPerTurn, user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' } },
];

const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }];

function buildMessages(req: Req): Anthropic.Beta.BetaMessageParam[] {
  const history: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of req.history) {
    if (!history.length && t.role === 'assistant') continue; // the first message must be the user's
    if (t.text.trim()) history.push({ role: t.role, content: t.text });
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...req.images.map((img): Anthropic.Beta.BetaImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
    { type: 'text', text: snapshotForModel(req.snapshot) },
    { type: 'text', text: req.message || (req.images.length ? '이 사진을 봐 주세요.' : '') },
  ];
  return [...history, { role: 'user', content }];
}

export interface TurnResult {
  text: string;
  cards: CoachCard[];
  stopReason: string;
  usage: { input: number; output: number; cacheRead: number };
}

export async function runCoachTurn(req: Req, emit: Emit, signal: AbortSignal): Promise<TurnResult> {
  const session = new CoachSession(req.snapshot, crypto.randomUUID().slice(0, 8));
  const messages = buildMessages(req);
  const cards: CoachCard[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let text = '';
  let stopReason = 'end_turn';
  let notes = 0;

  // first steps, finished when the model starts answering
  const opening: { id: string; done: string }[] = [];
  const s = req.snapshot;
  opening.push({ id: 'ctx', done: `오늘 기록 확인함 · ${s.totals.eatenKcal.toLocaleString('ko-KR')}/${s.target.kcal.toLocaleString('ko-KR')}kcal` });
  emit({ type: 'status', id: 'ctx', label: '오늘 기록 확인 중', state: 'running', kind: 'context' });
  if (req.images.length) {
    opening.push({ id: 'img', done: `사진 ${req.images.length}장 받음` });
    emit({ type: 'status', id: 'img', label: '사진 살펴보는 중', state: 'running', kind: 'context' });
  }
  const closeOpening = () => { for (const o of opening.splice(0)) emit({ type: 'status', id: o.id, label: o.done, state: 'done', kind: 'context' }); };

  for (let iter = 0; iter < LIMITS.maxIterations; iter++) {
    const last = iter === LIMITS.maxIterations - 1 || usage.output > LIMITS.maxTokensPerTurn;
    const stream = anthropic().beta.messages.stream({
      model: COACH_MODEL,
      max_tokens: LIMITS.maxTokensPerCall,
      system: SYSTEM,
      tools: TOOLS,
      // on the last allowed round the model must answer with what it has
      ...(last ? { tool_choice: { type: 'none' as const } } : {}),
      messages,
      thinking: { type: 'adaptive', display: 'updates' },
      output_config: { effort: 'medium' },
      betas: BETAS,
      fallbacks: 'default',
    }, { signal });

    const thinkingText = new Map<number, string>();
    const blockKind = new Map<number, string>();
    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        closeOpening();
        const b = ev.content_block;
        blockKind.set(ev.index, b.type);
        // a new text block after earlier text (e.g. after a search or tool call) starts a new paragraph
        if (b.type === 'text' && text && !text.endsWith('\n')) { text += '\n\n'; emit({ type: 'text', delta: '\n\n' }); }
        if (b.type === 'tool_use') emit({ type: 'status', id: b.id, label: toolStatusLabel(b.name), state: 'running', kind: 'tool' });
        else if (b.type === 'server_tool_use' && b.name === 'web_search') emit({ type: 'status', id: b.id, label: '웹 검색 중', state: 'running', kind: 'search' });
        else if (b.type === 'web_search_tool_result') {
          if (Array.isArray(b.content)) {
            const items = b.content.slice(0, 6).map((r) => ({ title: r.title.slice(0, 140), url: r.url }));
            emit({ type: 'status', id: b.tool_use_id, label: `웹 검색 완료 · 출처 ${b.content.length}개`, state: 'done', kind: 'search' });
            if (items.length) emit({ type: 'sources', items });
          } else {
            emit({ type: 'status', id: b.tool_use_id, label: '웹 검색을 하지 못했습니다', state: 'error', kind: 'search' });
          }
        }
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') { text += ev.delta.text; emit({ type: 'text', delta: ev.delta.text }); }
        else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) thinkingText.set(ev.index, (thinkingText.get(ev.index) ?? '') + ev.delta.thinking);
      } else if (ev.type === 'content_block_stop') {
        const kind = blockKind.get(ev.index);
        const block = stream.currentMessage?.content[ev.index];
        if (kind === 'thinking') {
          // with display "updates", a non-empty thinking block is a short progress note between tool calls
          const note = (thinkingText.get(ev.index) ?? '').trim();
          if (note && note !== INTERRUPTED) emit({ type: 'status', id: `note-${++notes}`, label: note.length > 140 ? `${note.slice(0, 139)}…` : note, state: 'done', kind: 'note' });
        } else if (block?.type === 'tool_use') {
          emit({ type: 'status', id: block.id, label: toolStatusLabel(block.name, block.input as Record<string, unknown>), state: 'running', kind: 'tool' });
        } else if (block?.type === 'server_tool_use' && block.name === 'web_search') {
          emit({ type: 'status', id: block.id, label: toolStatusLabel('web_search', block.input as Record<string, unknown>), state: 'running', kind: 'search' });
        }
      }
    }
    const msg = await stream.finalMessage();
    closeOpening();
    usage.input += msg.usage.input_tokens;
    usage.output += msg.usage.output_tokens;
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
    stopReason = msg.stop_reason ?? 'end_turn';

    if (msg.stop_reason === 'refusal') {
      emit({ type: 'error', code: 'refusal', message: '이 요청에는 답할 수 없습니다. 다르게 물어봐 주세요' });
      break;
    }
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
    const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (msg.stop_reason === 'max_tokens' && toolUses.length) {
      // a tool input cut off at max_tokens can still parse as a valid partial object: never run it
      emit({ type: 'error', code: 'too_long', message: '답이 너무 길어져 멈췄습니다. 조금 나눠서 물어봐 주세요' });
      break;
    }
    if (msg.stop_reason !== 'tool_use' || !toolUses.length) break;

    messages.push({ role: 'assistant', content: msg.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const parsed = parseToolInput(tu.name, tu.input);
      if (!parsed.ok) {
        emit({ type: 'status', id: tu.id, label: '입력을 다시 확인하는 중', state: 'error', kind: 'tool' });
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_INPUT: parsed.error }) });
        continue;
      }
      const out = session.run(tu.name as CoachToolName, parsed.data);
      if (out.card) { cards.push(out.card); emit({ type: 'card', card: out.card }); }
      emit({ type: 'status', id: tu.id, label: out.doneLabel, state: out.isError ? 'error' : 'done', kind: 'tool' });
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out.result), ...(out.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text, cards, stopReason, usage };
}
