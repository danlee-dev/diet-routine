// Local reminders for one day, planned from that day's view. Pure: the iPhone turns the list into
// scheduled notifications and reruns this whenever the day changes. Rules pinned by tests:
// nothing in the past, nothing in quiet hours, one notification per subject (stable ids), a daily cap.
import { ROUTINES, WEEK, type MealKey, type RoutineKey, type ScenId } from './data';
import { repMultiplier, workoutRounds } from './program';
import { DINNER_CUTOFF, type PlannedMeal } from './schedule';
import { hhmm, minutesOf, startOfDay } from './util';

export type ReminderKind = 'meal' | 'cutoff' | 'workout' | 'weigh' | 'wake' | 'water';

/** Priority when the daily cap drops something (first = kept longest). */
export const REMINDER_KINDS: ReminderKind[] = ['meal', 'cutoff', 'workout', 'weigh', 'wake', 'water'];

export interface ReminderPrefs {
  enabled: boolean;
  kinds: Record<ReminderKind, boolean>;
  /** Quiet window, minutes since midnight. Wraps past midnight when start > end. */
  quietStart: number;
  quietEnd: number;
  /** Ask for the wake time at this minute when it is still unset. */
  wakePromptAt: number;
  /** Day key on which reminders were turned off for the rest of that day. */
  mutedOn: string | null;
  maxPerDay: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: true,
  kinds: { meal: true, cutoff: true, workout: true, weigh: true, wake: true, water: true },
  quietStart: 23 * 60,
  quietEnd: 7 * 60,
  wakePromptAt: 9 * 60,
  mutedOn: null,
  maxPerDay: 8,
};

/** The slice of a day view reminders depend on. `TodayView` from @diet/data satisfies it. */
export interface ReminderDay {
  ctx: { key: string; dow: number; week: number };
  nowMin: number;
  scen: ScenId;
  day: { wake_min: number | null; water_cups: number };
  meals: PlannedMeal[];
  /** Slots already logged: eaten, replaced or skipped. */
  eaten: ReadonlySet<MealKey>;
  weight: number | null;
}

/** Today's home workout as the Today screen shows it (`workoutPlan` in @diet/data). */
export interface ReminderWorkout {
  routine: RoutineKey;
  at: number | null;
  done: boolean;
}

export interface Reminder {
  /** Stable for (day, subject): planning again replaces the notification instead of adding one. */
  id: string;
  kind: ReminderKind;
  date: string;
  /** Minutes since midnight on `date`. */
  at: number;
  title: string;
  body: string;
  /** Meal slots that "먹었어요" / "건너뛰기" apply to. */
  meals?: MealKey[];
  routine?: RoutineKey;
}

const ceil10 = (m: number): number => Math.ceil(m / 10) * 10;
const round5 = (m: number): number => Math.round(m / 5) * 5;

const WATER_MAX = 8;
/** Water pace runs from waking up to two hours after the dinner cutoff. */
const WATER_END = DINNER_CUTOFF + 120;
const CUTOFF_NOTICE = DINNER_CUTOFF - 30;
/** No water nudges in the last hour of the pace: drinking a lot right before bed only breaks sleep. */
const WATER_LAST_NUDGE = WATER_END - 60;

/** Cups that should be done by `at` on the even pace from wake to 22:00 (same rule as the Today card). */
export function expectedCups(at: number, wake: number | null): number {
  const w = wake ?? 8 * 60;
  if (w >= WATER_END - 60) return 0; // woke up in the evening: no pace to keep
  return Math.max(0, Math.min(WATER_MAX, Math.floor(((at - w) / (WATER_END - w)) * WATER_MAX)));
}

/** Earliest minute at which the pace asks for `cups` cups (Infinity when there is no pace). */
export function cupsDueAt(cups: number, wake: number | null): number {
  const w = wake ?? 8 * 60;
  if (w >= WATER_END - 60) return Infinity;
  return ceil10(w + (cups * (WATER_END - w)) / WATER_MAX);
}

