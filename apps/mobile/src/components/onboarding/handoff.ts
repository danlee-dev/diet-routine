// Splash -> first screen handoff. Welcome reports where its orb and its 다루 label sit; the splash flies its own
// orb and wordmark there and then tells Welcome to show the real ones, so they read as the same objects.
// Today registers nothing and gets the plain open-and-fade exit.
import { useSyncExternalStore } from 'react';

export interface OrbFrame { x: number; y: number; size: number }
export interface MarkFrame { x: number; y: number; w: number; h: number }

/** The splash turns its orb by this much while it rises; Welcome draws its orb at the same angle. */
export const ORB_TURN_DEG = -30;
/** Letter spacing of the 다루 wordmark as a share of its size, the same on the splash and on Welcome, so the
 *  shrunken splash wordmark lines up with the label glyph for glyph. */
export const MARK_SPACING = 0.02;

let target: OrbFrame | null = null;
let markTarget: MarkFrame | null = null;
let done = false;
const listeners = new Set<() => void>();

export const splashHandoff = {
  setTarget(f: OrbFrame | null) { target = f; },
  target: (): OrbFrame | null => target,
  setMark(f: MarkFrame | null) { markTarget = f; },
  mark: (): MarkFrame | null => markTarget,
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
