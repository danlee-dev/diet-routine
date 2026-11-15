import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { amrapOf, ROUTINES, type RoutineDef, type RoutineKey } from '@diet/core';
import { setRoutine, todayView } from '@diet/data';
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
  // format: fixed rounds with rest, or repeat the list for N minutes and count rounds
  const [amrap, setAmrap] = useState<number | null>(() => amrapOf(r));

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
    const undo = setRoutine(env, k, { items, amrapMin: amrap }, 'user', amrap ? `${r.name}를 ${amrap}분 동안 반복으로 바꿨습니다` : `${r.name} 구성을 바꿨습니다`);
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
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginTop: 22, marginBottom: 8 }}>하는 방식</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {[null, 10, 15, 20, 30].map((m) => (
          <Pressable key={String(m)} accessibilityRole="button" accessibilityState={{ selected: amrap === m }} onPress={() => { void Haptics.selectionAsync(); setAmrap(m); }}
            style={[{ height: 36, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: amrap === m ? t.fg : t.surface }, squircle]}>
            <Text style={{ color: amrap === m ? t.onFg : t.fg2, fontSize: 14, fontWeight: '600' }}>{m ? `${m}분 동안 반복` : '정해진 라운드'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 }}>
        {amrap ? `${amrap}분 동안 위 순서를 계속 반복하고, 한 바퀴 끝날 때마다 누르면 바퀴 수를 셉니다. 횟수는 적힌 그대로 합니다.` : '기본 횟수입니다. 3주차부터는 1.2배로 늘려서 보여줍니다.'}
      </Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        <Btn kind="ghost" label="기본 구성" onPress={reset} />
        <Btn label="저장" icon="check" style={{ flex: 1 }} onPress={save} />
      </View>
    </SheetBody>
  );
}
