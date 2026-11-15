// AI coach on iPhone: same request, events and card handling as the web panel (shared code in
// @diet/core/coach and @diet/data), streamed with expo/fetch.
import type { CoachPhoto } from './photo';
import { useSyncExternalStore } from 'react';
import { fetch } from 'expo/fetch';
import * as Crypto from 'expo-crypto';
import {
  createSSEParser, endTurn, historyFor, newAssistantTurn, reduceTurn, setCardState,
  type AssistantTurn, type ChatThreadRow, type CoachCard, type Turn, type UserTurn,
} from '@diet/core/coach';
import { applyCard, cardApplied, coachSnapshot, loadConversation, undoableByRows, undoByRows, type Env, type Undo } from '@diet/data';
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

/** what this screen can draw beyond text and cards (the server sends trend blocks only when listed) */
const FEATURES = ['blocks'];

// The conversation lives at module level: the coach screen is a modal, and closing it (or 보기) must not
// abort a running turn or drop the transcript and the undo handles of applied cards.
export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
interface ChatState { turns: Turn[]; busy: boolean; threads: ChatThreadRow[]; threadId: string | null; load: LoadState }
let state: ChatState = { turns: [], busy: false, threads: [], threadId: null, load: 'idle' };
const listeners = new Set<() => void>();
const setState = (fn: (s: ChatState) => ChatState) => { state = fn(state); for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getState = () => state;
let thread = Crypto.randomUUID();
let abort: AbortController | null = null;
const undos = new Map<string, Undo>();
let loadSeq = 0;

/**
 * Read the saved conversation (it may have started on the desktop): a chosen thread, the thread of a card
 * message (the today screen's "코치가 바꿈"), or the latest. `soft` keeps the turns on screen unless the
 * server has at least as many, so a turn that failed here (never saved) is not wiped.
 */
async function fetchConversation(want: { threadId?: string | null; messageId?: string | null } = {}, soft = false) {
  const supa = getSupabase();
  if (!supa || abort) return;
  const { data } = await supa.auth.getSession();
  if (!data.session) return;
  const seq = ++loadSeq;
  setState((s) => ({ ...s, load: 'loading' }));
  try {
    const c = await loadConversation(supa, want);
    if (seq !== loadSeq || abort) return;
    if (!c.threadId) { setState((s) => ({ ...s, threads: c.threads, load: 'ready' })); return; }
    const keep = soft && state.turns.length > 0 && (c.threadId !== thread || c.turns.length < state.turns.length);
    if (keep) { setState((s) => ({ ...s, threads: c.threads, load: 'ready' })); return; }
    thread = c.threadId;
    setState((s) => ({ ...s, threads: c.threads, threadId: c.threadId, turns: c.turns, load: 'ready' }));
  } catch {
    if (seq === loadSeq) setState((s) => ({ ...s, load: 'error' }));
  }
}

/** Opening the coach: refresh the conversation on screen, or load the latest when nothing is open. */
export const refreshCoach = () => fetchConversation(state.turns.length ? { threadId: thread } : {}, true);

// "코치가 바꿈" on the today screen: the coach tab opens on the conversation that made the change
let pendingMessage: { id: string | null } | null = null;
/** Remember which conversation to open; the coach screen takes it when it gains focus. */
export function openCoachAt(messageId: string | null) { pendingMessage = { id: messageId }; }
export function takePendingCoach(): boolean {
  const p = pendingMessage;
  pendingMessage = null;
  if (!p) return false;
  void fetchConversation(p.id ? { messageId: p.id } : {});
  return true;
}

const patch = (id: string, fn: (t: AssistantTurn) => AssistantTurn) =>
  setState((s) => ({ ...s, turns: s.turns.map((t) => (t.role === 'assistant' && t.id === id ? fn(t) : t)) }));

async function send(env: Env, text: string, photos: CoachPhoto[] = []) {
  const message = text.trim();
  if (abort || (!message && !photos.length)) return;
  const ac = new AbortController();
  abort = ac;
  const history = historyFor(state.turns);
  const user: UserTurn = { role: 'user', id: Crypto.randomUUID(), text: message, images: photos.map((p) => p.uri) };
  const reply = newAssistantTurn(Crypto.randomUUID());
  loadSeq++; // a load still in flight must not replace the turn being sent
  setState((s) => ({ ...s, turns: [...s.turns, user, reply], busy: true, threadId: thread, load: s.load === 'loading' ? 'ready' : s.load }));
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
      body: JSON.stringify({
        threadId: thread, message, images: photos.map((p) => ({ media_type: p.media_type, data: p.data })), history,
        snapshot: coachSnapshot(env, timeZone(), { extras: true }), features: FEATURES,
      }),
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
  const { turns, busy, threads, threadId, load } = useSyncExternalStore(subscribe, getState, getState);
  return {
    turns,
    busy,
    threads,
    threadId,
    load,
    send: (text: string, photos: CoachPhoto[] = []) => send(env, text, photos),
    stop: () => abort?.abort(),
    reset: () => {
      abort?.abort();
      loadSeq++;
      thread = Crypto.randomUUID();
      setState((s) => ({ ...s, turns: [], busy: false, threadId: null }));
    },
    refresh: () => { void refreshCoach(); },
    openThread: (id: string) => { void fetchConversation({ threadId: id }); },
    /** applied here (this session) or anywhere (the card's rows are in the store) */
    isApplied: (card: CoachCard, local: 'idle' | 'applied' | 'undone'): boolean => local === 'applied' || (local !== 'undone' && cardApplied(env, card)),
    canUndo: (card: CoachCard): boolean => undos.has(card.id) || undoableByRows(card),
    apply: (turnId: string, card: CoachCard): string | null => {
      const r = applyCard(env, card);
      if (!r.ok) return r.error;
      undos.set(card.id, r.undo);
      patch(turnId, (t) => setCardState(t, card.id, 'applied'));
      return null;
    },
    undo: (turnId: string, card: CoachCard) => {
      const u = undos.get(card.id);
      if (u) { u(); undos.delete(card.id); }
      else if (!undoByRows(env, card)) return;
      patch(turnId, (t) => setCardState(t, card.id, 'undone'));
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
