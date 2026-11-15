// Settings: reminders and Apple Health. Self-contained (reads Env from context); mount inside the
// settings ScrollView. Permissions are requested here, in context, never on launch.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Animated, AppState, Linking, Pressable, Text, View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fmt, hhmm, inQuiet, keyOf, pad, type ReminderKind, type ReminderPrefs } from '@diet/core';
import { todayView } from '@diet/data';
import { useEnv, useMinuteTick } from '@/lib/hooks';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import {
  devRunButtons, notifyPermission, plannedReminders, previewReminders, reminderPrefs, requestNotifyPermission, type NotifyPermission,
} from '@/lib/notifications';
import {
  connectHealth, disconnectHealth, healthAccess, healthAvailable, healthPrefs, healthWriteAllowed, lastNightWake, latestHealthWeight,
  pullHealth, seedHealthSamples, useHealthPrefs, useWakeSuggestion, type HealthAccess, type HealthPrefs, type HealthWeight,
} from '@/lib/health';
import { Btn, PickerFrame, useToast, Wheel, type WheelItem } from '@/components/ui';

const HOURS: WheelItem[] = Array.from({ length: 24 }, (_, i) => ({ v: i, t: pad(i) }));
const MINS: WheelItem[] = Array.from({ length: 6 }, (_, i) => ({ v: i * 10, t: pad(i * 10) }));

const KIND_ROWS: { kind: ReminderKind; title: string; sub: string }[] = [
  { kind: 'meal', title: '끼니', sub: '기상 시간에 맞춘 시각에 메뉴와 함께 · 먹었어요, 건너뛰기' },
  { kind: 'cutoff', title: '저녁 마감 30분 전', sub: '저녁을 아직 기록하지 않았을 때만 19:30에' },
  { kind: 'workout', title: '홈트', sub: '홈트 날 추천 시각에 루틴과 걸리는 시간' },
  { kind: 'water', title: '물', sub: '마시는 속도가 늦을 때만, 하루 두 번까지 · 물 +1' },
  { kind: 'weigh', title: '아침 체중', sub: '일어나고 10분 뒤 · 알림에서 바로 입력' },
];

const useReminderPrefs = (): ReminderPrefs => useSyncExternalStore(reminderPrefs.subscribe, reminderPrefs.get, reminderPrefs.get);

/** Re-check something when the screen mounts and whenever the app returns from Settings. */
function useOnActive(fn: () => void): void {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    ref.current();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') ref.current(); });
    return () => sub.remove();
  }, []);
}

// ---------------- primitives ----------------
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const t = useTheme();
  const dark = useColorScheme() === 'dark';
  const [x] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    Animated.spring(x, { toValue: on ? 1 : 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start();
  }, [on, x]);
  return (
    <Pressable
      accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on, disabled }} disabled={disabled}
      hitSlop={8} onPress={() => { void Haptics.selectionAsync(); onChange(!on); }}
      style={{ width: 50, height: 30, borderRadius: 15, padding: 2, backgroundColor: on ? t.fg : t.ctrl, opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View style={{
        width: 26, height: 26, borderRadius: 13, backgroundColor: on ? t.onFg : dark ? t.fg2 : '#FFFFFF',
        transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
      }} />
    </Pressable>
  );
}

function Card({ t, children, style }: { t: Theme; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ padding: 16, borderRadius: R.lg, backgroundColor: t.surface, gap: 16 }, squircle, style]}>{children}</View>;
}

function Row({ t, title, sub, right, onPress, label }: { t: Theme; title: string; sub?: string; right?: ReactNode; onPress?: () => void; label?: string }) {
  const body = (
    <>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '600' }}>{title}</Text>
        {!!sub && <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{sub}</Text>}
      </View>
      {right}
    </>
  );
  if (!onPress) return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

