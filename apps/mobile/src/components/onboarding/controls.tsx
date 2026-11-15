// Onboarding controls: large choice rows, chips, a big-number stepper, the chapter progress and the bottom bar.
// Selection is shown by inverting the surface (foreground fill), never by a tint or a colored border.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { R, squircle, useTheme } from '@/lib/theme';
import { CHAPTERS, chapterOf, STEPS, type StepId } from './answers';

export function Sym({ name, size = 16, color, weight = 'semibold' }: { name: SFSymbol; size?: number; color: string; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} />;
}

export function Choice({ label, sub, selected, onPress }: { label: string; sub?: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [
        { minHeight: 64, paddingHorizontal: 20, paddingVertical: 14, borderRadius: R.md, backgroundColor: selected ? t.fg : t.surface, flexDirection: 'row', alignItems: 'center', gap: 12, transform: [{ scale: pressed ? 0.98 : 1 }] },
        squircle,
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: selected ? t.onFg : t.fg, fontSize: 17, fontWeight: '500', letterSpacing: -0.2 }}>{label}</Text>
        {sub ? <Text lineBreakStrategyIOS="hangul-word" style={{ color: selected ? t.onFg : t.muted, opacity: selected ? 0.72 : 1, fontSize: 13.5, lineHeight: 19 }}>{sub}</Text> : null}
      </View>
      {selected && <Sym name="checkmark" size={15} color={t.onFg} weight="bold" />}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, trailing }: { label: string; selected: boolean; onPress: () => void; trailing?: SFSymbol }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [
        { height: 44, paddingHorizontal: 16, borderRadius: 999, backgroundColor: selected ? t.fg : t.surface, flexDirection: 'row', alignItems: 'center', gap: 6, transform: [{ scale: pressed ? 0.96 : 1 }] },
        squircle,
      ]}
    >
      <Text style={{ color: selected ? t.onFg : t.fg, fontSize: 15, fontWeight: '500' }}>{label}</Text>
      {trailing && <Sym name={trailing} size={11} color={selected ? t.onFg : t.muted} weight="bold" />}
    </Pressable>
  );
}

/** Big number with − / + (Apple Fitness goal style); a firmer tick at either end. */
export function Stepper({ value, min, max, unit, onChange, label }: { value: number; min: number; max: number; unit: string; onChange: (v: number) => void; label: string }) {
  const t = useTheme();
  const step = (d: number) => {
    const v = Math.min(max, Math.max(min, value + d));
    if (v === value) { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid); return; }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(v);
  };
  const btn = (d: number, icon: SFSymbol, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={d < 0 ? value <= min : value >= max}
      onPress={() => step(d)}
      style={({ pressed }) => [{ width: 56, height: 56, borderRadius: 28, backgroundColor: pressed ? t.surface2 : t.surface, alignItems: 'center', justifyContent: 'center', opacity: (d < 0 ? value <= min : value >= max) ? 0.4 : 1 }]}
    >
      <Sym name={icon} size={20} color={t.fg} />
    </Pressable>
  );
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${value}${unit}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
    >
      {btn(-1, 'minus', '하나 줄이기')}
      <Text style={{ color: t.fg, fontSize: 64, fontWeight: '200', letterSpacing: -2, fontVariant: ['tabular-nums'] }}>
        {value}<Text style={{ fontSize: 20, fontWeight: '500', letterSpacing: 0, color: t.fg2 }}> {unit}</Text>
      </Text>
      {btn(1, 'plus', '하나 늘리기')}
    </View>
  );
}

/** Four chapters instead of one long bar: the name of each, and how far into it the user is. Static fills. */
export function ChapterBar({ step }: { step: StepId | 'done' }) {
  const t = useTheme();
  const cur = step === 'done' ? CHAPTERS.length : chapterOf(step);
  const at = step === 'done' ? STEPS.length : STEPS.indexOf(step);
  return (
    <View accessible accessibilityLabel={`${CHAPTERS.length}단계 중 ${Math.min(cur + 1, CHAPTERS.length)}단계, ${CHAPTERS[Math.min(cur, CHAPTERS.length - 1)]!.label}`} style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
      {CHAPTERS.map((c, ci) => {
        const first = STEPS.indexOf(c.steps[0]!);
        const fill = ci < cur ? 1 : ci > cur ? 0 : (at - first + 1) / c.steps.length;
        return (
          <View key={c.label} style={{ flex: c.steps.length + 1, gap: 6 }}>
            <Text numberOfLines={1} style={{ color: ci <= cur ? t.fg : t.muted, fontSize: 12, fontWeight: '600' }}>{c.label}</Text>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: t.surface2, overflow: 'hidden' }}>
              <View style={{ width: `${Math.round(fill * 100)}%`, height: 3, backgroundColor: t.fg }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function IconButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Sym name={icon} size={15} color={t.fg} />
    </Pressable>
  );
}

export function TextButton({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" hitSlop={10} onPress={() => { void Haptics.selectionAsync(); onPress(); }} style={({ pressed }) => ({ paddingVertical: 8, paddingHorizontal: 4, opacity: pressed ? 0.55 : 1 })}>
      <Text style={{ color: color ?? t.fg2, fontSize: 15, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Cta({ label, onPress, disabled, busy, icon = 'arrow.right', wide }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; icon?: SFSymbol | null; wide?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={({ pressed }) => [
        { height: 56, paddingHorizontal: 26, borderRadius: 999, backgroundColor: t.fg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled ? 0.3 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        wide && { alignSelf: 'stretch' },
      ]}
    >
      {busy ? <ActivityIndicator color={t.onFg} /> : (
        <>
          <Text style={{ color: t.onFg, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 }}>{label}</Text>
          {icon && <Sym name={icon} size={15} color={t.onFg} weight="bold" />}
        </>
      )}
    </Pressable>
  );
}

/** Question layout: left-aligned title, a short why, the control, then what the answer changes. */
export function Question({ title, sub, children, result }: { title: string; sub?: string; children: ReactNode; result?: ReactNode }) {
  const t = useTheme();
  return (
    <View>
      <Text lineBreakStrategyIOS="hangul-word" accessibilityRole="header" style={{ color: t.fg, fontSize: 34, fontWeight: '300', letterSpacing: -1, lineHeight: 42 }}>{title}</Text>
      {sub ? <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 15, lineHeight: 22, marginTop: 8 }}>{sub}</Text> : null}
      <View style={{ marginTop: 28 }}>{children}</View>
      {result ? <View style={{ marginTop: 22 }}>{result}</View> : null}
    </View>
  );
}

/** "label ........ value" line used for the live results under a question and in the building ledger. */
export function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 5 }}>
      <Text style={{ color: t.muted, fontSize: 14.5, flexShrink: 1 }}>{label}</Text>
      <Text style={{ color: t.fg, fontSize: strong ? 17 : 15, fontWeight: strong ? '700' : '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}
