import { NativeTabs } from 'expo-router/native-tabs';
import { useTheme } from '@/lib/theme';

// 오늘 / 운동 / 코치 / 기록 / 계획. Quick logging lives on 오늘; runs and home workouts on 운동.
// One family of plain line glyphs at the same weight, unchanged when selected (the selection capsule shows state).
export default function TabsLayout() {
  const t = useTheme();
  return (
    <NativeTabs tintColor={t.fg}>
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Label>오늘</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sun.max" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(workout)">
        <NativeTabs.Trigger.Label>운동</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="dumbbell" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(coach)">
        <NativeTabs.Trigger.Label>코치</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(records)">
        <NativeTabs.Trigger.Label>기록</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.xyaxis.line" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(plan)">
        <NativeTabs.Trigger.Label>계획</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
