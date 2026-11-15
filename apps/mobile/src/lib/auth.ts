// Sign-in for the app: Google through the system auth sheet (PKCE), email 6-digit code as a fallback.
// The store attaches on SIGNED_IN in the root layout, so callers only need to sign in.
import { useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from './env';

/** dietroutine://auth/callback in builds. Must be in Supabase > Authentication > URL Configuration > Redirect URLs. */
export const authRedirect = (): string => Linking.createURL('auth/callback');

export type AuthResult = { ok: true } | { ok: false; cancelled?: boolean; error?: string };

const param = (url: string, k: string): string | null => {
  const m = url.match(new RegExp(`[?&#]${k}=([^&#]*)`));
  return m ? decodeURIComponent(m[1]!.replace(/\+/g, ' ')) : null;
};

export async function signInWithGoogle(): Promise<AuthResult> {
  const supa = getSupabase();
  if (!supa) return { ok: false, error: '서버 연결 설정이 없습니다' };
  const redirectTo = authRedirect();
  const { data, error } = await supa.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data.url) return { ok: false, error: error?.message ?? '로그인 주소를 받지 못했습니다' };
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return { ok: false, cancelled: true };
  const err = param(res.url, 'error_description') ?? param(res.url, 'error');
  if (err) return { ok: false, error: err };
  const code = param(res.url, 'code');
  if (!code) return { ok: false, error: '로그인 코드를 받지 못했습니다' };
  const { error: e2 } = await supa.auth.exchangeCodeForSession(code);
  return e2 ? { ok: false, error: e2.message } : { ok: true };
}

export async function sendEmailCode(email: string): Promise<AuthResult> {
  const supa = getSupabase();
  if (!supa) return { ok: false, error: '서버 연결 설정이 없습니다' };
  const { error } = await supa.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: authRedirect() } });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function verifyEmailCode(email: string, code: string): Promise<AuthResult> {
  const supa = getSupabase();
  if (!supa) return { ok: false, error: '서버 연결 설정이 없습니다' };
  const { error } = await supa.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

/** Current user, kept fresh from auth events. */
export function useAuthUser(): { user: User | null; ready: boolean } {
  const supa = getSupabase();
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({ user: null, ready: !supa });
  useEffect(() => {
    if (!supa) return;
    let alive = true;
    void supa.auth.getSession().then(({ data }) => { if (alive) setState({ user: data.session?.user ?? null, ready: true }); });
    const { data } = supa.auth.onAuthStateChange((_e, s) => setState({ user: s?.user ?? null, ready: true }));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [supa]);
  return state;
}
