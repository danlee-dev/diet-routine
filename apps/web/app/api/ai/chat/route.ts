// POST /api/ai/chat - one coach turn, streamed as server-sent events (see CoachEvent in @diet/core/coach).
// Auth: Supabase access token in `Authorization: Bearer`. Body: ChatRequest (validated).
import Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import { ChatRequestZ, type CoachErrorCode, type CoachEvent } from '@diet/core/coach';
import { runCoachTurn } from '@/lib/ai/agent';
import { authenticate } from '@/lib/ai/auth';
import { burstAllowed, quotaAllowed } from '@/lib/ai/limits';
import { recordTokens, takeUsage } from '@/lib/ai/usage';
import { SSE_HEADERS, sseFrame, ssePing } from '@/lib/ai/sse';

export const maxDuration = 300;

const MAX_BODY = 4_400_000; // under Vercel's 4.5 MB function body limit; three downscaled photos fit

const json = (status: number, code: CoachErrorCode, message: string, headers?: HeadersInit) =>
  Response.json({ error: { code, message } }, { status, headers });

export async function POST(req: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json(500, 'upstream', '서버에 AI 키가 설정되지 않았습니다');

  const auth = await authenticate(req);
  if (!auth.ok) return json(auth.status, auth.code, auth.message);

  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return json(413, 'bad_request', '사진이 너무 큽니다');
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, 'bad_request', '사진이 너무 큽니다');
    body = JSON.parse(raw);
  } catch {
    return json(400, 'bad_request', '요청 형식이 올바르지 않습니다');
  }
  const parsed = ChatRequestZ.safeParse(body);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') ?? '';
    console.warn('[coach] bad request at', where);
    return json(400, 'bad_request', where.startsWith('snapshot') ? '오늘 기록 중 읽을 수 없는 값이 있습니다. 앱을 새로 고친 뒤 다시 시도해 주세요' : '요청 형식이 올바르지 않습니다');
  }
  // keep only recent history and cap each turn: the client controls it, and every token is re-sent each round trip
  const input = { ...parsed.data, history: parsed.data.history.slice(-12).map((t) => ({ ...t, text: t.text.slice(0, 3000) })) };

  if (!burstAllowed(auth.user.id)) return json(429, 'rate_limit', '조금 천천히 물어봐 주세요', { 'Retry-After': '30' });
  // durable count in ai_usage when configured, otherwise the user's own chat_messages rows
  const usage = await takeUsage(auth.user.id, 'chat');
  if (usage && !usage.ok) return json(usage.status, 'rate_limit', usage.message, { 'Retry-After': '600' });
  if (!usage) {
    const quota = await quotaAllowed(auth.db);
    if (!quota.ok) return json(429, 'rate_limit', quota.message, { 'Retry-After': '600' });
  }

  // record the user turn (thread + message, through RLS) while the answer starts: the first status line should
  // not wait for these writes. The assistant row is saved after them (it needs the thread row).
  const db = auth.db;
  const savedUserTurn = (async () => {
    await db.from('chat_threads').upsert({ id: input.threadId, title: input.message.slice(0, 40) || '사진' }, { onConflict: 'id', ignoreDuplicates: true });
    // the thread list on every device is ordered by the last turn
    await Promise.all([
      db.from('chat_threads').update({ updated_at: new Date().toISOString() }).eq('id', input.threadId),
      db.from('chat_messages').insert({ thread_id: input.threadId, role: 'user', content: { text: input.message, images: input.images.length } }),
    ]);
  })().catch((e) => console.error('[coach] user turn not saved', e instanceof Error ? e.message : e));

  const assistantId = input.replyId ?? crypto.randomUUID();
  const saveReply = async (content: Record<string, unknown>) => {
    await savedUserTurn;
    const { error } = await db.from('chat_messages').insert({ id: assistantId, thread_id: input.threadId, role: 'assistant', content });
    // 23505: a stop note already holds this id (멈추기), so the answer is not saved
    if (error && error.code !== '23505') console.error('[coach] reply not saved', error.message);
  };

  // Leaving the app drops the connection, but the turn keeps going and is saved under assistantId; the app picks
  // it up when it comes back. Only 멈추기 stops the model: it saves a stop note under the same id (stop/route.ts),
  // which this loop notices within a few seconds.
  const upstream = new AbortController();
  const stopCheck = setInterval(() => {
    void db.from('chat_messages').select('id').eq('id', assistantId).maybeSingle().then(({ data }) => { if (data) upstream.abort(); });
  }, 3000);

  let seq = 0;
  let ctl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { ctl = c; },
    cancel() { ctl = null; },
  });
  const write = (chunk: Uint8Array) => { if (!ctl) return; try { ctl.enqueue(chunk); } catch { ctl = null; } };
  const send = (e: CoachEvent) => write(sseFrame(e, ++seq));
  const fail = async (code: CoachErrorCode, message: string) => {
    send({ type: 'error', code, message });
    await saveReply({ error: { code, message } });
  };

  const job = (async () => {
    const ping = setInterval(() => write(ssePing()), 15_000);
    try {
      const result = await runCoachTurn(input, send, upstream.signal, assistantId);
      send({ type: 'done', stopReason: result.stopReason });
      clearInterval(stopCheck);
      if (usage?.ok) await recordTokens(usage.id, result.usage.input + result.usage.cacheRead + result.usage.cacheWrite, result.usage.output);
      if (result.text || result.cards.length || result.blocks.length) {
        await saveReply({ text: result.text, cards: result.cards, blocks: result.blocks, parts: result.parts, usage: result.usage });
      } else {
        await saveReply({ error: { code: 'upstream', message: '답을 만들지 못했습니다' } });
      }
    } catch (err) {
      if (upstream.signal.aborted) { /* 멈추기: the stop note is already saved */ }
      else if (err instanceof Anthropic.RateLimitError) await fail('rate_limit', 'AI 서버가 바쁩니다. 잠시 뒤에 다시 시도해 주세요');
      else if (err instanceof Anthropic.BadRequestError) {
        console.error('[coach] bad request', err.message);
        await fail('upstream', '요청을 처리하지 못했습니다');
      } else if (err instanceof Anthropic.APIError) {
        console.error('[coach] api error', err.status, err.message);
        await fail('upstream', 'AI 서버에 연결하지 못했습니다. 잠시 뒤에 다시 시도해 주세요');
      } else {
        console.error('[coach] failed', err);
        await fail('upstream', '답을 만들지 못했습니다');
      }
    } finally {
      clearInterval(ping);
      clearInterval(stopCheck);
      // assigned in the stream callbacks, which TypeScript does not follow
      const c = ctl as ReadableStreamDefaultController<Uint8Array> | null;
      ctl = null;
      try { c?.close(); } catch { /* already closed */ }
    }
  })();
  // keeps the function alive until the turn is saved, even when the client is gone
  after(() => job);
  return new Response(stream, { headers: SSE_HEADERS });
}
