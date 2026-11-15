// "식단표 공유" on the phone: today's meals as one clean image (1080 wide), light or dark, to the share sheet
// (KakaoTalk, Instagram, 이미지 저장). Same content as the web share image.
import { useRef, useState } from 'react';
import { PixelRatio, Pressable, ScrollView, Text, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { fmt, hhmm } from '@diet/core';
import { todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { squircle, useTheme } from '@/lib/theme';
import { Btn, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';

const CARD_W = 360;
type Tone = 'light' | 'dark';
const TONES: Record<Tone, { bg: string; fg: string; fg2: string; muted: string; surface: string }> = {
  light: { bg: '#FCFCFC', fg: '#0B0B0B', fg2: '#3A3A3A', muted: '#6B6B6B', surface: '#F3F3F3' },
  dark: { bg: '#0A0A0A', fg: '#F2F2F2', fg2: '#CFCFCF', muted: '#9B9B9B', surface: '#171717' },
};

function CardOrb() {
  return (
    <Svg width={150} height={150} viewBox="0 0 100 100" style={{ position: 'absolute', right: -52, top: -52 }}>
      <Defs>
        <RadialGradient id="o" cx="35%" cy="35%" r="70%">
          <Stop offset="0" stopColor="#FFE6D0" />
          <Stop offset="0.35" stopColor="#FFB37A" />
          <Stop offset="0.7" stopColor="#FF7A45" />
          <Stop offset="1" stopColor="#FF4F6D" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#o)" />
    </Svg>
  );
}

export default function ShareMealsSheet() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { toast } = useToast();
  const [tone, setTone] = useState<Tone>(t.bg === TONES.dark.bg ? 'dark' : 'light');
  const [busy, setBusy] = useState(false);
  const card = useRef<ViewInstance | null>(null);
  const v = todayView(env);
  const C = TONES[tone];
  const total = v.meals.reduce((s, m) => s + m.kcal, 0);
  const protein = v.meals.reduce((s, m) => s + m.protein, 0);
  const timed = v.meals.some((m) => m.at != null);
  const scale = Math.min(1, (width - 40) / CARD_W);

  const share = async () => {
    if (!card.current || busy) return;
    setBusy(true);
    try {
      const px = PixelRatio.get();
      const uri = await captureRef(card, { format: 'png', width: 1080 / px, result: 'tmpfile' });
      if (!(await Sharing.isAvailableAsync())) { toast('이 기기에서는 공유할 수 없습니다'); return; }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: '오늘 식단 공유' });
    } catch (e) {
      toast(`이미지를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 22 }}>
        <View>
          <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>식단표 공유</Text>
          <Text style={{ color: t.fg, fontSize: 26, fontWeight: '300', letterSpacing: -0.6 }}>이렇게 보입니다</Text>
        </View>
        <Pressable accessibilityLabel="닫기" onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={14} color={t.fg} weight="semibold" />
        </Pressable>
      </View>
      <View style={[{ flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: t.surface, marginHorizontal: 20, marginTop: 14 }, squircle]}>
        {(['light', 'dark'] as const).map((x) => (
          <Pressable key={x} onPress={() => setTone(x)} style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === x ? t.bg : 'transparent' }}>
            <Text style={{ color: tone === x ? t.fg : t.muted, fontWeight: '600', fontSize: 14 }}>{x === 'light' ? '밝게' : '어둡게'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 16 }}>
        <View style={{ transform: [{ scale }], width: CARD_W }}>
          {/* the captured card: fixed width, height follows the meals */}
          <View ref={card} collapsable={false} style={{ width: CARD_W, backgroundColor: C.bg, paddingHorizontal: 26, paddingTop: 34, paddingBottom: 28, overflow: 'hidden' }}>
            <CardOrb />
            <Text style={{ color: C.muted, fontSize: 11, fontWeight: '500' }}>{v.ctx.label}</Text>
            <Text style={{ color: C.fg, fontSize: 32, fontWeight: '300', letterSpacing: -0.8, marginTop: 4 }}>오늘 식단</Text>
            <Text style={{ color: C.fg, fontSize: 24, fontWeight: '300', marginTop: 14, fontVariant: ['tabular-nums'] }}>
              {fmt(total)}<Text style={{ color: C.muted, fontSize: 12 }}> kcal · 단백질 {protein}g</Text>
            </Text>
            <Text style={{ color: C.muted, fontSize: 10.5, marginTop: 2 }}>하루 목표 {fmt(v.target)}kcal</Text>
            <View style={{ gap: 12, marginTop: 18 }}>
              {v.meals.map((m) => (
                <View key={m.key} style={[{ backgroundColor: C.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, gap: 5 }, squircle]}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
                    {timed && <Text style={{ width: 38, color: C.muted, fontSize: 10.5, fontVariant: ['tabular-nums'] }}>{m.at != null ? hhmm(m.at) : ''}</Text>}
                    <Text style={{ flex: 1, color: C.fg, fontSize: 14, fontWeight: '600' }}>{m.name}</Text>
                    <Text style={{ color: C.fg, fontSize: 13.5, fontVariant: ['tabular-nums'] }}>{m.est ? '약 ' : ''}{fmt(m.kcal)}<Text style={{ color: C.muted, fontSize: 9.5 }}> kcal</Text></Text>
                  </View>
                  {m.items.map((x, i) => (
                    <View key={`${x.name}-${i}`} style={{ flexDirection: 'row', gap: 8, paddingLeft: timed ? 48 : 0 }}>
                      <Text numberOfLines={1} style={{ flex: 1, color: C.fg2, fontSize: 11.5 }}>{x.name}</Text>
                      <Text style={{ color: C.muted, fontSize: 11 }}>{x.amount}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
            <Text style={{ color: C.muted, fontSize: 10, fontWeight: '500', marginTop: 20 }}>다루 · {v.ctx.week}주차 {v.ctx.no}일째</Text>
          </View>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 12, gap: 8 }}>
        <Btn icon="arrow-up-right" label={busy ? '만드는 중' : '공유하기'} style={{ height: 52 }} onPress={() => void share()} />
        <Text style={{ color: t.muted, fontSize: 12.5, textAlign: 'center' }}>공유 메뉴에서 카톡, 인스타, 이미지 저장을 고를 수 있습니다.</Text>
      </View>
    </View>
  );
}
