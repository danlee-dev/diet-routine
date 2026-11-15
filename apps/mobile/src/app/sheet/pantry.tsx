// One shopping item's count: pick how many are left now, or mark a purchase. Meals logged later use it up.
import { useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { fmt, pantryName, stockText, type PantryStatus } from '@diet/core';
import { markBought, pantryFor, setStock, stopCounting } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, PickerFrame, useToast, Wheel, type WheelItem } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

/** Pieces one by one, weights and volumes in steps, up to two purchases; the exact count now is always a stop. */
function wheelItems(s: PantryStatus): WheelItem[] {
  const { unit, pack } = s.item;
  const step = unit === 'ea' ? (pack > 120 ? 5 : 1) : pack >= 2000 ? 100 : pack >= 500 ? 50 : 10;
  const max = Math.max(pack * 2, s.stock ?? 0);
  const out: WheelItem[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push({ v, t: fmt(v) });
  if (s.stock != null && !out.some((x) => Math.abs(x.v - s.stock!) < 1e-9)) out.push({ v: s.stock, t: fmt(s.stock) });
  return out.sort((a, b) => a.v - b.v);
}
const nearest = (items: WheelItem[], v: number) => items.reduce((a, x) => (Math.abs(x.v - v) < Math.abs(a.v - v) ? x : a), items[0]!).v;

export default function PantrySheet() {
  'use no memo'; // reads mutable rows through a stable env
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = id ? pantryFor(env, id) : undefined;
  const items = useMemo(() => (s ? wheelItems(s) : []), [s?.item.id, s?.item.pack, s?.stock]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<number>(() => (s ? nearest(items, s.stock ?? s.item.pack) : 0));
  if (!s || !id) {
    return <SheetBody><SheetHead eyebrow="남은 양" title="찾을 수 없습니다" /></SheetBody>;
  }
  const name = pantryName(s.item.name);
  const days = s.daily > 0 ? Math.floor(pick / s.daily + 1e-9) : null;
  const lead = s.stock == null
    ? '지금 집에 있는 만큼 고르면 그때부터 먹을 때마다 줄어듭니다.'
    : `${s.daysLeft == null ? `지금 ${stockText(s.stock, s.item)} 남았습니다` : s.daysLeft <= 0 ? `지금 ${stockText(s.stock, s.item)} 남아 오늘 떨어집니다` : `지금 ${stockText(s.stock, s.item)}, ${s.daysLeft}일분이 남았습니다`}. 고르면 이 숫자부터 다시 셉니다.`;
  return (
    <SheetBody>
      <SheetHead eyebrow="남은 양" title={name} />
      <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{lead}</Text>
      <PickerFrame>
        <Wheel items={items} value={pick} onChange={setPick} width={120} label={`${name} 남은 양`} />
        <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600' }}>{s.item.unit === 'ea' ? s.item.label : s.item.unit}</Text>
      </PickerFrame>
      <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 13.5, textAlign: 'center', marginTop: 12 }}>
        {s.daily > 0
          ? `계획대로면 하루 ${stockText(s.daily, s.item)}씩 써서 ${days != null && days <= 0 ? '오늘 떨어집니다' : `${days}일 갑니다`}`
          : '지금 식단에는 이 품목이 들어 있지 않아 줄어들지 않습니다'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        <Btn kind="ghost" icon="package" label={`샀어요 +${stockText(s.item.pack, s.item)}`} onPress={() => {
          const undo = markBought(env, id);
          router.back();
          toast(`${name} ${stockText(s.item.pack, s.item)} 채웠습니다`, undo);
        }} />
        <Btn label="이만큼 있어요" icon="check" style={{ flex: 1 }} onPress={() => {
          const undo = setStock(env, id, pick);
          router.back();
          toast(`${name} ${stockText(pick, s.item)} 남음으로 맞췄습니다`, undo);
        }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 14 }}>
        <Pressable accessibilityRole="link" hitSlop={8} onPress={() => void Linking.openURL(s.item.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>쿠팡에서 보기</Text>
          <Icon name="arrow-up-right" size={11} color={t.fg2} weight="semibold" />
        </Pressable>
        {s.record && (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { const undo = stopCounting(env, id); router.back(); toast(`${name} 재고를 그만 셉니다`, undo); }}>
            <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>그만 세기</Text>
          </Pressable>
        )}
      </View>
    </SheetBody>
  );
}
