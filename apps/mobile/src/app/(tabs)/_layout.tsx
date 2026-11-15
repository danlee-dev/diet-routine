import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '@/lib/theme';

// 오늘 / 기록 / 계획 + the separated circular button on iOS 26 for "기록하기".
// One symbol family: filled glyphs of similar weight, the same in both states (as Apple's own iOS 26 tab bars).
export default function TabsLayout() {
  const t = useTheme();
  return (
    <NativeTabs tintColor={t.fg}>
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Label>오늘</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sun.max.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(records)">
        <NativeTabs.Trigger.Label>기록</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.bar.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(plan)">
        <NativeTabs.Trigger.Label>계획</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="book.closed.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(log)" role="search">
        <NativeTabs.Trigger.Label>기록하기</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="plus" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
