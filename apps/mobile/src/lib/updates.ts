// Over-the-air updates without waiting for a second cold start. Expo already downloads an update at launch
// and applies it on the next cold start; on top of that the app checks again each time it comes back to the
// foreground, and applies a downloaded update when it returns after at least five minutes away (where a
// fresh start costs nothing). Never during a run that is recording or while a workout screen is open.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { runSession } from './run/session';

const AWAY_MS = 5 * 60 * 1000;
let holds = 0;

/** Keeps a downloaded update from reloading the app while this screen is open (a workout in progress). */
export function useHoldUpdates(): void {
  useEffect(() => {
    holds++;
    return () => { holds--; };
  }, []);
}

export function useApplyUpdates(): void {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let ready = false;
    let checking = false;
    let leftAt = 0;
    const check = async () => {
      if (checking || ready) return;
      checking = true;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable) ready = (await Updates.fetchUpdateAsync()).isNew;
      } catch {
        // offline or the update server is slow: the next foreground tries again
      } finally {
        checking = false;
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') { leftAt = Date.now(); return; }
      if (st !== 'active') return;
      const away = leftAt ? Date.now() - leftAt : 0;
      if (ready && away >= AWAY_MS && holds === 0 && runSession.get().phase !== 'recording') {
        void Updates.reloadAsync().catch(() => {});
        return;
      }
      void check();
    });
    return () => sub.remove();
  }, []);
}
