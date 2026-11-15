import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmt, kmText } from '@diet/core';
import { runSegments, runsList, runTotals } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn } from '@/components/ui';
import { RunMap } from '@/lib/run/RunMap';

// "내가 달린 길": every route on one map, the real lines rather than a grid of claimed tiles.
export default function RunTerritoryScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const runs = runsList(env);
  const routes = runs.flatMap(runSegments).filter((r) => r.length > 1);
  const total = runTotals(runs);
  const days = new Set(runs.map((r) => new Date(r.started_at).toDateString())).size;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <RunMap routes={routes} camera={{ kind: 'fit' }} lineWidth={4} markEnds={false} bottomCover={0.36} style={{ flex: 1 }} />
      <View style={[{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 12, padding: 20, borderRadius: R.xl, backgroundColor: t.bg }, squircle]}>
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>내가 달린 길</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ color: t.fg, fontSize: 56, fontWeight: '200', letterSpacing: -3, fontVariant: ['tabular-nums'], marginLeft: -2 }}>{kmText(total.distance_m)}</Text>
          <Text style={{ color: t.muted, fontSize: 15, fontWeight: '600' }}>km</Text>
        </View>
        <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.fg2, fontSize: 14, lineHeight: 20 }}>
          {days}일 동안 {total.count}번 달렸습니다 · 처음 달린 길 {kmText(total.new_m)}km{total.area_m2 > 0 ? ` · 한 바퀴로 둘러싼 땅 ${total.area_m2 >= 100_000 ? `${(total.area_m2 / 1_000_000).toFixed(2)}km²` : `${fmt(Math.round(total.area_m2))}m²`}` : ''}
        </Text>
        <Btn label="이미지로 공유" icon="share" onPress={() => router.push({ pathname: '/run/share', params: { scope: 'all' } })} style={{ marginTop: 16 }} />
      </View>
    </View>
  );
}
