import { useRef, useState } from 'react';
import { PixelRatio, Pressable, Text, View, useWindowDimensions, type ViewInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { clockText, dayCtx, DOW, keyOf, kmText, paceText, sgn, type WeightRow } from '@diet/core';
import { runById, runSegments, runsList, runTotals, type Env } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, useToast } from '@/components/ui';
import { CARD_H, CARD_W, ShareCard, type CardData, type CardLook } from '@/lib/run/ShareCard';
import { runTitle } from '@/lib/run/hooks';

const LOOK_LABEL: Record<CardLook, string> = { night: '검정', paper: '밝게', clear: '투명 스티커' };

/** "감량 3일째 · -1.2kg" (weight part only when there is a weigh-in) */
function progressLine(env: Env, at: Date): string {
  const ctx = dayCtx(env.program, at);
  const key = keyOf(at);
  let latest: WeightRow | undefined;
  for (const w of env.store.all<WeightRow>('weights')) if (w.date <= key && (!latest || w.date > latest.date)) latest = w;
  const day = ctx.idx >= 0 ? `감량 ${ctx.no}일째` : '';
  const kg = latest ? `${sgn(latest.kg - env.program.startWeight)}kg` : '';
  return [day, kg].filter(Boolean).join(' · ');
}

export default function RunShareScreen() {
  const { id, scope } = useLocalSearchParams<{ id?: string; scope?: string }>();
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const { width, height } = useWindowDimensions();
  const [look, setLook] = useState<CardLook>('night');
  const [busy, setBusy] = useState(false);
  const card = useRef<ViewInstance>(null);

  let data: CardData | null = null;
  const run = id ? runById(env, id) : undefined;
  if (run) {
    const d = new Date(run.started_at);
    data = {
      routes: runSegments(run),
      when: `${d.getMonth() + 1}.${d.getDate()} ${runTitle(run)}`,
      label: run.kind === 'walk' ? '걸은 거리' : '달린 거리',
      big: kmText(Number(run.distance_m)),
      unit: 'km',
      stats: [
        { label: '평균 페이스', value: paceText(run.avg_pace_s_per_km) },
        { label: '시간', value: clockText(run.moving_s) },
        { label: '칼로리', value: `${Math.round(Number(run.kcal) || 0)}` },
      ],
      footer: progressLine(env, d),
    };
  } else if (scope === 'all') {
    const runs = runsList(env);
    const total = runTotals(runs);
    const now = env.now();
    data = {
      routes: runs.flatMap(runSegments).filter((r) => r.length > 1),
      when: `${now.getMonth() + 1}.${now.getDate()} ${DOW[now.getDay()]}요일까지`,
      label: '내가 달린 길',
      big: kmText(total.distance_m),
      unit: 'km',
      stats: [
        { label: '달린 횟수', value: `${total.count}번` },
        { label: '시간', value: clockText(total.moving_s) },
        { label: '처음 달린 길', value: `${kmText(total.new_m)}km` },
      ],
      footer: progressLine(env, now),
      many: true,
    };
  }

  // preview scale: fit the 360 x 640 card into the sheet
  const scale = Math.min((width - 76) / CARD_W, (height - insets.top - insets.bottom - 272) / CARD_H);

  const share = async () => {
    if (!card.current || busy) return;
    setBusy(true);
    try {
      // view-shot sizes are points (multiplied by the screen scale); aim for exactly 1080 x 1920 px
      const px = PixelRatio.get();
      const uri = await captureRef(card, { format: 'png', width: 1080 / px, height: 1920 / px, result: 'tmpfile' });
      if (!(await Sharing.isAvailableAsync())) { toast('이 기기에서는 공유할 수 없습니다'); return; }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: '러닝 이미지 공유' });
    } catch (e) {
      toast(`이미지를 만들지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 22, paddingBottom: insets.bottom + 12, paddingHorizontal: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: t.fg, fontSize: 20, fontWeight: '600' }}>공유 이미지</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={() => router.back()} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={15} color={t.fg} weight="semibold" />
        </Pressable>
      </View>

      {data ? (
        <>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            {/* neutral frame so the card's edge shows whichever look matches the sheet */}
            <View style={[{ padding: 6, borderRadius: R.lg + 6, backgroundColor: t.surface2 }, squircle]}>
              <View style={[{ width: CARD_W * scale, height: CARD_H * scale, borderRadius: R.lg, overflow: 'hidden', backgroundColor: look === 'clear' ? '#5A5A5A' : 'transparent' }, squircle]}>
                <View style={{ position: 'absolute', left: (CARD_W * scale - CARD_W) / 2, top: (CARD_H * scale - CARD_H) / 2, transform: [{ scale }] }}>
                  <ShareCard ref={card} data={data} look={look} />
                </View>
              </View>
            </View>
          </View>
          <View style={[{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.surface, alignSelf: 'center', marginBottom: 14 }, squircle]}>
            {(Object.keys(LOOK_LABEL) as CardLook[]).map((k) => (
              <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: look === k }} onPress={() => { void Haptics.selectionAsync(); setLook(k); }}
                style={{ height: 34, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', backgroundColor: look === k ? t.fg : 'transparent' }}>
                <Text style={{ color: look === k ? t.onFg : t.fg2, fontSize: 14, fontWeight: '600' }}>{LOOK_LABEL[k]}</Text>
              </Pressable>
            ))}
          </View>
          <Btn label={busy ? '이미지 만드는 중' : '공유하기'} icon="share" onPress={() => void share()} />
          <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 12.5, textAlign: 'center', marginTop: 10 }}>
            {look === 'clear' ? '투명 배경 PNG입니다. 스토리 사진 위에 스티커처럼 올리세요.' : '공유 시트에서 Instagram을 고르면 스토리로 올릴 수 있습니다.'}
          </Text>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.muted, fontSize: 15 }}>공유할 기록이 없습니다</Text>
        </View>
      )}
    </View>
  );
}
