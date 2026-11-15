// AI coach on iPhone: same request, events and card handling as the web panel (shared code in
// @diet/core/coach and @diet/data), streamed with expo/fetch.
import { useSyncExternalStore } from 'react';
import { fetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import {
  createSSEParser, endTurn, historyFor, newAssistantTurn, reduceTurn, setCardState,
  type AssistantTurn, type CoachCard, type Turn, type UserTurn,
} from '@diet/core/coach';
import { applyCard, coachSnapshot, type Env, type Undo } from '@diet/data';
import { getSupabase } from './env';

/** Coach endpoint. EXPO_PUBLIC_API_URL points a dev build at a local web server (the simulator reaches the Mac at localhost). */
export const COACH_URL = `${(process.env.EXPO_PUBLIC_API_URL ?? 'https://diet-routine.vercel.app').replace(/\/$/, '')}/api/ai/chat`;

// "보기": the coach screen closes, routes to the plan or today tab, and that screen highlights the target
// (plan:meal:<key>, plan:workout:week:<dow>, plan:workout:routine:<A|B>, today:meal:<key>, today:workout).
// Screens subscribe with onCoachFocus or read the pending value with takeCoachFocus when they gain focus.
type Target = CoachCard['target'];
const focusListeners = new Set<(t: Target) => void>();
let pendingFocus: Target | null = null;
export const onCoachFocus = (fn: (t: Target) => void): (() => void) => { focusListeners.add(fn); return () => { focusListeners.delete(fn); }; };
export const takeCoachFocus = (): Target | null => { const t = pendingFocus; pendingFocus = null; return t; };
export function emitCoachFocus(t: Target) {
  pendingFocus = t;
  for (const fn of focusListeners) fn(t);
}

async function accessToken(): Promise<string | null> {
  const supa = getSupabase();
  if (!supa) return null;
  const { data } = await supa.auth.getSession();
  return data.session?.access_token ?? null;
}

const timeZone = (): string | undefined => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

// The conversation lives at module level: the coach screen is a modal, and closing it (or 보기) must not
// abort a running turn or drop the transcript and the undo handles of applied cards.
interface ChatState { turns: Turn[]; busy: boolean }
let state: ChatState = { turns: [], busy: false };
const listeners = new Set<() => void>();
const setState = (fn: (s: ChatState) => ChatState) => { state = fn(state); for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getState = () => state;
let thread = Crypto.randomUUID();
let abort: AbortController | null = null;
const undos = new Map<string, Undo>();

const patch = (id: string, fn: (t: AssistantTurn) => AssistantTurn) =>
  setState((s) => ({ ...s, turns: s.turns.map((t) => (t.role === 'assistant' && t.id === id ? fn(t) : t)) }));

async function send(env: Env, text: string) {
  const message = text.trim();
  if (abort || !message) return;
  const ac = new AbortController();
  abort = ac;
  const history = historyFor(state.turns);
  const user: UserTurn = { role: 'user', id: Crypto.randomUUID(), text: message, images: [] };
  const reply = newAssistantTurn(Crypto.randomUUID());
  setState((s) => ({ turns: [...s.turns, user, reply], busy: true }));
  try {
    const token = await accessToken();
    if (ac.signal.aborted) { patch(reply.id, (t) => endTurn(t, 'stopped')); return; }
    if (!token) {
      patch(reply.id, (t) => endTurn(t, 'error', { code: 'auth', message: '코치를 쓰려면 로그인해야 합니다' }));
      return;
    }
    const res = await fetch(COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ threadId: thread, message, images: [], history, snapshot: coachSnapshot(env, timeZone()) }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = (j?.error?.code ?? 'upstream') as NonNullable<AssistantTurn['error']>['code'];
      patch(reply.id, (t) => endTurn(t, 'error', { code, message: j?.error?.message ?? '코치에 연결하지 못했습니다' }));
      return;
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const feed = createSSEParser();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const events = feed(value);
      if (events.length) patch(reply.id, (t) => events.reduce((acc, e) => reduceTurn(acc, e), t));
    }
    patch(reply.id, (t) => (t.status === 'streaming' ? endTurn(t, 'error', { code: 'network', message: '연결이 끊겼습니다. 다시 시도해 주세요' }) : t));
  } catch {
    patch(reply.id, (t) => (ac.signal.aborted ? endTurn(t, 'stopped') : endTurn(t, 'error', { code: 'network', message: '인터넷 연결을 확인해 주세요' })));
  } finally {
    abort = null;
    setState((s) => ({ ...s, busy: false }));
  }
}

export function useCoachChat(env: Env) {
  const { turns, busy } = useSyncExternalStore(subscribe, getState, getState);
  return {
    turns,
    busy,
    send: (text: string) => send(env, text),
    stop: () => abort?.abort(),
    reset: () => {
      abort?.abort();
      undos.clear();
      thread = Crypto.randomUUID();
      setState(() => ({ turns: [], busy: false }));
    },
    apply: (turnId: string, card: CoachCard): string | null => {
      const r = applyCard(env, card);
      if (!r.ok) return r.error;
      undos.set(card.id, r.undo);
      patch(turnId, (t) => setCardState(t, card.id, 'applied'));
      return null;
    },
    undo: (turnId: string, cardId: string) => {
      const u = undos.get(cardId);
      if (!u) return;
      u();
      undos.delete(cardId);
      patch(turnId, (t) => setCardState(t, cardId, 'undone'));
    },
    retry: () => {
      const lastUser = [...state.turns].reverse().find((t): t is UserTurn => t.role === 'user');
      if (!lastUser || abort) return;
      const at = state.turns.lastIndexOf(lastUser);
      setState((s) => ({ ...s, turns: s.turns.slice(0, at) }));
      void send(env, lastUser.text);
    },
  };
}
