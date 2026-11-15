'use client';
// Conversation state for the coach panel: loads the saved conversation (any device) on open, sends a turn,
// folds the SSE stream into the transcript, applies / undoes change cards through @diet/data.
// Card state comes from the rows: a card applied on the phone shows as applied here once the rows sync.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSSEParser, endTurn, historyFor, newAssistantTurn, reduceTurn, setCardState,
  type AssistantTurn, type ChatThreadRow, type CoachCard, type Turn, type UserTurn,
} from '@diet/core/coach';
import { applyCard, cardApplied, coachSnapshot, loadConversation, undoableByRows, undoByRows, type Env, type Undo } from '@diet/data';
import { getSupabase } from '@/lib/client';
import type { PreparedImage } from './image';

const uid = () => crypto.randomUUID();
/** what this panel can draw beyond text and cards (the server sends trend blocks only when listed) */
const FEATURES = ['blocks'];

async function accessToken(): Promise<string | null> {
  const supa = getSupabase();
  if (!supa) return null;
  const { data } = await supa.auth.getSession();
  return data.session?.access_token ?? null;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function useCoachChat(env: Env) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<ChatThreadRow[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [load, setLoad] = useState<LoadState>('idle');
  const turnsRef = useRef<Turn[]>([]);
  const thread = useRef(uid());
  const abort = useRef<AbortController | null>(null);
  const undos = useRef(new Map<string, Undo>());
  /** photos per user turn, so 다시 시도 sends them again */
  const photos = useRef(new Map<string, PreparedImage[]>());
  const loadSeq = useRef(0);

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = useCallback((id: string, fn: (t: AssistantTurn) => AssistantTurn) => {
    setTurns((ts) => ts.map((t) => (t.role === 'assistant' && t.id === id ? fn(t) : t)));
  }, []);

  /**
   * Read the saved conversation: a chosen thread, the thread a card message belongs to, or the latest one.
   * `soft` (on opening the panel) keeps what is on screen unless the server has at least as many turns,
   * so a turn that failed here (never saved) is not wiped.
   */
  const fetchConversation = useCallback(async (want: { threadId?: string | null; messageId?: string | null } = {}, soft = false) => {
    const supa = getSupabase();
    if (!supa || abort.current) return;
    const { data } = await supa.auth.getSession();
    if (!data.session) return;
    const seq = ++loadSeq.current;
    setLoad('loading');
    try {
      const c = await loadConversation(supa, want);
      if (seq !== loadSeq.current || abort.current) return;
      setThreads(c.threads);
      if (!c.threadId) { setLoad('ready'); return; }
      const local = turnsRef.current;
      const sameThread = c.threadId === thread.current;
      if (soft && local.length && (!sameThread || c.turns.length < local.length)) { setLoad('ready'); return; }
      thread.current = c.threadId;
      setThreadId(c.threadId);
      turnsRef.current = c.turns;
      setTurns(c.turns);
      setLoad('ready');
    } catch {
      if (seq === loadSeq.current) setLoad('error');
    }
  }, []);

  /** On opening the panel: the conversation on screen, refreshed, or the latest one when nothing is open. */
  const refresh = useCallback(() => {
    void fetchConversation(turnsRef.current.length ? { threadId: thread.current } : {}, true);
  }, [fetchConversation]);
  const openThread = useCallback((id: string) => { void fetchConversation({ threadId: id }); }, [fetchConversation]);
  const openByMessage = useCallback((messageId: string | null) => { void fetchConversation(messageId ? { messageId } : {}); }, [fetchConversation]);

  const send = useCallback(async (text: string, images: PreparedImage[]) => {
    if (abort.current) return;
    const message = text.trim();
    if (!message && !images.length) return;
    // claim the turn before any await, so a second tap or 멈추기 in between is handled
    const ac = new AbortController();
    abort.current = ac;
    loadSeq.current++; // a load still in flight must not replace the turn being sent
    setBusy(true);
    const history = historyFor(turnsRef.current);
    const user: UserTurn = { role: 'user', id: uid(), text: message, images: images.map((i) => i.preview) };
    if (images.length) photos.current.set(user.id, images);
    const reply = newAssistantTurn(uid());
    setTurns((ts) => [...ts, user, reply]);
    setThreadId(thread.current);

    try {
      const token = await accessToken();
      if (ac.signal.aborted) { patch(reply.id, (t) => endTurn(t, 'stopped')); return; }
      if (!token) {
        patch(reply.id, (t) => endTurn(t, 'error', { code: 'auth', message: '코치를 쓰려면 로그인해야 합니다' }));
        return;
      }
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          threadId: thread.current,
          message,
          images: images.map((i) => ({ media_type: i.type, data: i.data })),
          history,
          snapshot: coachSnapshot(env, Intl.DateTimeFormat().resolvedOptions().timeZone, { extras: true }),
          features: FEATURES,
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
    loadSeq.current++;
    photos.current.clear();
    thread.current = uid();
    setThreadId(null);
    turnsRef.current = [];
    setTurns([]);
  }, []);

  const apply = useCallback((turnId: string, card: CoachCard): string | null => {
    const r = applyCard(env, card);
    if (!r.ok) return r.error;
    undos.current.set(card.id, r.undo);
    patch(turnId, (t) => setCardState(t, card.id, 'applied'));
    return null;
  }, [env, patch]);

  /** Applied here (this session) or anywhere (the rows are in the store). */
  const isApplied = useCallback((card: CoachCard, local: 'idle' | 'applied' | 'undone'): boolean =>
    local === 'applied' || (local !== 'undone' && cardApplied(env, card)), [env]);

  const canUndo = useCallback((card: CoachCard) => undos.current.has(card.id) || undoableByRows(card), []);

  const undo = useCallback((turnId: string, card: CoachCard) => {
    const u = undos.current.get(card.id);
    if (u) { u(); undos.current.delete(card.id); }
    else if (!undoByRows(env, card)) return;
    patch(turnId, (t) => setCardState(t, card.id, 'undone'));
  }, [env, patch]);

  /** Re-send the last user turn after an error. */
  const retry = useCallback(() => {
    const ts = turnsRef.current;
    const lastUser = [...ts].reverse().find((t): t is UserTurn => t.role === 'user');
    if (!lastUser || abort.current) return;
    const images = photos.current.get(lastUser.id) ?? [];
    if (!lastUser.text && !images.length) return;
    const at = ts.lastIndexOf(lastUser);
    turnsRef.current = ts.slice(0, at);
    setTurns(ts.slice(0, at));
    void send(lastUser.text, images);
  }, [send]);

  return { turns, busy, threads, threadId, load, send, stop, reset, apply, undo, retry, isApplied, canUndo, refresh, openThread, openByMessage };
}
