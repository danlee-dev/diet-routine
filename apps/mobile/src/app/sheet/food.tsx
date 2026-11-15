import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fmt, keypadReduce, partialMeal, PORTIONS, type FoodPreset, type KeypadState, type MealKey, type Slot } from '@diet/core';
import { eatPartial, foodPresets, logFood, PRESET_GROUPS, remainingKcal, skipMeal, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, Keypad, useToast } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';


export default function FoodSheet() {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const params = useLocalSearchParams<{ slot?: string }>();
  const v = todayView(env);
  // the user's own list (edited on the web), or the built-in one
  const presets = foodPresets(env);
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
  // "일부만 먹었어요": planned items of this slot, all checked to start
  const meal = slot === 'extra' ? undefined : v.meals.find((m) => m.key === slot);
  const [keepBySlot, setKeepBySlot] = useState<Record<string, boolean[]>>({});
  const keep = meal ? keepBySlot[slot] ?? meal.items.map(() => true) : [];
  const part = meal ? partialMeal(meal, keep) : null;
  const toggleKeep = (i: number) => { void Haptics.selectionAsync(); setKeepBySlot((s) => ({ ...s, [slot]: keep.map((x, j) => (j === i ? !x : x)) })); };
  const keptCount = keep.filter(Boolean).length;

  return (
    <SheetBody scroll>
      <SheetHead eyebrow="다르게 먹었어요" title={preset || manual ? '이렇게 기록할까요?' : '무엇을 먹었어요?'} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {slots.map((s) => <Pressable key={s.id} style={chip(slot === s.id)} onPress={() => setSlot(s.id)}><Text style={chipText(slot === s.id)}>{s.label}</Text></Pressable>)}
      </View>

      {!preset && !manual && meal && part && meal.items.length > 1 && (
        <View style={[{ marginTop: 16, padding: 16, paddingBottom: 12, borderRadius: R.lg, backgroundColor: t.surface }, squircle]}>
          <Text style={{ color: t.fg, fontSize: 16, fontWeight: '600' }}>일부만 먹었어요</Text>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>안 먹은 것만 끄면 칼로리와 단백질을 줄여서 기록합니다.</Text>
          <View style={{ marginTop: 8 }}>
            {meal.items.map((x, i) => (
              <Pressable key={`${x.name}-${i}`} accessibilityRole="checkbox" accessibilityState={{ checked: keep[i] }} onPress={() => toggleKeep(i)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: keep[i] ? t.fg : t.ctrl, backgroundColor: keep[i] ? t.fg : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {keep[i] && <Icon name="check" size={12} color={t.onFg} weight="bold" />}
                </View>
                <Text style={{ flex: 1, color: keep[i] ? t.fg : t.muted, fontSize: 15, textDecorationLine: keep[i] ? 'none' : 'line-through' }}>{x.name}</Text>
                <Text style={{ color: t.muted, fontSize: 13.5 }}>{x.amount}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Text style={{ flex: 1, color: t.fg2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{fmt(part.kcal)}kcal · 단백질 {part.protein}g</Text>
            {keptCount === 0
              ? <Btn small kind="ghost" label="건너뛰기로 기록" onPress={() => { const undo = skipMeal(env, v.ctx.key, meal.key); router.back(); toast(`${meal.name} 건너뜀`, undo); }} />
              : <Btn small label="이만큼 먹었어요" icon="check" onPress={() => {
                  if (keptCount === meal.items.length) return;
                  const undo = eatPartial(env, v.ctx.key, meal.key as MealKey, keep);
                  router.back();
                  toast(`${meal.name} ${fmt(part.kcal)}kcal로 기록 · ${part.dropped.map((x) => x.name).join(', ')} 빼고`, undo);
                }} />}
          </View>
        </View>
      )}

      {!preset && !manual && (
        <>
          {meal && <Text style={{ color: t.fg, fontSize: 16, fontWeight: '600', marginTop: 22 }}>대신 먹은 것</Text>}
          {PRESET_GROUPS.filter(([g]) => presets.some((p) => p.group === g)).map(([g, label]) => (
            <View key={g}>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 2 }}>{label}</Text>
              {presets.filter((p) => p.group === g).map((p, i) => (
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
