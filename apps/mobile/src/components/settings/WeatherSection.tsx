// 날씨: rain on walking days. This phone's rough position (only when switched on) or a chosen city.
import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, useColorScheme, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CITIES } from '@diet/core';
import { setWeatherCity, weatherCity } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { coarsePosition, useWeatherLocation, weatherLocation } from '@/lib/weather';
import { R, squircle, useTheme } from '@/lib/theme';

/** Same look as the other switches in Settings (neutral, not the system green). */
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const t = useTheme();
  const dark = useColorScheme() === 'dark';
  const [x] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    Animated.spring(x, { toValue: on ? 1 : 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start();
  }, [on, x]);
  return (
    <Pressable
      accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on, disabled }} disabled={disabled}
      hitSlop={8} onPress={() => { void Haptics.selectionAsync(); onChange(!on); }}
      style={{ width: 50, height: 30, borderRadius: 15, padding: 2, backgroundColor: on ? t.fg : t.ctrl, opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View style={{
        width: 26, height: 26, borderRadius: 13, backgroundColor: on ? t.onFg : dark ? t.fg2 : '#FFFFFF',
        transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
      }} />
    </Pressable>
  );
}

export function WeatherSection() {
  'use no memo'; // reads mutable rows through a stable env
  const env = useEnv();
  const t = useTheme();
  const useLoc = useWeatherLocation();
  const city = weatherCity(env);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = async (on: boolean) => {
    if (!on) { weatherLocation.set(false); setMsg(''); return; }
    setBusy(true);
    const pos = await coarsePosition(true);
    setBusy(false);
    if (!pos) { setMsg('위치를 받지 못해 고른 도시 기준으로 봅니다. 설정 앱에서 위치 권한을 확인해 주세요'); return; }
    weatherLocation.set(true);
    setMsg('이 아이폰의 대략적인 위치(약 10km 단위)로 예보를 봅니다');
  };
  return (
    <View style={{ marginTop: 28 }}>
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 }}>날씨</Text>
      <View style={[{ borderRadius: R.lg, backgroundColor: t.surface, padding: 16, gap: 12 }, squircle]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '500' }}>이 아이폰 위치 사용</Text>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>켜면 대략적인 위치만 씁니다</Text>
          </View>
          <Toggle on={useLoc} disabled={busy} onChange={(on) => void toggle(on)} label="이 아이폰 위치 사용" />
        </View>
        {!!msg && <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.fg2, fontSize: 13, lineHeight: 18 }}>{msg}</Text>}
        <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600', marginTop: 4 }}>{useLoc ? '위치를 못 받을 때 쓸 도시' : '예보를 볼 도시'}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {CITIES.map((c) => {
            const on = city.id === c.id;
            return (
              <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { void Haptics.selectionAsync(); setWeatherCity(env, c.id); }}
                style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', backgroundColor: on ? t.fg : t.bg }}>
                <Text style={{ color: on ? t.onFg : t.fg2, fontSize: 13.5, fontWeight: '500' }}>{c.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 8, paddingHorizontal: 4 }}>
        걷는 날 비나 눈 예보가 있으면 오늘 화면에서 집에서 하는 홈트로 바꾸자고 알려 줍니다. 예보는 Open-Meteo에서 받습니다.
      </Text>
    </View>
  );
}
