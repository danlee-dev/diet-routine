import 'server-only';
// Cost guards for the coach.
// 1. Burst limit per user in this server instance (memory).
// 2. Hourly / daily limit per user across instances, counted from the user's own chat_messages rows
//    (the route records every user turn there, through RLS). If that query fails we fall back to (1) only.
import type { SupabaseClient } from '@supabase/supabase-js';

export const LIMITS = {
  burstPerMinute: 6,
  perHour: 40,
  perDay: 150,
  /** model calls per user turn (each tool round trip is one) */
  maxIterations: 6,
  /** output tokens per model call (includes thinking) */
  maxTokensPerCall: 16000,
  /** output tokens per user turn across all calls */
  maxTokensPerTurn: 48000,
  webSearchesPerTurn: 3,
} as const;

const recent = new Map<string, number[]>();

export function burstAllowed(userId: string, now = Date.now()): boolean {
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= LIMITS.burstPerMinute) { recent.set(userId, list); return false; }
  list.push(now);
  recent.set(userId, list);
  if (recent.size > 5000) recent.clear(); // a one-person app never gets here; keeps memory bounded anyway
  return true;
}

export type QuotaResult = { ok: true } | { ok: false; message: string };

export async function quotaAllowed(db: SupabaseClient, now = Date.now()): Promise<QuotaResult> {
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const count = async (since: string) => {
    const { count: n, error } = await db.from('chat_messages').select('id', { count: 'exact', head: true }).eq('role', 'user').gte('created_at', since);
    if (error) throw error;
    return n ?? 0;
  };
  try {
    const [h, d] = await Promise.all([count(hourAgo), count(dayAgo)]);
    if (h >= LIMITS.perHour) return { ok: false, message: '한 시간 사용량을 다 썼습니다. 잠시 뒤에 다시 물어봐 주세요' };
    if (d >= LIMITS.perDay) return { ok: false, message: '오늘 코치 사용량을 다 썼습니다. 내일 다시 물어봐 주세요' };
  } catch {
    // count unavailable: the burst limit still applies
  }
  return { ok: true };
}
