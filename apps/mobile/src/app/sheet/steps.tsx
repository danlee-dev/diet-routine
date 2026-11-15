import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { fmt, keypadReduce, type KeypadState } from '@diet/core';
import { setSteps, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { useActiveEnergy } from '@/lib/health';
import { useTheme } from '@/lib/theme';
import { Btn, Keypad, useToast } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

export default function StepsSheet() {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const v = todayView(env);
  const [pad, setPad] = useState<KeypadState>({ n: v.day.steps, fresh: true });
  const press = (k: string) => setPad((s) => keypadReduce(s, k));
  const left = v.stepsGoal - pad.n;
  const active = useActiveEnergy(env);
  return (
    <SheetBody>
      <SheetHead eyebrow="오늘 걸음" title="몇 걸음 걸었어요?" />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, marginTop: 14 }}>
        <Text style={{ fontSize: 52, fontWeight: '300', letterSpacing: -1.5, color: pad.fresh && pad.n > 0 ? t.muted : t.fg, fontVariant: ['tabular-nums'] }}>{fmt(pad.n)}</Text>
        <Text style={{ fontSize: 16, color: t.muted }}>보</Text>
      </View>
      <Text style={{ textAlign: 'center', color: t.muted, fontSize: 13.5 }}>
        {left > 0 ? <>목표 {fmt(v.stepsGoal)}보까지 <Text style={{ color: t.fg, fontWeight: '700' }}>{fmt(left)}보</Text></> : <>오늘 목표 <Text style={{ color: t.fg, fontWeight: '700' }}>{fmt(v.stepsGoal)}보</Text> 달성</>}
      </Text>
      {active != null && active > 0 && (
        <Text lineBreakStrategyIOS="hangul-word" style={{ textAlign: 'center', color: t.muted, fontSize: 12.5, marginTop: 4 }}>
          건강 앱 활동 {fmt(active)}kcal · 오늘 목표에는 운동 기록만 더합니다
        </Text>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
        {[500, 1000, 2000].map((x) => (
          <Pressable key={x} onPress={() => press(`+${x}`)} style={{ height: 34, paddingHorizontal: 13, borderRadius: 999, backgroundColor: t.surface, justifyContent: 'center' }}>
            <Text style={{ color: t.fg, fontSize: 13.5, fontWeight: '600' }}>+{fmt(x)}</Text>
          </Pressable>
        ))}
      </View>
      <Keypad onKey={press} />
      <Btn label="저장" icon="check" style={{ marginTop: 18 }} onPress={() => {
        const u = setSteps(env, v.ctx.key, pad.n);
        router.back();
        toast(pad.n >= v.stepsGoal ? `걸음 ${fmt(pad.n)}보 · 오늘 목표 달성` : `걸음 ${fmt(pad.n)}보 저장`, u);
      }} />
    </SheetBody>
  );
}
