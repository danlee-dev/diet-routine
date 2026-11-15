// 운동 tab: start today's session in one tap, start a run, then this week's plan and the routines.
import { useEffect, useRef } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { amrapOf, fmt, hhmm, kmText, workoutRounds } from '@diet/core';
import { runsList, todayView, workoutOn, workoutPlan } from '@diet/data';
import { useEnv, useRefresh } from '@/lib/hooks';
import { useRunSession } from '@/lib/run/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn } from '@/components/ui';
import { SESSION_NAME, WorkoutPlan } from '@/components/WorkoutPlan';
import { onCoachFocus, takeCoachFocus } from '@/lib/coach';

export default function WorkoutTab() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const refresh = useRefresh();
  const run = useRunSession();
  const v = todayView(env);
  const wp = workoutPlan(env, v);
  const done = workoutOn(env, v.ctx.key);
  const lastRun = runsList(env)[0];
  const r = wp ? v.routines[wp.routine] : null;
  const min = r ? amrapOf(r) : null;
  const stepsPct = Math.min(1, v.day.steps / Math.max(1, v.stepsGoal));
  // 보기 from the coach (plan:workout:*): bring the weekly plan and routines into view
  const scroll = useRef<ScrollViewInstance | null>(null);
  useEffect(() => {
    const go = (target: string | null) => { if (target?.startsWith('plan:workout')) setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 350); };
    go(takeCoachFocus());
    return onCoachFocus(go);
  }, []);

  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1, backgroundColor: t.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={t.muted} />}
      contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }}
    >
      {/* today's session: one tap to start */}
      <View style={[{ padding: 20, borderRadius: R.xl, backgroundColor: t.surface, gap: 6 }, squircle]}>
        <Text style={{ color: t.fg2, fontSize: 12.5, fontWeight: '700' }}>오늘 · {SESSION_NAME[v.session]}{wp?.at != null ? ` · ${hhmm(wp.at)}쯤` : ''}</Text>
        {r ? (
          <>
            <Text style={{ color: t.fg, fontSize: 34, fontWeight: '300', letterSpacing: -1 }}>{r.name}</Text>
            <Text style={{ color: t.muted, fontSize: 13.5 }}>
              {r.focus} · {min ? `${min}분 동안 반복` : `${v.session === 'light' ? 3 : workoutRounds(v.ctx.week)}라운드`}
              {done ? ` · 오늘 ${done.rounds ? `${done.rounds}${min ? '바퀴' : '라운드'} ` : ''}완료` : ''}
            </Text>
            <Btn icon="play" label={done ? '한 번 더 하기' : '지금 시작'} style={{ marginTop: 12, height: 52 }} onPress={() => router.push({ pathname: '/workout', params: { routine: wp!.routine } })} />
          </>
        ) : (
          <>
            <Text style={{ color: t.fg, fontSize: 30, fontWeight: '300', letterSpacing: -0.8 }}>{v.session === 'walk' ? '걷는 날' : '쉬는 날'}</Text>
            <Text style={{ color: t.muted, fontSize: 13.5 }}>홈트는 쉬고 걸음 수만 채웁니다.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Btn kind="ghost" label="홈트 A 하기" onPress={() => router.push({ pathname: '/workout', params: { routine: 'A' } })} />
              <Btn kind="ghost" label="홈트 B 하기" onPress={() => router.push({ pathname: '/workout', params: { routine: 'B' } })} />
            </View>
          </>
        )}
      </View>

      {/* run and steps */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void Haptics.selectionAsync(); router.push('/run'); }}
          style={({ pressed }) => [{ flex: 1.3, minHeight: 112, padding: 16, gap: 8, borderRadius: R.lg, backgroundColor: t.fg, transform: [{ scale: pressed ? 0.97 : 1 }] }, squircle]}
        >
          <Icon name="figure-run" size={22} color={t.onFg} />
          <View>
            <Text style={{ color: t.onFg, fontSize: 16, fontWeight: '700' }}>{run.phase === 'recording' ? '달리기 기록 중' : '달리기 시작'}</Text>
            <Text style={{ color: t.onFg, opacity: 0.7, fontSize: 12.5, marginTop: 2 }}>
              {run.phase === 'recording' ? `${kmText(run.live?.distance ?? 0)}km · 화면으로` : lastRun ? `지난번 ${kmText(Number(lastRun.distance_m))}km` : 'GPS로 경로·페이스 기록'}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/sheet/steps')}
          style={({ pressed }) => [{ flex: 1, minHeight: 112, padding: 16, gap: 8, borderRadius: R.lg, backgroundColor: t.surface, transform: [{ scale: pressed ? 0.97 : 1 }] }, squircle]}
        >
          <Icon name="footprints" size={22} color={t.fg} />
          <View>
            <Text style={{ color: t.fg, fontSize: 20, fontVariant: ['tabular-nums'] }}>{fmt(v.day.steps)}</Text>
            <Text style={{ color: t.muted, fontSize: 12.5 }}>/ {fmt(v.stepsGoal)}보</Text>
            <View style={{ height: 3, borderRadius: 3, backgroundColor: t.surface2, marginTop: 6, overflow: 'hidden' }}>
              <View style={{ width: `${stepsPct * 100}%`, height: 3, backgroundColor: t.fg }} />
            </View>
          </View>
        </Pressable>
      </View>
      {runsList(env).length > 0 && (
        <View style={{ flexDirection: 'row', gap: 18, marginTop: 12, paddingHorizontal: 4 }}>
          <Pressable hitSlop={8} onPress={() => router.push('/run/history')}><Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }}>달리기 기록</Text></Pressable>
          <Pressable hitSlop={8} onPress={() => router.push('/run/map')}><Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }}>내가 달린 길</Text></Pressable>
        </View>
      )}

      {/* this week and the routines */}
      <Text style={{ color: t.fg, fontSize: 17, fontWeight: '600', marginTop: 30 }}>이번 주</Text>
      <WorkoutPlan t={t} />
    </ScrollView>
  );
}
