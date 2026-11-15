import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { amrapOf, fmt, hhmm, proteinGap, relText, SCEN, SKIP_ADVICE, sgn, timeLabel, workoutRounds, type MealKey } from '@diet/core';
import {
  focusNow, recommendation, remainingKcal, setWake, setWater, skipMeal, timeline, todayView, toggleMeal,
  type Focus, type TimelineItem, type TodayView,
} from '@diet/data';
import { useEnv, useMinuteTick, useRefresh } from '@/lib/hooks';
import { getSupabase } from '@/lib/env';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, Orb, useToast } from '@/components/ui';
import { RebalanceCard } from '@/components/RebalanceCard';
import { SuggestionCards } from '@/components/SuggestionCards';
import { RainNote } from '@/components/RainNote';

function useMealActions(v: TodayView) {
  const env = useEnv();
  const { toast } = useToast();
  return {
    eat: (k: MealKey) => { const r = toggleMeal(env, v.ctx.key, k); const m = v.meals.find((x) => x.key === k); if (r.added) toast(`${m?.name ?? ''} 먹음 표시`, r.undo); },
    other: (k: MealKey) => router.push({ pathname: '/sheet/food', params: { slot: k } }),
    skip: (k: MealKey) => { const u = skipMeal(env, v.ctx.key, k); const m = v.meals.find((x) => x.key === k); toast(`${m?.name ?? ''} 건너뜀`, u); },
  };
}

function SyncBanner({ t }: { t: Theme }) {
  const env = useEnv();
  if (!getSupabase() || env.store.syncState !== 'local') return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, opacity: pressed ? 0.6 : 1 })}>
      <Icon name="cloud-off" size={14} color={t.muted} />
      <Text style={{ flex: 1, color: t.muted, fontSize: 13.5 }}>이 기기에만 저장 중입니다</Text>
      <Text style={{ color: t.fg, fontSize: 13.5, fontWeight: '600' }}>로그인해서 웹과 맞추기</Text>
    </Pressable>
  );
}

function Header({ v, t }: { v: TodayView; t: Theme }) {
  const env = useEnv();
  const sc = SCEN[v.scen];
  const left = remainingKcal(env, v);
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: t.muted, fontSize: 13.5, flexShrink: 1 }} numberOfLines={1}>{v.ctx.label} · {v.ctx.no}일째</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`오늘 상황: ${sc.name}. 바꾸기`} hitSlop={8} onPress={() => router.push('/sheet/scenario')} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: pressed ? 0.6 : 1 })}>
          <Icon name={sc.icon} size={14} color={t.fg} />
          <Text style={{ color: t.fg, fontSize: 13.5, fontWeight: '600' }}>{sc.name}</Text>
          <Icon name="chevron-down" size={10} color={t.muted} weight="semibold" />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ color: t.muted, fontSize: 13.5, flexShrink: 1 }}>
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{fmt(v.sum.eaten)}</Text> / {fmt(left + v.sum.eaten)} kcal 먹음
        </Text>
        <Text style={{ color: t.muted, fontSize: 13.5 }}>{left >= 0 ? '남은 ' : '초과 '}<Text style={{ color: t.fg, fontWeight: '600' }}>{fmt(Math.abs(left))}</Text></Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {v.meals.map((m) => <View key={m.key} style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: v.eaten.has(m.key) && !v.skipped.has(m.key) ? t.fg : t.surface2 }} />)}
      </View>
    </View>
  );
}

