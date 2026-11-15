import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clockText, fmt, kmText, paceText } from '@diet/core';
import { runSegments, runsList, runTotals } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn } from '@/components/ui';
import { RouteArt } from '@/lib/run/RouteArt';
import { durationWords, runTitle, runWhen } from '@/lib/run/hooks';

export default function RunHistoryScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const runs = runsList(env);
  const total = runTotals(runs);
  const routes = runs.flatMap(runSegments).filter((r) => r.length > 1);

  // group by month, newest first
  const months: { key: string; label: string; items: typeof runs }[] = [];
  for (const r of runs) {
    const d = new Date(r.started_at);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let g = months[months.length - 1];
    if (!g || g.key !== key) { g = { key, label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`, items: [] }; months.push(g); }
    g.items.push(r);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
      {runs.length === 0 ? (
        <View style={{ paddingTop: 40, gap: 14, alignItems: 'flex-start' }}>
          <Text style={{ color: t.fg, fontSize: 22, fontWeight: '300' }}>아직 기록한 달리기가 없습니다</Text>
          <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>달린 길은 모두 여기에 쌓이고, 한 지도에 겹쳐서 볼 수 있습니다.</Text>
          <Btn label="첫 달리기 시작하기" onPress={() => router.back()} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <Text style={{ color: t.fg, fontSize: 64, fontWeight: '200', letterSpacing: -3, fontVariant: ['tabular-nums'], marginLeft: -2 }}>{kmText(total.distance_m)}</Text>
            <Text style={{ color: t.muted, fontSize: 16, fontWeight: '600' }}>km</Text>
          </View>
          <Text style={{ color: t.muted, fontSize: 14 }}>{total.count}번 · {durationWords(total.moving_s)} · {fmt(Math.round(total.kcal))}kcal</Text>

          <Pressable accessibilityRole="button" onPress={() => router.push('/run/map')}
            style={({ pressed }) => [{ marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: R.xl, backgroundColor: t.surface, transform: [{ scale: pressed ? 0.98 : 1 }] }, squircle]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: t.fg, fontSize: 19, fontWeight: '600' }}>내가 달린 길</Text>
              <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>달린 길을 모두 한 지도에 겹쳐 봅니다</Text>
              <Text style={{ color: t.fg2, fontSize: 13.5, fontWeight: '600', marginTop: 6 }}>처음 달린 길 {kmText(total.new_m)}km</Text>
            </View>
            <RouteArt routes={routes} width={112} height={112} color={t.fg} strokeWidth={2} pad={4} opacity={0.9} />
          </Pressable>

          {months.map((g) => (
            <View key={g.key} style={{ marginTop: 30 }}>
              <Text style={{ color: t.fg, fontSize: 20, fontWeight: '600', marginBottom: 8 }}>{g.label}</Text>
              {g.items.map((r) => {
                const segs = runSegments(r);
                return (
                  <Pressable key={r.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/run/summary', params: { id: r.id } })}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
                    <View style={[{ width: 56, height: 56, borderRadius: R.sm, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }, squircle]}>
                      {segs.length ? <RouteArt routes={segs} width={56} height={56} color={t.fg} strokeWidth={2.2} pad={6} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '600' }}>{runTitle(r)}</Text>
                      <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{runWhen(r)}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: t.fg, fontSize: 19, fontWeight: '400', fontVariant: ['tabular-nums'] }}>{kmText(Number(r.distance_m))}<Text style={{ color: t.muted, fontSize: 13 }}> km</Text></Text>
                      <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 2, fontVariant: ['tabular-nums'] }}>{paceText(r.avg_pace_s_per_km)} · {clockText(r.moving_s)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
