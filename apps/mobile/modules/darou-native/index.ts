// Typed wrapper for the DarouNative module (ios/DarouNativeModule.swift). On Android, web, or a binary
// built before the module existed, every call is a no-op so callers never need to check the platform.
import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo';

/** Display-only Live Activity state; text comes formatted from @diet/core. Mirrors DarouActivity.swift. */
export interface ActivityState {
  phase: 'moving' | 'autoPaused' | 'paused' | 'done' | 'rest' | 'countdown';
  primary?: string;
  primaryUnit?: string;
  /** epoch ms the clock counts up from */
  clockFrom?: number;
  /** epoch ms the clock counts down to */
  endsAt?: number;
  clockText?: string;
  stat?: string;
  statLabel?: string;
  detail?: string;
}

export type ActivityKind = 'run' | 'walk' | 'rest' | 'cutoff';

interface Events {
  onQueue: (e: Record<string, never>) => void;
  onPedometer: (e: { steps: number; cadence?: number; at: number }) => void;
  onAltitude: (e: { relM: number; at: number }) => void;
}

interface NativeModule {
  appGroupAvailable(): boolean;
  writeGlance(json: string, reload: boolean): boolean;
  reloadWidgets(): void;
  readQueue(): Record<string, unknown>[];
  ackQueue(ids: string[]): void;
  activitiesEnabled(): boolean;
  listActivities(): { id: string; kind: ActivityKind }[];
  startActivity(kind: ActivityKind, title: string, state: ActivityState, staleAt: number | null): Promise<string | null>;
  updateActivity(id: string, state: ActivityState, staleAt: number | null): Promise<boolean>;
  endActivity(id: string, state: ActivityState | null, dismissAt: number | null): Promise<void>;
  pedometerAvailable(): boolean;
  startPedometer(fromMs: number): boolean;
  stopPedometer(): void;
  pedometerSteps(fromMs: number, toMs: number): Promise<number | null>;
  altimeterAvailable(): boolean;
  startAltimeter(): boolean;
  stopAltimeter(): void;
  addListener<K extends keyof Events>(event: K, fn: Events[K]): EventSubscription;
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeModule>('DarouNative') : null;

const noSub: EventSubscription = { remove: () => {} };
const safe = <T>(f: () => T, fallback: T): T => {
  if (!native) return fallback;
  try { return f(); } catch (e) { if (__DEV__) console.warn('[darou-native]', e); return fallback; }
};
const safeAsync = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
  if (!native) return fallback;
  try { return await f(); } catch (e) { if (__DEV__) console.warn('[darou-native]', e); return fallback; }
};

export const DarouNative = {
  available: native != null,
  appGroupAvailable: () => safe(() => native!.appGroupAvailable(), false),
  writeGlance: (json: string, reload: boolean) => safe(() => native!.writeGlance(json, reload), false),
  reloadWidgets: () => safe(() => native!.reloadWidgets(), undefined),
  readQueue: () => safe(() => native!.readQueue(), [] as Record<string, unknown>[]),
  ackQueue: (ids: string[]) => safe(() => native!.ackQueue(ids), undefined),

  activitiesEnabled: () => safe(() => native!.activitiesEnabled(), false),
  listActivities: () => safe(() => native!.listActivities(), [] as { id: string; kind: ActivityKind }[]),
  startActivity: (kind: ActivityKind, title: string, state: ActivityState, staleAt: number | null = null) =>
    safeAsync(() => native!.startActivity(kind, title, state, staleAt), null),
  updateActivity: (id: string, state: ActivityState, staleAt: number | null = null) =>
    safeAsync(() => native!.updateActivity(id, state, staleAt), false),
  endActivity: (id: string, state: ActivityState | null = null, dismissAt: number | null = null) =>
    safeAsync(() => native!.endActivity(id, state, dismissAt), undefined),

  pedometerAvailable: () => safe(() => native!.pedometerAvailable(), false),
  startPedometer: (fromMs: number) => safe(() => native!.startPedometer(fromMs), false),
  stopPedometer: () => safe(() => native!.stopPedometer(), undefined),
  pedometerSteps: (fromMs: number, toMs: number) => safeAsync(() => native!.pedometerSteps(fromMs, toMs), null),
  altimeterAvailable: () => safe(() => native!.altimeterAvailable(), false),
  startAltimeter: () => safe(() => native!.startAltimeter(), false),
  stopAltimeter: () => safe(() => native!.stopAltimeter(), undefined),

  addListener: <K extends keyof Events>(event: K, fn: Events[K]): EventSubscription =>
    safe(() => native!.addListener(event, fn), noSub),
};
