// Motion sensors during a run: cadence from the pedometer and altitude from the barometer (CMAltimeter).
// The barometer is far steadier than GPS altitude, so when the phone has one, every fix's altitude comes
// from here instead (see session.ts) and elevation gain uses a finer threshold.
import { useSyncExternalStore } from 'react';
import type { EventSubscription } from 'expo';
import type { RunConfig } from '@diet/core';
import { DarouNative } from '../../../modules/darou-native';

/** Elevation settings for barometric altitude (GPS keeps core's defaults). */
export const BARO_CONFIG: Partial<RunConfig> = { elevHysteresis: 2 };

/** A reading older than this is not used for a fix (the sensor stopped, or the app was asleep). */
const FRESH_MS = 3000;
const CADENCE_FRESH_MS = 8000;

interface Live { cadence: number | null; cadenceAt: number }

let subs: EventSubscription[] = [];
let live: Live = { cadence: null, cadenceAt: 0 };
let alt: { m: number; at: number } | null = null;
/** relative altitude restarts at 0 on every start: this keeps a restored run continuous */
let offset: number | null = null;
let baseline: number | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };

export const motion = {
  hasBarometer: (): boolean => DarouNative.altimeterAvailable(),

  /**
   * Start both sensors for a run that began at `startedAt`. `altitudeBaseline` is the last barometric
   * altitude saved before a restart, so the new readings continue from it instead of from 0.
   */
  start(startedAt: number, altitudeBaseline: number | null = null): void {
    motion.stop();
    baseline = altitudeBaseline;
    subs = [
      DarouNative.addListener('onPedometer', (e) => {
        live = { cadence: e.cadence != null && e.cadence > 0 ? Math.round(e.cadence * 60) : null, cadenceAt: e.at };
        emit();
      }),
      DarouNative.addListener('onAltitude', (e) => {
        if (offset == null) offset = (baseline ?? 0) - e.relM;
        alt = { m: Math.round((e.relM + offset) * 10) / 10, at: e.at };
      }),
    ];
    DarouNative.startPedometer(startedAt);
    DarouNative.startAltimeter();
  },

  stop(): void {
    for (const s of subs) s.remove();
    subs = [];
    DarouNative.stopPedometer();
    DarouNative.stopAltimeter();
    live = { cadence: null, cadenceAt: 0 };
    alt = null;
    offset = null;
    baseline = null;
    emit();
  },

  /** Barometric altitude for a fix taken at `t`, or null when no fresh reading exists. */
  altitudeAt(t: number): number | null {
    return alt && Math.abs(t - alt.at) <= FRESH_MS ? alt.m : null;
  },

  /** Steps per minute right now, or null (no pedometer, standing still, or no recent update). */
  cadence(): number | null {
    return live.cadence != null && Date.now() - live.cadenceAt <= CADENCE_FRESH_MS ? live.cadence : null;
  },

  /**
   * Average cadence over the run: steps the motion chip counted between start and end, over moving time.
   * Auto-pause only triggers when standing still, so steps outside moving time are few. Null without a
   * pedometer or when the number is implausible.
   */
  async averageCadence(startedAt: number, endedAt: number, movingS: number): Promise<number | null> {
    if (movingS < 60) return null;
    const steps = await DarouNative.pedometerSteps(startedAt, endedAt);
    if (steps == null || steps <= 0) return null;
    const spm = Math.round(steps / (movingS / 60));
    return spm >= 40 && spm <= 250 ? spm : null;
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/** Live cadence for the recording screen (re-renders on pedometer updates). */
export function useCadence(): number | null {
  useSyncExternalStore(motion.subscribe, () => live.cadenceAt, () => 0);
  return motion.cadence();
}
