import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { applyPlanChanges, hhmm, MEALS, pad, plan, type MealKey, type PlanItem } from '@diet/core';
import { addAdjustments, setMealOverride, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, PickerFrame, useToast, Wheel, type WheelItem } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

const HOURS: WheelItem[] = Array.from({ length: 24 }, (_, i) => ({ v: i, t: pad(i) }));
const MINS: WheelItem[] = Array.from({ length: 12 }, (_, i) => ({ v: i * 5, t: pad(i * 5) }));

// Edit one meal: items and amounts, kcal/protein, time. Save for today only (day adjustment) or from now on (plan version).
export default function MealSheet() {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const { key } = useLocalSearchParams<{ key: MealKey }>();
  const v = todayView(env);
  // the meal as the plan has it, before today's one-day changes
  const base = applyPlanChanges(plan({ scen: v.scen, eatout: v.eatout, wake: v.day.wake_min }), v.override, []).find((m) => m.key === key);
  const shown = v.meals.find((m) => m.key === key);
  const [items, setItems] = useState<PlanItem[]>(() => (shown?.items ?? base?.items ?? []).map((x) => ({ ...x })));
  const [kcal, setKcal] = useState(String(shown?.kcal ?? base?.kcal ?? 0));
  const [protein, setProtein] = useState(String(shown?.protein ?? base?.protein ?? 0));
  const startAt = shown?.at ?? base?.at ?? 12 * 60;
  const [h, setH] = useState(Math.floor(startAt / 60));
  const [m, setM] = useState(Math.round((startAt % 60) / 5) * 5 % 60);
  const [pickTime, setPickTime] = useState(false);
  const [timeTouched, setTimeTouched] = useState(false);

  if (!key || !(key in MEALS) || !base) {
    return <SheetBody><SheetHead eyebrow="식단 바꾸기" title="이 끼니는 오늘 계획에 없습니다" /></SheetBody>;
  }

  const input = [{ height: 44, borderRadius: R.xs, backgroundColor: t.surface, paddingHorizontal: 12, color: t.fg, fontSize: 15.5 }, squircle];
  const num = (s: string) => Math.max(0, Math.round(Number(s.replace(/[^\d.]/g, '')) || 0));
  const clean = items.filter((x) => x.name.trim()).map((x) => ({ ...x, name: x.name.trim(), amount: x.amount.trim() }));
  const time = timeTouched ? `${pad(h)}:${pad(m)}` : undefined;

  const saveAlways = () => {
    const undo = setMealOverride(env, key, { items: clean, kcal: num(kcal), protein: num(protein), ...(time ? { time } : {}), note: '직접 바꿨습니다' }, 'user');
    router.back();
    toast(`${base.name}을 앞으로 이렇게 먹습니다`, undo);
  };
  const saveToday = () => {
    const undo = addAdjustments(env, [{
      offset: 0,
      adj: { slot: key, source: 'user', reason: '오늘만 바꿈', change: { kind: 'edit', items: clean, kcal_delta: num(kcal) - base.kcal, protein_delta: num(protein) - base.protein, label: '오늘만 바꿈' } },
    }]);
    router.back();
    toast(`오늘 ${base.name}만 바꿨습니다`, undo);
  };
  const removeMeal = () => {
    const undo = setMealOverride(env, key, { removed: true, note: `${base.name}을 뺐습니다` }, 'user');
    router.back();
    toast(`${base.name}을 계획에서 뺐습니다`, undo);
  };
  const reset = () => {
    const undo = setMealOverride(env, key, null, 'user', `${base.name}을 기본으로 되돌렸습니다`);
    router.back();
    toast('기본 식단으로 되돌렸습니다', undo);
  };

  return (
    <SheetBody>
      <SheetHead eyebrow="식단 바꾸기" title={base.name} />

      <Pressable
        accessibilityRole="button"
        onPress={() => setPickTime((x) => !x)}
        style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, height: 48, paddingHorizontal: 14, borderRadius: R.sm, backgroundColor: t.surface }, squircle]}
      >
        <Text style={{ color: t.fg, fontSize: 15.5 }}>시간</Text>
        <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{timeTouched ? `${pad(h)}:${pad(m)}` : shown?.at != null ? hhmm(shown.at) : base.time}</Text>
      </Pressable>
      {pickTime && (
        <PickerFrame>
          <Wheel items={HOURS} value={h} onChange={(x) => { setH(x); setTimeTouched(true); }} label="시" />
          <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600', marginRight: 12 }}>시</Text>
          <Wheel items={MINS} value={m} onChange={(x) => { setM(x); setTimeTouched(true); }} label="분" />
          <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600' }}>분</Text>
        </PickerFrame>
      )}

      <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginTop: 22, marginBottom: 8 }}>먹는 것</Text>
      <View style={{ gap: 8 }}>
        {items.map((x, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput style={[input, { flex: 1.6 }]} value={x.name} placeholder="이름" placeholderTextColor={t.muted} onChangeText={(s) => setItems((a) => a.map((y, j) => (j === i ? { ...y, name: s } : y)))} />
            <TextInput style={[input, { flex: 1 }]} value={x.amount} placeholder="양" placeholderTextColor={t.muted} onChangeText={(s) => setItems((a) => a.map((y, j) => (j === i ? { ...y, amount: s } : y)))} />
            <Pressable accessibilityLabel={`${x.name || '항목'} 빼기`} hitSlop={8} onPress={() => setItems((a) => a.filter((_, j) => j !== i))} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={13} color={t.muted} weight="semibold" />
            </Pressable>
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={() => setItems((a) => [...a, { name: '', amount: '' }])} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <Icon name="plus" size={13} color={t.fg} weight="semibold" />
          <Text style={{ color: t.fg, fontSize: 14.5, fontWeight: '600' }}>항목 추가</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>칼로리</Text>
          <TextInput style={input} value={kcal} onChangeText={setKcal} keyboardType="number-pad" placeholder="kcal" placeholderTextColor={t.muted} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>단백질 (g)</Text>
          <TextInput style={input} value={protein} onChangeText={setProtein} keyboardType="number-pad" placeholder="g" placeholderTextColor={t.muted} />
        </View>
      </View>
      <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 8 }}>정확한 숫자를 모르면 코치에게 &quot;이렇게 바꾸면 몇 kcal야?&quot; 라고 물어보면 계산해서 바꿔 줍니다.</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        <Btn kind="ghost" label="오늘만" style={{ flex: 1 }} onPress={saveToday} />
        <Btn label="앞으로 계속" icon="check" style={{ flex: 1.4 }} onPress={saveAlways} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
        <Pressable accessibilityRole="button" onPress={removeMeal} hitSlop={8}><Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>이 끼니 빼기</Text></Pressable>
        {(base.edited || shown?.changes?.length) ? <Pressable accessibilityRole="button" onPress={reset} hitSlop={8}><Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>기본으로 되돌리기</Text></Pressable> : null}
      </View>
    </SheetBody>
  );
}
