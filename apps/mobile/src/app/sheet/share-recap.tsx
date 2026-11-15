// "주간 회고 공유": the weekly recap card as one image (1080 wide), light or dark, to the share sheet.
// Same capture path as the meal table share; the web draws the same card on a canvas.
import { useRef, useState } from 'react';
import { PixelRatio, Pressable, ScrollView, Text, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { todayView, weeklyRecapFor } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { squircle, useTheme } from '@/lib/theme';
import { Btn, useToast } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { RecapCardBody, RecapOrb, type RecapPalette } from '@/components/WeeklyRecap';

const CARD_W = 360;
type Tone = 'light' | 'dark';
const TONES: Record<Tone, RecapPalette> = {
  light: { bg: '#FCFCFC', fg: '#0B0B0B', fg2: '#3A3A3A', muted: '#6B6B6B', surface: '#F3F3F3', ctrl: '#C9C9C9' },
  dark: { bg: '#0A0A0A', fg: '#F2F2F2', fg2: '#CFCFCF', muted: '#9B9B9B', surface: '#171717', ctrl: '#4A4A4A' },
};

export default function ShareRecapSheet() {
  'use no memo';
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { toast } = useToast();
  const [tone, setTone] = useState<Tone>(t.bg === TONES.dark.bg ? 'dark' : 'light');
  const [busy, setBusy] = useState(false);
  const card = useRef<ViewInstance | null>(null);
  const r = weeklyRecapFor(env);
  const v = todayView(env);
  const scale = Math.min(1, (width - 40) / CARD_W);

  const share = async () => {
    if (!card.current || busy) return;
    setBusy(true);
    try {
      const uri = await captureRef(card, { format: 'png', width: 1080 / PixelRatio.get(), result: 'tmpfile' });
      if (!(await Sharing.isAvailableAsync())) { toast('이 기기에서는 공유할 수 없습니다'); return; }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: '주간 회고 공유' });
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
          <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>주간 회고 공유</Text>
          <Text style={{ color: t.fg, fontSize: 26, fontWeight: '300', letterSpacing: -0.6 }}>이렇게 보입니다</Text>
        </View>
        <Pressable accessibilityLabel="닫기" onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={14} color={t.fg} weight="semibold" />
        </Pressable>
      </View>
      <View style={[{ flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: t.surface, marginHorizontal: 20, marginTop: 14 }, squircle]}>
        {(['light', 'dark'] as const).map((x) => (
          <Pressable key={x} accessibilityRole="button" accessibilityState={{ selected: tone === x }} onPress={() => setTone(x)}
            style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === x ? t.bg : 'transparent' }}>
            <Text style={{ color: tone === x ? t.fg : t.muted, fontWeight: '600', fontSize: 14 }}>{x === 'light' ? '밝게' : '어둡게'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 16 }}>
        <View style={{ transform: [{ scale }], width: CARD_W }}>
          <View ref={card} collapsable={false} style={{ width: CARD_W, backgroundColor: TONES[tone].bg, paddingHorizontal: 26, paddingTop: 34, paddingBottom: 28, overflow: 'hidden' }}>
            <RecapOrb />
            <RecapCardBody r={r} C={TONES[tone]} share footer={`다루 · ${v.ctx.week}주차`} />
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
