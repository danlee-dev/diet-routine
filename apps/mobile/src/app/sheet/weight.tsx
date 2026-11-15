import { useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { mdw, programDate, programKey, sgn } from '@diet/core';
import { dayRecord, previousWeightFor, setWeight, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { Btn, PickerFrame, useToast, Wheel, type WheelItem } from '@/components/ui';
import { SheetBody, SheetHead } from '@/components/sheet';

const KG: WheelItem[] = Array.from({ length: 111 }, (_, n) => ({ v: 40 + n, t: String(40 + n) }));
const DEC: WheelItem[] = Array.from({ length: 10 }, (_, n) => ({ v: n, t: String(n) }));

export default function WeightSheet() {
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const params = useLocalSearchParams<{ i?: string }>();
  const v = todayView(env);
  const i = params.i != null ? Number(params.i) : v.ctx.idx;
  const key = programKey(env.program, i);
  const isToday = key === v.ctx.key;
  const has = dayRecord(env, i).weight;
  const prev = previousWeightFor(env, i);
  const t10 = Math.round((has ?? prev ?? env.program.startWeight) * 10);
  const [kg, setKg] = useState(Math.min(150, Math.max(40, Math.floor(t10 / 10))));
  const [dec, setDec] = useState(((t10 % 10) + 10) % 10);
  const value = Math.round((kg + dec / 10) * 10) / 10;
  const label = isToday ? '체중' : `${mdw(programDate(env.program, i))} 체중`;
  return (
    <SheetBody>
      <SheetHead eyebrow={isToday ? '아침 체중' : label} title={has != null ? '체중 고치기' : '몇 kg이에요?'} />
      <PickerFrame>
        <Wheel items={KG} value={kg} onChange={setKg} label="킬로그램" />
        <Text style={{ color: t.fg, fontSize: 25, marginHorizontal: -2 }}>.</Text>
        <Wheel items={DEC} value={dec} onChange={setDec} width={54} label="소수점 아래" />
        <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600' }}>kg</Text>
      </PickerFrame>
      <Text style={{ color: t.muted, fontSize: 13.5, textAlign: 'center', marginTop: 14 }}>
        시작 대비 <Text style={{ color: t.fg, fontWeight: '700' }}>{sgn(value - env.program.startWeight)}kg</Text>
        {prev != null && <> · 지난 기록보다 <Text style={{ color: t.fg, fontWeight: '700' }}>{sgn(value - prev)}kg</Text></>}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        {has != null && <Btn kind="ghost" label="지우기" onPress={() => { const u = setWeight(env, key, null); router.back(); toast(`${label} 기록을 지웠습니다`, u); }} />}
        <Btn label="저장" icon="check" style={{ flex: 1 }} onPress={() => { const u = setWeight(env, key, value); router.back(); toast(`${label} ${value.toFixed(1)}kg 저장`, u); }} />
      </View>
    </SheetBody>
  );
}
