// Personalized local reminders. @diet/core plans the day (planReminders), this file keeps the iOS
// schedule equal to that plan and runs the notification buttons through the same data actions the
// screens use, so "먹었어요" on a banner and a tap on the Today screen produce the same rows.
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import {
  addDays, DEFAULT_REMINDER_PREFS, inQuiet, keyOf, minutesOf, nextReduced, parseKey, planReminders, round1, sameReduced, startOfDay,
  type MealKey, type Reminder, type ReminderKind, type ReminderPrefs, type RoutineKey,
} from '@diet/core';
import {
  applyOvershootCarry, dayRow, entriesFor, mealsFor, overshootInfo, reminderDone, reminderExtras, reminderOutcomes, setWake, setWater, setWeight,
  skipMeal, todayView, toggleMeal, weightOn, workoutOn, workoutPlan, type Env,
} from '@diet/data';
import { devicePref } from './env';

// ---------------- device preferences with listeners ----------------
export interface PrefStore<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(fn: () => void): () => void;
}

export function createPrefStore<T extends object>(key: string, defaults: T, merge: (saved: Partial<T>) => T = (s) => ({ ...defaults, ...s })): PrefStore<T> {
  let value = merge(devicePref.get<Partial<T>>(key, {}));
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      devicePref.set(key, value);
      for (const l of listeners) l();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export const reminderPrefs = createPrefStore<ReminderPrefs>('reminders', DEFAULT_REMINDER_PREFS, (s) => ({
  ...DEFAULT_REMINDER_PREFS, ...s, kinds: { ...DEFAULT_REMINDER_PREFS.kinds, ...s.kinds },
  reduced: { ...s.reduced }, reduceFrom: { ...s.reduceFrom },
}));

/** Put a reduced kind back to normal; the ignored days before today stop counting for it. */
export function restoreKind(kind: ReminderKind, today: string): void {
  const p = reminderPrefs.get();
  const reduced = { ...p.reduced };
  delete reduced[kind];
  reminderPrefs.set({ reduced, reduceFrom: { ...p.reduceFrom, [kind]: today } });
}

// ---------------- payload and categories ----------------
type PayloadKind = ReminderKind | 'wakeSuggest';

interface Payload {
  dr: 1;
  kind: PayloadKind;
  date: string;
  meals?: MealKey[];
  routine?: RoutineKey;
  /** water cups when planned: a nudge is stale once this changes */
  cups?: number;
  /** suggested wake minute (wakeSuggest) */
  wake?: number;
  /** schedule signature: unchanged reminders are left alone */
  sig?: string;
  preview?: boolean;
  /** carry: the split is not in the plan yet */
  canApply?: boolean;
}

const isOurs = (d: unknown): d is Payload => !!d && typeof d === 'object' && (d as Payload).dr === 1;

const CATEGORY: Partial<Record<PayloadKind, string>> = {
  meal: 'dr.meal', cutoff: 'dr.cutoff', water: 'dr.water', weigh: 'dr.weigh', workout: 'dr.workout', wakeSuggest: 'dr.wake',
  steps: 'dr.steps', wrap: 'dr.wrap', carry: 'dr.info', weekly: 'dr.info', event: 'dr.info',
};
const categoryOf = (kind: PayloadKind, canApply?: boolean): string | undefined => (kind === 'carry' && canApply ? 'dr.carry' : CATEGORY[kind]);

let setupDone: Promise<void> | null = null;
function setup(): Promise<void> {
  if (setupDone) return setupDone;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  // background buttons: the action runs without opening the app (iOS launches it in the background)
  const bg = { opensAppToForeground: false };
  const fg = { opensAppToForeground: true };
  // every category ends with "오늘 알림 끄기": the rest of today's reminders are cancelled
  const mute: Notifications.NotificationAction = { identifier: 'mute', buttonTitle: '오늘 알림 끄기', options: bg };
  const categories: [string, Notifications.NotificationAction[]][] = [
    ['dr.meal', [
      { identifier: 'eat', buttonTitle: '먹었어요', options: bg },
      { identifier: 'skip', buttonTitle: '건너뛰기', options: bg },
      mute,
    ]],
    ['dr.cutoff', [{ identifier: 'eat', buttonTitle: '먹었어요', options: bg }, mute]],
    ['dr.water', [{ identifier: 'water', buttonTitle: '물 +1', options: bg }, mute]],
    ['dr.weigh', [
      { identifier: 'weight', buttonTitle: '체중 입력', textInput: { submitButtonTitle: '저장', placeholder: '예: 74.3' }, options: bg },
      mute,
    ]],
    ['dr.workout', [{ identifier: 'start', buttonTitle: '지금 시작', options: fg }, mute]],
    ['dr.wake', [{ identifier: 'accept', buttonTitle: '이 시간으로 맞추기', options: bg }]],
    ['dr.steps', [{ identifier: 'walk', buttonTitle: '걷기 시작', options: fg }, mute]],
    ['dr.wrap', [
      { identifier: 'eatAll', buttonTitle: '다 먹었어요', options: bg },
      { identifier: 'other', buttonTitle: '다르게 먹었어요', options: fg },
      mute,
    ]],
    ['dr.carry', [{ identifier: 'carry', buttonTitle: '나눠서 줄이기', options: bg }, mute]],
    ['dr.info', [mute]],
  ];
  // one at a time: each call reads the registered set, adds one and writes it back, so parallel calls drop categories
  setupDone = (async () => {
    for (const [id, actions] of categories) await Notifications.setNotificationCategoryAsync(id, actions).catch(() => null);
  })();
  return setupDone;
}

// ---------------- permission ----------------
export type NotifyPermission = 'granted' | 'denied' | 'undetermined';

const toPermission = (p: Notifications.NotificationPermissionsStatus): NotifyPermission =>
  p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';

export async function notifyPermission(): Promise<NotifyPermission> {
  if (Platform.OS !== 'ios') return 'denied';
  return toPermission(await Notifications.getPermissionsAsync());
}

/** Ask once, from the settings section (never on launch). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (Platform.OS !== 'ios') return 'denied';
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return toPermission(p);
}

// ---------------- sent ledger ----------------
// Reminder id -> the time it was scheduled for. An entry whose time has passed was delivered: the planner
// never plans it again and counts it toward the daily cap (iOS does not tell us what it delivered while the
// app was not running). Cancelling a pending reminder removes its entry.
const SENT_KEY = 'notif:sent';
type SentLedger = Record<string, number>;

function sentIds(now: number): Set<string> {
  const ledger = devicePref.get<SentLedger>(SENT_KEY, {});
  return new Set(Object.entries(ledger).filter(([, at]) => at <= now).map(([id]) => id));
}

function updateSent(fn: (l: SentLedger) => void, now: number): void {
  const ledger = devicePref.get<SentLedger>(SENT_KEY, {});
  fn(ledger);
  // a week back: the ignored-kinds rule reads the last three full days
  for (const [id, at] of Object.entries(ledger)) if (at < now - 8 * 86400_000) delete ledger[id];
  devicePref.set(SENT_KEY, ledger);
}

// Reminder ids whose notification was opened or had a button pressed (the "reacted" half of the ignored rule).
const ACTED_KEY = 'notif:acted';
const actedIds = (): Set<string> => new Set(devicePref.get<string[]>(ACTED_KEY, []));
function markActed(id: string): void {
  const list = devicePref.get<string[]>(ACTED_KEY, []);
  if (!list.includes(id)) devicePref.set(ACTED_KEY, [...list.slice(-199), id]);
}

/** Reduce kinds ignored three days in a row (and restore those reacted to). Runs before planning, never in render. */
function updateReduced(env: Env): void {
  const p = reminderPrefs.get();
  const outcomes = reminderOutcomes(env, devicePref.get<SentLedger>(SENT_KEY, {}), actedIds());
  const next = nextReduced(p.reduced, outcomes, keyOf(env.now()), p.reduceFrom);
  if (!sameReduced(next, p.reduced)) reminderPrefs.set({ reduced: next });
}

// ---------------- planning and scheduling ----------------
/** Today's remaining reminders plus tomorrow's, so the next morning works even if the app is not opened. */
export function plannedReminders(env: Env): Reminder[] {
  const prefs = reminderPrefs.get();
  const sent = sentIds(env.now().getTime());
  const v = todayView(env);
  const tomorrow = startOfDay(addDays(env.now(), 1));
  const envT: Env = { ...env, now: () => tomorrow };
  const vt = todayView(envT);
  return [
    ...planReminders(v, workoutPlan(env, v), prefs, sent, reminderExtras(env, v)),
    ...planReminders(vt, workoutPlan(envT, vt), prefs, sent, reminderExtras(envT, vt)),
  ];
}

const ident = (r: Reminder): string => `dr:${r.id}`;
const sigOf = (r: Reminder): string => `${r.at}|${r.title}|${r.body}|${r.canApply ? 1 : 0}`;
export const reminderDate = (r: Pick<Reminder, 'date' | 'at'>): Date => {
  const d = parseKey(r.date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(r.at / 60), r.at % 60);
};

function contentOf(env: Env, r: Reminder, extra: Partial<Payload> = {}): Notifications.NotificationContentInput {
  const data: Payload = {
    dr: 1, kind: r.kind, date: r.date, meals: r.meals, routine: r.routine, sig: sigOf(r), canApply: r.canApply,
    cups: r.kind === 'water' ? dayRow(env, r.date).water_cups : undefined, ...extra,
  };
  return { title: r.title, body: r.body, data: data as unknown as Record<string, unknown>, categoryIdentifier: categoryOf(r.kind, r.canApply), sound: 'default', threadIdentifier: `dr:${r.date}` };
}

let chain: Promise<void> = Promise.resolve();
/** Make the pending iOS schedule equal to the plan. Calls are serialized. */
export function rescheduleReminders(env: Env): Promise<void> {
  chain = chain.then(() => syncSchedule(env)).catch((e: unknown) => { if (__DEV__) console.warn('[reminders]', e); });
  return chain;
}

async function syncSchedule(env: Env): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await setup();
  const granted = (await Notifications.getPermissionsAsync()).granted;
  if (granted) updateReduced(env);
  const want = granted ? plannedReminders(env) : [];
  const byId = new Map(want.map((r) => [ident(r), r]));
  const keep = new Set<string>();
  const now = env.now().getTime();
  for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
    const d = n.content.data;
    if (!isOurs(d) || d.preview || d.kind === 'wakeSuggest') continue;
    const r = byId.get(n.identifier);
    if (r && d.sig === sigOf(r)) { keep.add(n.identifier); continue; }
    await Notifications.cancelScheduledNotificationAsync(n.identifier);
    updateSent((l) => { delete l[n.identifier.slice(3)]; }, now);
  }
  for (const r of want) {
    if (keep.has(ident(r))) continue;
    const when = reminderDate(r);
    if (when.getTime() <= now + 5000) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: ident(r), content: contentOf(env, r),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
    });
    updateSent((l) => { l[r.id] = when.getTime(); }, now);
  }
  await dismissStale(env);
}

