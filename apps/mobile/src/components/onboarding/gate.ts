// Which side of the app a launch shows: Welcome + onboarding for a fresh install, the tabs once a profile exists.
// The root layout feeds this into Stack.Protected, so a profile arriving (onboarding saved, or pulled after a
// sign-in) moves the user to Today without any screen navigating by hand.
import { useEffect, useSyncExternalStore } from 'react';
import { adoptLegacyProfile, profileState, type Env } from '@diet/data';

const none = () => () => {};

type Gate = 'ready' | 'new' | 'legacy-local' | 'legacy-account';

export function useOnboarded(env: Env | null): boolean {
  const state = useSyncExternalStore<Gate>(
    env ? env.store.subscribe : none,
    () => {
      if (!env) return 'ready';
      const st = profileState(env.store);
      if (st !== 'legacy') return st;
      return env.store.currentUserId ? 'legacy-account' : 'legacy-local';
    },
  );
  // Records but no profile on a signed-out device: the owner's install from before onboarding. Keep their built-in
  // plan, as the root layout does at startup. A signed-in account in that state (e.g. records written on the web
  // before it had onboarding) is someone else's: it goes through onboarding instead of getting the owner's numbers.
  useEffect(() => {
    if (env && state === 'legacy-local') adoptLegacyProfile(env);
  }, [env, state]);
  return state === 'ready' || state === 'legacy-local';
}
