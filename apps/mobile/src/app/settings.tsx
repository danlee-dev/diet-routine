import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { fmt, mdw, parseKey } from '@diet/core';
import { useEnv } from '@/lib/hooks';
import { todayView } from '@diet/data';
import { getSupabase } from '@/lib/env';
import { sendEmailCode, signInWithGoogle, signOut, useAuthUser, verifyEmailCode } from '@/lib/auth';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Row, Section } from '@/components/list';
import { HealthNotifySection } from '@/components/settings/HealthNotifySection';
import { ShortcutsSection } from '@/components/settings/ShortcutsSection';
import { WeatherSection } from '@/components/settings/WeatherSection';
import { useToast } from '@/components/ui';

function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

function SignIn({ t }: { t: Theme }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'google' | 'email' | 'code'>('google');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const input = [{ height: 48, borderRadius: R.sm, backgroundColor: t.bg, paddingHorizontal: 14, color: t.fg, fontSize: 16 }, squircle];

  const google = async () => {
    setBusy(true); setMsg('');
    const r = await signInWithGoogle();
    setBusy(false);
    if (r.ok) toast('로그인했습니다. 기록을 맞추는 중입니다');
    else if (!r.cancelled) setMsg(r.error ?? '로그인하지 못했습니다');
  };
  const email1 = async () => {
    if (!/.+@.+\..+/.test(email.trim())) { setMsg('이메일 주소를 확인해 주세요'); return; }
    setBusy(true); setMsg('');
    const r = await sendEmailCode(email);
    setBusy(false);
    if (r.ok) { setMode('code'); setMsg('메일로 받은 6자리 코드를 넣어 주세요'); } else setMsg(r.error ?? '코드를 보내지 못했습니다');
  };
  const email2 = async () => {
    setBusy(true); setMsg('');
    const r = await verifyEmailCode(email, code);
    setBusy(false);
    if (r.ok) toast('로그인했습니다. 기록을 맞추는 중입니다'); else setMsg(r.error ?? '코드가 맞지 않습니다');
  };

  return (
    <View style={[{ marginTop: 8, padding: 20, borderRadius: R.lg, backgroundColor: t.surface, gap: 14 }, squircle]}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: t.fg, fontSize: 19, fontWeight: '600', letterSpacing: -0.3 }}>웹과 같은 기록으로 씁니다</Text>
        <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>로그인하면 이 기기 기록이 그대로 올라가고, 웹에서 체크한 것도 여기에 바로 보입니다.</Text>
      </View>
      {mode === 'google' ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void google()}
            style={({ pressed }) => [{ height: 50, borderRadius: 999, backgroundColor: t.fg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            {busy ? <ActivityIndicator color={t.onFg} /> : <GoogleMark />}
            <Text style={{ color: t.onFg, fontSize: 16, fontWeight: '600' }}>Google로 계속하기</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setMode('email'); setMsg(''); }} style={{ alignSelf: 'center', paddingVertical: 4 }}>
            <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>이메일 코드로 로그인</Text>
          </Pressable>
        </>
      ) : (
        <>
          {mode === 'email'
            ? <TextInput style={input} value={email} onChangeText={setEmail} placeholder="이메일" placeholderTextColor={t.muted} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" autoFocus onSubmitEditing={() => void email1()} />
            : <TextInput style={[input, { letterSpacing: 8, fontVariant: ['tabular-nums'] }]} value={code} onChangeText={(x) => setCode(x.replace(/\D/g, '').slice(0, 6))} placeholder="6자리 코드" placeholderTextColor={t.muted} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoFocus />}
          <Pressable
            accessibilityRole="button"
            disabled={busy || (mode === 'code' && code.length !== 6)}
            onPress={() => void (mode === 'email' ? email1() : email2())}
            style={({ pressed }) => [{ height: 50, borderRadius: 999, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center', opacity: busy || (mode === 'code' && code.length !== 6) ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
          >
            {busy ? <ActivityIndicator color={t.onFg} /> : <Text style={{ color: t.onFg, fontSize: 16, fontWeight: '600' }}>{mode === 'email' ? '코드 받기' : '로그인'}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setMode('google'); setMsg(''); setCode(''); }} style={{ alignSelf: 'center', paddingVertical: 4 }}>
            <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>Google로 로그인</Text>
          </Pressable>
        </>
      )}
      {!!msg && <Text style={{ color: t.fg2, fontSize: 13.5, lineHeight: 19, textAlign: 'center' }}>{msg}</Text>}
    </View>
  );
}