/** Remove delivered notifications whose subject is already done (meal logged, weight saved, ...). */
async function dismissStale(env: Env): Promise<void> {
  const today = todayView(env).ctx.key;
  for (const n of await Notifications.getPresentedNotificationsAsync()) {
    const d = n.request.content.data;
    if (!isOurs(d)) continue;
    if (d.date < today || isDone(env, d)) await Notifications.dismissNotificationAsync(n.request.identifier);
  }
}

function isDone(env: Env, d: Payload): boolean {
  switch (d.kind) {
    case 'meal':
    case 'cutoff': {
      const logged = new Set(entriesFor(env, d.date).map((e) => e.slot));
      return (d.meals ?? []).every((m) => logged.has(m));
    }
    case 'water': return dayRow(env, d.date).water_cups !== d.cups;
    case 'weigh': return weightOn(env, d.date) != null;
    case 'wake':
    case 'wakeSuggest': return dayRow(env, d.date).wake_min != null;
    case 'workout': return !!workoutOn(env, d.date);
    case 'wrap': {
      const logged = new Set(entriesFor(env, d.date).map((e) => e.slot));
      return mealsFor(env, d.date).every((m) => logged.has(m.key));
    }
    case 'steps': return reminderDone(env, `${d.date}:steps:evening`);
    case 'carry': return !!d.canApply && d.date === keyOf(env.now()) && !!overshootInfo(env)?.applied;
    default: return false;
  }
}

