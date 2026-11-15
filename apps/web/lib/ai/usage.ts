import 'server-only';
// Durable per-user AI limits. With SUPABASE_SECRET_KEY set, every AI request is counted in public.ai_usage,
// a table users can read but not write (migration 20261115190000_ai_usage.sql), so nobody can reset their
// own count. Without the key (local dev, or an owner-only deployment with COACH_ALLOWED_EMAILS) the routes
// fall back to weaker limits.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type UsageKind = 'chat' | 'plan';

export const USAGE_LIMITS: Record<UsageKind, { perHour: number; perDay: number }> = {
  chat: { perHour: 40, perDay: 150 },
  plan: { perHour: 5, perDay: 5 },
};

let admin: SupabaseClient | null | undefined;
function adminClient(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
  return admin;
}

/** Durable limits are available (the secret key is configured). */
export const durableUsage = (): boolean => !!process.env.SUPABASE_SECRET_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

export type UsageResult = { ok: true; id: number | null } | { ok: false; status: 429 | 503; message: string };

/**
 * Count this user's recent requests of `kind` and record a new one when under the limit.
 * Returns null when durable limits are not configured (the caller uses its fallback).
 */
export async function takeUsage(userId: string, kind: UsageKind, now = Date.now()): Promise<UsageResult | null> {
  const db = adminClient();
  if (!db) return null;
  const lim = USAGE_LIMITS[kind];
  const since = (ms: number) => new Date(now - ms).toISOString();
  const count = async (from: string) => {
    const { count: n, error } = await db.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', kind).gte('created_at', from);
    if (error) throw error;
    return n ?? 0;
  };
  try {
    const [h, d] = await Promise.all([count(since(3_600_000)), count(since(86_400_000))]);
    if (d >= lim.perDay) return { ok: false, status: 429, message: kind === 'plan' ? '오늘은 계획을 더 만들 수 없습니다. 내일 다시 시도해 주세요' : '오늘 코치 사용량을 다 썼습니다. 내일 다시 물어봐 주세요' };
    if (h >= lim.perHour) return { ok: false, status: 429, message: '한 시간 사용량을 다 썼습니다. 잠시 뒤에 다시 시도해 주세요' };
    const { data, error } = await db.from('ai_usage').insert({ user_id: userId, kind }).select('id').single();
    if (error) throw error;
    return { ok: true, id: (data as { id: number }).id };
  } catch (e) {
    console.error('[ai-usage] unavailable', e instanceof Error ? e.message : e);
    // a deployment that relies on these limits must not run without them
    return process.env.VERCEL ? { ok: false, status: 503, message: '사용량을 확인하지 못해 잠시 쉬고 있습니다. 조금 뒤에 다시 시도해 주세요' } : null;
  }
}

/** Store the tokens a request used (best effort). */
export async function recordTokens(id: number | null, input: number, output: number): Promise<void> {
  const db = adminClient();
  if (!db || id == null) return;
  await db.from('ai_usage').update({ input_tokens: input, output_tokens: output }).eq('id', id);
}
