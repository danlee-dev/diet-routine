import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { addDays, bandFor, DOW, md, parseKey, programDate, weekGoalText } from '@diet/core';
import { dayRecord, streaks, todayView, weightData } from '@diet/data';
import { useEnv, useRefresh } from '@/lib/hooks';
import { useTheme, type Theme } from '@/lib/theme';
import { Btn } from '@/components/ui';

/** One day of the 30-day calendar: a ring that fills with the meals eaten (of 5). Today is a solid disc. */
function DayRing({ label, pct, today, future, t }: { label: string; pct: number; today: boolean; future: boolean; t: Theme }) {
  const size = 36, sw = 3, r = (size - sw) / 2, c = 2 * Math.PI * r, mid = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {today
          ? <Circle cx={mid} cy={mid} r={mid} fill={t.fg} />
          : (
            <>
              <Circle cx={mid} cy={mid} r={r} stroke={t.surface2} strokeWidth={sw} fill="none" opacity={future ? 0.5 : 1} />
              {pct > 0 && <Circle cx={mid} cy={mid} r={r} stroke={t.fg} strokeWidth={sw} fill="none" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} />}
            </>
          )}
      </Svg>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: today ? t.onFg : future ? t.muted : t.fg, fontVariant: ['tabular-nums'] }}>{label}</Text>
    </View>
  );
}

