// First screen of a fresh install. The splash orb lands in the corner as a low sun, then the headline, one line
// of what the app does, and two ways in: 시작하기 (onboarding, no account needed) or 이미 계정이 있습니다
// (Google / email code). After a sign-in it waits for the first pull: a profile arriving moves the user to
// Today through the root gate; no profile means onboarding.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, Text, TextInput, useWindowDimensions, View, type ViewInstance } from 'react-native';
import { router } from 'expo-router';
import Animated, { Easing, FadeIn, interpolate, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { profileState } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { getSupabase } from '@/lib/env';
import { sendEmailCode, signInWithGoogle, useAuthUser, verifyEmailCode } from '@/lib/auth';
import { R, squircle, useTheme } from '@/lib/theme';
import { Orb } from '@/components/ui';
import { Cta, TextButton } from './controls';
import { GoogleMark } from './GoogleMark';
import { ORB_TURN_DEG, splashHandoff, useSplashDone } from './handoff';
import { STEPS } from './answers';

type Mode = 'start' | 'signin' | 'email' | 'code' | 'pulling' | 'failed';
const PULL_TIMEOUT_MS = 20000;

/** Staggered rise for the blocks under the orb, started when the splash hands over. */
function Rise({ p, k, reduce, children }: { p: SharedValue<number>; k: number; reduce: boolean; children: ReactNode }) {
  const st = useAnimatedStyle(() => {
    const v = interpolate(p.value, [k * 0.14, k * 0.14 + 0.58], [0, 1], 'clamp');
    return { opacity: v, transform: [{ translateY: reduce ? 0 : 12 * (1 - v) }] };
  });
  return <Animated.View style={st}>{children}</Animated.View>;
}

export function Welcome() {
  'use no memo'; // reads the store's sync state on every store change
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const splashDone = useSplashDone();
  const { user } = useAuthUser();
  const [mode, setMode] = useState<Mode>('start');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const orbRef = useRef<ViewInstance | null>(null);
  const ORB = Math.round(Math.min(W * 0.8, 360));
  const small = H < 720;

  // the splash flies its orb here (see handoff.ts); ours stays hidden until it lands
  useEffect(() => () => splashHandoff.setTarget(null), []);
  const p = useSharedValue(splashHandoff.isDone() ? 1 : 0);
  useEffect(() => {
    // under Reduce Motion the blocks only fade (no rise), which is fine to keep
    if (splashDone) p.value = withTiming(1, { duration: reduce ? 300 : 900, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.Never });
  }, [splashDone, reduce, p]);

  // after a sign-in: wait for the store's first pull, then decide. A pulled profile flips the root gate and
  // this screen is replaced by Today; no profile means onboarding.
  useEffect(() => {
    if (mode !== 'pulling') return;
    const check = () => {
      const st = env.store.syncState;
      if (st === 'synced' && env.store.currentUserId) {
        if (profileState(env.store) === 'new') { setMode('start'); router.push('/onboarding'); }
      } else if (st === 'error' || st === 'offline') {
        setMsg(env.store.lastError ?? '');
        setMode('failed');
      }
    };
    const unsub = env.store.subscribe(check);
    const first = setTimeout(check, 0);
    const late = setTimeout(() => { setMsg('서버 응답이 늦습니다.'); setMode('failed'); }, PULL_TIMEOUT_MS);
    return () => { unsub(); clearTimeout(first); clearTimeout(late); };
  }, [mode, env]);

  const google = async () => {
    setBusy(true); setMsg('');
    const r = await signInWithGoogle();
    setBusy(false);
    if (r.ok) setMode('pulling');
    else if (!r.cancelled) setMsg(r.error ?? '로그인하지 못했습니다');
  };
  const sendCode = async () => {
    if (!/.+@.+\..+/.test(email.trim())) { setMsg('이메일 주소를 확인해 주세요'); return; }
    setBusy(true); setMsg('');
    const r = await sendEmailCode(email);
    setBusy(false);
    if (r.ok) { setMode('code'); setMsg('메일로 받은 6자리 코드를 넣으면 됩니다.'); } else setMsg(r.error ?? '코드를 보내지 못했습니다');
  };
  const verify = async () => {
    setBusy(true); setMsg('');
    const r = await verifyEmailCode(email, code);
    setBusy(false);
    if (r.ok) setMode('pulling'); else setMsg(r.error ?? '코드가 맞지 않습니다');
  };
  const to = (m: Mode) => { setMsg(''); setMode(m); };

  const input = [{ height: 54, borderRadius: R.md, backgroundColor: t.surface, paddingHorizontal: 18, color: t.fg, fontSize: 17 }, squircle];
  const heading = (s: string, sub?: string) => (
    <View style={{ gap: 6, marginBottom: 18 }}>
      <Text accessibilityRole="header" style={{ color: t.fg, fontSize: 22, fontWeight: '600', letterSpacing: -0.5 }}>{s}</Text>
      {sub ? <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 14.5, lineHeight: 21 }}>{sub}</Text> : null}
    </View>
  );
  const note = msg ? <Text lineBreakStrategyIOS="hangul-word" accessibilityLiveRegion="polite" style={{ color: t.fg2, fontSize: 13.5, lineHeight: 19, marginTop: 12, textAlign: 'center' }}>{msg}</Text> : null;

  let actions: ReactNode;
  if (mode === 'start') {
    actions = (
      <View>
        <Cta label="시작하기" wide onPress={() => router.push('/onboarding')} />
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          {user
            ? <Text style={{ color: t.muted, fontSize: 13.5, paddingVertical: 8 }}>{user.email ?? '계정'}으로 로그인되어 있습니다</Text>
            : getSupabase() ? <TextButton label="이미 계정이 있습니다" color={t.fg} onPress={() => to('signin')} /> : null}
        </View>
        <Text style={{ color: t.muted, fontSize: 12.5, textAlign: 'center', marginTop: small ? 6 : 14 }}>로그인하지 않아도 이 기기에서 바로 씁니다.</Text>
      </View>
    );
  } else if (mode === 'signin') {
    actions = (
      <View>
        {heading('기존 계정으로 로그인', '웹이나 다른 기기에서 쓰던 기록과 계획을 가져옵니다.')}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void google()}
          style={({ pressed }) => [{ height: 56, borderRadius: 999, backgroundColor: t.fg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          {busy ? <ActivityIndicator color={t.onFg} /> : <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}><GoogleMark size={16} /></View>}
          <Text style={{ color: t.onFg, fontSize: 17, fontWeight: '600' }}>Google로 계속하기</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => to('email')}
          style={({ pressed }) => [{ height: 56, borderRadius: 999, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', marginTop: 10, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '600' }}>이메일 코드로 로그인</Text>
        </Pressable>
        {note}
        <View style={{ alignItems: 'center', marginTop: 8 }}><TextButton label="돌아가기" onPress={() => to('start')} /></View>
      </View>
    );
  } else if (mode === 'email' || mode === 'code') {
    actions = (
      <View>
        {heading(mode === 'email' ? '이메일 코드로 로그인' : '6자리 코드', mode === 'email' ? '코드를 메일로 보냅니다. 비밀번호는 없습니다.' : email.trim())}
        {mode === 'email'
          ? <TextInput style={input} value={email} onChangeText={setEmail} placeholder="이메일" placeholderTextColor={t.muted} selectionColor={t.fg} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" autoFocus returnKeyType="send" onSubmitEditing={() => void sendCode()} />
          : <TextInput style={[input, { letterSpacing: 10, fontVariant: ['tabular-nums'], fontSize: 22 }]} value={code} onChangeText={(x) => setCode(x.replace(/\D/g, '').slice(0, 6))} placeholder="000000" placeholderTextColor={t.muted} selectionColor={t.fg} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" autoFocus />}
        <View style={{ marginTop: 12 }}>
          <Cta label={mode === 'email' ? '코드 받기' : '로그인'} icon={null} wide busy={busy} disabled={mode === 'code' && code.length !== 6} onPress={() => void (mode === 'email' ? sendCode() : verify())} />
        </View>
        {note}
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <TextButton label={mode === 'email' ? '돌아가기' : '다른 이메일로'} onPress={() => { setCode(''); to(mode === 'email' ? 'signin' : 'email'); }} />
        </View>
      </View>
    );
  } else if (mode === 'pulling') {
    actions = (
      <View>
        {heading('기록을 가져오는 중입니다', '계획이 있으면 바로 오늘 화면으로, 없으면 질문으로 넘어갑니다.')}
        <Cta label="가져오는 중" wide busy onPress={() => {}} />
      </View>
    );
  } else {
    actions = (
      <View>
        {heading('기록을 가져오지 못했습니다', msg || '연결을 확인하고 다시 시도해 주세요.')}
        <Cta label="다시 시도" icon={null} wide onPress={() => { setMsg(''); setMode('pulling'); void env.store.refresh(); }} />
        <View style={{ alignItems: 'center', marginTop: 8 }}><TextButton label="새로 시작하기" onPress={() => { to('start'); router.push('/onboarding'); }} /></View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: t.bg }}>
      {/* the orb: a low sun in the top corner, partly off the edge */}
      <View
        ref={orbRef}
        pointerEvents="none"
        onLayout={() => orbRef.current?.measureInWindow((x, y, w) => { if (w > 0) splashHandoff.setTarget({ x, y, size: w }); })}
        style={{ position: 'absolute', width: ORB, height: ORB, left: W - ORB * 0.74, top: insets.top - ORB * 0.2, opacity: splashDone ? 1 : 0 }}
      >
        <View style={{ width: ORB, height: ORB, transform: [{ rotate: `${ORB_TURN_DEG}deg` }] }}>
          <Orb size={ORB} />
        </View>
      </View>

      <View style={{ flex: 1, paddingTop: insets.top + 14, paddingHorizontal: 24, paddingBottom: insets.bottom + 12 }}>
        <Rise p={p} k={0} reduce={reduce}>
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 }}>감량 루틴</Text>
        </Rise>
        <View style={{ flex: 1 }} />
        <Rise p={p} k={1} reduce={reduce}>
          <Text lineBreakStrategyIOS="hangul-word" accessibilityRole="header" style={{ color: t.fg, fontSize: small ? 36 : 42, fontWeight: '300', letterSpacing: -1.4, lineHeight: small ? 43 : 50 }}>
            {'끼니와 운동,\n장볼 것까지\n정해 드립니다.'}
          </Text>
        </Rise>
        <Rise p={p} k={2} reduce={reduce}>
          <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 15.5, lineHeight: 23, marginTop: 14, marginBottom: small ? 22 : 34, maxWidth: 340 }}>
            질문 {STEPS.length}개에 답하면 하루 칼로리, 끼니별 식단, 쿠팡 장보기 목록이 바로 나옵니다.
          </Text>
        </Rise>
        <Rise p={p} k={3} reduce={reduce}>
          <Animated.View key={mode} entering={FadeIn.duration(220)}>{actions}</Animated.View>
        </Rise>
      </View>
    </KeyboardAvoidingView>
  );
}
