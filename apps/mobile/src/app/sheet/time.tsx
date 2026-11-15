import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { hhmm, minutesOf, pad, schedule } from '@diet/core';
import { setWake, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn, PickerFrame, useToast, Wheel, type WheelItem } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

const HOURS: WheelItem[] = Array.from({ length: 24 }, (_, i) => ({ v: i, t: pad(i) }));
const MINS: WheelItem[] = Array.from({ length: 60 }, (_, i) => ({ v: i, t: pad(i) }));

export default function TimeSheet() {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const v = todayView(env);
  const start = v.day.wake_min ?? minutesOf(env.now());
  const [h, setH] = useState(Math.floor(start / 60) % 24);
  const [m, setM] = useState(start % 60);
  const wake = h * 60 + m;
  const s = schedule(wake)!;
  const din = v.scen === 'lateHome' ? 19 * 60 : s.d;
  const cells: [string, number][] = s.merge ? [['첫 끼', s.b], ['점심', s.l], ['저녁', din]] : [['아침', s.b], ['점심', s.l], ['간식', s.s], ['저녁', din]];
  return (
    <SheetBody>
      <SheetHead eyebrow="기상 시간" title="몇 시에 일어났어요?" />
      <PickerFrame>
        <Wheel items={HOURS} value={h} onChange={setH} label="시" />
        <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600', marginRight: 12 }}>시</Text>
        <Wheel items={MINS} value={m} onChange={setM} label="분" />
        <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600' }}>분</Text>
      </PickerFrame>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 16 }}>
        {cells.map(([l, at]) => (
          <View key={l} style={[{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: R.sm, backgroundColor: t.surface }, squircle]}>
            <Text style={{ color: t.muted, fontSize: 12 }}>{l}</Text>
            <Text style={{ color: t.fg, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{hhmm(at)}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        <Btn kind="ghost" label="지금" onPress={() => { const n = minutesOf(env.now()); setH(Math.floor(n / 60)); setM(n % 60); }} />
        <Btn label="이 시간으로 맞추기" icon="check" style={{ flex: 1 }} onPress={() => { setWake(env, wake, { lateRule: true }); router.back(); toast(`기상 ${hhmm(wake)} · 끼니 시간을 맞췄습니다`); }} />
      </View>
    </SheetBody>
  );
}
