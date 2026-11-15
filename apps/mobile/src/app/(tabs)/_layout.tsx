import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '@/lib/theme';

// 오늘 / 기록 / 계획 + the separated circular button on iOS 26 for "기록하기".
export default function TabsLayout() {
  const t = useTheme();
  return (
    <NativeTabs tintColor={t.fg}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>오늘</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="records">
        <NativeTabs.Trigger.Label>기록</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.xyaxis.line" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="plan">
        <NativeTabs.Trigger.Label>계획</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="log" role="search">
        <NativeTabs.Trigger.Label>기록하기</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="plus" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
