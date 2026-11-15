import { Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

// The whole running area lives inside one full-screen modal: run screen, summary, history, my map, share.
export default function RunLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerTintColor: t.fg,
        headerTitleStyle: { color: t.fg },
        headerLargeTitleStyle: { color: t.fg, fontWeight: '300' },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: t.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="summary" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen name="history" options={{ title: '러닝 기록', headerLargeTitleEnabled: true, headerTransparent: true }} />
      <Stack.Screen name="map" options={{ title: '', headerTransparent: true }} />
      <Stack.Screen
        name="share"
        options={{ presentation: 'formSheet', sheetAllowedDetents: [1], sheetGrabberVisible: true, sheetCornerRadius: 34, headerShown: false }}
      />
    </Stack>
  );
}
