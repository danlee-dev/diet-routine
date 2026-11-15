import 'server-only';
// Who is calling: the Supabase access token from `Authorization: Bearer`, verified with Supabase Auth.
// The returned client acts as that user, so every query below it is limited by RLS (no secret key needed).
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { durableUsage } from './usage';

export type AuthResult =
  | { ok: true; user: User; db: SupabaseClient }
  | { ok: false; status: 401 | 403 | 500; code: 'auth' | 'forbidden'; message: string };

const allowList = (): string[] | null => {
  const raw = process.env.COACH_ALLOWED_EMAILS?.trim();
  return raw ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
};

export async function authenticate(req: Request): Promise<AuthResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { ok: false, status: 500, code: 'auth', message: '서버에 로그인 설정이 없습니다' };
  const header = req.headers.get('authorization') ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token || token.length > 4096) return { ok: false, status: 401, code: 'auth', message: '로그인이 필요합니다' };

  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return { ok: false, status: 401, code: 'auth', message: '로그인이 만료됐습니다. 다시 로그인해 주세요' };

  // Anyone can create a Supabase account (email code, Google). A deployment serves either the listed emails
  // (COACH_ALLOWED_EMAILS) or everyone with durable per-user limits (SUPABASE_SECRET_KEY + ai_usage table);
  // with neither it refuses, so open sign-up can never spend the API key without limits. Local dev stays open.
  const allowed = allowList();
  if (!allowed && process.env.VERCEL && !durableUsage()) return { ok: false, status: 403, code: 'forbidden', message: 'AI 기능이 서버에 아직 설정되지 않았습니다' };
  if (allowed && !allowed.includes((data.user.email ?? '').toLowerCase())) {
    return { ok: false, status: 403, code: 'forbidden', message: '이 계정은 코치를 쓸 수 없습니다' };
  }
  return { ok: true, user: data.user, db };
}
