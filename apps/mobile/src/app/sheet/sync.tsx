import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useEnv } from '@/lib/hooks';
import { getSupabase } from '@/lib/env';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

// Email + 6-digit code sign-in (the magic link email template must include {{ .Token }}).
export default function SyncSheet() {
  const env = useEnv();
  const t = useTheme();
  const supa = getSupabase();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [msg, setMsg] = useState('');
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => { void supa?.auth.getUser().then(({ data }) => setUser(data.user?.email ?? null)); }, [supa]);
  const input = [{ marginTop: 14, height: 46, borderRadius: R.sm, borderWidth: 1, borderColor: t.ctrl, paddingHorizontal: 14, color: t.fg, fontSize: 16 }, squircle];
  const state = { local: '이 기기에만 저장 중', syncing: '동기화 중', synced: '웹과 같은 기록을 봅니다', offline: '오프라인 · 연결되면 올립니다', error: '동기화 오류' }[env.store.syncState];

  if (!supa) return <SheetBody><SheetHead eyebrow="동기화" title="연결 전입니다" /></SheetBody>;
  if (user) {
    return (
      <SheetBody>
        <SheetHead eyebrow="동기화" title={state} />
        <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 8 }}>{user}{env.store.pendingCount() ? ` · 올릴 기록 ${env.store.pendingCount()}개` : ''}</Text>
        {env.store.lastError && <Text style={{ color: t.fg2, fontSize: 13, marginTop: 8 }}>{env.store.lastError}</Text>}
        <Btn kind="ghost" label="로그아웃" style={{ marginTop: 18, alignSelf: 'flex-start' }} onPress={async () => { await supa.auth.signOut(); env.store.detach(); setUser(null); }} />
      </SheetBody>
    );
  }
  return (
    <SheetBody>
      <SheetHead eyebrow="동기화" title="로그인" />
      <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 8 }}>이메일로 받은 6자리 코드를 넣으면 웹과 같은 기록을 봅니다. 지금 기록은 로그인하면 그대로 올라갑니다.</Text>
      {step === 'email'
        ? <TextInput style={input} value={email} onChangeText={setEmail} placeholder="이메일" placeholderTextColor={t.muted} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
        : <TextInput style={[input, { letterSpacing: 6 }]} value={code} onChangeText={(x) => setCode(x.replace(/\D/g, '').slice(0, 6))} placeholder="6자리 코드" placeholderTextColor={t.muted} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" />}
      {!!msg && <Text style={{ color: t.fg2, fontSize: 13, marginTop: 10 }}>{msg}</Text>}
      <View style={{ marginTop: 16 }}>
        <Btn label={step === 'email' ? '코드 받기' : '로그인'} onPress={async () => {
          if (step === 'email') {
            const { error } = await supa.auth.signInWithOtp({ email: email.trim() });
            if (error) setMsg(error.message); else { setStep('code'); setMsg('메일함에서 6자리 코드를 확인하세요'); }
          } else {
            const { data, error } = await supa.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
            if (error || !data.user) setMsg(error?.message ?? '코드가 맞지 않습니다');
            else { setUser(data.user.email ?? email); await env.store.attach(supa, data.user.id); }
          }
        }} />
      </View>
    </SheetBody>
  );
}
