// Instagram Story card for a run or for "my map". Laid out at 360 x 640 pt and captured at 1080 x 1920 px.
// Three looks: night (black), paper (light grey), clear (transparent PNG sticker to put over a photo).
import type { Ref } from 'react';
import { Text, View, type ViewInstance } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop, Circle } from 'react-native-svg';
import { projectRoutes, type LatLng } from '@diet/core';

export const CARD_W = 360;
export const CARD_H = 640;

export type CardLook = 'night' | 'paper' | 'clear';

export interface CardData {
  routes: LatLng[][];
  /** top-right, e.g. "11.15 토요일 저녁" */
  when: string;
  /** small line above the big number */
  label: string;
  big: string;
  unit: string;
  stats: { label: string; value: string }[];
  footer?: string;
  /** thin lines for many overlaid routes */
  many?: boolean;
}

const LOOKS: Record<CardLook, { bg: string; fg: string; sub: string; lineA: string; lineB: string; shadow: boolean }> = {
  night: { bg: '#0A0A0A', fg: '#F2F2F2', sub: 'rgba(242,242,242,0.58)', lineA: '#FF4F6D', lineB: '#FF8A4C', shadow: false },
  paper: { bg: '#F3F3F3', fg: '#0B0B0B', sub: 'rgba(11,11,11,0.55)', lineA: '#0B0B0B', lineB: '#0B0B0B', shadow: false },
  clear: { bg: 'transparent', fg: '#FFFFFF', sub: 'rgba(255,255,255,0.85)', lineA: '#FFFFFF', lineB: '#FFFFFF', shadow: true },
};

export function ShareCard({ data, look, ref }: { data: CardData; look: CardLook; ref?: Ref<ViewInstance> }) {
  const L = LOOKS[look];
  const artW = CARD_W - 56;
  const artH = 290;
  const sw = data.many ? 2.6 : 7;
  const p = projectRoutes(data.routes, artW, artH, sw + 6);
  const shadow = L.shadow ? { textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } } : null;
  return (
    <View ref={ref} collapsable={false} style={{ width: CARD_W, height: CARD_H, backgroundColor: L.bg, paddingHorizontal: 28, paddingTop: 30, paddingBottom: 28 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[{ color: L.fg, fontSize: 13, fontWeight: '800', letterSpacing: 0.3 }, shadow]}>다루</Text>
        <Text style={[{ color: L.sub, fontSize: 12.5, fontWeight: '600' }, shadow]}>{data.when}</Text>
      </View>

      <View style={{ height: artH, marginTop: 34, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={artW} height={artH}>
          <Defs>
            <LinearGradient id="route" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={L.lineA} />
              <Stop offset="1" stopColor={L.lineB} />
            </LinearGradient>
          </Defs>
          {L.shadow && p.paths.map((d, i) => <Path key={`s${i}`} d={d} stroke="rgba(0,0,0,0.28)" strokeWidth={sw + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
          {p.paths.map((d, i) => <Path key={i} d={d} stroke="url(#route)" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={data.many ? 0.92 : 1} />)}
          {!data.many && p.start && <Circle cx={p.start.x} cy={p.start.y} r={sw * 0.9} fill={look === 'clear' ? 'transparent' : L.bg} stroke={L.fg} strokeWidth={3} />}
          {!data.many && p.end && <Circle cx={p.end.x} cy={p.end.y} r={sw * 0.9} fill={L.fg} />}
        </Svg>
      </View>

      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Text style={[{ color: L.sub, fontSize: 13, fontWeight: '700' }, shadow]}>{data.label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[{ color: L.fg, fontSize: 112, fontWeight: '900', letterSpacing: -5, fontVariant: ['tabular-nums'], includeFontPadding: false }, shadow]}>{data.big}</Text>
          <Text style={[{ color: L.fg, fontSize: 24, fontWeight: '800' }, shadow]}>{data.unit}</Text>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 14, gap: 18 }}>
          {data.stats.map((s) => (
            <View key={s.label} style={{ flex: 1 }}>
              <Text style={[{ color: L.sub, fontSize: 11.5, fontWeight: '700' }, shadow]}>{s.label}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[{ color: L.fg, fontSize: 23, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 }, shadow]}>{s.value}</Text>
            </View>
          ))}
        </View>
        {data.footer ? <Text style={[{ color: L.sub, fontSize: 12.5, fontWeight: '600', marginTop: 18 }, shadow]}>{data.footer}</Text> : null}
      </View>
    </View>
  );
}