function Account({ t }: { t: Theme }) {
  const env = useEnv();
  const { user } = useAuthUser();
  if (!user) return null;
  const name = (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined);
  const initial = (name ?? user.email ?? '?').trim().charAt(0).toUpperCase();
  const pending = env.store.pendingCount();
  const st = env.store.syncState;
  const syncText = st === 'syncing' ? '맞추는 중' : st === 'synced' ? (pending ? `올릴 기록 ${pending}개` : '최신 상태') : st === 'offline' ? '오프라인' : st === 'error' ? '오류' : '연결 전';
  return (
    <Section title="계정" footer={st === 'offline' || st === 'error' ? `${env.store.lastError ?? ''} 연결되면 자동으로 다시 올립니다.`.trim() : '웹에서 같은 계정으로 로그인하면 기록이 서로 바로 맞춰집니다.'}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.onFg, fontSize: 17, fontWeight: '600' }}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: t.fg, fontSize: 16, fontWeight: '600' }}>{name ?? user.email ?? '로그인됨'}</Text>
          {name ? <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13.5 }}>{user.email}</Text> : null}
        </View>
      </View>
      <Row icon="refresh-cw" title="지금 맞추기" value={syncText} onPress={() => void env.store.refresh()} />
      <Row
        icon="log-out"
        title="로그아웃"
        onPress={() => Alert.alert('로그아웃할까요?', '이 기기 기록은 그대로 남습니다. 다시 로그인하면 이어서 맞춥니다.', [
          { text: '취소', style: 'cancel' },
          { text: '로그아웃', style: 'destructive', onPress: () => void signOut() },
        ])}
      />
    </Section>
  );
}

export default function SettingsScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, ready } = useAuthUser();
  const P = env.program;
  const version = Constants.expoConfig?.version ?? '';
  // which over-the-air update is running, so a fix can be confirmed on the phone ("업데이트 11월 16일 11:20")
  const at = Updates.isEmbeddedLaunch ? null : Updates.createdAt;
  const build = at ? `업데이트 ${at.getMonth() + 1}월 ${at.getDate()}일 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '설치한 그대로';
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
    >
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="checkmark" accessibilityLabel="완료" onPress={() => router.back()} />
      </Stack.Toolbar>
      {getSupabase() && ready && !user && <SignIn t={t} />}
      <Account t={t} />

      <HealthNotifySection />

      <ShortcutsSection />

      <Section title="내 프로그램" footer="숫자는 코치와 대화해서 바꿀 수 있습니다.">
        <Row title="시작일" value={mdw(parseKey(P.startDate))} />
        <Row title="기간" value={`${P.days}일`} />
        <Row title="시작 체중" value={`${P.startWeight.toFixed(1)}kg`} />
        <Row title="목표 체중" value={`${P.goalWeight.toFixed(1)}kg`} />
        <Row title="키" value={`${P.heightCm}cm`} />
        <Row title="하루 목표" value={`${fmt(P.baseKcal)}kcal`} />
        <Row title="단백질 최소" value={`${P.proteinFloor}g`} />
        <Row title="내 정보 다시 입력" sub="답을 고치면 식단, 운동, 장보기를 다시 짭니다" chevron onPress={() => router.push('/answers')} />
      </Section>

      <WeatherSection />

      <Section title="항상 지키는 것" inset={52}>
        {todayView(env).rules.map((k) => <Row key={k.title} icon={k.icon} title={k.title} sub={k.desc} />)}
      </Section>

      <View style={{ alignItems: 'center', marginTop: 32, gap: 4 }}>
        <Icon name="sun" size={16} color={t.muted} />
        <Text style={{ color: t.muted, fontSize: 12.5 }}>다루 {version} · {build}</Text>
      </View>
    </ScrollView>
  );
}
