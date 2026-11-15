// Shared app primitives: buttons, orb, toast with undo, wheel picker, keypad.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type ScrollViewInstance, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from './Icon';

// ---------------- buttons ----------------
export function Btn({ label, icon, onPress, kind = 'primary', style, small }: {
  label: string; icon?: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'quiet'; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.fg : 'transparent';
  const fg = kind === 'primary' ? t.onFg : t.fg;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [
        { height: small ? 36 : 46, paddingHorizontal: small ? 14 : 18, borderRadius: 999, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, transform: [{ scale: pressed ? 0.96 : 1 }] },
        kind === 'ghost' && { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={small ? 14 : 16} color={fg} weight="semibold" />}
      <Text style={{ color: fg, fontSize: small ? 13.5 : 15.5, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

// ---------------- orb (the single color accent) ----------------
export function Orb({ size, style }: { size: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="a" cx="30%" cy="30%" r="55%"><Stop offset="0" stopColor={t.orb4} /><Stop offset="1" stopColor={t.orb4} stopOpacity="0" /></RadialGradient>
          <RadialGradient id="b" cx="72%" cy="34%" r="60%"><Stop offset="0" stopColor={t.orb2} /><Stop offset="1" stopColor={t.orb2} stopOpacity="0" /></RadialGradient>
          <RadialGradient id="c" cx="40%" cy="76%" r="70%"><Stop offset="0" stopColor={t.orb1} /><Stop offset="1" stopColor={t.orb1} stopOpacity="0" /></RadialGradient>
        </Defs>
        <Circle cx="50" cy="50" r="50" fill={t.orb3} />
        <Circle cx="50" cy="50" r="50" fill="url(#c)" />
        <Circle cx="50" cy="50" r="50" fill="url(#b)" />
        <Circle cx="50" cy="50" r="50" fill="url(#a)" />
      </Svg>
    </View>
  );
}

// ---------------- toast ----------------
interface ToastApi { toast: (text: string, undo?: () => void) => void }
const ToastCtx = createContext<ToastApi | null>(null);
export const useToast = (): ToastApi => {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<{ text: string; undo?: () => void } | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setState(null));
  }, [anim]);
  const toast = useCallback((text: string, undo?: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    setState({ text, undo });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220 }).start();
    timer.current = setTimeout(hide, 4000);
  }, [anim, hide]);
  const api = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      {state && (
        <Animated.View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 8, alignItems: 'center', opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }}
        >
          <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 18, paddingRight: 8, paddingVertical: 8, borderRadius: 999, backgroundColor: t.fg, maxWidth: '100%' }, squircle]}>
            <Text numberOfLines={1} style={{ color: t.onFg, fontSize: 14, flexShrink: 1 }}>{state.text}</Text>
            {state.undo && (
              <Pressable onPress={() => { const u = state.undo; hide(); u?.(); }} style={{ height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(127,127,127,0.25)', justifyContent: 'center' }}>
                <Text style={{ color: t.onFg, fontWeight: '700', fontSize: 13 }}>되돌리기</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  );
}

// ---------------- wheel picker ----------------
const IH = 46;
export interface WheelItem { v: number; t: string }

export function Wheel({ items, value, onChange, width = 78, label }: { items: WheelItem[]; value: number; onChange: (v: number) => void; width?: number; label: string }) {
  const t = useTheme();
  const [initial] = useState(() => Math.max(0, items.findIndex((x) => x.v === value)));
  const [scrollY] = useState(() => new Animated.Value(initial * IH));
  const ref = useRef<ScrollViewInstance | null>(null);
  const idx = useRef(initial);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  // index changes come from the native scroll value, outside render (haptic tick per item)
  useEffect(() => {
    const id = scrollY.addListener(({ value: y }) => {
      const i = Math.max(0, Math.min(items.length - 1, Math.round(y / IH)));
      if (i !== idx.current) { idx.current = i; void Haptics.selectionAsync(); onChangeRef.current(items[i]!.v); }
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, items]);
  // external changes (e.g. the "now" button)
  useEffect(() => {
    const i = items.findIndex((x) => x.v === value);
    if (i >= 0 && i !== idx.current) { idx.current = i; ref.current?.scrollTo({ y: i * IH, animated: true }); }
  }, [value, items]);
  const [onScroll] = useState(() => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }));
  // A plain ScrollView (not a virtualized list): the sheet adopts its own body scroll view, not this one.
  return (
    <View style={{ width, height: IH * 5, overflow: 'hidden' }} collapsable={false}>
      <Animated.ScrollView
        ref={ref}
        accessibilityLabel={label}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: IH * 2 }}
        contentOffset={{ x: 0, y: initial * IH }}
        showsVerticalScrollIndicator={false}
        snapToInterval={IH}
        decelerationRate="fast"
        nestedScrollEnabled
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {items.map((item, index) => {
          const scale = scrollY.interpolate({ inputRange: [(index - 3) * IH, index * IH, (index + 3) * IH], outputRange: [0.76, 1, 0.76], extrapolate: 'clamp' });
          const opacity = scrollY.interpolate({ inputRange: [(index - 2.5) * IH, index * IH, (index + 2.5) * IH], outputRange: [0.15, 1, 0.15], extrapolate: 'clamp' });
          return (
            <Pressable key={item.v} onPress={() => ref.current?.scrollTo({ y: index * IH, animated: true })} style={{ height: IH, alignItems: 'center', justifyContent: 'center' }}>
              <Animated.Text style={{ fontSize: 25, fontWeight: '300', color: t.fg, fontVariant: ['tabular-nums'], opacity, transform: [{ scale }] }}>{item.t}</Animated.Text>
            </Pressable>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

export function PickerFrame({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ height: IH * 5, marginTop: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
      <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: IH * 2, height: IH, borderRadius: R.sm, backgroundColor: t.surface }, squircle]} />
      {children}
    </View>
  );
}

// ---------------- keypad ----------------
export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const t = useTheme();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'c', '0', 'b'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
      {keys.map((k) => (
        <Pressable
          key={k}
          accessibilityLabel={k === 'b' ? '한 자리 지우기' : k === 'c' ? '비우기' : k}
          onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onKey(k); }}
          style={({ pressed }) => [{ width: '31.8%', height: 54, borderRadius: R.md, backgroundColor: pressed ? t.surface2 : t.surface, alignItems: 'center', justifyContent: 'center' }, squircle]}
        >
          {k === 'b' ? <Icon name="delete" size={22} color={t.fg2} /> : <Text style={{ fontSize: k === 'c' ? 15 : 26, fontWeight: k === 'c' ? '600' : '300', color: k === 'c' ? t.fg2 : t.fg }}>{k === 'c' ? '비우기' : k}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  eyebrow: { fontSize: 12.5, fontWeight: '600', letterSpacing: 0.2 },
});