/** Deliver the next planned reminder (or all of today's, for testing) in a few seconds, buttons included. */
export async function previewReminders(env: Env, opts: { all?: boolean } = {}): Promise<number> {
  if (Platform.OS !== 'ios') return 0;
  await setup();
  const v = todayView(env);
  const list = plannedReminders(env).filter((r) => r.date === v.ctx.key);
  const picked = opts.all ? list : list.slice(0, 1);
  let i = 0;
  for (const r of picked) {
    await Notifications.scheduleNotificationAsync({
      identifier: `dr:preview:${r.id}`, content: contentOf(env, r, { preview: true }),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 + i * 4 },
    });
    i++;
  }
  return picked.length;
}

/**
 * Ask to confirm a wake time read from Apple Health (never set silently). Follows the same switches as the
 * planned reminders (off, off for today, the wake kind, quiet hours). Returns whether it was sent.
 */
export async function postWakeSuggestion(date: string, wake: number, label: string, now: Date): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const p = reminderPrefs.get();
  if (!p.enabled || p.mutedOn === date || !p.kinds.wake || inQuiet(minutesOf(now), p, null)) return false;
  if (!(await Notifications.getPermissionsAsync()).granted) return false;
  await setup();
  const data: Payload = { dr: 1, kind: 'wakeSuggest', date, wake };
  await Notifications.scheduleNotificationAsync({
    identifier: `dr:${date}:wakeSuggest`,
    content: {
      title: `${label}에 깬 기록이 있습니다`,
      body: `건강 앱 수면 기록입니다. 이 시각으로 오늘 끼니와 홈트 시간을 맞추겠습니까?`,
      data: data as unknown as Record<string, unknown>, categoryIdentifier: CATEGORY.wakeSuggest, sound: 'default',
    },
    trigger: null,
  });
  return true;
}