function TimeValue({ t, value, open }: { t: Theme; value: string; open: boolean }) {
  return (
    <View style={[{ paddingHorizontal: 12, height: 32, borderRadius: R.xs, justifyContent: 'center', backgroundColor: open ? t.fg : t.bg }, squircle]}>
      <Text style={{ color: open ? t.onFg : t.fg, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

function Segments<K extends string>({ t, value, items, onChange }: { t: Theme; value: K; items: [K, string][]; onChange: (k: K) => void }) {
  return (
    <View style={[{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.bg }, squircle]}>
      {items.map(([k, l]) => (
        <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: value === k }} onPress={() => { void Haptics.selectionAsync(); onChange(k); }}
          style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: value === k ? t.surface2 : 'transparent' }}>
          <Text style={{ color: value === k ? t.fg : t.muted, fontWeight: '600', fontSize: 14 }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Hour + 10-minute wheels. Remounted per field (key) so switching fields never spins values into the wrong one. */
function MinutePicker({ t, value, onChange }: { t: Theme; value: number; onChange: (m: number) => void }) {
  const h = Math.floor(value / 60) % 24;
  const m = Math.round((value % 60) / 10) * 10 % 60;
  // on the page color: PickerFrame's selection band is the surface color, which would vanish on this card
  return (
    <View style={[{ backgroundColor: t.bg, borderRadius: R.md, paddingBottom: 18, marginTop: 4 }, squircle]}>
      <PickerFrame>
        <Wheel items={HOURS} value={h} onChange={(nh) => onChange(nh * 60 + m)} label="시" />
        <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600', marginRight: 12 }}>시</Text>
        <Wheel items={MINS} value={m} onChange={(nm) => onChange(h * 60 + nm)} label="분" />
        <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600' }}>분</Text>
      </PickerFrame>
    </View>
  );
}

const Eyebrow = ({ t, children }: { t: Theme; children: string }) => (
  <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600', marginLeft: 4, marginBottom: 8 }}>{children}</Text>
);

// ---------------- reminders ----------------
type Editing = 'quiet' | 'wake' | null;

function RemindersBlock() {
  // reads mutable store rows through a stable `env`; the compiler would cache them
  'use no memo';
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  useMinuteTick();
  const prefs = useReminderPrefs();
  const [perm, setPerm] = useState<NotifyPermission | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [quietEdge, setQuietEdge] = useState<'start' | 'end'>('start');
  useOnActive(() => { void notifyPermission().then(setPerm); });

  const v = todayView(env);
  const today = plannedReminders(env).filter((r) => r.date === v.ctx.key);
  const muted = prefs.mutedOn === v.ctx.key;
  const set = (patch: Partial<ReminderPrefs>) => reminderPrefs.set(patch);
  const setKind = (k: ReminderKind, on: boolean) => set({ kinds: { ...prefs.kinds, [k]: on } });
  const live = perm === 'granted' && prefs.enabled;

  const enable = async () => {
    const p = await requestNotifyPermission();
    setPerm(p);
    if (p === 'granted') { set({ enabled: true }); toast('오늘 일정으로 알림을 예약했습니다'); }
  };
  const preview = async (all = false) => {
    const n = await previewReminders(env, { all });
    toast(n ? `${n > 1 ? `${n}개 알림을` : '다음 알림을'} 5초 뒤에 보냅니다. 홈 화면으로 나가 보세요` : '오늘 남은 알림이 없습니다');
  };

  return (
    <View>
      <Eyebrow t={t}>알림</Eyebrow>
      {perm !== 'granted' ? (
        <Card t={t}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.fg, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 }}>
              {perm === 'denied' ? '알림이 꺼져 있습니다' : '오늘 일정대로 알려 드립니다'}
            </Text>
            <Text style={{ color: t.fg2, fontSize: 14, lineHeight: 20 }}>
              {perm === 'denied'
                ? 'iPhone 설정에서 이 앱의 알림을 허용하면 끼니, 홈트, 물, 아침 체중 알림을 다시 받습니다.'
                : '기상 시간에 맞춰 끼니 시각과 메뉴, 홈트, 물, 아침 체중을 알립니다. 알림에서 바로 먹었어요, 물 +1, 체중 입력을 누를 수 있습니다.'}
            </Text>
          </View>
          {perm === 'denied'
            ? <Btn label="설정에서 허용" icon="arrow-up-right" onPress={() => void Linking.openSettings()} />
            : <Btn label="알림 켜기" onPress={() => void enable()} />}
        </Card>
      ) : (
        <Card t={t}>
          <Row t={t} title="알림 받기" right={<Toggle label="알림 받기" on={prefs.enabled} onChange={(on) => set({ enabled: on })} />} />
          {prefs.enabled && (
            <Row t={t} title="오늘은 알림 끄기" sub="내일 아침에 다시 켜집니다"
              right={<Toggle label="오늘은 알림 끄기" on={muted} onChange={(on) => set({ mutedOn: on ? v.ctx.key : null })} />} />
          )}
          {live && !muted && (
            <View style={[{ borderRadius: R.md, backgroundColor: t.bg, padding: 14, gap: 10 }, squircle]}>
              <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>
                {today.length ? `오늘 남은 알림 ${today.length}개` : '오늘 남은 알림이 없습니다'}
              </Text>
              {today.slice(0, 5).map((r) => (
                <View key={r.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'baseline' }}>
                  <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], width: 46 }}>{hhmm(r.at)}</Text>
                  <Text numberOfLines={1} style={{ color: t.fg2, fontSize: 14.5, flex: 1 }}>{r.title.replace(/\s\d{2}:\d{2}/, '')}</Text>
                </View>
              ))}
              {today.length > 0 && <Btn small kind="ghost" label="다음 알림 미리 받기" style={{ alignSelf: 'flex-start', marginTop: 2 }} onPress={() => void preview()} />}
              {__DEV__ && today.length > 1 && <Btn small kind="quiet" label="개발용: 오늘 알림 모두 미리 받기" style={{ alignSelf: 'flex-start' }} onPress={() => void preview(true)} />}
              {__DEV__ && <Btn small kind="quiet" label="개발용: 받은 알림의 버튼 눌러 보기" style={{ alignSelf: 'flex-start' }} onPress={() => { void devRunButtons(env).then((r) => toast(r)); }} />}
            </View>
          )}
        </Card>
      )}

      {live && (
        <Card t={t} style={{ marginTop: 12 }}>
          {KIND_ROWS.map((k) => (
            <Row key={k.kind} t={t} title={k.title} sub={k.sub} right={<Toggle label={k.title} on={prefs.kinds[k.kind]} onChange={(on) => setKind(k.kind, on)} />} />
          ))}
          <Row t={t} title="기상 시간 묻기" sub={prefs.kinds.wake && inQuiet(prefs.wakePromptAt, prefs, null) ? '조용한 시간에 걸려 보내지 않습니다' : '이 시각까지 기상 시간이 없으면 한 번'}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {prefs.kinds.wake && (
                  <Pressable accessibilityRole="button" accessibilityLabel={`기상 시간 묻는 시각 ${hhmm(prefs.wakePromptAt)}`} onPress={() => setEditing(editing === 'wake' ? null : 'wake')}>
                    <TimeValue t={t} value={hhmm(prefs.wakePromptAt)} open={editing === 'wake'} />
                  </Pressable>
                )}
                <Toggle label="기상 시간 묻기" on={prefs.kinds.wake} onChange={(on) => { setKind('wake', on); if (!on && editing === 'wake') setEditing(null); }} />
              </View>
            } />
          {editing === 'wake' && prefs.kinds.wake && (
            <MinutePicker key="wake" t={t} value={prefs.wakePromptAt} onChange={(m) => set({ wakePromptAt: m })} />
          )}
        </Card>
      )}

      {live && (
        <Card t={t} style={{ marginTop: 12 }}>
          <Row t={t} title="조용한 시간" sub="이 사이에는 보내지 않습니다. 기상 시간을 넣으면 그때부터 다시 보냅니다."
            onPress={() => setEditing(editing === 'quiet' ? null : 'quiet')} label={`조용한 시간 ${hhmm(prefs.quietStart)}부터 ${hhmm(prefs.quietEnd)}까지`}
            right={<TimeValue t={t} value={`${hhmm(prefs.quietStart)} ~ ${hhmm(prefs.quietEnd)}`} open={editing === 'quiet'} />} />
          {editing === 'quiet' && (
            <View style={{ gap: 8 }}>
              <Segments t={t} value={quietEdge} items={[['start', `시작 ${hhmm(prefs.quietStart)}`], ['end', `끝 ${hhmm(prefs.quietEnd)}`]]} onChange={setQuietEdge} />
              <MinutePicker key={`quiet-${quietEdge}`} t={t} value={quietEdge === 'start' ? prefs.quietStart : prefs.quietEnd}
                onChange={(m) => set(quietEdge === 'start' ? { quietStart: m } : { quietEnd: m })} />
            </View>
          )}
        </Card>
      )}
    </View>
  );
}

