// POST /api/plan/generate - refine the onboarding plan with Claude, streamed as server-sent events.
// In: { answers: OnboardingAnswers, baseline: GeneratedPlan } (validated; targets are recomputed on the server).
// Out: status events, then one `plan` event { plan: GeneratedPlan, source: 'ai' | 'baseline' }, then `done`.
import Anthropic from '@anthropic-ai/sdk';
import { baselineFallback, PlanGenerateRequestZ, type PlanGenEvent } from '@diet/core/coach';
import { authenticate } from '@/lib/ai/auth';
import { burstAllowed } from '@/lib/ai/limits';
import { runPlanGeneration } from '@/lib/ai/plan';
import { SSE_HEADERS, ssePing } from '@/lib/ai/sse';
import { recordTokens, takeUsage, USAGE_LIMITS } from '@/lib/ai/usage';

export const maxDuration = 300;

const MAX_BODY = 200_000;
const enc = new TextEncoder();
const frame = (e: PlanGenEvent, id: number) => enc.encode(`id: ${id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
const json = (status: number, code: Extract<PlanGenEvent, { type: 'error' }>['code'], message: string, headers?: HeadersInit) =>
  Response.json({ error: { code, message } }, { status, headers });

// fallback daily count when durable limits are not configured (local dev / owner-only deployments)
const local = new Map<string, number[]>();
function localAllowed(userId: string, now = Date.now()): boolean {
  const list = (local.get(userId) ?? []).filter((t) => now - t < 86_400_000);
  if (list.length >= USAGE_LIMITS.plan.perDay) { local.set(userId, list); return false; }
  list.push(now);
  local.set(userId, list);
  return true;
}

export async function POST(req: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json(500, 'upstream', '서버에 AI 키가 설정되지 않았습니다');
  const auth = await authenticate(req);
  if (!auth.ok) return json(auth.status, auth.code, auth.message);

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, 'bad_request', '요청이 너무 큽니다');
    body = JSON.parse(raw);
  } catch {
    return json(400, 'bad_request', '요청 형식이 올바르지 않습니다');
  }
  const parsed = PlanGenerateRequestZ.safeParse(body);
  if (!parsed.success) return json(400, 'bad_request', '요청 형식이 올바르지 않습니다');
  const { answers, baseline } = parsed.data;

  if (!burstAllowed(auth.user.id)) return json(429, 'rate_limit', '조금 천천히 시도해 주세요', { 'Retry-After': '30' });
  const usage = await takeUsage(auth.user.id, 'plan');
  if (usage && !usage.ok) return json(usage.status, 'rate_limit', usage.message, { 'Retry-After': '3600' });
  if (!usage && !localAllowed(auth.user.id)) return json(429, 'rate_limit', '오늘은 계획을 더 만들 수 없습니다. 내일 다시 시도해 주세요', { 'Retry-After': '3600' });

  const upstream = new AbortController();
  req.signal.addEventListener('abort', () => upstream.abort(), { once: true });
  let seq = 0;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    cancel() { open = false; upstream.abort(); },
    async start(controller) {
      const send = (e: PlanGenEvent) => { if (open) controller.enqueue(frame(e, ++seq)); };
      const ping = setInterval(() => { if (open) controller.enqueue(ssePing()); }, 15_000);
      try {
        const result = await runPlanGeneration(answers, baseline, send, upstream.signal);
        send({ type: 'plan', plan: result.plan, source: result.source });
        send({ type: 'done', stopReason: result.source });
        if (usage?.ok) await recordTokens(usage.id, result.usage.input, result.usage.output);
      } catch (err) {
        if (!upstream.signal.aborted) {
          console.error('[plan] failed', err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
          // the client always gets a usable plan: the server's own baseline
          send({ type: 'plan', plan: baselineFallback(answers, err instanceof Anthropic.RateLimitError ? 'AI 서버가 바쁩니다' : 'AI 서버에 연결하지 못했습니다'), source: 'baseline' });
          send({ type: 'done', stopReason: 'baseline' });
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
