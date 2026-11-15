// Grouped list primitives (iOS inset grouped style): one surface per section, rows separated by an inset hairline.
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from './Icon';

export function Section({ title, footer, children, style, inset = 16 }: {
  title?: string; footer?: string; children: ReactNode; style?: StyleProp<ViewStyle>;
  /** where row separators start (16, or 52 when rows have a leading icon) */
  inset?: number;
}) {
  const t = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[{ marginTop: 28 }, style]}>
      {title ? <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginBottom: 8, paddingHorizontal: 4 }}>{title}</Text> : null}
      <View style={[{ borderRadius: R.lg, backgroundColor: t.surface, overflow: 'hidden' }, squircle]}>
        {rows.map((r, i) => (
          <Fragment key={r.key ?? i}>
            {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginLeft: inset }} />}
            {r}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 8, paddingHorizontal: 4 }}>{footer}</Text> : null}
    </View>
  );
}

export function Row({ icon, title, sub, value, onPress, chevron, right, muted, accessibilityLabel }: {
  icon?: string; title: string; sub?: string; value?: string; onPress?: () => void; chevron?: boolean;
  right?: ReactNode; muted?: boolean; accessibilityLabel?: string;
}) {
  const t = useTheme();
  const body = (
    <>
      {icon && <View style={{ width: 24, alignItems: 'center' }}><Icon name={icon} size={18} color={t.fg} /></View>}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: muted ? t.muted : t.fg, fontSize: 15.5, fontWeight: '500' }}>{title}</Text>
        {sub ? <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{sub}</Text> : null}
      </View>
      {value ? <Text style={{ color: t.muted, fontSize: 15, fontVariant: ['tabular-nums'] }}>{value}</Text> : null}
      {right}
      {chevron && <Icon name="chevron-right" size={12} color={t.muted} weight="semibold" />}
    </>
  );
  const style = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, minHeight: 50, paddingVertical: 12, paddingHorizontal: 16 };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => [style, pressed && { backgroundColor: t.surface2 }]}
    >
      {body}
    </Pressable>
  );
}
