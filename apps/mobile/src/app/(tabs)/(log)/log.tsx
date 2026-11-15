import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { fmt, kmText } from '@diet/core';
import { runsList, setWater, skipMeal, todayView, toggleMeal, workoutPlan } from '@diet/data';
import { useEnv, useRefresh } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/ui';
import { useRunSession } from '@/lib/run/hooks';

// The "+" button: every quick log in one place. After logging, go back to Today.
export default function LogScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const refresh = useRefresh();
  const v = todayView(env);
  const wp = workoutPlan(env, v);
  const next = v.next;
  const back = () => router.navigate('/');
  const run = useRunSession();
  const lastRun = runsList(env)[0];
  const tiles: { id: string; icon: string; title: string; sub: string; primary?: boolean; run: () => void }[] = [];
  if (v.day.wake_min == null) tiles.push({ id: 'wake', icon: 'sunrise', title: '일어났어요', sub: '끼니 시간 맞추기', primary: true, run: () => router.push('/sheet/time') });
  if (next) {
    tiles.push({ id: 'ate', icon: 'check', title: `${next.name} 먹었어요`, sub: `${fmt(next.kcal)}kcal · 계획대로`, primary: v.day.wake_min != null, run: () => { const r = toggleMeal(env, v.ctx.key, next.key); if (r.added) toast(`${next.name} 먹음 표시`, r.undo); back(); } });
    tiles.push({ id: 'other', icon: 'utensils-crossed', title: '다르게 먹었어요', sub: '외식·배달·간식', run: () => router.push({ pathname: '/sheet/food', params: { slot: next.key } }) });
    tiles.push({ id: 'skip', icon: 'skip-forward', title: `${next.name} 건너뛰기`, sub: '0kcal로 남기고 대처법 보기', run: () => { const u = skipMeal(env, v.ctx.key, next.key); toast(`${next.name} 건너뜀`, u); back(); } });
  }
  tiles.push({ id: 'weight', icon: 'weight', title: '체중', sub: v.weight != null ? `${v.weight.toFixed(1)}kg 고치기` : '아침에 한 번', run: () => router.push({ pathname: '/sheet/weight', params: { i: String(v.ctx.idx) } }) });
  tiles.push({ id: 'water', icon: 'glass-water', title: '물 +1잔', sub: `지금 ${v.day.water_cups}/8잔`, run: () => { const b = v.day.water_cups; setWater(env, v.ctx.key, b + 1); toast(`물 ${Math.min(8, b + 1)}잔`, () => setWater(env, v.ctx.key, b)); } });
  tiles.push({ id: 'steps', icon: 'footprints', title: '걸음', sub: `${fmt(v.day.steps)} / ${fmt(v.stepsGoal)}보`, run: () => router.push('/sheet/steps') });
  tiles.push({ id: 'run', icon: 'figure-run', title: run.phase === 'recording' ? '달리기 기록 중' : '달리기', sub: run.phase === 'recording' ? `${kmText(run.live?.distance ?? 0)}km · 화면으로 돌아가기` : lastRun ? `지난번 ${kmText(Number(lastRun.distance_m))}km · 경로 기록` : 'GPS로 거리·페이스 기록', primary: run.phase === 'recording', run: () => router.push('/run') });
  if (wp) tiles.push({ id: 'wo', icon: 'play', title: `홈트 ${wp.routine} 시작`, sub: wp.done ? '오늘 완료 · 다시 하기' : '따라하기', run: () => router.push({ pathname: '/workout', params: { routine: wp.routine } }) });
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentInsetAdjustmentBehavior="automatic" refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={t.muted} />} contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}>
      <Text style={{ color: t.muted, fontSize: 13, marginBottom: 14 }}>{v.ctx.label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tiles.map((x) => (
          <Pressable
            key={x.id}
            onPress={() => { void Haptics.selectionAsync(); x.run(); }}
            style={({ pressed }) => [{ width: '48.8%', minHeight: 104, padding: 14, gap: 10, borderRadius: R.md, backgroundColor: x.primary ? t.fg : t.surface, transform: [{ scale: pressed ? 0.97 : 1 }] }, squircle]}
          >
            <Icon name={x.icon} size={22} color={x.primary ? t.onFg : t.fg} />
            <View>
              <Text style={{ color: x.primary ? t.onFg : t.fg, fontSize: 15, fontWeight: '700' }}>{x.title}</Text>
              <Text style={{ color: x.primary ? t.onFg : t.muted, opacity: x.primary ? 0.7 : 1, fontSize: 12.5, marginTop: 2 }}>{x.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
