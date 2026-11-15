// The weekly recap card: trend, kept days as a week strip, workouts and runs, the best day. Drawn with a
// palette so the records screen (theme colors) and the share image (light or dark) are the same card.
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { DOW, fmt, md, mdw, parseKey, signedKg } from '@diet/core';
import type { WeeklyRecapView } from '@diet/data';
import { squircle } from '@/lib/theme';

export interface RecapPalette { bg: string; fg: string; fg2: string; muted: string; surface: string; ctrl: string }

export const recapRangeText = (r: Pick<WeeklyRecapView, 'from' | 'to'>): string => `${md(parseKey(r.from))} – ${md(parseKey(r.to))}`;

/** The brand orb cut by the card's top-right corner (place it as the card's first child). */
export function RecapOrb() {
  return (
    <Svg width={150} height={150} viewBox="0 0 100 100" style={{ position: 'absolute', right: -52, top: -52 }}>
      <Defs>
        <RadialGradient id="ro" cx="35%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFE6D0" />
          <Stop offset="0.35" stopColor="#FFB37A" />
          <Stop offset="0.7" stopColor="#FF7A45" />
          <Stop offset="1" stopColor="#FF4F6D" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#ro)" />
    </Svg>
  );
}

/** Seven cells, Monday first: filled = kept, ring = logged, faint = nothing or not yet. */
function Strip({ r, C }: { r: WeeklyRecapView; C: RecapPalette }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {r.strip.map((d) => {
        const date = parseKey(d.key);
        return (
          <View key={d.key} style={{ alignItems: 'center', gap: 6, width: 34 }}>
            <View style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: d.state === 'kept' ? C.fg : 'transparent',
              borderWidth: d.state === 'kept' ? 0 : 1.5,
              borderColor: d.state === 'logged' ? C.fg : C.ctrl,
              borderStyle: d.state === 'future' ? 'dashed' : 'solid',
              opacity: d.state === 'empty' || d.state === 'future' ? 0.6 : 1,
            }} />
            <Text style={{ color: C.muted, fontSize: 10.5, fontWeight: '500' }}>{DOW[date.getDay()]}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Stat({ C, n, unit, label }: { C: RecapPalette; n: string; unit: string; label: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: C.fg, fontSize: 22, fontWeight: '300', fontVariant: ['tabular-nums'] }}>{n}<Text style={{ color: C.muted, fontSize: 11.5 }}> {unit}</Text></Text>
      <Text style={{ color: C.muted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export function RecapCardBody({ r, C, share, footer }: { r: WeeklyRecapView; C: RecapPalette; share?: boolean; footer?: string }) {
  const delta = r.trend.delta;
  const moving = r.runs ? { n: r.runKm.toFixed(1), unit: 'km', label: `달리기 ${r.runs}회` } : r.walks ? { n: r.walkKm.toFixed(1), unit: 'km', label: `걷기 ${r.walks}회` } : { n: '0', unit: '회', label: '달리기' };
  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: C.muted, fontSize: 11.5, fontWeight: '500' }}>{recapRangeText(r)} · {r.current ? '이번 주' : '지난주'}</Text>
        <Text style={{ color: C.fg, fontSize: share ? 32 : 26, fontWeight: '300', letterSpacing: -0.8 }}>{r.current ? '이번 주 회고' : '지난주 회고'}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <Text style={{ color: C.fg, fontSize: 44, fontWeight: '200', letterSpacing: -1.5, fontVariant: ['tabular-nums'] }}>{delta != null ? signedKg(delta) : '–'}<Text style={{ fontSize: 15, color: C.muted }}> kg</Text></Text>
        <Text style={{ color: C.muted, fontSize: 12.5, marginBottom: 9, flexShrink: 1 }}>{r.trend.end != null ? `추세 ${r.trend.end.toFixed(1)}kg` : '체중 기록이 쌓이면 추세가 나옵니다'}</Text>
      </View>
      <Strip r={r} C={C} />
      <View style={{ flexDirection: 'row' }}>
        <Stat C={C} n={`${r.kept}`} unit={`/ ${r.days}일`} label="지킨 날" />
        <Stat C={C} n={`${r.workouts}`} unit="회" label="홈트" />
        <Stat C={C} n={moving.n} unit={moving.unit} label={moving.label} />
      </View>
      {r.best && (
        <View style={[{ backgroundColor: C.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 3 }, squircle]}>
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600' }}>가장 잘 지킨 날 · {mdw(parseKey(r.best.key))}</Text>
          <Text style={{ color: C.fg, fontSize: 14, fontWeight: '600' }}>{r.best.notes.join(' · ')}</Text>
          <Text style={{ color: C.fg2, fontSize: 11.5 }}>목표 {fmt(r.best.target)}kcal</Text>
        </View>
      )}
      {footer ? <Text style={{ color: C.muted, fontSize: 10, fontWeight: '500' }}>{footer}</Text> : null}
    </View>
  );
}
