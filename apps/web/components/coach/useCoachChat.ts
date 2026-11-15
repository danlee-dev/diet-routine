'use client';
// Conversation state for the coach panel: sends a turn, folds the SSE stream into the transcript,
// applies / undoes change cards through @diet/data. The transcript lives in memory for this tab.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSSEParser, endTurn, historyFor, newAssistantTurn, reduceTurn, setCardState,
  type AssistantTurn, type CoachCard, type Turn, type UserTurn,
} from '@diet/core/coach';
import { applyCard, coachSnapshot, type Env, type Undo } from '@diet/data';
import { getSupabase } from '@/lib/client';
import type { PreparedImage } from './image';

const uid = () => crypto.randomUUID();

async function accessToken(): Promise<string | null> {
  const supa = getSupabase();
  if (!supa) return null;
  const { data } = await supa.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useCoachChat(env: Env) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const turnsRef = useRef<Turn[]>([]);
  const thread = useRef(uid());
  const abort = useRef<AbortController | null>(null);
  const undos = useRef(new Map<string, Undo>());

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = useCallback((id: string, fn: (t: AssistantTurn) => AssistantTurn) => {
    setTurns((ts) => ts.map((t) => (t.role === 'assistant' && t.id === id ? fn(t) : t)));
  }, []);

  const send = useCallback(async (text: string, images: PreparedImage[]) => {
    if (abort.current) return;
    const message = text.trim();
    if (!message && !images.length) return;
    const history = historyFor(turnsRef.current);
    const user: UserTurn = { role: 'user', id: uid(), text: message, images: images.map((i) => i.preview) };
    const reply = newAssistantTurn(uid());
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
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          threadId: thread.current,
          message,
          images: images.map((i) => ({ media_type: i.type, data: i.data })),
          history,
          snapshot: coachSnapshot(env, Intl.DateTimeFormat().resolvedOptions().timeZone),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        const code = (j?.error?.code ?? 'upstream') as NonNullable<AssistantTurn['error']>['code'];
        patch(reply.id, (t) => endTurn(t, 'error', { code, message: j?.error?.message ?? '코치에 연결하지 못했습니다' }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const feed = createSSEParser();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const events = feed(dec.decode(value, { stream: true }));
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
    thread.current = uid();
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

  /** Re-send the last user turn after an error. */
  const retry = useCallback(() => {
    const ts = turnsRef.current;
    const lastUser = [...ts].reverse().find((t): t is UserTurn => t.role === 'user');
    if (!lastUser || abort.current) return;
    const at = ts.lastIndexOf(lastUser);
    turnsRef.current = ts.slice(0, at);
    setTurns(ts.slice(0, at));
    void send(lastUser.text, []);
  }, [send]);

  return { turns, busy, send, stop, reset, apply, undo, retry };
}
