// POST /api/ai/chat - one coach turn, streamed as server-sent events (see CoachEvent in @diet/core/coach).
// Auth: Supabase access token in `Authorization: Bearer`. Body: ChatRequest (validated).
import Anthropic from '@anthropic-ai/sdk';
import { ChatRequestZ, type CoachErrorCode, type CoachEvent } from '@diet/core/coach';
import { runCoachTurn } from '@/lib/ai/agent';
import { authenticate } from '@/lib/ai/auth';
import { burstAllowed, quotaAllowed } from '@/lib/ai/limits';
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
  const quota = await quotaAllowed(auth.db);
  if (!quota.ok) return json(429, 'rate_limit', quota.message, { 'Retry-After': '600' });

  // record the user turn (thread + message, through RLS); this is also what the hourly/daily quota counts
  const db = auth.db;
  await db.from('chat_threads').upsert({ id: input.threadId, title: input.message.slice(0, 40) || '사진' }, { onConflict: 'id', ignoreDuplicates: true });
  await db.from('chat_messages').insert({ thread_id: input.threadId, role: 'user', content: { text: input.message, images: input.images.length } });

  const assistantId = crypto.randomUUID();
  // stops the model call when the client disconnects or cancels the stream (멈추기), so nothing keeps billing
  const upstream = new AbortController();
  req.signal.addEventListener('abort', () => upstream.abort(), { once: true });
  let seq = 0;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    cancel() { open = false; upstream.abort(); },
    async start(controller) {
      const send = (e: CoachEvent) => { if (open) controller.enqueue(sseFrame(e, ++seq)); };
      const ping = setInterval(() => { if (open) controller.enqueue(ssePing()); }, 15_000);
      try {
        const result = await runCoachTurn(input, send, upstream.signal, assistantId);
        send({ type: 'done', stopReason: result.stopReason });
        if (result.text || result.cards.length) {
          await db.from('chat_messages').insert({ id: assistantId, thread_id: input.threadId, role: 'assistant', content: { text: result.text, cards: result.cards, usage: result.usage } });
        }
      } catch (err) {
        if (upstream.signal.aborted) { /* client went away: stop quietly */ }
        else if (err instanceof Anthropic.RateLimitError) send({ type: 'error', code: 'rate_limit', message: 'AI 서버가 바쁩니다. 잠시 뒤에 다시 시도해 주세요' });
        else if (err instanceof Anthropic.BadRequestError) {
          console.error('[coach] bad request', err.message);
          send({ type: 'error', code: 'upstream', message: '요청을 처리하지 못했습니다' });
        } else if (err instanceof Anthropic.APIError) {
          console.error('[coach] api error', err.status, err.message);
          send({ type: 'error', code: 'upstream', message: 'AI 서버에 연결하지 못했습니다. 잠시 뒤에 다시 시도해 주세요' });
        } else {
          console.error('[coach] failed', err);
          send({ type: 'error', code: 'upstream', message: '답을 만들지 못했습니다' });
        }
      } finally {
        clearInterval(ping);
        open = false;
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
