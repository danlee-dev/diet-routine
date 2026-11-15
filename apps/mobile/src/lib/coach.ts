// AI coach on iPhone: same request, events and card handling as the web panel (shared code in
// @diet/core/coach and @diet/data), streamed with expo/fetch.
import { useCallback, useEffect, useRef, useState } from 'react';
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

export function useCoachChat(env: Env) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const turnsRef = useRef<Turn[]>([]);
  const thread = useRef(Crypto.randomUUID());
  const abort = useRef<AbortController | null>(null);
  const undos = useRef(new Map<string, Undo>());

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = useCallback((id: string, fn: (t: AssistantTurn) => AssistantTurn) => {
    setTurns((ts) => ts.map((t) => (t.role === 'assistant' && t.id === id ? fn(t) : t)));
  }, []);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (abort.current || !message) return;
    const history = historyFor(turnsRef.current);
    const user: UserTurn = { role: 'user', id: Crypto.randomUUID(), text: message, images: [] };
    const reply = newAssistantTurn(Crypto.randomUUID());
    setTurns((ts) => [...ts, user, reply]);

    const token = await accessToken();
    if (!token) {
      patch(reply.id, (t) => endTurn(t, 'error', { code: 'auth', message: '코치를 쓰려면 로그인해야 합니다' }));
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    try {
      const res = await fetch(COACH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ threadId: thread.current, message, images: [], history, snapshot: coachSnapshot(env, timeZone()) }),
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
      abort.current = null;
      setBusy(false);
    }
  }, [env, patch]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const reset = useCallback(() => {
    abort.current?.abort();
    undos.current.clear();
    thread.current = Crypto.randomUUID();
    setTurns([]);
  }, []);

  const apply = useCallback((turnId: string, card: CoachCard): string | null => {
    const r = applyCard(env, card);
    if (!r.ok) return r.error;
    undos.current.set(card.id, r.undo);
    patch(turnId, (t) => setCardState(t, card.id, 'applied'));
    return null;
  }, [env, patch]);

  const undo = useCallback((turnId: string, cardId: string) => {
    const u = undos.current.get(cardId);
    if (!u) return;
    u();
    undos.current.delete(cardId);
    patch(turnId, (t) => setCardState(t, cardId, 'undone'));
  }, [patch]);

  const retry = useCallback(() => {
    const ts = turnsRef.current;
    const lastUser = [...ts].reverse().find((t): t is UserTurn => t.role === 'user');
    if (!lastUser || abort.current) return;
    const at = ts.lastIndexOf(lastUser);
    turnsRef.current = ts.slice(0, at);
    setTurns(ts.slice(0, at));
    void send(lastUser.text);
  }, [send]);

  return { turns, busy, send, stop, reset, apply, undo, retry };
}
