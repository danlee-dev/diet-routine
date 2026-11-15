import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ROUTINES, type RoutineDef, type RoutineKey } from '@diet/core';
import { setRoutineItems, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, useToast } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

type Item = RoutineDef['items'][number];

// Edit a home-workout routine: exercises, base reps (the weekly multiplier still applies).
export default function RoutineSheet() {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const { key } = useLocalSearchParams<{ key: RoutineKey }>();
  const k: RoutineKey = key === 'B' ? 'B' : 'A';
  const v = todayView(env);
  const r = v.routines[k];
  const [items, setItems] = useState<Item[]>(() => r.items.map((x) => ({ ...x })));
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<'회' | '초'>('회');

  const step = (i: number, d: number) => {
    void Haptics.selectionAsync();
    setItems((a) => a.map((x, j) => (j === i ? { ...x, n: Math.max(1, x.n + d * (x.unit.startsWith('초') ? 5 : 1)) } : x)));
  };
  const add = () => {
    if (!name.trim()) return;
    setItems((a) => [...a, { name: name.trim(), n: unit === '초' ? 30 : 10, unit }]);
    setName('');
  };
  const save = () => {
    const undo = setRoutineItems(env, k, items, 'user', `${r.name} 구성을 바꿨습니다`);
    router.back();
    toast(`${r.name}을 이렇게 합니다`, undo);
  };
  const reset = () => setItems(ROUTINES[k].items.map((x) => ({ ...x })));
  const round = (s: string) => [{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.surface2, alignItems: 'center' as const, justifyContent: 'center' as const }, s === 'x' && { backgroundColor: 'transparent' }];

  return (
    <SheetBody>
      <SheetHead eyebrow={`${r.focus} 루틴`} title={r.name} />
      <View style={[{ marginTop: 18, borderRadius: R.lg, backgroundColor: t.surface, paddingVertical: 4 }, squircle]}>
        {items.map((x, i) => (
          <View key={`${x.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
            <Pressable accessibilityLabel={`${x.name} 빼기`} hitSlop={6} onPress={() => setItems((a) => a.filter((_, j) => j !== i))} style={round('x')}>
              <Icon name="x" size={12} color={t.muted} weight="semibold" />
            </Pressable>
            <Text style={{ flex: 1, color: t.fg, fontSize: 15.5 }} numberOfLines={1}>{x.name}</Text>
            <Pressable accessibilityLabel={`${x.name} 줄이기`} onPress={() => step(i, -1)} style={round('')}><Text style={{ color: t.fg, fontSize: 18, fontWeight: '500' }}>−</Text></Pressable>
            <Text style={{ width: 62, textAlign: 'center', color: t.fg, fontSize: 15.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{x.n}{x.unit}</Text>
            <Pressable accessibilityLabel={`${x.name} 늘리기`} onPress={() => step(i, 1)} style={round('')}><Text style={{ color: t.fg, fontSize: 18, fontWeight: '500' }}>+</Text></Pressable>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <TextInput
          style={[{ flex: 1, height: 44, borderRadius: R.xs, backgroundColor: t.surface, paddingHorizontal: 12, color: t.fg, fontSize: 15.5 }, squircle]}
          value={name} onChangeText={setName} placeholder="운동 추가 (예: 와이드 스쿼트)" placeholderTextColor={t.muted} onSubmitEditing={add} returnKeyType="done"
        />
        <View style={[{ flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: t.surface }, squircle]}>
          {(['회', '초'] as const).map((u) => (
            <Pressable key={u} onPress={() => setUnit(u)} style={{ width: 38, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: unit === u ? t.bg : 'transparent' }}>
              <Text style={{ color: unit === u ? t.fg : t.muted, fontWeight: '600' }}>{u}</Text>
            </Pressable>
          ))}
        </View>
        <Btn small label="추가" onPress={add} />
      </View>
      <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 }}>기본 횟수입니다. 3주차부터는 1.2배로 늘려서 보여줍니다.</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        <Btn kind="ghost" label="기본 구성" onPress={reset} />
        <Btn label="저장" icon="check" style={{ flex: 1 }} onPress={save} />
      </View>
    </SheetBody>
  );
}
