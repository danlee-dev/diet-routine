import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { amrapOf, cueCountdown, cueDone, cueHoldEnd, cueHoldStart, cueMove, cueRest, cueRoundGo, repMultiplier, workoutRounds, type RoutineKey } from '@diet/core';
import { completeWorkout, todayView, toggleMeal } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { Btn, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { AmrapPlayer } from '@/components/AmrapPlayer';
import { VoiceToggle } from '@/components/VoiceToggle';
import { sayWorkout, stopWorkoutVoice, useWorkoutVoice } from '@/lib/workoutVoice';

type Phase = 'work' | 'hold' | 'rest' | 'done';
const C = 2 * Math.PI * 104;

// Fixed rounds with rest, or a time-boxed repeat when the routine has minutes set.
export default function WorkoutScreen() {
  const env = useEnv();
  const params = useLocalSearchParams<{ routine?: string }>();
  const key: RoutineKey = params.routine === 'B' ? 'B' : 'A';
  const min = amrapOf(todayView(env).routines[key]);
  return min ? <AmrapPlayer routine={key} minutes={min} /> : <RoundsPlayer />;
}

function RoundsPlayer() {
  useKeepAwake();
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const params = useLocalSearchParams<{ routine?: string }>();
  const key: RoutineKey = params.routine === 'B' ? 'B' : 'A';
  const v = todayView(env);
  const [rounds] = useState(() => (v.session === 'light' ? 3 : workoutRounds(v.ctx.week)));
  const [round, setRound] = useState(1);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('work');
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(0);
  const end = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef<Date | null>(null);
  useEffect(() => { started.current = new Date(); }, []);
  const onDone = useRef<() => void>(() => {});
  const mult = repMultiplier(v.ctx.week);
  const items = v.routines[key].items.map((x) => ({ ...x, n: Math.round(x.n * mult) }));
  const cur = items[idx]!;
  const voice = useWorkoutVoice();

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => () => { stop(); stopWorkoutVoice(); }, []);
  // spoken cues: the move and reps when it comes up (the round on its first move), 3-2-1 at the end of holds and rests
  const lastMove = useRef('');
  useEffect(() => {
    if (phase !== 'work' || lastMove.current === `${round}:${idx}`) return;
    lastMove.current = `${round}:${idx}`;
    sayWorkout(cueMove(cur, { idx, total: items.length, round, rounds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, round]);
  useEffect(() => {
    if (phase === 'hold' || phase === 'rest') sayWorkout(cueCountdown(left), true);
  }, [phase, left]);
  const buzz = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const run = useCallback((secs: number, done: () => void) => {
    if (timer.current) clearInterval(timer.current);
    setLeft(secs); setTotal(secs); end.current = Date.now() + secs * 1000; onDone.current = done;
    timer.current = setInterval(() => {
      const l = Math.max(0, Math.ceil((end.current - Date.now()) / 1000));
      setLeft(l);
      if (l <= 3 && l > 0) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (l <= 0) { if (timer.current) clearInterval(timer.current); timer.current = null; onDone.current(); }
    }, 250);
  }, []);
  const next = () => {
    stop();
    if (idx < items.length - 1) { setIdx(idx + 1); setPhase('work'); }
    else if (round < rounds) { setPhase('rest'); sayWorkout(cueRest(60, items[0])); run(60, () => { sayWorkout(cueRoundGo); setRound((r) => r + 1); setIdx(0); setPhase('work'); buzz(); }); }
    else { setPhase('done'); completeWorkout(env, v.ctx.key, key, { rounds, startedAt: started.current ?? new Date(), endedAt: new Date() }); sayWorkout(cueDone(rounds)); buzz(); }
  };
  const ring = (
    <Svg width={220} height={220} viewBox="0 0 240 240">
      <Circle cx="120" cy="120" r="104" stroke={t.surface2} strokeWidth={10} fill="none" />
      <Circle cx="120" cy="120" r="104" stroke={t.fg} strokeWidth={10} fill="none" strokeLinecap="round" strokeDasharray={`${C}`} strokeDashoffset={C * (1 - (total ? left / total : 0))} transform="rotate(-90 120 120)" />
    </Svg>
  );
  const steps = (
    <View style={{ flexDirection: 'row', gap: 5, width: 300 }}>
      {items.map((_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: i < idx || (i === idx && phase !== 'work') ? t.fg : t.surface2 }} />)}
    </View>
  );
  const nx = items[idx + 1] ?? (round < rounds ? { name: '쉬는 시간 60초', n: 0, unit: '' } : { name: '마지막 동작입니다', n: 0, unit: '' });
  const postDone = v.eaten.has('post');

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, paddingHorizontal: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: t.fg, fontWeight: '700', fontSize: 15 }}>{v.routines[key].name} · {phase === 'done' ? '완료' : `라운드 ${round}/${rounds}`}</Text>
        <VoiceToggle on={voice.on} onToggle={voice.toggle} />
        <Pressable accessibilityLabel="닫기" onPress={() => router.back()} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={15} color={t.fg} weight="semibold" />
        </Pressable>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {phase === 'work' && <>
          {steps}
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 14 }}>{idx + 1} / {items.length}</Text>
          <Text style={{ color: t.fg, fontSize: 44, fontWeight: '300', letterSpacing: -1 }}>{cur.name}</Text>
          <Text style={{ color: t.fg, fontSize: 110, fontWeight: '200', letterSpacing: -4, fontVariant: ['tabular-nums'] }}>{cur.n}<Text style={{ fontSize: 22, color: t.muted }}> {cur.unit}</Text></Text>
          <Text style={{ color: t.muted, fontSize: 14 }}>다음: {nx.name}{nx.n ? ` ${nx.n}${nx.unit}` : ''}</Text>
        </>}
        {phase === 'hold' && <>{steps}<Text style={{ color: t.fg, fontSize: 32, fontWeight: '300' }}>{cur.name}</Text>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>{ring}<Text style={{ position: 'absolute', color: t.fg, fontSize: 60, fontWeight: '200', fontVariant: ['tabular-nums'] }}>{left}</Text></View>
          <Text style={{ color: t.muted, fontSize: 14 }}>자세를 유지합니다</Text></>}
        {phase === 'rest' && <><Text style={{ color: t.muted, fontSize: 13 }}>쉬는 시간</Text>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>{ring}<Text style={{ position: 'absolute', color: t.fg, fontSize: 60, fontWeight: '200', fontVariant: ['tabular-nums'] }}>{left}</Text></View>
          <Text style={{ color: t.muted, fontSize: 14 }}>다음 라운드: {items[0]!.name} {items[0]!.n}{items[0]!.unit}</Text></>}
        {phase === 'done' && <><Text style={{ color: t.muted, fontSize: 13 }}>오늘 홈트 끝</Text>
          <Text style={{ color: t.fg, fontSize: 44, fontWeight: '300' }}>잘했습니다</Text>
          <Text style={{ color: t.muted, fontSize: 14, textAlign: 'center' }}>{v.routines[key].name} {rounds}라운드를 마쳤습니다.{postDone ? '' : ' 이제 프로틴 + 우유를 마실 차례입니다.'}</Text></>}
      </View>
      <View style={{ gap: 10 }}>
        {phase === 'work' && (cur.unit === '초'
          ? <><Btn icon="timer" label={`${cur.n}초 타이머 시작`} style={{ height: 56 }} onPress={() => { setPhase('hold'); sayWorkout(cueHoldStart(cur), true); run(cur.n, () => { buzz(); sayWorkout(cueHoldEnd); next(); }); }} /><Btn kind="ghost" label="타이머 없이 완료" onPress={next} /></>
          : <Btn icon="check" label={`${cur.n}${cur.unit.replace(' (양쪽)', '')} 했어요`} style={{ height: 56 }} onPress={next} />)}
        {phase === 'hold' && <Btn icon="check" label="끝났어요" style={{ height: 56 }} onPress={next} />}
        {phase === 'rest' && <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
          <Btn kind="ghost" label="+15초" onPress={() => { end.current += 15000; setLeft((l) => l + 15); setTotal((x) => x + 15); }} />
          <Btn icon="skip-forward" label="바로 시작" onPress={() => { stop(); stopWorkoutVoice(); setRound((r) => r + 1); setIdx(0); setPhase('work'); }} />
        </View>}
        {phase === 'done' && (postDone
          ? <Btn label="닫기" style={{ height: 56 }} onPress={() => router.back()} />
          : <><Btn icon="check" label="프로틴 먹음 표시하고 닫기" style={{ height: 56 }} onPress={() => { const r = toggleMeal(env, v.ctx.key, 'post'); router.back(); if (r.added) toast('운동 후 먹음 표시', r.undo); }} /><Btn kind="ghost" label="그냥 닫기" onPress={() => router.back()} /></>)}
      </View>
    </View>
  );
}
