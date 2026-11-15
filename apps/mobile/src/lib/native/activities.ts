// Live Activities: the run or walk being recorded, the home-workout rest timer, the dinner cutoff countdown.
// Text is formatted with @diet/core here and only displayed by the widget extension (LiveActivity.swift).
// ActivityKit only lets the app start an activity while it is in the foreground; updates and ends work
// from the background (a run keeps the app alive through location updates).
import { clockText, DINNER_CUTOFF, kmText, minutesOf, paceText, startOfDay } from '@diet/core';
import { todayView, type Env } from '@diet/data';
import { DarouNative, type ActivityKind, type ActivityState } from '../../../modules/darou-native';
import { devicePref } from '../env';
import { runSession, type RunSnapshot } from '../run/session';

/** One activity of a kind at a time, with its calls kept in order (start resolves before update/end). */
function controller(kinds: ActivityKind[]) {
  let id: string | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
  /** Adopt an activity left from before a relaunch, ending any extra copies. */
  const adopt = async () => {
    if (id) return;
    const found = DarouNative.listActivities().filter((a) => kinds.includes(a.kind));
    id = found[0]?.id ?? null;
    for (const extra of found.slice(1)) await DarouNative.endActivity(extra.id);
  };
  return {
    get active() { return id != null; },
    show: (kind: ActivityKind, title: string, state: ActivityState, staleAt: number | null) => serial(async () => {
      await adopt();
      if (id && (await DarouNative.updateActivity(id, state, staleAt))) return;
      id = await DarouNative.startActivity(kind, title, state, staleAt);
    }),
    update: (state: ActivityState, staleAt: number | null) => serial(async () => {
      await adopt();
      if (id && !(await DarouNative.updateActivity(id, state, staleAt))) id = null; // the user dismissed it
    }),
    end: (state: ActivityState | null = null, dismissAt: number | null = null) => serial(async () => {
      await adopt();
      if (!id) return;
      const cur = id;
      id = null;
      await DarouNative.endActivity(cur, state, dismissAt);
    }),
  };
}

// ---------------- run / walk ----------------
const run = controller(['run', 'walk']);
const RUN_EVERY_MS = 5000;
/** If the app dies mid-run, the lock screen marks the activity out of date after this long. */
const RUN_STALE_MS = 10 * 60_000;

function runState(s: RunSnapshot): ActivityState {
  const live = s.live;
  const movingS = live?.movingS ?? 0;
  const phase = s.paused ? 'paused' : live?.status === 'autoPaused' ? 'autoPaused' : 'moving';
  const anchor = s.lastFixAt ?? Date.now();
  return {
    phase,
    primary: kmText(live?.distance ?? 0),
    primaryUnit: 'km',
    ...(phase === 'moving' ? { clockFrom: Math.round(anchor - movingS * 1000) } : { clockText: clockText(Math.floor(movingS)) }),
    stat: paceText(live?.avgPace),
    statLabel: '평균 페이스',
  };
}

let lastRunPush = 0;
let lastRunKey = '';
let lastPhase: string | null = null;
let runSyncOn = false;

function onRunSnapshot(): void {
  const s = runSession.get();
  if (s.phase !== 'recording') {
    // idle snapshots arrive every second while GPS warms up: act only on the recording -> idle change
    if (lastPhase != null) {
      lastPhase = null;
      lastRunKey = '';
      void run.end();
    }
    return;
  }
  const st = runState(s);
  const key = `${st.phase}|${st.primary}|${st.stat}`;
  const now = Date.now();
  const phaseChanged = st.phase !== lastPhase;
  if (!phaseChanged && (key === lastRunKey || now - lastRunPush < RUN_EVERY_MS)) return;
  lastRunKey = key;
  lastRunPush = now;
  const first = lastPhase == null;
  lastPhase = st.phase;
  const staleAt = now + RUN_STALE_MS;
  if (first) void run.show(s.kind, s.kind === 'walk' ? '걷기' : '달리기', st, staleAt);
  else void run.update(st, staleAt);
}

/** Mirror the run session onto the lock screen. Idempotent; call once the app is up. */
export function startRunActivitySync(): void {
  if (runSyncOn || !DarouNative.available) return;
  runSyncOn = true;
  runSession.subscribe(onRunSnapshot);
  void runSession.ready.then(() => {
    // a run activity left over from a run that ended while the app was not running
    if (runSession.get().phase !== 'recording') {
      if (DarouNative.listActivities().some((a) => a.kind === 'run' || a.kind === 'walk')) void run.end();
    } else onRunSnapshot();
  });
}

// ---------------- home workout rest ----------------
const rest = controller(['rest']);

export const restActivity = {
  /** Rest until `endsAt` (epoch ms); `next` names what comes after, e.g. "스쿼트 15회". */
  show(endsAt: number, next: string): void {
    void rest.show('rest', '쉬는 시간', { phase: 'rest', endsAt, detail: `다음 라운드 · ${next}` }, endsAt + 60_000);
  },
  end(): void { void rest.end(); },
};

// ---------------- dinner cutoff ----------------
const cutoff = controller(['cutoff']);
const CUTOFF_PREF = 'liveActivity.cutoff';
/** The countdown appears this many minutes before the cutoff. */
export const CUTOFF_LEAD_MIN = 30;

export const cutoffActivityEnabled = (): boolean => devicePref.get<boolean>(CUTOFF_PREF, true);
export const setCutoffActivityEnabled = (on: boolean): void => devicePref.set(CUTOFF_PREF, on);

/**
 * Show the countdown from 19:30 while dinner is not logged; end it once dinner is logged, the cutoff
 * passes or the setting is off. Returns the next minute of the day worth checking again (or null).
 */
export function syncCutoffActivity(env: Env): number | null {
  const v = todayView(env);
  const now = env.now();
  const nowMin = minutesOf(now);
  const at = DINNER_CUTOFF;
  const dinner = v.meals.find((m) => m.key === 'dinner');
  const open = !!dinner && !v.eaten.has('dinner');
  const inWindow = nowMin >= at - CUTOFF_LEAD_MIN && nowMin < at;
  if (cutoffActivityEnabled() && open && inWindow && DarouNative.activitiesEnabled()) {
    const endsAt = startOfDay(now).getTime() + at * 60_000;
    const items = dinner!.items.map((x) => x.name).join(' · ');
    void cutoff.show('cutoff', '저녁 마감까지', { phase: 'countdown', endsAt, detail: `${dinner!.name} · ${items}` }, endsAt);
    return at;
  }
  if (cutoff.active || DarouNative.listActivities().some((a) => a.kind === 'cutoff')) void cutoff.end();
  return open && nowMin < at - CUTOFF_LEAD_MIN ? at - CUTOFF_LEAD_MIN : null;
}
