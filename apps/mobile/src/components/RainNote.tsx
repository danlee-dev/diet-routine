// Rain while one would walk today: offer the home workout that is due instead (one tap, undo in the toast).
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { rainSuggestion, swapWalkForWorkout, type TodayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/env';
import { useForecast } from '@/lib/weather';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';
import { Btn, useToast } from './ui';

export function RainNote({ v }: { v: TodayView }) {
  'use no memo'; // reads mutable rows through a stable env
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const hours = useForecast(env, v.session === 'walk');
  const dkey = `rain:${v.ctx.key}`;
  const [kept, setKept] = useState(() => devicePref.get<boolean>(dkey, false));
  const s = hours ? rainSuggestion(env, v, hours) : null;
  if (!s || kept) return null;
  const r = v.routines[s.routine];
  return (
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 14, paddingVertical: 12, paddingHorizontal: 4 }}>
      <View style={{ paddingTop: 1 }}><Icon name={s.check.snow ? 'cloud-snow' : 'cloud-rain'} size={18} color={t.fg2} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.fg, fontSize: 14.5, fontWeight: '600' }}>{s.text}</Text>
        <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>걷는 날이지만 오늘은 집에서 {r.name}({r.focus})로 바꿀 수 있습니다</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 }}>
          <Btn small icon="dumbbell" label="홈트로 바꾸기" onPress={() => { const undo = swapWalkForWorkout(env, s.routine); toast(`오늘은 걷기 대신 ${r.name}를 합니다`, undo); }} />
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { devicePref.set(dkey, true); setKept(true); }}>
            <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>그대로 걷기</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
