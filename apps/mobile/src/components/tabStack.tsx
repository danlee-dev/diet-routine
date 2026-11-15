import { router, Stack } from 'expo-router';
import { useTheme } from '@/lib/theme';

/**
 * Native iOS header for a tab: large title that collapses on scroll. On iOS 26 the header is
 * transparent and the system scroll edge effect softly blurs content scrolling under the status bar,
 * so text never collides with it. (No extra headerBlurEffect: the docs warn the two overlap.)
 * The account button is a native bar button (Stack.Toolbar), so it gets the system glass and hit target.
 */
export function TabStack({ screen, title }: { screen: string; title: string }) {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerTintColor: t.fg,
        headerTitleStyle: { color: t.fg },
        headerLargeTitleStyle: { color: t.fg, fontWeight: '300' },
      }}
    >
      <Stack.Screen name={screen} options={{ title }}>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="person.crop.circle" accessibilityLabel="설정과 계정" onPress={() => router.push('/settings')} />
        </Stack.Toolbar>
      </Stack.Screen>
    </Stack>
  );
}