/** Rough length of a home workout: reps at ~3 s, holds as written, 15 s between moves, 60 s between rounds. */
export function routineMinutes(routine: RoutineKey, week: number, dow: number): number {
  const rounds = WEEK[dow]?.t === 'light' ? 3 : workoutRounds(week);
  const mult = repMultiplier(week);
  const perRound = ROUTINES[routine].items.reduce((s, x) => {
    const n = Math.round(x.n * mult);
    const work = x.unit === '초' ? n : n * 3 * (x.unit.includes('양쪽') ? 2 : 1);
    return s + work + 15;
  }, 0);
  const secs = rounds * perRound + (rounds - 1) * 60;
  return Math.max(5, Math.round(secs / 300) * 5);
}

const menu = (m: PlannedMeal): string => m.items.map((x) => `${x.name} ${x.amount}`).join(' · ');

export function inQuiet(at: number, prefs: Pick<ReminderPrefs, 'quietStart' | 'quietEnd'>, wake: number | null): boolean {
  const { quietStart: s } = prefs;
  let e = prefs.quietEnd;
  if (s === e) return false;
  const wraps = s > e;
  // a known wake time ends the night early ("밤 11시~기상 전"): someone who is up is not disturbed by breakfast
  if (wake != null && wake < e && (wraps || wake >= s)) e = wake;
  return wraps ? at >= s || at < e : at >= s && at < e;
}

export interface SleepSample {
  start: Date;
  end: Date;
  /** an asleep stage; false for "in bed" (what an iPhone without a Watch records) */
  asleep: boolean;
}

/**
 * Wake time (minutes today) from last night's sleep samples, or null. Uses asleep stages when there are any,
 * in-bed otherwise; only ends between 03:00 and 13:00 count (a nap is not a wake time), and only once the
 * last sample ended `settleMin` ago, so waking up briefly at night and falling asleep again is not suggested.
 */
export function wakeFromSleep(samples: readonly SleepSample[], now: Date, settleMin = 10): number | null {
  const day = startOfDay(now).getTime();
  const morning = samples.filter((s) => s.end.getTime() >= day + 3 * 3600_000 && s.end.getTime() <= Math.min(now.getTime(), day + 13 * 3600_000));
  const asleep = morning.filter((s) => s.asleep);
  const pool = asleep.length ? asleep : morning;
  if (!pool.length) return null;
  const end = Math.max(...pool.map((s) => s.end.getTime()));
  // anything still going on (or ended moments ago) means the night may not be over
  const latest = Math.max(...samples.map((s) => s.end.getTime()));
  if (now.getTime() - latest < settleMin * 60_000) return null;
  return minutesOf(new Date(end));
}

/**
 * `sent` holds ids of reminders already delivered (any day). They are never planned again, and they count
 * toward the daily cap and the two water nudges, so a day stays within its limits however often it is replanned.
 */
