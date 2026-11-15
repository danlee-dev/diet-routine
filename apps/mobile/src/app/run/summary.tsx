import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clockText, estimateRunSteps, fastestSplit, fmt, keyOf, kmText, paceText, runKcalCredit, type Split } from '@diet/core';
import { deleteRun, runById, runCreditRatio, runDate, runSegments } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, useToast } from '@/components/ui';
import { RunMap } from '@/lib/run/RunMap';
import { runTitle, runWhen } from '@/lib/run/hooks';

export default function RunSummaryScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const run = id ? runById(env, id) : undefined;
  // fresh: the summary replaced the run screen, so back() closes the whole running modal; then show Today,
  // where the run's budget credit and steps are visible. (navigate('/') alone would stack the tabs over the modal.)
  const leave = () => {
    router.back();
    if (fresh) router.navigate('/');
  };

  if (!run) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Text style={{ color: t.muted, fontSize: 15 }}>이 기록을 찾을 수 없습니다</Text>
        <Btn label="돌아가기" kind="ghost" onPress={leave} />
      </View>
    );
  }

  const segments = runSegments(run);
  const splits = run.splits ?? [];
  const credit = runKcalCredit(run.kcal, runCreditRatio(env));
  const today = runDate(run) === keyOf(env.now());
  const steps = estimateRunSteps(splits, env.program.heightCm);
  const share = () => router.push({ pathname: '/run/share', params: { id: run.id } });
  const remove = () => {
    const undo = deleteRun(env, run.id);
    toast('기록을 지웠습니다', undo);
    leave();
  };

  const cells: { label: string; value: string }[] = [
    { label: '시간', value: clockText(run.moving_s) },
    { label: '평균 페이스', value: paceText(run.avg_pace_s_per_km) },
    { label: '활동 칼로리', value: `${fmt(Math.round(Number(run.kcal) || 0))}kcal` },
    { label: '걸음 (추정)', value: fmt(steps) },
  ];
  if (run.elev_gain_m != null) cells.push({ label: '오른 높이', value: `${Math.round(Number(run.elev_gain_m))}m` });
  if (run.new_distance_m != null) cells.push({ label: '처음 달린 길', value: `${kmText(Number(run.new_distance_m))}km` });
  if (run.elapsed_s - run.moving_s >= 60) cells.push({ label: '멈춘 시간', value: clockText(run.elapsed_s - run.moving_s) });

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: fresh ? () => (
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={leave} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={16} color={t.fg} weight="semibold" />
            </Pressable>
          ) : undefined,
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="공유하기" onPress={share} hitSlop={8} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="share" size={16} color={t.fg} weight="semibold" />
            </Pressable>
          ),
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <RunMap routes={segments} camera={{ kind: 'fit' }} style={{ height: 360 }} />

        <View style={{ paddingHorizontal: 24, paddingTop: 22 }}>
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>{runWhen(run)}</Text>
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '600', marginTop: 2 }}>{runTitle(run)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
            <Text style={{ color: t.fg, fontSize: 84, fontWeight: '200', letterSpacing: -4, fontVariant: ['tabular-nums'], marginLeft: -3 }}>{kmText(Number(run.distance_m))}</Text>
            <Text style={{ color: t.muted, fontSize: 17, fontWeight: '600' }}>km</Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 18, marginTop: 10 }}>
            {cells.map((c) => (
              <View key={c.label} style={{ width: '50%' }}>
                <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '500' }}>{c.label}</Text>
                <Text style={{ color: t.fg, fontSize: 26, fontWeight: '300', fontVariant: ['tabular-nums'], marginTop: 2 }}>{c.value}</Text>
              </View>
            ))}
          </View>

          {credit > 0 && (
            <View style={[{ marginTop: 26, padding: 16, borderRadius: R.md, backgroundColor: t.surface }, squircle]}>
              <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.fg, fontSize: 15, fontWeight: '600' }}>
                {today ? `오늘 먹을 수 있는 양이 ${fmt(credit)}kcal 늘었습니다` : `${runWhen(run).split(' · ')[0]} 식단에 ${fmt(credit)}kcal를 더했습니다`}
              </Text>
              <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 13, marginTop: 4, lineHeight: 18 }}>
                소모한 {fmt(Math.round(Number(run.kcal) || 0))}kcal의 {runCreditRatio(env) === 0.5 ? '절반' : `${Math.round(runCreditRatio(env) * 100)}%`}만 더하고, 나머지는 감량으로 남깁니다.
              </Text>
            </View>
          )}

          {splits.length > 0 && <Splits t={t} splits={splits} showElev={run.elev_gain_m != null} />}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 30 }}>
            <Btn label="이미지로 공유" icon="share" onPress={share} style={{ flex: 1 }} />
            {fresh ? <Btn label="완료" kind="ghost" onPress={leave} style={{ flex: 1 }} /> : null}
          </View>
          <Btn label="기록 지우기" kind="quiet" onPress={remove} style={{ marginTop: 10, alignSelf: 'center' }} small />
        </View>
      </ScrollView>
    </>
  );
}

/** km splits; the fastest stands out by weight and a full-strength bar, not by colour. */
function Splits({ t, splits, showElev }: { t: Theme; splits: Split[]; showElev: boolean }) {
  // "fastest" only means something with at least two full kilometres to compare
  const fast = splits.filter((x) => x.m >= 1000).length >= 2 ? fastestSplit(splits) : -1;
  const speeds = splits.map((s) => (s.pace > 0 ? 1 / s.pace : 0));
  const top = Math.max(...speeds, 1e-9);
  const best = splits[fast];
  return (
    <View style={{ marginTop: 32 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ color: t.fg, fontSize: 20, fontWeight: '600' }}>구간</Text>
        {best && <Text style={{ color: t.muted, fontSize: 13 }}>가장 빠른 구간 {best.km}km · {paceText(best.pace)}</Text>}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 12, marginBottom: 6 }}>
        <Text style={{ color: t.muted, fontSize: 12, width: 44 }}>km</Text>
        <Text style={{ color: t.muted, fontSize: 12, width: 66 }}>페이스</Text>
        <View style={{ flex: 1 }} />
        {showElev ? <Text style={{ color: t.muted, fontSize: 12, width: 48, textAlign: 'right' }}>높이</Text> : null}
      </View>
      {splits.map((s, i) => {
        const isFast = i === fast;
        return (
          <View key={s.km} accessibilityLabel={`${s.km}킬로미터 구간, 페이스 ${paceText(s.pace)}${isFast ? ', 가장 빠름' : ''}`}
            style={{ flexDirection: 'row', alignItems: 'center', height: 38 }}>
            <Text style={{ color: isFast ? t.fg : t.fg2, fontSize: 15, fontWeight: isFast ? '700' : '400', width: 44, fontVariant: ['tabular-nums'] }}>
              {s.m < 1000 ? (s.m / 1000).toFixed(2) : s.km}
            </Text>
            <Text style={{ color: isFast ? t.fg : t.fg2, fontSize: 15, fontWeight: isFast ? '700' : '400', width: 66, fontVariant: ['tabular-nums'] }}>{paceText(s.pace)}</Text>
            <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: t.surface, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(6, (speeds[i]! / top) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: isFast ? t.fg : t.ctrl }} />
            </View>
            {showElev ? <Text style={{ color: t.muted, fontSize: 13, width: 48, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{s.elev > 0 ? `+${s.elev}m` : '-'}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
