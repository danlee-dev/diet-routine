import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, useColorScheme } from 'react-native';
import { useTheme } from '@/lib/theme';
import { adoptLegacyProfile, profileState, type Env } from '@diet/data';
import { getEnv, getSupabase } from '@/lib/env';
import { EnvContext } from '@/lib/hooks';
import { useReminders } from '@/lib/notifications';
import { useHealthSync } from '@/lib/health';
import { ToastProvider } from '@/components/ui';
import { Splash } from '@/components/onboarding/Splash';
import { useOnboarded } from '@/components/onboarding/gate';
import '@/lib/run/session'; // defines the background location task at startup

void SplashScreen.preventAutoHideAsync();

const sheet = (detents: number[] | 'fitToContents' = 'fitToContents', opts: { wheel?: boolean } = {}) => ({
  presentation: 'formSheet' as const,
  sheetAllowedDetents: detents,
  // sheets with wheel pickers: a downward drag must spin the wheel, not dismiss the sheet
  sheetGrabberVisible: !opts.wheel,
  gestureEnabled: !opts.wheel,
  sheetCornerRadius: 34,
  headerShown: false,
});

export default function RootLayout() {
  const scheme = useColorScheme();
  const t = useTheme();
  const [env, setEnv] = useState<Env | null>(null);
  const onboarded = useOnboarded(env);
  useReminders(env); // schedule today's reminders and handle notification buttons (cold start included)
  useHealthSync(env); // Apple Health steps/weight/sleep in, weight/workouts out, once connected in settings

  useEffect(() => {
    void getEnv().then((e) => {
      // the owner's install from before onboarding existed: keep their plan exactly as it was
      if (profileState(e.store) === 'legacy') adoptLegacyProfile(e);
      setEnv(e); // <Splash> hides the native splash once it has drawn the same frame
    });
  }, []);

  // sync with Supabase when signed in; flush the local snapshot when the app backgrounds
  useEffect(() => {
    if (!env) return;
    const supa = getSupabase();
    // background: save the snapshot. foreground: catch up on anything changed elsewhere while realtime was asleep.
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') void env.store.flush(); else void env.store.refresh(); });
    if (!supa) return () => sub.remove();
    void supa.auth.getSession().then(({ data }) => { if (data.session) void env.store.attach(supa, data.session.user.id); });
    const { data: auth } = supa.auth.onAuthStateChange((evt, session) => {
      if (evt === 'SIGNED_OUT') env.store.detach();
      if (evt === 'SIGNED_IN' && session) void env.store.attach(supa, session.user.id);
    });
    return () => { sub.remove(); auth.subscription.unsubscribe(); };
  }, [env]);

  if (!env) return null;
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <EnvContext.Provider value={env}>
        <ToastProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={!onboarded} redirectTo="/">
              <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
              <Stack.Screen name="onboarding" />
            </Stack.Protected>
            <Stack.Protected guard={onboarded} redirectTo="/welcome">
              {/* only ever pushed by the guard (onboarding saved, or a profile pulled after sign-in): fade into Today.
                  No swipe-back: the guarded welcome can still sit under it in the stack. */}
              <Stack.Screen name="(tabs)" options={{ animation: 'fade', gestureEnabled: false }} />
            </Stack.Protected>
            <Stack.Screen name="sheet/time" options={sheet('fitToContents', { wheel: true })} />
            <Stack.Screen name="sheet/weight" options={sheet('fitToContents', { wheel: true })} />
            <Stack.Screen name="sheet/steps" options={sheet()} />
            <Stack.Screen name="sheet/scenario" options={sheet()} />
            <Stack.Screen name="sheet/food" options={sheet([0.75, 1])} />
            <Stack.Screen name="sheet/meal" options={sheet([0.8, 1])} />
            {/* a page sheet: the preview scrolls between a fixed header and a fixed share button */}
            <Stack.Screen name="sheet/share-meals" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="sheet/routine" options={sheet([0.75, 1])} />
            <Stack.Screen
              name="settings"
              options={{
                presentation: 'modal', headerShown: true, title: '설정', headerLargeTitleEnabled: true,
                headerShadowVisible: false, headerLargeTitleShadowVisible: false,
                headerTitleStyle: { color: t.fg }, headerLargeTitleStyle: { color: t.fg, fontWeight: '300' },
              }}
            />
            <Stack.Screen name="auth/callback" options={{ animation: 'none' }} />
            <Stack.Screen name="workout" options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="coach" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="run" options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="answers" options={{ presentation: 'fullScreenModal' }} />
          </Stack>
          <Splash />
        </ToastProvider>
      </EnvContext.Provider>
    </ThemeProvider>
  );
}
