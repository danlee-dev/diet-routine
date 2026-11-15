// POST /api/ai/chat/stop - 멈추기 for a running coach turn. The turn no longer stops when the client
// disconnects (leaving the app must not lose the answer), so the client names the reply it wants stopped.
// This saves a stop note under that reply id; the running turn checks for a row with its id every few
// seconds, aborts the model call, and its own save then finds the id taken and skips.
// Auth: Supabase access token in `Authorization: Bearer`. Body: { threadId, replyId } (uuids).
import { z } from 'zod';
import { authenticate } from '@/lib/ai/auth';

const BodyZ = z.object({ threadId: z.uuid(), replyId: z.uuid() });

export async function POST(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth.ok) return Response.json({ error: { code: auth.code, message: auth.message } }, { status: auth.status });
  const parsed = BodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: 'bad_request', message: '요청 형식이 올바르지 않습니다' } }, { status: 400 });
  const { threadId, replyId } = parsed.data;

  // the thread row can still be on its way when 멈추기 comes right after sending; try for a few seconds
  for (let i = 0; i < 4; i++) {
    const { error } = await auth.db.from('chat_messages').insert({ id: replyId, thread_id: threadId, role: 'assistant', content: { stopped: true } });
    // 23505: the answer (or an earlier stop) is already saved under this id; nothing left to stop
    if (!error || error.code === '23505') return Response.json({ ok: true });
    if (error.code !== '23503') {
      console.error('[coach] stop not saved', error.message);
      return Response.json({ error: { code: 'upstream', message: '멈추지 못했습니다' } }, { status: 500 });
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return Response.json({ error: { code: 'upstream', message: '멈추지 못했습니다' } }, { status: 500 });
}