function FocusCard({ f, v, t }: { f: Focus; v: TodayView; t: Theme }) {
  const env = useEnv();
  const { toast } = useToast();
  const act = useMealActions(v);
  const box = [{ overflow: 'hidden' as const, padding: 20, paddingTop: 22, borderRadius: R.xl, backgroundColor: t.surface }, squircle];
  const k = (s: string) => <Text style={{ color: t.fg2, fontSize: 12.5, fontWeight: '700' }}>{s}</Text>;
  const title = (s: string) => <Text style={{ color: t.fg, fontSize: 36, fontWeight: '300', letterSpacing: -1, marginTop: 4, paddingRight: 40 }}>{s}</Text>;
  const meta = (s: string) => <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 12, lineHeight: 18 }}>{s}</Text>;
  const orb = <Orb size={118} style={{ right: -46, top: -56 }} />;
  const acts = (children: React.ReactNode) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>{children}</View>;

  if (f.kind === 'wake') {
    return (
      <View style={box}>{orb}{k('좋은 아침이에요')}{title('일어났나요?')}
        {meta('일어난 시간에 맞춰 끼니 시간을 정하고, 저녁은 8시 전에 끝나게 맞춥니다.')}
        {acts(<>
          <Btn label="지금 일어났어요" icon="sunrise" onPress={() => { const n = env.now(); const m = n.getHours() * 60 + n.getMinutes(); setWake(env, m, { lateRule: true }); toast(`기상 ${hhmm(m)} · 끼니 시간을 맞췄습니다`); }} />
          <Btn label="시간 고르기" kind="ghost" onPress={() => router.push('/sheet/time')} />
        </>)}
      </View>
    );
  }
  if (f.kind === 'workout') {
    const r = v.routines[f.routine];
    return (
      <View style={box}>{orb}{k(`홈트 시간 · ${hhmm(f.at)}쯤`)}{title(r.name)}
        <Text style={{ color: t.fg, fontSize: 13.5, fontWeight: '600', marginTop: 6 }}>{r.focus} · {amrapOf(r) ? `${amrapOf(r)}분 동안 반복` : `${workoutRounds(v.ctx.week)}라운드 · 약 25분`}</Text>
        {acts(<Btn label="따라하기 시작" icon="play" onPress={() => router.push({ pathname: '/workout', params: { routine: f.routine } })} />)}
      </View>
    );
  }
  if (f.kind === 'cutoff') {
    return (
      <View style={box}>{orb}{k('저녁 마감 20:00 지남')}{title('오늘은 물만 마셔요')}{meta(SKIP_ADVICE.dinner)}
        {acts(<>
          <Btn label="저녁 먹었어요" icon="check" onPress={() => act.eat('dinner')} />
          <Btn label="건너뛰기" kind="ghost" onPress={() => act.skip('dinner')} />
        </>)}
      </View>
    );
  }
  if (f.kind === 'done') {
    const gap = proteinGap(v.sum.eatenProtein, env.program.proteinFloor);
    return (
      <View style={box}>{orb}{k('오늘 끝')}{title(`${fmt(v.sum.eaten)}kcal 먹었어요`)}
        <Text style={{ color: t.fg, fontSize: 13.5, fontWeight: '600', marginTop: 6 }}>단백질 {v.sum.eatenProtein}g{gap ? ` · 목표보다 ${gap}g 적음` : ' · 목표 채움'}</Text>
        {meta('이제부터는 물, 아메리카노, 제로 음료만 마십니다.')}
      </View>
    );
  }
  const m = f.meal;
  return (
    <View style={box}>{orb}{k(`지금 먹을 것 · ${timeLabel(m)}`)}{title(m.name)}
      {m.at != null && <Text style={{ color: t.fg, fontSize: 13.5, fontWeight: '600', marginTop: 6 }}>{relText(m.at, v.nowMin)}</Text>}
      <View style={{ gap: 5, marginTop: 14 }}>
        {m.items.map((x) => (
          <View key={x.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
            <Text style={{ color: t.fg, fontSize: 15, flexShrink: 1 }}>{x.name}</Text><Text style={{ color: t.muted, fontSize: 15 }}>{x.amount}</Text>
          </View>
        ))}
      </View>
      {acts(<>
        <Btn label="먹었어요" icon="check" onPress={() => act.eat(m.key)} />
        <Btn label="다르게 · 일부만" kind="ghost" onPress={() => act.other(m.key)} />
      </>)}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
        <Text style={{ flex: 1, color: t.muted, fontSize: 12.5, lineHeight: 18 }}>{`${m.est ? '약 ' : ''}${fmt(m.kcal)}kcal · 단백질 ${m.protein}g${m.hint ? ` · ${m.hint}` : ''}`}</Text>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={() => act.skip(m.key)}>
          <Text style={{ color: t.fg2, fontSize: 13.5, fontWeight: '600' }}>건너뛰기</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QuickLog({ v, t }: { v: TodayView; t: Theme }) {
  const env = useEnv();
  const { toast } = useToast();
  const pill = [{ flex: 1, padding: 12, borderRadius: R.md, backgroundColor: t.surface, gap: 2 }, squircle];
  const bar = (pct: number) => <View style={{ height: 3, borderRadius: 3, backgroundColor: t.surface2, marginTop: 6, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, pct)}%`, height: 3, backgroundColor: t.fg }} /></View>;
  const label = (icon: string, s: string) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name={icon} size={12} color={t.muted} /><Text style={{ color: t.muted, fontSize: 12, fontWeight: '500' }}>{s}</Text></View>;
  const big = { color: t.fg, fontSize: 21, fontWeight: '400' as const, fontVariant: ['tabular-nums' as const] };
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
      <Pressable style={pill} onPress={() => router.push({ pathname: '/sheet/weight', params: { i: String(v.ctx.idx) } })}>
        {label('weight', '체중')}
        {v.weight != null
          ? <Text style={big}>{v.weight.toFixed(1)}<Text style={{ fontSize: 12, color: t.muted }}> kg {v.prevWeight != null ? sgn(v.weight - v.prevWeight) : ''}</Text></Text>
          : <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600', paddingTop: 4 }}>기록하기</Text>}
      </Pressable>
      <Pressable style={pill} onPress={() => { const b = v.day.water_cups; void Haptics.selectionAsync(); setWater(env, v.ctx.key, b + 1); toast(`물 ${Math.min(8, b + 1)}잔`, () => setWater(env, v.ctx.key, b)); }}>
        {label('glass-water', '물 +1')}
        <Text style={big}>{v.day.water_cups}<Text style={{ fontSize: 12, color: t.muted }}> / 8잔</Text></Text>
        {bar((v.day.water_cups / 8) * 100)}
      </Pressable>
      <Pressable style={pill} onPress={() => router.push('/sheet/steps')}>
        {label('footprints', '걸음')}
        <Text style={big} numberOfLines={1}>{fmt(v.day.steps)}</Text>
        {bar((v.day.steps / v.stepsGoal) * 100)}
      </Pressable>
    </View>
  );
}

function Reco({ v, t }: { v: TodayView; t: Theme }) {
  const env = useEnv();
  const { toast } = useToast();
  const r = recommendation(env, v);
  const run = () => {
    const a = r.action;
    if (!a) return;
    if (a.kind === 'order') { if (a.url) void Linking.openURL(a.url); else router.push('/plan'); }
    else if (a.kind === 'steps') router.push('/sheet/steps');
    else if (a.kind === 'water') { const b = v.day.water_cups; setWater(env, v.ctx.key, b + 1); toast(`물 ${b + 1}잔`, () => setWater(env, v.ctx.key, b)); }
    else router.push('/sheet/scenario');
  };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, paddingVertical: 12, paddingHorizontal: 4 }}>
      <Icon name={r.icon} size={18} color={t.fg2} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} lineBreakStrategyIOS="hangul-word" style={{ color: t.fg, fontSize: 14.5, fontWeight: '600' }}>{r.title}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{r.body}</Text>
      </View>
      {r.action && <Btn small kind="ghost" label={r.action.label} onPress={run} />}
    </View>
  );
}

function Row({ it, v, t, open, setOpen }: { it: TimelineItem; v: TodayView; t: Theme; open: string | null; setOpen: (s: string | null) => void }) {
  const env = useEnv();
  const act = useMealActions(v);
  const expanded = open === it.id;
  const m = it.meal;
  const kcal = it.entries?.length ? it.entries.reduce((a, e) => a + e.kcal, 0) : m?.kcal;
  const tag = it.state === 'late' ? '지남' : it.state === 'skipped' ? '건너뜀' : it.state === 'next' ? '다음' : null;
  const dot = it.state === 'done'
    ? { backgroundColor: t.fg, borderColor: t.fg }
    : it.state === 'next' ? { width: 18, height: 18, borderWidth: 4, borderColor: t.fg, backgroundColor: t.bg } : { borderColor: t.ctrl, backgroundColor: t.bg, borderStyle: (it.state === 'late' || it.state === 'skipped' ? 'dashed' : 'solid') as 'dashed' | 'solid' };
  const done = it.state === 'done';
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 10 }}>
      <Text style={{ width: 46, textAlign: 'right', color: t.muted, fontSize: 12.5, paddingTop: 2, fontVariant: ['tabular-nums'] }}>{it.at != null ? hhmm(it.at) : ''}</Text>
      <View style={{ width: 34, alignItems: 'center' }}>
        <View style={[{ width: 14, height: 14, borderRadius: 9, borderWidth: 1.5, marginTop: 4 }, dot]} />
      </View>
      <View style={{ flex: 1 }}>
        <Pressable onPress={() => { if (it.kind === 'wake') router.push('/sheet/time'); else if (it.kind === 'meal') setOpen(expanded ? null : it.id); }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: done || it.state === 'skipped' ? t.muted : t.fg, fontSize: 15.5, fontWeight: '600', textDecorationLine: done && it.kind === 'meal' ? 'line-through' : 'none' }}>{it.title}</Text>
            {tag && <Text style={{ fontSize: 11.5, fontWeight: '700', color: t.fg2, backgroundColor: t.surface2, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, overflow: 'hidden' }}>{tag}</Text>}
          </View>
          <Text numberOfLines={it.state === 'skipped' ? 3 : 1} style={{ color: it.state === 'skipped' ? t.fg2 : t.muted, fontSize: 13, marginTop: 1 }}>{it.sub}</Text>
        </Pressable>
        {expanded && m && (
          <View style={[{ marginTop: 8, padding: 12, borderRadius: R.sm, backgroundColor: t.surface, gap: 4 }, squircle]}>
            {m.items.map((x) => <View key={x.name} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: t.fg, fontSize: 14 }}>{x.name}</Text><Text style={{ color: t.muted, fontSize: 14 }}>{x.amount}</Text></View>)}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {done || it.state === 'skipped'
                ? <Btn small kind="ghost" icon="rotate-ccw" label="기록 취소" onPress={() => { toggleMeal(env, v.ctx.key, m.key); setOpen(null); }} />
                : <><Btn small kind="ghost" label="다르게 먹었어요" onPress={() => act.other(m.key)} /><Btn small kind="ghost" label="건너뛰기" onPress={() => { act.skip(m.key); setOpen(null); }} /></>}
            </View>
          </View>
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 8 }}>
        {it.kind === 'meal' && m && (
          <>
            <Text style={{ color: t.fg2, fontSize: 14, paddingTop: 7, fontVariant: ['tabular-nums'] }}>{fmt(kcal ?? 0)}<Text style={{ fontSize: 11, color: t.muted }}>kcal</Text></Text>
            <Pressable
              accessibilityLabel={`${it.title} 먹음 표시`}
              onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); if (it.state === 'skipped') toggleMeal(env, v.ctx.key, m.key); else act.eat(m.key); }}
              style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: done ? t.fg : t.ctrl, backgroundColor: done ? t.fg : 'transparent', alignItems: 'center', justifyContent: 'center', borderStyle: it.state === 'skipped' ? 'dashed' : 'solid' }}
            >
              {(done || it.state === 'skipped') && <Icon name={done ? 'check' : 'rotate-ccw'} size={14} color={done ? t.onFg : t.muted} weight="bold" />}
            </Pressable>
          </>
        )}
        {it.kind === 'workout' && it.routine && it.state !== 'done' && <Btn small label="시작" icon="play" onPress={() => router.push({ pathname: '/workout', params: { routine: it.routine! } })} />}
        {it.kind === 'workout' && done && <Text style={{ color: t.fg, fontWeight: '600', fontSize: 13, paddingTop: 6 }}>완료</Text>}
      </View>
    </View>
  );
}

export default function TodayScreen() {
  const env = useEnv();
  useMinuteTick();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const v = todayView(env);
  const f = focusNow(env, v);
  const items = timeline(env, v);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = useRefresh();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={t.muted} />}
      contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}>
      <Header v={v} t={t} />
      <SyncBanner t={t} />
      <FocusCard f={f} v={v} t={t} />
      <RebalanceCard v={v} />
      <SuggestionCards />
      <RainNote v={v} />
      <QuickLog v={v} t={t} />
      <Reco v={v} t={t} />
      <Text style={{ color: t.fg, fontSize: 17, fontWeight: '600', marginTop: 24, marginBottom: 4 }}>오늘 흐름</Text>
      {items.map((it) => <Row key={it.id} it={it} v={v} t={t} open={open} setOpen={setOpen} />)}
    </ScrollView>
  );
}
