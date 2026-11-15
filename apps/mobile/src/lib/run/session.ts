// The one active run. GPS comes through a TaskManager location task (keeps running with the screen locked,
// "When In Use" permission is enough because the run starts in the foreground). Every fix goes into the
// RunTracker from @diet/core, and the recorded events are saved so a run survives the app being killed.
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import Storage from 'expo-sqlite/kv-store';
import { replayRun, runConfigFor, RunTracker, type GeoFix, type LatLng, type RunEvent, type RunLive, type RunSummary, type Split } from '@diet/core';
import { cueSplit, cueState } from './cues';

export const RUN_TASK = 'dr-run-location';
const ACTIVE_KEY = 'dr:run:active:v1';
/** A saved run older than this is restored paused, without switching GPS back on (the app died long ago). */
const STALE_MS = 20 * 60 * 1000;
const SAVE_EVERY_MS = 30_000;

export type RunKind = 'run' | 'walk';

export interface RunSnapshot {
  phase: 'idle' | 'recording';
  id: string | null;
  kind: RunKind;
  startedAt: number | null;
  /** manual pause */
  paused: boolean;
  live: RunLive | null;
  /** stretches drawn so far (a manual pause starts a new one) */
  segments: LatLng[][];
  /** time of the newest accepted fix, for a smooth clock between fixes */
  lastFixAt: number | null;
  /** pre-run GPS from the foreground watch */
  gps: { acc: number | null; point: LatLng; at: number } | null;
  permission: 'unknown' | 'granted' | 'denied';
  error: string | null;
}

export interface FinishedRun {
  id: string;
  kind: RunKind;
  startedAt: Date;
  endedAt: Date;
  summary: RunSummary;
}

const TASK_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  activityType: Location.ActivityType.Fitness,
  distanceInterval: 0,
  timeInterval: 1000,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
};

// Compact persisted events: ['f', t, lat, lng, acc, alt, altAcc, speed] | ['p', t] | ['r', t]
type Packed = ['f', number, number, number, number | null, number | null, number | null, number | null] | ['p', number] | ['r', number];
const r7 = (x: number) => Math.round(x * 1e7) / 1e7;
const r1 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const pack = (e: RunEvent): Packed =>
  e.k === 'fix' ? ['f', e.f.t, r7(e.f.lat), r7(e.f.lng), r1(e.f.acc), r1(e.f.alt), r1(e.f.altAcc), r1(e.f.speed)] : [e.k === 'pause' ? 'p' : 'r', e.t];
const unpack = (p: Packed): RunEvent =>
  p[0] === 'f' ? { k: 'fix', f: { t: p[1], lat: p[2], lng: p[3], acc: p[4], alt: p[5], altAcc: p[6], speed: p[7] } } : { k: p[0] === 'p' ? 'pause' : 'resume', t: p[1] };

interface Persisted { v: 1; id: string; kind: RunKind; startedAt: number; paused: boolean; events: Packed[] }

const toFix = (l: Location.LocationObject): GeoFix => ({
  lat: l.coords.latitude, lng: l.coords.longitude, t: l.timestamp, acc: l.coords.accuracy,
  alt: l.coords.altitude, altAcc: l.coords.altitudeAccuracy, speed: l.coords.speed,
});

const idle = (permission: RunSnapshot['permission'] = 'unknown'): RunSnapshot => ({
  phase: 'idle', id: null, kind: 'run', startedAt: null, paused: false, live: null, segments: [], lastFixAt: null, gps: null, permission, error: null,
});

