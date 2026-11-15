// Shown on Today when the rest of the day, eaten as planned, would run over target (or short on protein).
// One tap writes the proposal as day adjustments; the timeline and the meal table then show the trimmed meals.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmt, MEALS } from '@diet/core';
import { applyRebalance, rebalanceToday, rebalanceWorthShowing, type TodayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/env';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn, useToast } from './ui';

export function RebalanceCard({ v }: { v: TodayView }) {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const p = rebalanceToday(env, v);
  // dismissal is remembered per day and per 100 kcal step, so a bigger overshoot asks again
  const dkey = `rb:${v.ctx.key}:${Math.floor(p.over / 100)}:${p.proteinAdds.length}`;
  const [dismissed, setDismissed] = useState(() => devicePref.get<boolean>(dkey, false));
  if (!rebalanceWorthShowing(p) || dismissed) return null;

  const lines: [string, string][] = [
    ...p.cuts.map((c): [string, string] => [`${MEALS[c.slot].name} · ${c.label}`, `−${c.kcal}`]),
    ...p.proteinAdds.map((a): [string, string] => [`${MEALS[a.slot].name} · ${a.label} 더하기`, `+${a.kcal}`]),
    ...p.carry.map((c): [string, string] => [c.offset === 1 ? '내일' : `${c.offset}일 뒤`, `−${c.kcal}`]),
  ];
  const title = p.over > 100 ? `이대로면 오늘 ${fmt(p.over)}kcal 넘칩니다` : `단백질이 ${env.program.proteinFloor - p.before.protein}g 모자랍니다`;
  return (
    <View style={[{ marginTop: 12, padding: 18, borderRadius: R.lg, borderWidth: 1.5, borderColor: t.fg, gap: 12 }, squircle]}>
      <View style={{ gap: 3 }}>
        <Text style={{ color: t.fg, fontSize: 16.5, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>
          {p.over > 100 ? '남은 끼니에서 먼저 줄이고, 그래도 남으면 며칠에 나눠 덜 먹습니다. 단백질은 줄이지 않습니다.' : '저녁에 단백질을 조금 더합니다.'}
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        {lines.map(([a, b]) => (
          <View key={a + b} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ flex: 1, color: t.fg2, fontSize: 14.5 }}>{a}</Text>
            <Text style={{ color: t.fg, fontSize: 14.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{b}kcal</Text>
          </View>
        ))}
        {p.stepsBonus > 0 && <Text style={{ color: t.fg2, fontSize: 14.5 }}>내일 걸음 +{fmt(p.stepsBonus)}</Text>}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Btn small label="이렇게 맞추기" icon="check" onPress={() => { const undo = applyRebalance(env, p); toast('남은 계획을 맞췄습니다', undo); }} />
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { devicePref.set(dkey, true); setDismissed(true); }}>
          <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>그대로 두기</Text>
        </Pressable>
      </View>
    </View>
  );
}
