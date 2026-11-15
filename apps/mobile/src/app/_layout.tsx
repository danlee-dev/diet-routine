import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppState, useColorScheme } from 'react-native';
import type { Env } from '@diet/data';
import { getEnv, getSupabase } from '@/lib/env';
import { EnvContext } from '@/lib/hooks';
import { ToastProvider } from '@/components/ui';
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
  const [env, setEnv] = useState<Env | null>(null);

  useEffect(() => {
    void getEnv().then((e) => { setEnv(e); void SplashScreen.hideAsync(); });
  }, []);

  // sync with Supabase when signed in; flush the local snapshot when the app backgrounds
  useEffect(() => {
    if (!env) return;
    const supa = getSupabase();
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') void env.store.flush(); });
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
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="sheet/time" options={sheet('fitToContents', { wheel: true })} />
            <Stack.Screen name="sheet/weight" options={sheet('fitToContents', { wheel: true })} />
            <Stack.Screen name="sheet/steps" options={sheet()} />
            <Stack.Screen name="sheet/scenario" options={sheet()} />
            <Stack.Screen name="sheet/food" options={sheet([0.75, 1])} />
            <Stack.Screen name="sheet/sync" options={sheet()} />
            <Stack.Screen name="workout" options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="run" options={{ presentation: 'fullScreenModal', headerShown: false }} />
          </Stack>
        </ToastProvider>
      </EnvContext.Provider>
    </ThemeProvider>
  );
}
