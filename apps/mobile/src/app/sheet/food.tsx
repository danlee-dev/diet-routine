import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fmt, keypadReduce, PORTIONS, PRESETS, type FoodPreset, type KeypadState, type Slot } from '@diet/core';
import { logFood, remainingKcal, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn, Keypad, useToast } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

const GROUPS: [FoodPreset['group'], string][] = [['delivery', '배달·외식'], ['meal', '식사'], ['drink', '마실 것'], ['snack', '간식']];

export default function FoodSheet() {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const params = useLocalSearchParams<{ slot?: string }>();
  const v = todayView(env);
  const [slot, setSlot] = useState<Slot>((params.slot as Slot) ?? v.next?.key ?? 'extra');
  const [preset, setPreset] = useState<FoodPreset | null>(null);
  const [portion, setPortion] = useState<(typeof PORTIONS)[number]['id']>('normal');
  const [manual, setManual] = useState(false);
  const [name, setName] = useState('');
  const [pad, setPad] = useState<KeypadState>({ n: 0, fresh: true });
  const [protein, setProtein] = useState(10);
  const mult = PORTIONS.find((p) => p.id === portion)!.mult;
  const kcal = manual ? pad.n : preset ? Math.round(preset.kcal * mult) : 0;
  const prot = manual ? protein : preset ? Math.round(preset.protein * mult) : 0;
  const replacedEaten = slot === 'extra' ? 0 : v.entries.filter((e) => e.slot === slot).reduce((a, e) => a + e.kcal, 0);
  const leftAfter = remainingKcal(env, v) - kcal + replacedEaten;
  const chip = (on: boolean) => [{ height: 34, paddingHorizontal: 13, borderRadius: 999, backgroundColor: on ? t.fg : t.surface, justifyContent: 'center' as const }];
  const chipText = (on: boolean) => ({ color: on ? t.onFg : t.fg2, fontSize: 13.5, fontWeight: '600' as const });
  const slots: { id: Slot; label: string }[] = [...v.meals.map((m) => ({ id: m.key as Slot, label: m.name.replace(/ \(.+\)$/, '') })), { id: 'extra', label: '추가로 먹음' }];

  return (
    <SheetBody scroll>
      <SheetHead eyebrow="다르게 먹었어요" title={preset || manual ? '이렇게 기록할까요?' : '무엇을 먹었어요?'} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {slots.map((s) => <Pressable key={s.id} style={chip(slot === s.id)} onPress={() => setSlot(s.id)}><Text style={chipText(slot === s.id)}>{s.label}</Text></Pressable>)}
      </View>

      {!preset && !manual && (
        <>
          {GROUPS.map(([g, label]) => (
            <View key={g}>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 2 }}>{label}</Text>
              {PRESETS.filter((p) => p.group === g).map((p, i) => (
                <Pressable key={p.id} onPress={() => { void Haptics.selectionAsync(); setPreset(p); }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: t.line, opacity: pressed ? 0.6 : 1 })}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.fg, fontSize: 15, fontWeight: '700' }}>{p.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 13 }}>{p.serving} · 단백질 {p.protein}g</Text>
                  </View>
                  <Text style={{ color: t.fg2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{fmt(p.kcal)}kcal</Text>
                </Pressable>
              ))}
            </View>
          ))}
          <Btn kind="ghost" label="목록에 없어요 · 직접 입력" style={{ marginTop: 14, alignSelf: 'flex-start' }} onPress={() => setManual(true)} />
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>사진이나 말로 기록하는 AI 코치는 다음 단계에서 붙습니다.</Text>
        </>
      )}

      {preset && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: t.muted, fontSize: 14 }}>{preset.name} · {preset.serving}</Text>
          <View style={[{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.surface, marginTop: 10 }, squircle]}>
            {PORTIONS.map((p) => (
              <Pressable key={p.id} onPress={() => { void Haptics.selectionAsync(); setPortion(p.id); }} style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: portion === p.id ? t.bg : 'transparent' }}>
                <Text style={{ color: portion === p.id ? t.fg : t.muted, fontWeight: '600' }}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {manual && (
        <>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="무엇을 먹었는지 (예: 회사 근처 쌀국수)"
            placeholderTextColor={t.muted}
            style={[{ marginTop: 16, height: 46, borderRadius: R.sm, borderWidth: 1, borderColor: t.ctrl, paddingHorizontal: 14, color: t.fg, fontSize: 16 }, squircle]}
          />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 14 }}>
            <Text style={{ fontSize: 44, fontWeight: '300', color: pad.fresh ? t.muted : t.fg, fontVariant: ['tabular-nums'] }}>{fmt(pad.n)}</Text>
            <Text style={{ fontSize: 16, color: t.muted }}>kcal</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {[0, 10, 20, 30, 40].map((g) => <Pressable key={g} style={chip(protein === g)} onPress={() => setProtein(g)}><Text style={chipText(protein === g)}>단백질 {g}g</Text></Pressable>)}
          </View>
          <Keypad onKey={(k) => setPad((s) => keypadReduce(s, k))} />
        </>
      )}

      {(preset || manual) && (
        <>
          <View style={{ flexDirection: 'row', gap: 22, marginTop: 18 }}>
            {[[fmt(kcal), 'kcal'], [`${prot}g`, '단백질'], [fmt(Math.max(0, leftAfter)), leftAfter >= 0 ? '오늘 남는 kcal' : '오늘 초과']].map(([a, b]) => (
              <View key={b}><Text style={{ color: t.fg, fontSize: 26, fontWeight: '400', fontVariant: ['tabular-nums'] }}>{a}</Text><Text style={{ color: t.muted, fontSize: 12.5 }}>{b}</Text></View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
            <Btn kind="ghost" label="다시 고르기" onPress={() => { setPreset(null); setManual(false); }} />
            <Btn label="기록" icon="check" style={{ flex: 1 }} onPress={() => {
              if (!kcal) return;
              const label = manual ? name.trim() || '직접 입력' : preset!.name;
              const undo = logFood(env, { date: v.ctx.key, slot, kcal, protein: prot, source: manual ? 'manual' : 'preset', name: label, amount: manual ? '' : `${preset!.serving} · ${PORTIONS.find((p) => p.id === portion)!.label}` });
              router.back();
              toast(`${label} ${fmt(kcal)}kcal 기록`, undo);
            }} />
          </View>
        </>
      )}
    </SheetBody>
  );
}
