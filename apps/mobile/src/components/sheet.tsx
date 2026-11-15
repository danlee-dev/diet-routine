import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { Icon } from './Icon';

export function SheetBody({ children }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Always a ScrollView: iOS form sheets adopt the first scroll view as their body, so it must be this one.
  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: insets.bottom + 20 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function SheetHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>{eyebrow}</Text>
        <Text style={{ color: t.fg, fontSize: 30, fontWeight: '300', letterSpacing: -0.8, marginTop: 2 }}>{title}</Text>
      </View>
      <Pressable accessibilityLabel="닫기" onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="x" size={14} color={t.fg} weight="semibold" />
      </Pressable>
    </View>
  );
}
