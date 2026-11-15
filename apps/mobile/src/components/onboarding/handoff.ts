// Splash -> first screen handoff. Welcome reports where its orb sits; the splash flies its own orb there and
// then tells Welcome to show the real one, so the two read as one object. Today registers nothing and gets
// the plain open-and-fade exit.
import { useSyncExternalStore } from 'react';

export interface OrbFrame { x: number; y: number; size: number }

/** The splash turns its orb by this much while it breathes; Welcome draws its orb at the same angle. */
export const ORB_TURN_DEG = -30;

let target: OrbFrame | null = null;
let done = false;
const listeners = new Set<() => void>();

export const splashHandoff = {
  setTarget(f: OrbFrame | null) { target = f; },
  target: (): OrbFrame | null => target,
  /** The splash is gone (or never ran): screens show their own orb and start their entrance. */
  finish() {
    if (done) return;
    done = true;
    for (const fn of listeners) fn();
  },
  isDone: (): boolean => done,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

export const useSplashDone = (): boolean =>
  useSyncExternalStore(splashHandoff.subscribe, splashHandoff.isDone, splashHandoff.isDone);