export function planReminders(
  v: ReminderDay, workout: ReminderWorkout | null, prefs: ReminderPrefs = DEFAULT_REMINDER_PREFS, sent: ReadonlySet<string> = new Set(),
): Reminder[] {
  const date = v.ctx.key;
  if (!prefs.enabled || prefs.mutedOn === date) return [];
  const sentToday = [...sent].filter((id) => id.startsWith(`${date}:`));
  const sentOf = (kind: ReminderKind) => sentToday.filter((id) => id.startsWith(`${date}:${kind}:`)).length;
  const wake = v.day.wake_min;
  const out: Reminder[] = [];
  const add = (r: Omit<Reminder, 'id' | 'date'>, subject: string) => out.push({ ...r, id: `${date}:${r.kind}:${subject}`, date });

  // meals at their shifted time, only when not logged yet. Slots that share a time (late wake: snack with
  // the first meal, rest day: protein with the snack) become one notification.
  const dinner = v.meals.find((m) => m.key === 'dinner');
  const dinnerNear = dinner?.at != null && dinner.at >= CUTOFF_NOTICE - 15;
  const byTime = new Map<number, PlannedMeal[]>();
  for (const m of v.meals) {
    if (m.at == null || v.eaten.has(m.key)) continue;
    const list = byTime.get(m.at) ?? [];
    list.push(m);
    byTime.set(m.at, list);
  }
  for (const [at, list] of byTime) {
    const first = list[0]!;
    const rest = list.slice(1);
    const cutoffNote = list.some((m) => m.key === 'dinner') && dinnerNear ? ` · ${hhmm(DINNER_CUTOFF)} 마감` : '';
    add({
      kind: 'meal', at,
      title: `${first.name} ${hhmm(at)}${rest.length ? ` · ${rest.map((m) => m.name).join(', ')} 같이` : ''}${cutoffNote}`,
      body: list.map(menu).join(' · '),
      meals: list.map((m) => m.key),
    }, list.map((m) => m.key).join('+'));
  }

  // 19:30 heads-up while dinner is still open (folded into the dinner reminder when dinner is that late anyway)
  if (dinner && !v.eaten.has('dinner') && !dinnerNear) {
    add({
      kind: 'cutoff', at: CUTOFF_NOTICE, title: '저녁 마감까지 30분',
      body: `저녁을 아직 기록하지 않았습니다. ${hhmm(DINNER_CUTOFF)} 이후에는 물, 아메리카노, 제로 음료만 마십니다.`,
      meals: ['dinner'],
    }, 'dinner');
  }

  if (workout && !workout.done && workout.at != null) {
    const r = ROUTINES[workout.routine];
    const rounds = WEEK[v.ctx.dow]?.t === 'light' ? 3 : workoutRounds(v.ctx.week);
    add({
      kind: 'workout', at: workout.at, title: `${r.name} ${hhmm(workout.at)}`,
      body: `${r.focus} · ${rounds}라운드 · 약 ${routineMinutes(workout.routine, v.ctx.week, v.ctx.dow)}분`,
      routine: workout.routine,
    }, workout.routine);
  }

  if (wake != null && v.weight == null) {
    // wake time entered late (the 09:00 prompt, a Health suggestion accepted later): the next half hour instead,
    // as long as it is still within three hours of waking
    let at = round5(wake + 10);
    if (at <= v.nowMin) at = Math.ceil((v.nowMin + 10) / 30) * 30;
    if (at <= wake + 180) add({
      kind: 'weigh', at, title: '아침 체중을 잴 시간입니다',
      body: '화장실에 다녀와 먹기 전에 재면 추세가 정확합니다. 알림을 길게 누르면 바로 입력합니다.',
    }, 'morning');
  }

  if (wake == null && v.eaten.size === 0) {
    add({
      kind: 'wake', at: prefs.wakePromptAt, title: '기상 시간이 아직 없습니다',
      body: '기상 시간을 넣으면 오늘 끼니와 홈트 시간이 정해집니다.',
    }, 'prompt');
  }

  // water: only on the milestones where the pace would be two cups ahead of what is logged, at most twice.
  // The milestones depend only on (wake, cups), so planning again never re-arms a nudge that already fired.
  const cups = v.day.water_cups;
  let nudges = sentOf('water');
  for (let k = cups + 2; k <= WATER_MAX && nudges < 2; k += 2) {
    let at = cupsDueAt(k, wake);
    if (at <= v.nowMin) continue;
    if (at > WATER_LAST_NUDGE) break;
    const clash = out.find((r) => Math.abs(r.at - at) < 10);
    if (clash) at = clash.at + 20;
    add({
      kind: 'water', at, title: `물 ${cups + 1}잔째를 마실 시간입니다`,
      body: `지금쯤 ${k}잔이면 좋습니다. 기록은 ${cups}잔입니다.`,
    }, String(k));
    nudges++;
  }

  const kept = out
    .filter((r) => prefs.kinds[r.kind] && !sent.has(r.id) && r.at > v.nowMin && r.at < 24 * 60 && !inQuiet(r.at, prefs, wake))
    .sort((a, b) => REMINDER_KINDS.indexOf(a.kind) - REMINDER_KINDS.indexOf(b.kind) || a.at - b.at)
    .slice(0, Math.max(0, prefs.maxPerDay - sentToday.length));
  return kept.sort((a, b) => a.at - b.at || REMINDER_KINDS.indexOf(a.kind) - REMINDER_KINDS.indexOf(b.kind));
}
