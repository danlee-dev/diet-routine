// Client side of the coach stream, shared by web and iPhone so both render the same conversation:
// an SSE frame parser, a reducer from events to an assistant turn, and the history sent with the next turn.
import type { CoachCard, CoachErrorCode, CoachEvent } from './types';

/** Incremental SSE parser: feed text chunks, get complete events back. */
export function createSSEParser(): (chunk: string) => CoachEvent[] {
  let buf = '';
  return (chunk) => {
    buf += chunk.replace(/\r\n/g, '\n');
    const out: CoachEvent[] = [];
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue; // comments (": ping") and id-only frames
      try {
        const e = JSON.parse(data) as CoachEvent;
        if (e && typeof e.type === 'string') out.push(e);
      } catch { /* ignore a malformed frame */ }
    }
    return out;
  };
}

export interface CoachStep {
  id: string;
  label: string;
  state: 'running' | 'done' | 'error';
  kind: 'context' | 'tool' | 'search' | 'note';
}

export type CardState = 'idle' | 'applied' | 'undone';

export type TurnPart =
  | { kind: 'steps'; steps: CoachStep[] }
  | { kind: 'text'; text: string }
  | { kind: 'card'; card: CoachCard; state: CardState }
  | { kind: 'sources'; items: { title: string; url: string }[] };

export interface UserTurn {
  role: 'user';
  id: string;
  text: string;
  /** display-only previews (data URLs on web, file URIs on iPhone) */
  images: string[];
}

export interface AssistantTurn {
  role: 'assistant';
  id: string;
  parts: TurnPart[];
  status: 'streaming' | 'done' | 'error' | 'stopped';
  error?: { code: CoachErrorCode | 'network'; message: string };
  startedAt: number;
  endedAt?: number;
}

export type Turn = UserTurn | AssistantTurn;

export const newAssistantTurn = (id: string, now = Date.now()): AssistantTurn => ({ role: 'assistant', id, parts: [], status: 'streaming', startedAt: now });

/** Fold one event into the assistant turn (immutable). */
export function reduceTurn(turn: AssistantTurn, e: CoachEvent, now = Date.now()): AssistantTurn {
  const parts = [...turn.parts];
  const last = parts[parts.length - 1];
  switch (e.type) {
    case 'status': {
      const step: CoachStep = { id: e.id, label: e.label, state: e.state, kind: e.kind };
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p]!;
        if (part.kind !== 'steps') continue;
        const at = part.steps.findIndex((s) => s.id === e.id);
        if (at >= 0) {
          const steps = [...part.steps];
          steps[at] = step;
          parts[p] = { kind: 'steps', steps };
          return { ...turn, parts };
        }
      }
      if (last?.kind === 'steps') parts[parts.length - 1] = { kind: 'steps', steps: [...last.steps, step] };
      else parts.push({ kind: 'steps', steps: [step] });
      return { ...turn, parts };
    }
    case 'text': {
      if (last?.kind === 'text') parts[parts.length - 1] = { kind: 'text', text: last.text + e.delta };
      else if (e.delta.trim()) parts.push({ kind: 'text', text: e.delta.replace(/^\n+/, '') });
      return { ...turn, parts };
    }
    case 'card':
      parts.push({ kind: 'card', card: e.card, state: 'idle' });
      return { ...turn, parts };
    case 'sources': {
      const existing = parts.findIndex((p) => p.kind === 'sources');
      if (existing >= 0) {
        const prev = parts[existing] as Extract<TurnPart, { kind: 'sources' }>;
        const seen = new Set(prev.items.map((x) => x.url));
        parts[existing] = { kind: 'sources', items: [...prev.items, ...e.items.filter((x) => !seen.has(x.url))].slice(0, 8) };
      } else parts.push({ kind: 'sources', items: e.items });
      return { ...turn, parts };
    }
    case 'done':
      return { ...turn, parts: settleSteps(parts), status: turn.status === 'error' ? 'error' : 'done', endedAt: now };
    case 'error':
      return { ...turn, parts: settleSteps(parts), status: 'error', error: { code: e.code, message: e.message }, endedAt: now };
  }
}

/** When a turn ends, a step still marked running did not finish. */
function settleSteps(parts: TurnPart[]): TurnPart[] {
  return parts.map((p) => (p.kind === 'steps' ? { kind: 'steps', steps: p.steps.map((s) => (s.state === 'running' ? { ...s, state: 'done' as const } : s)) } : p));
}

export const endTurn = (turn: AssistantTurn, status: 'stopped' | 'error', error?: AssistantTurn['error'], now = Date.now()): AssistantTurn =>
  ({ ...turn, parts: settleSteps(turn.parts), status: turn.status === 'streaming' ? status : turn.status, ...(error && turn.status === 'streaming' ? { error } : {}), endedAt: turn.endedAt ?? now });

export const setCardState = (turn: AssistantTurn, cardId: string, state: CardState): AssistantTurn => ({
  ...turn,
  parts: turn.parts.map((p) => (p.kind === 'card' && p.card.id === cardId ? { ...p, state } : p)),
});

/** Text of an assistant turn for history: answer text plus one line per card and whether it was applied. */
export function turnText(turn: AssistantTurn): string {
  const out: string[] = [];
  for (const p of turn.parts) {
    if (p.kind === 'text' && p.text.trim()) out.push(p.text.trim());
    if (p.kind === 'card') out.push(`[변경 카드: ${p.card.title} · ${p.state === 'applied' ? '사용자가 적용함' : p.state === 'undone' ? '적용 후 되돌림' : '아직 적용 안 함'}]`);
  }
  return out.join('\n\n');
}

/** Last turns as plain text for the request (the server rebuilds the model conversation from this). */
export function historyFor(turns: Turn[], maxTurns = 16): { role: 'user' | 'assistant'; text: string }[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const t of turns.slice(-maxTurns)) {
    const text = t.role === 'user' ? (t.text || (t.images.length ? `(사진 ${t.images.length}장)` : '')) : turnText(t);
    if (text) out.push({ role: t.role, text: text.slice(0, 6000) });
  }
  return out;
}

/** Elapsed seconds of a finished turn, for the collapsed step summary. */
export const turnSeconds = (t: AssistantTurn): number => Math.max(1, Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000));

/** Suggested prompts for an empty conversation, from the current snapshot-like state. */
export function suggestedPrompts(next: { key: string; name: string } | undefined, hour: number): string[] {
  const s: string[] = [];
  if (next && hour >= 11 && next.key !== 'breakfast') s.push(`${next.name} 대신 편의점에서 먹으면 뭐가 좋아?`);
  s.push('점심에 순대국이랑 밥 반 공기 먹었어');
  s.push('간식 빼고 그만큼 저녁에 닭가슴살 더 줘');
  s.push('프로틴 1스쿱을 그릭요거트에 타 먹어도 돼?');
  s.push('오늘 무릎이 좀 아파');
  s.push('이번 주 어땠어?');
  return s.slice(0, 5);
}
