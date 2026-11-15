// get_trends answer drawn as a card in the coach chat: kept days, intake, workouts and runs, and the weight
// trend line. Every number is from the block (summarizeTrends in core); this only draws.
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { fmt } from '@diet/core';
import type { TrendBlock } from '@diet/core/coach';
import { R, squircle, useTheme } from '@/lib/theme';

const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

function Spark({ points }: { points: TrendBlock['weight']['points'] }) {
  const t = useTheme();
  const W = 300, H = 46, PAD = 5;
  const vals = points.flatMap((p) => [p.trend, p.kg]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(0.6, hi - lo);
  const mid = (lo + hi) / 2;
  const x = (i: number) => (points.length > 1 ? PAD + (i * (W - PAD * 2)) / (points.length - 1) : W / 2);
  const y = (v: number) => H / 2 - ((v - mid) / span) * (H - PAD * 2);
  const line = points.flatMap((p, i) => (p.trend != null ? [`${x(i).toFixed(1)},${y(p.trend).toFixed(1)}`] : []));
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" accessibilityLabel="체중 추세">
      <Line x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} stroke={t.line} strokeWidth={1} />
      {line.length > 1 && <Polyline points={line.join(' ')} fill="none" stroke={t.fg} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
      {points.map((p, i) => (p.kg != null ? <Circle key={p.date} cx={x(i)} cy={y(p.kg)} r={3.2} fill={t.surface} stroke={t.muted} strokeWidth={1.4} /> : null))}
    </Svg>
  );
}

export function TrendCard({ block: b }: { block: TrendBlock }) {
  const t = useTheme();
  const weighIns = b.weight.points.filter((p) => p.kg != null).length;
  const stat = (big: string, unit: string, sub: string) => (
    <View style={{ width: '50%', paddingRight: 10, gap: 2 }}>
      <Text style={{ color: t.fg, fontSize: 24, fontWeight: '300', letterSpacing: -0.6, fontVariant: ['tabular-nums'] }}>
        {big}<Text style={{ color: t.muted, fontSize: 13, fontWeight: '500', letterSpacing: 0 }}> {unit}</Text>
      </Text>
      <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 17 }}>{sub}</Text>
    </View>
  );
  return (
    <View accessibilityLabel={`${b.label} 기록 요약`} style={{ padding: 16, paddingBottom: 14, borderRadius: R.lg, ...squircle, backgroundColor: t.surface }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{b.label} · {md(b.from)}{b.from !== b.to ? `–${md(b.to)}` : ''}</Text>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{b.finished}일 마침</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, marginTop: 14 }}>
        {stat(String(b.kept.days), `/ ${b.kept.of}일`, '지킨 날')}
        {stat(b.intake.avgKcal != null ? fmt(b.intake.avgKcal) : '-', 'kcal', b.intake.avgTarget != null ? `하루 평균 · 목표 ${fmt(b.intake.avgTarget)}` : '기록한 날이 없습니다')}
        {stat(String(b.workouts.home), '회', `홈트${b.workouts.minutes ? ` · ${fmt(b.workouts.minutes)}분` : ''}`)}
        {stat(b.runs.km.toFixed(1), 'km', `러닝·걷기 ${b.runs.count}회`)}
      </View>
      <View style={{ marginTop: 18, gap: 6 }}>
        {weighIns > 0 ? (
          <>
            <Spark points={b.weight.points} />
            <Text style={{ color: t.fg2, fontSize: 13.5, lineHeight: 19 }}>
              {b.weight.trendFirst != null && b.weight.trendLast != null && b.weight.trendChange != null
                ? <>추세 <Text style={{ color: t.fg, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{b.weight.trendFirst.toFixed(1)} → {b.weight.trendLast.toFixed(1)}kg</Text> ({signed(b.weight.trendChange)})</>
                : <>체중 <Text style={{ color: t.fg, fontWeight: '600' }}>{b.weight.last?.toFixed(1)}kg</Text></>}
              {` · 체중 기록 ${weighIns}번`}
            </Text>
          </>
        ) : <Text style={{ color: t.fg2, fontSize: 13.5 }}>이 기간에는 체중 기록이 없습니다</Text>}
      </View>
    </View>
  );
}
