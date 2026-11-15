// Which side of the app a launch shows: Welcome + onboarding for a fresh install, the tabs once a profile exists.
// The root layout feeds this into Stack.Protected, so a profile arriving (onboarding saved, or pulled after a
// sign-in) moves the user to Today without any screen navigating by hand.
import { useEffect, useSyncExternalStore } from 'react';
import { adoptLegacyProfile, profileState, type Env } from '@diet/data';

const none = () => () => {};

export function useOnboarded(env: Env | null): boolean {
  const state = useSyncExternalStore(
    env ? env.store.subscribe : none,
    () => (env ? profileState(env.store) : 'ready'),
  );
  // Records but no profile: the owner's install from before onboarding (also when a sign-in pulls such an
  // account onto a fresh device). Keep their built-in plan, as the root layout does at startup.
  useEffect(() => {
    if (env && state === 'legacy') adoptLegacyProfile(env);
  }, [env, state]);
  return state !== 'new';
}
