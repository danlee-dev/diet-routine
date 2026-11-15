import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { clockText, keyOf, kmText, paceText, runKcal, type Split } from '@diet/core';
import { runsList, saveRun, weightFor } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/env';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, useToast } from '@/components/ui';
import { runSession, type RunKind, type RunSnapshot } from '@/lib/run/session';
import { cueFinish, setVoiceEnabled, voiceEnabled } from '@/lib/run/cues';
import { useRunClock, useRunSession, runWhen } from '@/lib/run/hooks';
import { RunMap } from '@/lib/run/RunMap';
import { HoldButton } from '@/lib/run/HoldButton';

const RECORDING_RED = '#FF3B30';

export default function RunScreen() {
  const s = useRunSession();
  useEffect(() => {
    if (s.phase === 'recording') return;
    void runSession.warmUp();
    return () => runSession.coolDown();
  }, [s.phase]);
  return s.phase === 'recording' ? <Recording s={s} /> : <BeforeStart s={s} />;
}

// ---------------- before the start ----------------
function BeforeStart({ s }: { s: RunSnapshot }) {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [kind, setKind] = useState<RunKind>(() => devicePref.get<RunKind>('run.kind', 'run'));
  const last = runsList(env)[0];
  const acc = s.gps?.acc ?? null;
  const gpsLine = s.permission === 'denied' ? '위치 권한이 없어 기록할 수 없습니다'
    : acc == null ? 'GPS 신호를 찾고 있습니다'
    : acc <= 12 ? `GPS ±${Math.round(acc)}m · 바로 시작할 수 있습니다`
    : acc <= 20 ? `GPS ±${Math.round(acc)}m · 조금 기다리면 더 정확해집니다`
    : `GPS ±${Math.round(acc)}m · 하늘이 트인 곳에서 시작하세요`;
  const pick = (k: RunKind) => { void Haptics.selectionAsync(); setKind(k); devicePref.set('run.kind', k); };
  const start = () => { void runSession.start(kind, env.newId()); };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <RunMap routes={[]} camera={{ kind: 'follow', point: s.gps?.point ?? null, zoom: 16 }} showsUser style={{ height: height * 0.6 }} />
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <RoundButton icon="x" label="닫기" onPress={() => router.back()} t={t} />
        <Pressable accessibilityRole="button" onPress={() => router.push('/run/history')} style={[{ height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: t.bg, flexDirection: 'row', alignItems: 'center', gap: 6 }, squircle]}>
          <Icon name="list" size={15} color={t.fg} weight="semibold" />
          <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }}>기록</Text>
        </Pressable>
      </View>

      <View style={[{ flex: 1, marginTop: -R.xl, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, backgroundColor: t.bg, paddingHorizontal: 24, paddingTop: 22, paddingBottom: insets.bottom + 16 }, squircle]}>
        <View style={[{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.surface, alignSelf: 'flex-start' }, squircle]}>
          {(['run', 'walk'] as const).map((k) => (
            <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: kind === k }} onPress={() => pick(k)}
              style={{ height: 34, paddingHorizontal: 18, borderRadius: 999, justifyContent: 'center', backgroundColor: kind === k ? t.fg : 'transparent' }}>
              <Text style={{ color: kind === k ? t.onFg : t.fg2, fontSize: 14.5, fontWeight: '600' }}>{k === 'run' ? '달리기' : '걷기'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600', marginTop: 18 }}>{gpsLine}</Text>
        {last
          ? <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 6 }}>지난 기록 · {runWhen(last)} · {kmText(last.distance_m)}km · {paceText(last.avg_pace_s_per_km)}</Text>
          : <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 6 }}>잠금 화면에서도 경로를 계속 기록합니다</Text>}

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
          {s.permission === 'denied'
            ? <Btn label="설정에서 위치 허용하기" onPress={() => void Linking.openSettings()} />
            : (
              <Pressable accessibilityRole="button" accessibilityLabel={`${kind === 'run' ? '달리기' : '걷기'} 시작`} onPress={start}
                style={({ pressed }) => ({ width: 104, height: 104, borderRadius: 52, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                <Text style={{ color: t.onFg, fontSize: 21, fontWeight: '700' }}>시작</Text>
              </Pressable>
            )}
        </View>
      </View>
    </View>
  );
}

// ---------------- recording ----------------
function Recording({ s }: { s: RunSnapshot }) {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const { height } = useWindowDimensions();
  const clock = useRunClock(s);
  const [voice, setVoice] = useState(voiceEnabled);
  const live = s.live;
  const weight = weightFor(env, keyOf(s.startedAt ? new Date(s.startedAt) : env.now()));
  const parts: Split[] = live ? [...live.splits, ...(live.partial ? [live.partial] : [])] : [];
  const kcal = runKcal(parts, weight);
  const lastSplit = live?.splits[live.splits.length - 1];
  const status = s.paused ? '일시정지' : live?.status === 'autoPaused' ? '멈춤 · 움직이면 다시 기록합니다' : s.kind === 'walk' ? '걷기 기록 중' : '달리기 기록 중';
  const weak = live?.accuracy != null && live.accuracy > 20;

  const finish = async () => {
    const res = await runSession.finish();
    if (!res) return;
    if (res.summary.distance_m < 50) {
      await runSession.forget();
      toast('50m보다 짧아서 저장하지 않았습니다');
      router.back();
      return;
    }
    const row = saveRun(env, res);
    await env.store.flush();
    await runSession.forget();
    cueFinish(kmText(row.distance_m));
    router.replace({ pathname: '/run/summary', params: { id: row.id, fresh: '1' } });
  };
  const toggleVoice = () => { const next = !voice; setVoice(next); setVoiceEnabled(next); void Haptics.selectionAsync(); };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <RunMap routes={live?.point && !s.paused && live.status === 'moving' && s.segments.length ? [...s.segments.slice(0, -1), [...s.segments[s.segments.length - 1]!, live.point]] : s.segments} camera={{ kind: 'follow', point: live?.point ?? null }} showsUser markEnds={false} style={{ height: height * 0.34 }} />
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={[{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: t.bg, flexDirection: 'row', alignItems: 'center', gap: 8 }, squircle]}>
          {!s.paused && live?.status !== 'autoPaused' && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: RECORDING_RED }} />}
          <Text style={{ color: t.fg, fontSize: 13.5, fontWeight: '600' }}>{status}{weak ? ' · GPS 약함' : ''}</Text>
        </View>
        <RoundButton icon={voice ? 'volume-2' : 'volume-x'} label={voice ? '음성 안내 끄기' : '음성 안내 켜기'} onPress={toggleVoice} t={t} />
      </View>

      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 18 }}>
        <Text accessibilityLabel={`${kmText(live?.distance ?? 0)}킬로미터`} numberOfLines={1} adjustsFontSizeToFit
          style={{ color: t.fg, fontSize: 116, fontWeight: '200', letterSpacing: -5, fontVariant: ['tabular-nums'], marginLeft: -4 }}>
          {kmText(live?.distance ?? 0)}
        </Text>
        <Text style={{ color: t.muted, fontSize: 14, fontWeight: '600', marginTop: -6 }}>킬로미터</Text>

        <View style={{ flexDirection: 'row', marginTop: 26 }}>
          <Stat t={t} label="시간" value={clockText(clock)} />
          <Stat t={t} label="현재 페이스" value={paceText(live?.currentPace)} />
          <Stat t={t} label="평균 페이스" value={paceText(live?.avgPace)} />
        </View>
        <View style={{ flexDirection: 'row', marginTop: 18 }}>
          <Stat t={t} label="칼로리" value={`${kcal}`} />
          <Stat t={t} label="오른 높이" value={`${live?.elevGain ?? 0}m`} />
          <Stat t={t} label="직전 1km" value={lastSplit ? paceText(lastSplit.pace) : `-'--"`} />
        </View>
        {s.error ? <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 12.5, marginTop: 14 }}>위치 기록을 시작하지 못했습니다: {s.error}</Text> : null}
      </View>

      <View style={{ paddingBottom: insets.bottom + 20, paddingTop: 8, alignItems: 'center' }}>
        {s.paused ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 44 }}>
            <HoldButton icon="stop" label="길게 눌러 끝내기" onComplete={() => void finish()} />
            <BigButton t={t} icon="play" label="다시 시작" onPress={() => runSession.resume()} />
          </View>
        ) : (
          <BigButton t={t} icon="pause" label="일시정지" onPress={() => runSession.pause()} />
        )}
      </View>
    </View>
  );
}

function Stat({ t, label, value }: { t: Theme; label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '500' }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: t.fg, fontSize: 28, fontWeight: '300', fontVariant: ['tabular-nums'], marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function BigButton({ t, icon, label, onPress }: { t: Theme; icon: string; label: string; onPress: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }}
        style={({ pressed }) => ({ width: 84, height: 84, borderRadius: 42, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
        <Icon name={icon} size={28} color={t.onFg} weight="semibold" />
      </Pressable>
      <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

function RoundButton({ icon, label, onPress, t }: { icon: string; label: string; onPress: () => void; t: Theme }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Icon name={icon} size={17} color={t.fg} weight="semibold" />
    </Pressable>
  );
}