class RunSession {
  private snap: RunSnapshot = idle();
  private listeners = new Set<() => void>();
  private tracker: RunTracker | null = null;
  private events: RunEvent[] = [];
  private watch: Location.LocationSubscription | null = null;
  /** bumped by coolDown, so a watch that resolves after the screen closed is removed at once */
  private watchToken = 0;
  private lastSave = 0;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.restore().catch(() => {});
    AppState.addEventListener('change', (s) => { if (s !== 'active') this.persist(true); });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  get = (): RunSnapshot => this.snap;
  private set(patch: Partial<RunSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  async ensurePermission(): Promise<boolean> {
    const cur = await Location.getForegroundPermissionsAsync();
    let ok = cur.granted;
    if (!ok && cur.canAskAgain) ok = (await Location.requestForegroundPermissionsAsync()).granted;
    this.set({ permission: ok ? 'granted' : 'denied' });
    return ok;
  }

  /** Before the start: watch GPS so the screen can show accuracy and centre the map. */
  async warmUp(): Promise<void> {
    await this.ready;
    if (this.snap.phase === 'recording' || this.watch) return;
    const token = ++this.watchToken;
    if (!(await this.ensurePermission()) || token !== this.watchToken) return;
    try {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 1000 },
        (l) => this.set({ gps: { acc: l.coords.accuracy, point: { lat: l.coords.latitude, lng: l.coords.longitude }, at: l.timestamp } }),
      );
      if (token !== this.watchToken || this.get().phase === 'recording') sub.remove(); // get(): the phase may have changed while awaiting
      else this.watch = sub;
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  coolDown(): void {
    this.watchToken++;
    this.watch?.remove();
    this.watch = null;
  }

  async start(kind: RunKind, id: string): Promise<void> {
    await this.ready;
    if (this.snap.phase === 'recording') return;
    if (!(await this.ensurePermission())) return;
    this.coolDown();
    const startedAt = Date.now();
    this.tracker = new RunTracker(startedAt, runConfigFor(kind));
    this.events = [];
    this.set({ phase: 'recording', id, kind, startedAt, paused: false, live: this.tracker.live(), segments: [], lastFixAt: null, error: null });
    this.persist(true);
    cueState('start', kind);
    await this.ensureUpdates();
  }

  private async ensureUpdates(): Promise<void> {
    try {
      if (!(await Location.hasStartedLocationUpdatesAsync(RUN_TASK))) await Location.startLocationUpdatesAsync(RUN_TASK, TASK_OPTIONS);
      this.set({ error: null });
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }

  pause(): void {
    if (!this.tracker || this.snap.paused) return;
    this.tracker.pause();
    this.events.push({ k: 'pause', t: Date.now() });
    this.set({ paused: true, live: this.tracker.live() });
    this.persist(true);
    cueState('pause', this.snap.kind);
  }

  resume(): void {
    if (!this.tracker || !this.snap.paused) return;
    this.tracker.resume();
    this.events.push({ k: 'resume', t: Date.now() });
    this.set({ paused: false, live: this.tracker.live() });
    this.persist(true);
    cueState('resume', this.snap.kind);
    void this.ensureUpdates(); // a run restored long after a crash comes back paused with GPS off
  }

  /**
   * Stop GPS and hand back the result; the caller saves it with saveRun and then calls forget().
   * The recorded events stay on disk until then, so a crash in between loses nothing.
   */
  async finish(): Promise<FinishedRun | null> {
    const tr = this.tracker;
    const { id, kind, startedAt } = this.snap;
    if (!tr || !id || startedAt == null) return null;
    this.persist(true);
    await this.stopUpdates();
    const endedAt = Date.now();
    const summary = tr.summary(endedAt);
    this.tracker = null;
    this.events = [];
    this.set({ ...idle(this.snap.permission) });
    return { id, kind, startedAt: new Date(startedAt), endedAt: new Date(endedAt), summary };
  }

  /** Drop the saved events once the finished run is in the store (or was too short to keep). */
  async forget(): Promise<void> {
    await Storage.removeItem(ACTIVE_KEY);
  }

  async discard(): Promise<void> {
    await this.stopUpdates();
    this.tracker = null;
    this.events = [];
    this.set({ ...idle(this.snap.permission) });
    await Storage.removeItem(ACTIVE_KEY);
  }

  private async stopUpdates() {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK)) await Location.stopLocationUpdatesAsync(RUN_TASK);
    } catch { /* not running */ }
  }

  /** Called by the location task, in the foreground or with the screen locked. */
  ingest(locations: Location.LocationObject[]): void {
    const tr = this.tracker;
    if (!tr || this.snap.phase !== 'recording') return;
    const splits: Split[] = [];
    let changed: RunLive['status'] | undefined;
    let accepted = false;
    for (const l of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
      // feed the tracker exactly what is persisted, so a run rebuilt after a restart matches the live one
      const ev = unpack(pack({ k: 'fix', f: toFix(l) }));
      if (ev.k !== 'fix') continue;
      this.events.push(ev);
      const res = tr.ingest(ev.f);
      accepted ||= res.accepted;
      splits.push(...res.splits);
      if (res.status) changed = res.status;
    }
    const live = tr.live();
    this.set({ live, segments: tr.segments.map((g) => [...g]), ...(accepted ? { lastFixAt: Date.now() } : {}) });
    for (const s of splits) cueSplit(s, live.movingS, this.snap.kind);
    if (changed && !this.snap.paused) cueState(changed === 'autoPaused' ? 'autoPause' : 'autoResume', this.snap.kind);
    this.persist(splits.length > 0);
  }

  private persist(now: boolean) {
    const { id, kind, startedAt, paused, phase } = this.snap;
    if (phase !== 'recording' || !id || startedAt == null) return;
    if (!now && Date.now() - this.lastSave < SAVE_EVERY_MS) return;
    this.lastSave = Date.now();
    const data: Persisted = { v: 1, id, kind, startedAt, paused, events: this.events.map(pack) };
    void Storage.setItem(ACTIVE_KEY, JSON.stringify(data));
  }

  /** On launch: pick up a run that was recording when the app was closed. */
  private async restore(): Promise<void> {
    let p: Persisted | null = null;
    try {
      const raw = await Storage.getItem(ACTIVE_KEY);
      p = raw ? (JSON.parse(raw) as Persisted) : null;
    } catch { p = null; }
    if (p?.v !== 1 || !p.id) {
      await this.stopUpdates(); // an orphaned location task with no run to feed: switch GPS off
      return;
    }
    this.events = p.events.map(unpack);
    const tracker = replayRun(p.startedAt, this.events, runConfigFor(p.kind));
    this.tracker = tracker;
    const lastEv = this.events[this.events.length - 1];
    const lastAt = !lastEv ? p.startedAt : lastEv.k === 'fix' ? lastEv.f.t : lastEv.t;
    const stale = Date.now() - lastAt > STALE_MS;
    if (stale && tracker.state !== 'paused') {
      tracker.pause();
      this.events.push({ k: 'pause', t: lastAt });
    }
    this.set({ phase: 'recording', id: p.id, kind: p.kind, startedAt: p.startedAt, paused: tracker.state === 'paused', live: tracker.live(), segments: tracker.segments.map((g) => [...g]) });
    if (stale) await this.stopUpdates();
    else await this.ensureUpdates();
  }
}

export const runSession = new RunSession();

// Must be defined at startup (imported from the root layout), so iOS can deliver fixes after a relaunch.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(RUN_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  await runSession.ready;
  if (runSession.get().phase !== 'recording') return void Location.stopLocationUpdatesAsync(RUN_TASK).catch(() => {});
  runSession.ingest(data.locations);
});
