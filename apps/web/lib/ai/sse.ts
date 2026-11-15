import type { CoachEvent } from '@diet/core/coach';

const enc = new TextEncoder();

/** One server-sent event: `event: <type>` + `data: <json>` (id increments so a client can tell what it missed). */
export const sseFrame = (e: CoachEvent, id: number): Uint8Array =>
  enc.encode(`id: ${id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);

/** Comment line that keeps proxies from closing a quiet connection while the model thinks. */
export const ssePing = (): Uint8Array => enc.encode(': ping\n\n');

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
