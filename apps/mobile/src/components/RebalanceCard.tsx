// Shown on Today when the rest of the day, eaten as planned, would run over target (or short on protein).
// One tap writes the proposal as day adjustments; the timeline and the meal table then show the trimmed meals.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmt, MEALS } from '@diet/core';
import { applyRebalance, overCauses, rebalanceToday, rebalanceWorthShowing, type TodayView } from '@diet/data';
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

  const today: [string, string][] = [
    ...p.cuts.map((c): [string, string] => [`${MEALS[c.slot].name} · ${c.label}`, `−${c.kcal}kcal`]),
    ...p.proteinAdds.map((a): [string, string] => [`${MEALS[a.slot].name} · ${a.label} 더하기`, `+${a.kcal}kcal`]),
  ];
  // carry-over: one line when every day gets the same cut ("다음 3일 하루 목표 −200kcal씩")
  const same = p.carry.length > 1 && p.carry.every((c) => c.kcal === p.carry[0]!.kcal);
  const later: [string, string][] = same
    ? [[`다음 ${p.carry.length}일 하루 목표`, `−${p.carry[0]!.kcal}kcal씩`]]
    : p.carry.map((c): [string, string] => [`${c.offset === 1 ? '내일' : `${c.offset}일 뒤`} 하루 목표`, `−${c.kcal}kcal`]);
  if (p.stepsBonus > 0) later.push(['내일 걸음 목표', `+${fmt(p.stepsBonus)}보`]);
  const causes = overCauses(v);
  const title = p.over > 100 ? `오늘 목표보다 ${fmt(p.over)}kcal 많아집니다` : `단백질이 ${env.program.proteinFloor - p.before.protein}g 모자랍니다`;
  // say why in plain words: what was eaten on top of the plan, and what the day adds up to
  const why = p.over > 100
    ? `${causes.length ? `계획에 없던 ${causes.map((c) => `${c.name} ${fmt(c.kcal)}kcal`).join(', ')}를 먹어서, ` : ''}남은 끼니까지 계획대로 먹으면 하루 ${fmt(p.before.total)}kcal로 목표 ${fmt(v.target)}kcal를 넘습니다. 아래처럼 바꾸면 맞춰집니다.`
    : '저녁에 단백질을 조금 더합니다.';
  const group = (label: string, rows: [string, string][]) => rows.length > 0 && (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
      {rows.map(([a, b]) => (
        <View key={a + b} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ flex: 1, color: t.fg2, fontSize: 14.5 }}>{a}</Text>
          <Text style={{ color: t.fg, fontSize: 14.5, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{b}</Text>
        </View>
      ))}
    </View>
  );
  return (
    <View style={[{ marginTop: 12, padding: 18, borderRadius: R.lg, borderWidth: 1.5, borderColor: t.fg, gap: 12 }, squircle]}>
      <View style={{ gap: 3 }}>
        <Text style={{ color: t.fg, fontSize: 16.5, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>
          {why}
        </Text>
      </View>
      {group('오늘 남은 끼니', today)}
      {group('앞으로 며칠', later)}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Btn small label="이렇게 맞추기" icon="check" onPress={() => { const undo = applyRebalance(env, p); toast('남은 계획을 맞췄습니다', undo); }} />
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { devicePref.set(dkey, true); setDismissed(true); }}>
          <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>그대로 두기</Text>
        </Pressable>
      </View>
    </View>
  );
}
