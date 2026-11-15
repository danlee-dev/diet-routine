import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { addDays, DOW, md, parseKey, programDate, TARGET_BAND, TARGETS } from '@diet/core';
import { dayRecord, streaks, todayView, weightData } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn } from '@/components/ui';

export default function RecordsScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const v = todayView(env);
  const P = env.program;
  const { series, avg, stats } = weightData(env, v.ctx.idx);
  const st = streaks(env, v.ctx.idx);

  // chart
  const W = 340, H = 190, pl = 28, pr = 8, pt = 10, pb = 22, xmax = P.days - 1;
  let ymin = 69, ymax = 77;
  for (const p of series) { ymin = Math.min(ymin, Math.floor(p.w - 0.5)); ymax = Math.max(ymax, Math.ceil(p.w + 0.5)); }
  const x = (i: number) => pl + ((W - pl - pr) * i) / xmax;
  const y = (w: number) => pt + ((H - pt - pb) * (ymax - w)) / (ymax - ymin);
  const pts = (a: [number, number][]) => a.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
  const band = `M${pts(TARGET_BAND.upper).join(' L')} L${pts([...TARGET_BAND.lower].reverse()).join(' L')} Z`;
  const grid: number[] = [];
  for (let w = Math.ceil(ymin); w <= ymax; w++) if (w % 2 === 0) grid.push(w);

  const lead = parseKey(P.startDate).getDay();
  const box = [{ padding: 16, borderRadius: R.lg, backgroundColor: t.surface, marginTop: 12 }, squircle];
  const stat = (a: string, b: string) => (
    <View style={[{ flex: 1, padding: 12, borderRadius: R.md, backgroundColor: t.bg }, squircle]}>
      <Text style={{ color: t.fg, fontSize: 20, fontVariant: ['tabular-nums'] }}>{a}</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>{b}</Text>
    </View>
  );
  const fromStart = stats.last != null ? stats.last - P.startWeight : null;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}>
      <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '500' }}>기록 · {v.ctx.no}일째</Text>
      <Text style={{ color: t.fg, fontSize: 40, fontWeight: '300', letterSpacing: -1 }}>몸 변화</Text>
      <Text style={{ color: t.muted, fontSize: 14, marginTop: 4 }}>식단 연속 {st.streak}일 · 홈트 {st.workouts}회 · 남은 기간 {Math.max(0, P.days - v.ctx.no)}일</Text>

      <View style={box}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>체중</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>이번 주 목표 {TARGETS[Math.min(v.ctx.week, 4)]!.text}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {stat(stats.last != null ? stats.last.toFixed(1) : '-', '최근 kg')}
          {stat(fromStart != null ? `${fromStart <= 0 ? '' : '+'}${fromStart.toFixed(1)}` : '-', '시작 대비')}
          {stat(stats.projection != null ? stats.projection.toFixed(1) : '-', stats.projection != null ? `${md(addDays(parseKey(P.startDate), P.days - 1))} 예상` : '5일 기록 후')}
        </View>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
          <Path d={band} fill={t.surface2} />
          {grid.map((w) => (
            <Line key={w} x1={pl} x2={W - pr} y1={y(w)} y2={y(w)} stroke={t.line} strokeWidth={1} />
          ))}
          {grid.map((w) => <SvgText key={`l${w}`} x={pl - 5} y={y(w) + 4} fontSize={10} fill={t.muted} textAnchor="end">{w}</SvgText>)}
          {[0, 7, 14, 21, 28].map((i) => <SvgText key={i} x={x(i)} y={H - 6} fontSize={10} fill={t.muted} textAnchor="middle">{md(programDate(P, i))}</SvgText>)}
          {v.ctx.idx >= 0 && v.ctx.idx <= xmax && <Line x1={x(v.ctx.idx)} x2={x(v.ctx.idx)} y1={pt} y2={H - pb} stroke={t.ctrl} strokeDasharray="3 4" />}
          {avg.length > 1 && <Path d={`M${avg.map((p) => `${x(p.i)},${y(p.w)}`).join(' L')}`} stroke={t.muted} strokeWidth={1.5} strokeDasharray="5 5" fill="none" />}
          {series.length > 0 && <Path d={`M${series.map((p) => `${x(p.i)},${y(p.w)}`).join(' L')}`} stroke={t.fg} strokeWidth={2.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
          {series.map((p) => <Circle key={p.i} cx={x(p.i)} cy={y(p.w)} r={3.5} fill={t.fg} />)}
          {!series.length && <SvgText x={W / 2} y={H / 2} fontSize={12} fill={t.muted} textAnchor="middle">아침 체중을 넣으면 선이 그려집니다</SvgText>}
        </Svg>
        <Btn kind={v.weight != null ? 'ghost' : 'primary'} icon="weight" label={v.weight != null ? `오늘 체중 고치기 · ${v.weight.toFixed(1)}kg` : '오늘 아침 체중 기록'} style={{ marginTop: 12 }} onPress={() => router.push({ pathname: '/sheet/weight', params: { i: String(v.ctx.idx) } })} />
      </View>

      <View style={box}>
        <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 10 }}>30일 달력</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {DOW.map((d) => <Text key={d} style={{ width: `${100 / 7}%`, textAlign: 'center', color: t.muted, fontSize: 11.5, marginBottom: 4 }}>{d}</Text>)}
          {Array.from({ length: lead }, (_, b) => <View key={`b${b}`} style={{ width: `${100 / 7}%` }} />)}
          {Array.from({ length: P.days }, (_, i) => {
            const rec = dayRecord(env, i);
            const isT = i === v.ctx.idx;
            const fut = i > v.ctx.idx;
            return (
              <View key={i} style={{ width: `${100 / 7}%`, padding: 3, opacity: fut ? 0.4 : 1 }}>
                <Pressable
                  disabled={fut}
                  onPress={() => router.push({ pathname: '/sheet/weight', params: { i: String(i) } })}
                  style={[{ minHeight: 54, padding: 6, borderRadius: R.xs, backgroundColor: isT ? t.fg : t.bg, justifyContent: 'space-between' }, squircle]}
                >
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: isT ? t.onFg : t.fg }}>{rec.date.getDate() === 1 ? md(rec.date) : rec.date.getDate()}</Text>
                  <Text style={{ fontSize: 10, color: isT ? t.onFg : t.muted, opacity: isT ? 0.7 : 1, fontVariant: ['tabular-nums'] }}>{rec.weight != null ? rec.weight.toFixed(1) : ''}</Text>
                  <View style={{ height: 3, borderRadius: 3, backgroundColor: isT ? 'rgba(127,127,127,0.35)' : t.surface2, overflow: 'hidden' }}>
                    <View style={{ width: `${(rec.meals / 5) * 100}%`, height: 3, backgroundColor: isT ? t.onFg : t.fg }} />
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 10 }}>막대는 먹은 끼니 수, 숫자는 그날 체중입니다. 날짜를 누르면 그날 체중을 고칩니다.</Text>
      </View>
    </ScrollView>
  );
}