export default function RecordsScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const refresh = useRefresh();
  const v = todayView(env);
  const P = env.program;
  const { series, avg, stats } = weightData(env, v.ctx.idx);
  const st = streaks(env, v.ctx.idx);
  const goal = weekGoalText(P, v.ctx.week);
  const TARGET_BAND = bandFor(P);

  // chart
  const W = 340, H = 180, pl = 26, pr = 6, pt = 8, pb = 22, xmax = P.days - 1;
  let ymin = 69, ymax = 77;
  for (const p of series) { ymin = Math.min(ymin, Math.floor(p.w - 0.5)); ymax = Math.max(ymax, Math.ceil(p.w + 0.5)); }
  const x = (i: number) => pl + ((W - pl - pr) * i) / xmax;
  const y = (w: number) => pt + ((H - pt - pb) * (ymax - w)) / (ymax - ymin);
  const pts = (a: [number, number][]) => a.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
  const band = `M${pts(TARGET_BAND.upper).join(' L')} L${pts([...TARGET_BAND.lower].reverse()).join(' L')} Z`;
  const grid: number[] = [];
  for (let w = Math.ceil(ymin); w <= ymax; w++) if (w % 2 === 0) grid.push(w);

  const last = stats.last;
  const fromStart = last != null ? last - P.startWeight : null;
  const endLabel = md(addDays(parseKey(P.startDate), P.days - 1));
  const delta = fromStart == null
    ? `이번 주 목표 ${goal}`
    : `${fromStart <= 0 ? '시작보다 ' + Math.abs(fromStart).toFixed(1) + 'kg 줄었습니다' : '시작보다 ' + fromStart.toFixed(1) + 'kg 많습니다'}${stats.projection != null ? ` · ${endLabel} 예상 ${stats.projection.toFixed(1)}kg` : ''}`;
  const lead = parseKey(P.startDate).getDay();
  const stat = (n: string, unit: string, label: string) => (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: t.fg, fontSize: 24, fontWeight: '300', fontVariant: ['tabular-nums'] }}>{n}<Text style={{ fontSize: 14, color: t.muted }}> {unit}</Text></Text>
      <Text style={{ color: t.muted, fontSize: 12.5 }}>{label}</Text>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={t.muted} />}
      contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        <Text style={{ color: last != null ? t.fg : t.muted, fontSize: 60, fontWeight: '200', letterSpacing: -2, fontVariant: ['tabular-nums'] }}>{(last ?? P.startWeight).toFixed(1)}</Text>
        <Text style={{ color: t.muted, fontSize: 18, marginBottom: 12 }}>kg</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 14, marginTop: -2 }}>{last != null ? delta : '시작 체중입니다. 아침 체중을 넣으면 추이와 예상이 나옵니다.'}</Text>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 20 }}>
        <Path d={band} fill={t.surface} />
        {grid.map((w) => <Line key={w} x1={pl} x2={W - pr} y1={y(w)} y2={y(w)} stroke={t.line} strokeWidth={0.75} />)}
        {grid.map((w) => <SvgText key={`l${w}`} x={pl - 6} y={y(w) + 3.5} fontSize={10} fill={t.muted} textAnchor="end">{w}</SvgText>)}
        {[0, 7, 14, 21, 28].map((i) => <SvgText key={i} x={x(i)} y={H - 5} fontSize={10} fill={t.muted} textAnchor="middle">{md(programDate(P, i))}</SvgText>)}
        {v.ctx.idx >= 0 && v.ctx.idx <= xmax && <Line x1={x(v.ctx.idx)} x2={x(v.ctx.idx)} y1={pt} y2={H - pb} stroke={t.ctrl} strokeDasharray="2 4" />}
        {avg.length > 1 && <Path d={`M${avg.map((p) => `${x(p.i)},${y(p.w)}`).join(' L')}`} stroke={t.muted} strokeWidth={1.5} strokeDasharray="4 5" fill="none" />}
        {series.length > 0 && <Path d={`M${series.map((p) => `${x(p.i)},${y(p.w)}`).join(' L')}`} stroke={t.fg} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
        {series.map((p) => <Circle key={p.i} cx={x(p.i)} cy={y(p.w)} r={3.5} fill={t.fg} />)}
      </Svg>
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>회색 띠는 주차별 목표 범위, 점선은 5일 평균입니다.</Text>

      <Btn
        kind={v.weight != null ? 'ghost' : 'primary'}
        icon="weight"
        label={v.weight != null ? `오늘 ${v.weight.toFixed(1)}kg · 고치기` : '오늘 아침 체중 기록'}
        style={{ marginTop: 16 }}
        onPress={() => router.push({ pathname: '/sheet/weight', params: { i: String(v.ctx.idx) } })}
      />

      <View style={{ flexDirection: 'row', marginTop: 32 }}>
        {stat(String(st.streak), '일', '식단 연속')}
        {stat(String(st.workouts), '회', '홈트')}
        {stat(String(Math.max(0, P.days - v.ctx.no)), '일', '남은 기간')}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 36, marginBottom: 10 }}>
        <Text style={{ color: t.fg, fontSize: 17, fontWeight: '600' }}>30일</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{md(parseKey(P.startDate))} – {endLabel}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {DOW.map((d) => <Text key={d} style={{ width: `${100 / 7}%`, textAlign: 'center', color: t.muted, fontSize: 11.5, marginBottom: 6 }}>{d}</Text>)}
        {Array.from({ length: lead }, (_, b) => <View key={`b${b}`} style={{ width: `${100 / 7}%` }} />)}
        {Array.from({ length: P.days }, (_, i) => {
          const rec = dayRecord(env, i);
          const fut = i > v.ctx.idx;
          return (
            <Pressable
              key={i}
              disabled={fut}
              accessibilityLabel={`${md(rec.date)} · 끼니 ${rec.meals}개${rec.weight != null ? ` · ${rec.weight.toFixed(1)}kg` : ''}`}
              onPress={() => router.push({ pathname: '/sheet/weight', params: { i: String(i) } })}
              style={({ pressed }) => ({ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
            >
              <DayRing t={t} label={String(rec.date.getDate())} pct={Math.min(1, rec.meals / 5)} today={i === v.ctx.idx} future={fut} />
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 }}>고리는 그날 먹은 끼니 수입니다. 날짜를 누르면 그날 체중을 고칩니다.</Text>
    </ScrollView>
  );
}
