// "Building" as an honest calculation ledger, not a fake loader: the real numbers behind the plan appear one line
// at a time (resting energy -> daily burn -> cut -> target -> meals, workout, shopping). The offline plan is
// already complete; when signed in, the coach's refinement streams its steps underneath and replaces the plan
// if it arrives. "계획 보기" never waits for it.
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACTIVITY_FACTOR, fmt, hhmm, schedule, type GeneratedPlan, type OnboardingAnswers } from '@diet/core';
import { useTheme } from '@/lib/theme';
import { Cta, Fact, Sym } from './controls';
import { refinePlan, signedInToken, type RefineStep } from './refine';

const STEP_MS = 230;

export function ledgerOf(a: OnboardingAnswers, g: GeneratedPlan): { label: string; value: string; strong?: boolean }[] {
  const t = g.targets;
  const meals = Object.values(g.plan.meals ?? {}).filter((m) => m && !m.removed).length;
  const week = Object.values(g.plan.workout?.week ?? {});
  const strength = week.filter((w) => w === 'A' || w === 'B').length;
  const walk = week.filter((w) => w === 'walk').length;
  const shop = (g.plan.shop?.now.length ?? 0) + (g.plan.shop?.week.length ?? 0);
  const first = schedule(a.wakeMin)?.b;
  return [
    { label: '기초대사량', value: `${fmt(t.bmr)}kcal` },
    { label: `하루 소모 (활동량 ×${ACTIVITY_FACTOR[a.activity]})`, value: `${fmt(t.tdee)}kcal` },
    { label: '하루 줄일 양', value: `−${fmt(t.deficit)}kcal` },
    { label: '하루 목표', value: `${fmt(t.kcal)}kcal`, strong: true },
    { label: '단백질', value: `${t.proteinFloor}g 이상` },
    { label: '끼니', value: `${meals}번${first != null ? ` · 첫 끼 ${hhmm(first)}` : ''}` },
    { label: '운동', value: strength ? `근력 주 ${strength}회 · 걷기 ${walk}일` : `걷기 ${walk}일` },
    { label: '장보기', value: `${shop}가지 · 주 약 ${fmt(Math.round(g.weeklyCost / 1000) * 1000)}원` },
  ];
}

export function Building({ answers, base, onDone }: {
  answers: OnboardingAnswers;
  base: GeneratedPlan;
  onDone: (plan: GeneratedPlan, source: 'user' | 'ai') => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const rows = ledgerOf(answers, base);
  const [shown, setShown] = useState(reduce ? rows.length : 0);
  const [ai, setAi] = useState<{ state: 'off' | 'running' | 'done' | 'failed'; steps: RefineStep[]; plan: GeneratedPlan | null }>({ state: 'off', steps: [], plan: null });
  const abort = useRef<AbortController | null>(null);

  // staged reveal: one ledger line at a time, a light tick each, a success tap at the end
  useEffect(() => {
    if (shown >= rows.length) { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); return; }
    const id = setTimeout(() => { void Haptics.selectionAsync(); setShown((n) => n + 1); }, shown === 0 ? 350 : STEP_MS);
    return () => clearTimeout(id);
  }, [shown, rows.length]);

  // coach refinement, only when signed in; any failure keeps the offline plan
  useEffect(() => {
    let alive = true;
    void signedInToken().then((token) => {
      if (!token || !alive) return;
      const ac = new AbortController();
      abort.current = ac;
      const timer = setTimeout(() => ac.abort(), 45000);
      setAi({ state: 'running', steps: [], plan: null });
      void refinePlan(answers, base, (s) => {
        if (alive) setAi((cur) => ({ ...cur, steps: cur.steps.some((x) => x.id === s.id) ? cur.steps.map((x) => (x.id === s.id ? s : x)) : [...cur.steps, s] }));
      }, ac.signal).then((plan) => {
        clearTimeout(timer);
        if (alive) setAi((cur) => ({ ...cur, state: plan ? 'done' : 'failed', plan }));
      });
    });
    return () => { alive = false; abort.current?.abort(); };
  }, [answers, base]);

  const ready = shown >= rows.length;
  const waiting = ai.state === 'running';
  const go = () => {
    abort.current?.abort();
    onDone(ai.plan ?? base, ai.plan ? 'ai' : 'user');
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 22, paddingBottom: 24 }}>
        <Text lineBreakStrategyIOS="hangul-word" accessibilityRole="header" style={{ color: t.fg, fontSize: 34, fontWeight: '300', letterSpacing: -1, lineHeight: 42 }}>
          {ready ? '계획이 나왔습니다' : '계산하는 중입니다'}
        </Text>
        <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 15, lineHeight: 22, marginTop: 8 }}>{ready ? '답한 내용으로 이렇게 정했습니다.' : '답한 내용으로 하나씩 계산합니다.'}</Text>
        <View style={{ marginTop: 26 }}>
          {rows.slice(0, shown).map((r, i) => (
            <Animated.View key={r.label} entering={FadeInDown.duration(280).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })} style={i === 3 ? { marginTop: 4, marginBottom: 10 } : undefined}>
              <Fact label={r.label} value={r.value} strong={r.strong} />
            </Animated.View>
          ))}
        </View>
        {ai.state !== 'off' && ready && (
          <Animated.View entering={FadeIn.duration(240)} style={{ marginTop: 22, gap: 8 }}>
            <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>
              {ai.state === 'running' ? '코치가 식단을 다듬고 있습니다' : ai.state === 'done' ? '코치가 다듬은 식단으로 바꿨습니다' : '코치 다듬기는 건너뛰고 이 계획으로 갑니다'}
            </Text>
            {ai.steps.map((s) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 16, alignItems: 'center' }}>{s.done ? <Sym name="checkmark" size={11} color={t.fg} weight="bold" /> : null}</View>
                <Text style={{ color: s.done ? t.fg : t.muted, fontSize: 14.5 }}>{s.label}</Text>
              </View>
            ))}
          </Animated.View>
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: insets.bottom + 12 }}>
        <Cta label={waiting ? '기다리지 않고 보기' : '계획 보기'} disabled={!ready} onPress={go} wide />
      </View>
    </View>
  );
}
