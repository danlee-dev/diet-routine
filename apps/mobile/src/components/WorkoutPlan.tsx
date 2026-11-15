// The workout plan: this week's sessions (tap a day to change it, today only or every week) and the two
// routines with their exercises. Used by the 운동 tab.
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { amrapOf, DOW, repMultiplier, WEEK_LABEL, WEEK_TYPES, type RoutineKey, type WeekType } from '@diet/core';
import { setTodaySession, setWeekDay, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { squircle, type Theme } from '@/lib/theme';
import { Btn, useToast } from '@/components/ui';
import { Section } from '@/components/list';
import { onCoachFocus } from '@/lib/coach';

export const SESSION_NAME: Record<WeekType, string> = { A: '홈트 A · 상체', B: '홈트 B · 하체', walk: '걷기', light: '가볍게 (A 3라운드)', rest: '휴식' };

export function Segmented<T extends string>({ items, value, onChange, t }: { items: [T, string][]; value: T; onChange: (v: T) => void; t: Theme }) {
  return (
    <View style={[{ flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: t.surface }, squircle]}>
      {items.map(([k, l]) => (
        <Pressable
          key={k}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === k }}
          onPress={() => { void Haptics.selectionAsync(); onChange(k); }}
          style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: value === k ? t.bg : 'transparent' }}
        >
          <Text style={{ color: value === k ? t.fg : t.muted, fontWeight: '600', fontSize: 14 }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function WorkoutPlan({ t }: { t: Theme }) {
  const env = useEnv();
  const { toast } = useToast();
  const v = todayView(env);
  const [rt, setRt] = useState<RoutineKey>(v.session === 'B' ? 'B' : 'A');
  // 보기 on a routine card shows that routine
  useEffect(() => onCoachFocus((target) => { const m = /^plan:workout:routine:(A|B)$/.exec(target); if (m) setRt(m[1] as RoutineKey); }), []);
  const mult = repMultiplier(v.ctx.week);
  const R2 = v.routines;
  const pickDay = (d: number) => {
    const opts = WEEK_TYPES.map((x) => SESSION_NAME[x]);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `${DOW[d]}요일 운동`, options: [...opts, '취소'], cancelButtonIndex: opts.length },
      (i) => {
        if (i >= opts.length) return;
        const pick = WEEK_TYPES[i]!;
        const weekly = () => { const undo = setWeekDay(env, d, pick, 'user', `${DOW[d]}요일을 ${WEEK_LABEL[pick]}로 바꿨습니다`); toast(`매주 ${DOW[d]}요일은 ${SESSION_NAME[pick]}`, undo); };
        if (d !== v.ctx.dow) { weekly(); return; }
        ActionSheetIOS.showActionSheetWithOptions(
          { title: `${SESSION_NAME[pick]}로 바꿉니다`, options: ['오늘만', `매주 ${DOW[d]}요일`, '취소'], cancelButtonIndex: 2 },
          (j) => {
            if (j === 0) { const undo = setTodaySession(env, pick, 'user'); toast(`오늘은 ${SESSION_NAME[pick]}`, undo); }
            else if (j === 1) weekly();
          },
        );
      },
    );
  };
  return (
    <>
      <View style={{ flexDirection: 'row', marginTop: 22 }}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const today = d === v.ctx.dow;
          const t2 = today ? v.session : v.week[d]!.t;
          return (
            <Pressable key={d} accessibilityRole="button" accessibilityLabel={`${DOW[d]}요일 ${SESSION_NAME[t2]}. 바꾸기`} onPress={() => pickDay(d)} style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ color: t.muted, fontSize: 12 }}>{DOW[d]}</Text>
              <View style={{ minWidth: 38, height: 34, paddingHorizontal: 4, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: today ? t.fg : 'transparent' }}>
                <Text style={{ color: today ? t.onFg : t2 === 'rest' ? t.muted : t.fg, fontSize: 13.5, fontWeight: '600' }}>{WEEK_LABEL[t2]}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 10, textAlign: 'center' }}>
        {v.session !== v.week[v.ctx.dow]!.t ? `오늘만 ${SESSION_NAME[v.session]}로 바꿨습니다 · ` : ''}요일을 누르면 바꿉니다
      </Text>
      <View style={{ marginTop: 24 }}>
        <Segmented t={t} value={rt} onChange={setRt} items={[['A', `${R2.A.name} · 상체`], ['B', `${R2.B.name} · 하체`]]} />
      </View>
      <Section style={{ marginTop: 12 }} footer={amrapOf(R2[rt]) ? `${amrapOf(R2[rt])}분 동안 이 순서를 계속 반복하고 바퀴 수를 셉니다.` : `${v.ctx.week}주차 기준 횟수입니다. 주마다 조금씩 늘어납니다.`}>
        {R2[rt].items.map((x) => (
          <View key={x.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 16 }}>
            <Text style={{ color: t.fg, fontSize: 15.5 }}>{x.name}</Text>
            <Text style={{ color: t.muted, fontSize: 15.5, fontVariant: ['tabular-nums'] }}>{amrapOf(R2[rt]) ? x.n : Math.round(x.n * mult)}{x.unit}</Text>
          </View>
        ))}
      </Section>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
        <Btn kind="ghost" label="구성 바꾸기" onPress={() => router.push({ pathname: '/sheet/routine', params: { key: rt } })} />
        <Btn icon="play" label={`${R2[rt].name} 따라하기`} style={{ flex: 1 }} onPress={() => router.push({ pathname: '/workout', params: { routine: rt } })} />
      </View>
    </>
  );
}

