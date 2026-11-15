// The whole onboarding on one screen: a question per step (chapter progress, back, skip where the answer is
// optional), then the building ledger, then the review. /onboarding uses it for new users; /answers uses it
// prefilled for Settings > 내 정보 다시 입력.
import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import Animated, { FadeInLeft, FadeInRight, FadeOut, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { generatePlan, type GeneratedPlan, type OnboardingAnswers } from '@diet/core';
import { useEnv } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/components/ui';
import { answersOf, draftFromProfile, emptyDraft, STEPS, summaryOf, type Draft } from './answers';
import { ChapterBar, Cta, IconButton, TextButton } from './controls';
import { canContinue, firstInvalid, SKIPPABLE, StepView } from './steps';
import { Building } from './Building';
import { Review } from './Review';
import { saveNew, updateAnswers } from './save';

const enterFwd = FadeInRight.duration(300).withInitialValues({ opacity: 0, transform: [{ translateX: 28 }] });
const enterBack = FadeInLeft.duration(300).withInitialValues({ opacity: 0, transform: [{ translateX: -28 }] });
const leave = FadeOut.duration(140);

export function OnboardingFlow({ mode }: { mode: 'new' | 'edit' }) {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => (mode === 'edit' ? draftFromProfile(env) : emptyDraft()));
  const draftRef = useRef(draft);
  const [i, setI] = useState(0);
  const iRef = useRef(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [reached, setReached] = useState(mode === 'edit' ? STEPS.length : 0);
  // height/weight follow the chosen sex's defaults until touched; a saved profile counts as touched
  const [touched] = useState(() => new Set<string>(mode === 'edit' ? STEPS : []));
  const [stage, setStage] = useState<'ask' | 'build' | 'review'>('ask');
  const [built, setBuilt] = useState<{ answers: OnboardingAnswers; base: GeneratedPlan; cached: GeneratedPlan | null } | null>(null);
  const [result, setResult] = useState<{ plan: GeneratedPlan; source: 'user' | 'ai' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [now] = useState(() => env.now());
  const id = STEPS[i]!;
  // the review fades out before the gate swaps in Today, so the handover reads as one fade, not a blank cut
  const shown = useSharedValue(1);
  const shownStyle = useAnimatedStyle(() => ({ opacity: shown.value }));

  const set = (patch: Partial<Draft>) => {
    touched.add(STEPS[iRef.current]!);
    draftRef.current = { ...draftRef.current, ...patch };
    setDraft(draftRef.current);
  };

  const goTo = (n: number, d: 1 | -1) => {
    iRef.current = n;
    Keyboard.dismiss();
    setDir(d);
    setI(n);
    setReached((r) => Math.max(r, n));
  };

  // AI refinements already received in this flow, by answers: going back and forth never spends another request
  const aiCache = useRef(new Map<string, GeneratedPlan>());

  const build = () => {
    Keyboard.dismiss();
    // edit mode can jump here from any question: never build from an answer the steps would not accept
    const bad = firstInvalid(draftRef.current, STEPS);
    if (bad >= 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (stage !== 'ask') setStage('ask');
      goTo(bad, bad < iRef.current ? -1 : 1);
      return;
    }
    const answers = answersOf(draftRef.current);
    setBuilt({ answers, base: generatePlan(answers), cached: aiCache.current.get(JSON.stringify(answers)) ?? null });
    setResult(null);
    setReached(STEPS.length);
    setStage('build');
  };

  /** `from` guards against double taps and late auto-advances: only the step that asked may move on. */
  const next = (from: number) => {
    if (from !== iRef.current) return;
    if (!canContinue(STEPS[from]!, draftRef.current)) return;
    if (from < STEPS.length - 1) goTo(from + 1, 1);
    else build();
  };

  const back = () => {
    if (saving) return;
    if (stage !== 'ask') { setStage('ask'); goTo(STEPS.length - 1, -1); return; }
    if (i > 0) goTo(i - 1, -1);
    else router.back();
  };

  const save = () => {
    if (!built || !result || saving) return;
    setSaving(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (mode === 'new') {
      // fade out, then save: the root gate sees the new profile and fades Today in (see _layout.tsx)
      shown.set(withTiming(0, { duration: 180, reduceMotion: ReduceMotion.Never }));
      setTimeout(() => {
        try {
          saveNew(env, built.answers, result.plan, result.source);
        } catch {
          shown.set(1);
          setSaving(false);
          toast('계획을 저장하지 못했습니다. 다시 눌러 주세요');
        }
      }, 180);
      return;
    }
    const undo = updateAnswers(env, built.answers, result.plan, result.source);
    // close this flow and Settings: the toast lives under native modals, and Today is where the new plan shows
    router.dismissTo('/');
    toast('새 답으로 계획을 바꿨습니다', undo);
  };

  const skip = SKIPPABLE[id];
  const right = stage !== 'ask' ? null
    : mode === 'edit' ? <TextButton label="계획 보기" color={t.fg} onPress={build} />
      : skip ? <TextButton label="건너뛰기" onPress={() => { set(skip); next(i); }} /> : null;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: t.bg }}>
      <Animated.View style={[{ flex: 1 }, shownStyle]}>
      {/* swipe-back only where it cannot throw away answers */}
      <Stack.Screen options={{ gestureEnabled: stage === 'ask' && i === 0 }} />
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconButton icon={stage === 'ask' && i === 0 && mode === 'edit' ? 'xmark' : 'chevron.left'} label={stage === 'ask' && i === 0 && mode === 'edit' ? '닫기' : '뒤로'} onPress={back} />
        <ChapterBar step={stage === 'ask' ? id : 'done'} />
        <View style={{ width: 72, alignItems: 'flex-end' }}>{right}</View>
      </View>

      {stage === 'ask' && (
        <>
          <View style={{ flex: 1 }}>
            <Animated.View key={id} entering={dir > 0 ? enterFwd : enterBack} exiting={leave} style={StyleSheet.absoluteFill}>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 22, paddingBottom: 28 }}>
                <StepView id={id} d={draft} set={set} advance={() => next(i)} now={now} touched={touched} />
              </ScrollView>
            </Animated.View>
          </View>
          <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: insets.bottom + 12, flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {/* each fact is one unbreakable chunk, so a wrap never splits "12주" or "78 → 72kg" */}
            <View accessible accessibilityLabel={`지금까지: ${summaryOf(draft, reached).join(', ')}`} style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', maxHeight: 36, overflow: 'hidden' }}>
              {summaryOf(draft, reached).map((part, n, all) => (
                <Text key={n} numberOfLines={1} style={{ color: t.muted, fontSize: 13, lineHeight: 18 }}>{part}{n < all.length - 1 ? ' · ' : ''}</Text>
              ))}
            </View>
            <Cta label={i === STEPS.length - 1 ? '계획 만들기' : '다음'} disabled={!canContinue(id, draft)} onPress={() => next(i)} />
          </View>
        </>
      )}

      {stage === 'build' && built && (
        <Building
          answers={built.answers}
          base={built.base}
          cached={built.cached}
          onRefined={(plan) => aiCache.current.set(JSON.stringify(built.answers), plan)}
          onDone={(plan, source) => { setResult({ plan, source }); setStage('review'); }}
        />
      )}

      {stage === 'review' && built && result && (
        <Review answers={built.answers} plan={result.plan} source={result.source} mode={mode} saving={saving} onSave={save} />
      )}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}