// ---------------- responses ----------------
const HANDLED_KEY = 'notif:handled';
/** The same response can arrive twice (live event, then "last response" after a cold start). */
function firstTime(key: string): boolean {
  const list = devicePref.get<string[]>(HANDLED_KEY, []);
  if (list.includes(key)) return false;
  devicePref.set(HANDLED_KEY, [...list.slice(-39), key]);
  return true;
}

/** "74.3", "74,3", "74.3kg"; "743" is read as 74.3 (a keypad without the dot). Anything else is ignored. */
export function parseKg(text: string | undefined): number | null {
  const t = (text ?? '').trim().replace(',', '.').replace(/\s*kg$/i, '');
  if (!/^\d{2,3}(\.\d{1,2})?$/.test(t)) return null;
  let n = Number(t);
  if (!t.includes('.') && n > 250) n /= 10;
  return n >= 30 && n <= 250 ? round1(n) : null;
}

function go(href: Href): void {
  // a cold start delivers the response while the navigator is still mounting
  setTimeout(() => { try { router.push(href); } catch { /* not mounted */ } }, 400);
}

export function handleNotificationResponse(env: Env, res: Notifications.NotificationResponse): void {
  try {
    respond(env, res);
  } catch (e) {
    if (__DEV__) console.warn('[reminders] response', e);
  }
}

