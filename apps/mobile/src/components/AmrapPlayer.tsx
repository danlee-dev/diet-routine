// Time-boxed workout: repeat the list until the timer runs out and count rounds (e.g. 풀업 5, 푸시업 10, 스쿼트 15
// for 20 minutes). One big button per finished round; the count is saved as the workout's rounds.
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { cueAmrapDone, cueAmrapMark, cueAmrapStart, cueCountdown, cueLap, pad, type RoutineKey } from '@diet/core';
import { completeWorkout, todayView, toggleMeal, workoutOn } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn, useToast } from './ui';
import { Icon } from './Icon';
import { VoiceToggle } from './VoiceToggle';
import { sayWorkout, stopWorkoutVoice, useWorkoutVoice } from '@/lib/workoutVoice';

type Phase = 'ready' | 'go' | 'paused' | 'done';
const mmss = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

export function AmrapPlayer({ routine, minutes }: { routine: RoutineKey; minutes: number }) {
  useKeepAwake();
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const v = todayView(env);
  const r = v.routines[routine];
  const total = minutes * 60;
  const [phase, setPhase] = useState<Phase>('ready');
  const [left, setLeft] = useState(total);
  const [rounds, setRounds] = useState(0);
  const endAt = useRef(0);
  const started = useRef<Date | null>(null);
  const roundsRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // last time's rounds for this routine, shown as the number to beat
  const [best] = useState(() => workoutOn(env, v.ctx.key)?.rounds ?? null);

  const voice = useWorkoutVoice();

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => () => { stop(); stopWorkoutVoice(); }, []);
  // minute marks (every 5, then each of the last 3, 30 s) and 3-2-1 while the clock runs
  useEffect(() => {
    if (phase === 'go') sayWorkout(cueAmrapMark(left, total) ?? cueCountdown(left), true);
  }, [phase, left, total]);

  const finish = () => {
    stop();
    sayWorkout(cueAmrapDone(roundsRef.current), true);
    setPhase('done');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    completeWorkout(env, v.ctx.key, routine, { rounds: roundsRef.current, startedAt: started.current ?? new Date(), endedAt: new Date() });
  };
  const tick = () => {
    const l = Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000));
    setLeft(l);
    if (l === 60) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (l <= 3 && l > 0) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (l <= 0) finish();
  };
  const go = (secs: number) => {
    endAt.current = Date.now() + secs * 1000;
    stop();
    timer.current = setInterval(tick, 250);
    setPhase('go');
  };
  const lap = () => {
    roundsRef.current += 1;
    setRounds(roundsRef.current);
    sayWorkout(cueLap(roundsRef.current), true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const elapsed = total - left;
  const pace = rounds > 0 ? Math.round(elapsed / rounds) : null;
  const postDone = v.eaten.has('post');

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, paddingHorizontal: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: t.fg, fontWeight: '700', fontSize: 15 }}>{r.name} · {minutes}분 동안 반복</Text>
        <VoiceToggle on={voice.on} onToggle={voice.toggle} />
        <Pressable accessibilityLabel="닫기" onPress={() => { if (phase === 'go' || phase === 'paused') finish(); router.back(); }} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={15} color={t.fg} weight="semibold" />
        </Pressable>
      </View>

      <View style={{ flex: 1, justifyContent: 'center', gap: 18 }}>
        {phase !== 'done' ? (
          <>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: phase === 'paused' ? t.muted : t.fg, fontSize: 96, fontWeight: '200', letterSpacing: -3, fontVariant: ['tabular-nums'] }}>{mmss(left)}</Text>
              <Text style={{ color: t.muted, fontSize: 14 }}>
                {phase === 'ready' ? (best != null ? `오늘 이미 ${best}바퀴 했습니다` : '시작하면 시간이 줄어듭니다') : `${rounds}바퀴${pace ? ` · 한 바퀴 ${Math.floor(pace / 60)}분 ${pace % 60}초` : ''}`}
              </Text>
            </View>
            <View style={[{ padding: 18, borderRadius: R.lg, backgroundColor: t.surface, gap: 10 }, squircle]}>
              {r.items.map((x) => (
                <View key={x.name} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: t.fg, fontSize: 20 }}>{x.name}</Text>
                  <Text style={{ color: t.fg, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{x.n}{x.unit}</Text>
                </View>
              ))}
            </View>
            {phase !== 'ready' && (
              <Text style={{ color: t.fg, fontSize: 64, fontWeight: '200', textAlign: 'center', fontVariant: ['tabular-nums'] }}>{rounds}<Text style={{ fontSize: 20, color: t.muted }}> 바퀴</Text></Text>
            )}
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Text style={{ color: t.muted, fontSize: 13 }}>{minutes}분 끝</Text>
            <Text style={{ color: t.fg, fontSize: 72, fontWeight: '200', fontVariant: ['tabular-nums'] }}>{rounds}<Text style={{ fontSize: 22, color: t.muted }}> 바퀴</Text></Text>
            <Text style={{ color: t.muted, fontSize: 14, textAlign: 'center' }}>
              {r.items.map((x) => `${x.name} ${x.n * rounds}${x.unit}`).join(' · ')}{'\n'}다음에는 {rounds + 1}바퀴가 목표입니다.{postDone ? '' : ' 이제 프로틴을 마실 차례입니다.'}
            </Text>
          </View>
        )}
      </View>

      <View style={{ gap: 10 }}>
        {phase === 'ready' && <Btn icon="play" label={`${minutes}분 시작`} style={{ height: 56 }} onPress={() => { started.current = new Date(); sayWorkout(cueAmrapStart(minutes, r.items)); go(total); }} />}
        {phase === 'go' && (
          <>
            <Btn icon="check" label="한 바퀴 끝" style={{ height: 64 }} onPress={lap} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn kind="ghost" label="잠깐 멈춤" style={{ flex: 1 }} onPress={() => { stop(); setPhase('paused'); }} />
              <Btn kind="ghost" label="여기서 끝내기" style={{ flex: 1 }} onPress={finish} />
            </View>
          </>
        )}
        {phase === 'paused' && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn icon="play" label="계속" style={{ flex: 1.4, height: 56 }} onPress={() => go(left)} />
            <Btn kind="ghost" label="여기서 끝내기" style={{ flex: 1, height: 56 }} onPress={finish} />
          </View>
        )}
        {phase === 'done' && (postDone
          ? <Btn label="닫기" style={{ height: 56 }} onPress={() => router.back()} />
          : <>
              <Btn icon="check" label="프로틴 먹음 표시하고 닫기" style={{ height: 56 }} onPress={() => { const x = toggleMeal(env, v.ctx.key, 'post'); router.back(); if (x.added) toast('운동 후 먹음 표시', x.undo); }} />
              <Btn kind="ghost" label="그냥 닫기" onPress={() => router.back()} />
            </>)}
      </View>
    </View>
  );
}