// ---------------- Apple Health ----------------
const HEALTH_ROWS: { key: keyof Omit<HealthPrefs, 'connected' | 'connectedOn'>; title: string }[] = [
  { key: 'steps', title: '걸음 수 자동 입력' },
  { key: 'weightIn', title: '체중계 기록 가져오기' },
  { key: 'sleep', title: '수면으로 기상 시간 제안' },
  { key: 'weightOut', title: '체중을 건강 앱에 저장' },
  { key: 'workoutOut', title: '홈트를 건강 앱에 저장' },
];

function HealthBlock() {
  'use no memo';
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const prefs = useHealthPrefs();
  const [access, setAccess] = useState<HealthAccess | null>(null);
  const [weight, setWeight] = useState<HealthWeight | null>(null);
  const [wake, setWake] = useState<number | null>(null);
  const [write, setWrite] = useState({ weight: true, workout: true });
  const available = healthAvailable();

  const refresh = useCallback(async () => {
    if (!available) { setAccess('unavailable'); return; }
    const a = await healthAccess().catch(() => 'notAsked' as const);
    setAccess(a);
    if (a !== 'asked' || !healthPrefs.get().connected) return;
    setWrite(healthWriteAllowed());
    setWeight(await latestHealthWeight().catch(() => null));
    setWake(await lastNightWake(env).catch(() => null));
  }, [available, env]);
  useOnActive(() => { void refresh(); });

  const v = todayView(env);
  const connected = prefs.connected && access === 'asked';
  const suggestion = useWakeSuggestion(env);

  const connect = async () => {
    const ok = await connectHealth(env);
    await refresh();
    if (ok) { void pullHealth(env); toast('건강 앱과 연결했습니다'); }
    else toast('건강 앱 권한 창을 열지 못했습니다. 다시 눌러 주십시오');
  };

  const detail = (key: (typeof HEALTH_ROWS)[number]['key']): string => {
    switch (key) {
      case 'steps': return v.day.steps_source === 'health' ? `오늘 ${fmt(v.day.steps)}보` : '건강 앱 걸음 수로 오늘 걸음을 채웁니다';
      case 'weightIn': return weight && !weight.own ? `최근 ${weight.kg.toFixed(1)}kg · ${keyOf(weight.at) === v.ctx.key ? `오늘 ${hhmm(weight.at.getHours() * 60 + weight.at.getMinutes())}` : `${weight.at.getMonth() + 1}/${weight.at.getDate()}`}` : '오늘 체중계 기록이 있으면 오늘 체중으로 넣습니다';
      case 'sleep': return wake != null ? `오늘 ${hhmm(wake)}에 깬 기록이 있습니다 · 맞추기 전에 묻습니다` : '깬 시각을 알림으로 묻고, 누르면 끼니 시간을 맞춥니다';
      case 'weightOut':
        if (!write.weight) return '건강 앱에서 체중 쓰기가 꺼져 있습니다';
        return weight?.own && keyOf(weight.at) === v.ctx.key ? `오늘 ${weight.kg.toFixed(1)}kg을 건강 앱에 저장했습니다` : '앱에서 기록하거나 고친 체중을 하루 하나로 저장합니다';
      case 'workoutOut': return write.workout ? '홈트를 마치면 근력 운동으로 저장합니다' : '건강 앱에서 운동 쓰기가 꺼져 있습니다';
    }
  };

  return (
    <View>
      <Eyebrow t={t}>건강 앱</Eyebrow>
      {!available ? (
        <Card t={t}><Text style={{ color: t.fg2, fontSize: 14, lineHeight: 20 }}>이 기기에서는 건강 앱을 쓸 수 없습니다.</Text></Card>
      ) : !connected ? (
        <Card t={t}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: t.fg, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 }}>건강 앱과 연결</Text>
            <Text style={{ color: t.fg2, fontSize: 14, lineHeight: 20 }}>
              걸음 수를 직접 넣지 않아도 되고, 체중계 기록과 수면 기록으로 아침 입력이 줄어듭니다. 앱에서 기록한 체중과 홈트는 건강 앱에 저장합니다.
            </Text>
          </View>
          <Btn label="건강 앱 연결" onPress={() => void connect()} />
        </Card>
      ) : (
        <Card t={t}>
          {HEALTH_ROWS.map((r) => (
            <Row key={r.key} t={t} title={r.title} sub={detail(r.key)}
              right={<Toggle label={r.title} on={prefs[r.key]} onChange={(on) => healthPrefs.set({ [r.key]: on } as Partial<HealthPrefs>)} />} />
          ))}
          {suggestion.wake != null && (
            <View style={[{ borderRadius: R.md, backgroundColor: t.bg, padding: 14, gap: 10 }, squircle]}>
              <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600' }}>오늘 {hhmm(suggestion.wake)}에 깬 기록이 있습니다</Text>
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>건강 앱 수면 기록입니다. 맞추면 끼니와 홈트 시간이 이 시각 기준으로 정해집니다.</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn small label={`${hhmm(suggestion.wake)}로 맞추기`} onPress={() => { suggestion.accept(); toast(`기상 ${hhmm(suggestion.wake!)} · 끼니 시간을 맞췄습니다`); }} />
                <Btn small kind="ghost" label="아니요" onPress={suggestion.dismiss} />
              </View>
            </View>
          )}
          {(!write.weight || !write.workout) && (
            <Btn small kind="ghost" label="건강 앱에서 권한 열기" icon="arrow-up-right" style={{ alignSelf: 'flex-start' }} onPress={() => void Linking.openURL('x-apple-health://')} />
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Btn small kind="ghost" label="지금 가져오기" onPress={() => { void pullHealth(env).then(refresh).then(() => toast('건강 앱에서 다시 읽었습니다')); }} />
            <Btn small kind="quiet" label="연결 끊기" onPress={() => { disconnectHealth(); toast('건강 앱 연결을 끊었습니다. 권한은 설정 > 건강에서 바꿉니다'); }} />
          </View>
          {__DEV__ && <Btn small kind="quiet" label="개발용: 샘플 건강 데이터 넣기" style={{ alignSelf: 'flex-start' }} onPress={() => { void seedHealthSamples(env).then(() => pullHealth(env)).then(refresh).then(() => toast('샘플 걸음·체중·수면을 넣었습니다')); }} />}
        </Card>
      )}
    </View>
  );
}

/** Reminders + Apple Health settings. Mount inside the settings ScrollView. */
export function HealthNotifySection({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 28 }, style]}>
      <RemindersBlock />
      <HealthBlock />
    </View>
  );
}

export default HealthNotifySection;