function respond(env: Env, res: Notifications.NotificationResponse): void {
  const req = res.notification.request;
  const d = req.content.data;
  if (!isOurs(d)) return;
  if (!firstTime(`${req.identifier}|${res.actionIdentifier}|${res.notification.date}`)) return;
  if (!d.preview && req.identifier.startsWith('dr:')) markActed(req.identifier.slice(3));
  // a notification left over from yesterday: meals still belong to their day (a 00:30 "먹었어요" on last
  // night's dinner), but a weight or a glass of water is measured now and goes to today
  const today = keyOf(env.now());
  const yesterday = keyOf(addDays(env.now(), -1));
  const mealDay = d.date >= yesterday ? d.date : null;
  const logged = new Set(mealDay ? entriesFor(env, mealDay).map((e) => e.slot) : []);
  const meals = d.meals ?? [];
  switch (res.actionIdentifier) {
    case 'eat':
      if (mealDay) for (const m of meals) if (!logged.has(m)) toggleMeal(env, mealDay, m);
      break;
    case 'skip':
      if (mealDay) for (const m of meals) if (!logged.has(m)) skipMeal(env, mealDay, m);
      break;
    case 'water':
      setWater(env, today, dayRow(env, today).water_cups + 1);
      break;
    case 'weight': {
      const kg = parseKg(res.userText);
      if (kg != null) setWeight(env, today, kg);
      break;
    }
    case 'accept':
      if (d.wake != null && d.date === todayView(env).ctx.key && dayRow(env, d.date).wake_min == null) setWake(env, d.wake, { lateRule: true });
      break;
    case 'start':
      go({ pathname: '/workout', params: { routine: d.routine ?? 'A' } });
      break;
    case 'eatAll':
      // "다 먹었어요" on the wrap-up: the rest of that day as planned
      if (mealDay) for (const m of meals) if (!logged.has(m)) toggleMeal(env, mealDay, m);
      break;
    case 'other': {
      const first = meals.find((m) => !logged.has(m));
      go(first ? { pathname: '/sheet/food', params: { slot: first } } : '/');
      break;
    }
    case 'walk':
      devicePref.set('run.kind', 'walk');
      go('/run');
      break;
    case 'carry':
      if (d.date === today) applyOvershootCarry(env);
      break;
    case 'mute':
      reminderPrefs.set({ mutedOn: today });
      break;
    case Notifications.DEFAULT_ACTION_IDENTIFIER:
      if (d.kind === 'wake' || d.kind === 'wakeSuggest') go('/sheet/time');
      else if (d.kind === 'weigh') go('/sheet/weight');
      else if (d.kind === 'workout') go({ pathname: '/workout', params: { routine: d.routine ?? 'A' } });
      else if (d.kind === 'weekly') go('/records');
      else if (d.kind === 'steps') { devicePref.set('run.kind', 'walk'); go('/run'); }
      else go('/');
      break;
    default:
      break;
  }
  // a background launch can be suspended right after this: write the snapshot and fix the schedule now
  // (cancel the 19:30 heads-up for a dinner just logged), not after the store debounce
  void env.store.flush().then(() => rescheduleReminders(env));
}

/**
 * Dev builds only: press the first button of every delivered reminder through the real response handler
 * (the simulator cannot open a notification's buttons). Returns a one-line summary for a toast.
 */
export async function devRunButtons(env: Env): Promise<string> {
  if (!__DEV__ || Platform.OS !== 'ios') return '';
  const cats = await Notifications.getNotificationCategoriesAsync();
  const titles = cats.filter((c) => c.identifier.startsWith('dr.')).map((c) => `${c.identifier.slice(3)}: ${c.actions.map((a) => a.buttonTitle).join('/')}`);
  if (__DEV__) console.log('[reminders] categories', titles.join(' | '));
  let n = 0;
  for (const notification of await Notifications.getPresentedNotificationsAsync()) {
    const d = notification.request.content.data;
    if (!isOurs(d)) continue;
    const cat = cats.find((c) => c.identifier === categoryOf(d.kind, d.canApply));
    const action = cat?.actions[0];
    // "오늘 알림 끄기" would silence the rest of the test day
    if (!action || action.options?.opensAppToForeground || action.identifier === 'mute') continue;
    handleNotificationResponse(env, { notification, actionIdentifier: action.identifier, userText: action.textInput ? '74.3' : undefined });
    if (__DEV__) console.log('[reminders] pressed', action.buttonTitle, 'on', notification.request.content.title);
    n++;
  }
  return `버튼 ${n}개를 눌렀습니다 · ${titles.length}개 종류 등록됨`;
}

// ---------------- root hook ----------------
/**
 * Mount once in the root layout. Keeps the schedule in sync with the store (debounced), preferences,
 * foregrounding and midnight, and handles notification buttons, including the one that launched the app.
 * It never asks for permission; the settings section does.
 */
export function useReminders(env: Env | null): void {
  useEffect(() => {
    if (!env || Platform.OS !== 'ios') return;
    void setup();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = (ms = 1500) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void rescheduleReminders(env); }, ms);
    };
    const offStore = env.store.subscribe(() => soon());
    const offPrefs = reminderPrefs.subscribe(() => soon(200));
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') soon(300); });
    let midnight: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      const n = env.now();
      const ms = addDays(startOfDay(n), 1).getTime() + 60_000 - n.getTime();
      midnight = setTimeout(() => { soon(0); arm(); }, ms);
    };
    arm();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => handleNotificationResponse(env, r));
    const last = Notifications.getLastNotificationResponse();
    if (last) handleNotificationResponse(env, last);
    soon(0);
    return () => {
      if (timer) clearTimeout(timer);
      if (midnight) clearTimeout(midnight);
      offStore();
      offPrefs();
      app.remove();
      sub.remove();
    };
  }, [env]);
}
