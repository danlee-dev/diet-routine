// Press and hold to confirm (finishing a run). A ring fills while held; letting go early rewinds it.
import { useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function HoldButton({ size = 84, icon, label, onComplete, holdMs = 900 }: {
  size?: number; icon: string; label: string; onComplete: () => void; holdMs?: number;
}) {
  const t = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const done = useRef(false);
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = progress.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });

  const begin = () => {
    done.current = false;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.timing(progress, { toValue: 1, duration: holdMs, easing: Easing.linear, useNativeDriver: false }).start(({ finished }) => {
      if (finished && !done.current) {
        done.current = true;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onComplete();
      }
    });
  };
  const cancel = () => {
    if (done.current) return;
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: false }).start();
  };

  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="길게 누르면 실행합니다"
        onPressIn={begin}
        onPressOut={cancel}
        style={({ pressed }) => ({ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.96 : 1 }] })}
      >
        <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: t.surface2 }} />
        <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <AnimatedCircle cx={size / 2} cy={size / 2} r={r} stroke={t.fg} strokeWidth={stroke} fill="none" strokeDasharray={`${c} ${c}`} strokeDashoffset={offset} strokeLinecap="round" />
        </Svg>
        <Icon name={icon} size={size * 0.32} color={t.fg} weight="semibold" />
      </Pressable>
      <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}
