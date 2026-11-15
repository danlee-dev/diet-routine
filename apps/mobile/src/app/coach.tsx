// AI coach chat (modal). Same events and change cards as the web panel; text only until a photo picker is added.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, LayoutAnimation, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fmt } from '@diet/core';
import { coachSnapshot } from '@diet/data';
import { suggestedPrompts, turnSeconds, type AssistantTurn, type CoachCard, type CoachStep, type TurnPart } from '@diet/core/coach';
import { useEnv } from '@/lib/hooks';
import { emitCoachFocus, useCoachChat } from '@/lib/coach';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import { Btn } from '@/components/ui';

const KIND: Record<CoachCard['kind'], string> = {
  log_food: '기록', plan_change: '식단표', day_adjustment: '오늘만', rebalance: '다시 맞추기', skip_meal: '건너뛰기', workout: '운동',
};
const rise = FadeInDown.duration(300).withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] });
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(Math.round(n)))}${unit}`;

export default function CoachScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const chat = useCoachChat(env);
  const [draft, setDraft] = useState('');
  const [kbPad, setKbPad] = useState(0);
  const [height, setHeight] = useState(0);
  const win = useWindowDimensions();
  const scroll = useRef<ScrollViewInstance>(null);
  const stick = useRef(true);

  const snap = coachSnapshot(env);
  const applied = new Set(chat.turns.flatMap((x) => (x.role === 'assistant' ? x.parts : [])).filter((p) => p.kind === 'card' && p.state === 'applied').map((p) => (p.kind === 'card' ? p.card.id : '')));
  const next = snap.meals.find((m) => m.state === 'pending');
  const prompts = suggestedPrompts(next ? { key: next.key, name: next.name } : undefined, Number(snap.now.time.slice(0, 2)));

  // This screen's bottom is the screen's bottom (as a page-sheet modal and as a full screen), so the keyboard
  // covers exactly (screen height - keyboard top). KeyboardAvoidingView and measureInWindow measure inside the
  // sheet's own coordinates and come out short by the sheet's top offset.
  useEffect(() => {
    const animate = (duration: number) => LayoutAnimation.configureNext({ duration: duration || 250, update: { type: LayoutAnimation.Types.keyboard } });
    const change = Keyboard.addListener('keyboardWillChangeFrame', (e) => {
      animate(e.duration);
      setKbPad(Math.max(0, win.height - e.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener('keyboardWillHide', (e) => { animate(e.duration); setKbPad(0); });
    return () => { change.remove(); hide.remove(); };
  }, [win.height]);
  // As a page sheet the screen starts below the status bar; opened from a deep link it is full screen.
  const topInset = height ? Math.max(0, insets.top - (win.height - height)) : 0;

  const submit = (text = draft) => {
    if (chat.busy || !text.trim()) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stick.current = true;
    void chat.send(text);
    setDraft('');
  };

  const view = (target: string) => {
    emitCoachFocus(target);
    router.dismissTo(target.startsWith('plan:') ? '/plan' : '/');
  };

  return (
    <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ flex: 1, backgroundColor: t.bg, paddingBottom: kbPad }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingTop: topInset + 22, paddingBottom: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>
            오늘 {fmt(snap.totals.eatenKcal)} / {fmt(snap.target.kcal)}kcal 먹음 · 단백질 {snap.totals.eatenProtein}g
          </Text>
          <Text style={{ color: t.fg, fontSize: 30, fontWeight: '300', letterSpacing: -0.8, marginTop: 2 }}>코치</Text>
        </View>
        {chat.turns.length > 0 && (
          <Pressable accessibilityRole="button" onPress={chat.reset} style={({ pressed }) => ({ height: 36, paddingHorizontal: 12, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ color: t.fg2, fontSize: 14.5, fontWeight: '600' }}>새 대화</Text>
          </Pressable>
        )}
        <Pressable accessibilityLabel="닫기" onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name="xmark" size={14} tintColor={t.fg} weight="semibold" />
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 22 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80; }}
        scrollEventThrottle={64}
        onContentSizeChange={() => { if (stick.current) scroll.current?.scrollToEnd({ animated: true }); }}
      >
        {chat.turns.length === 0 ? (
          <View style={{ paddingTop: 18 }}>
            <Text style={{ color: t.fg, fontSize: 27, fontWeight: '500', letterSpacing: -0.9, lineHeight: 33 }}>먹은 것도, 식단표도{'\n'}말로 바꿉니다</Text>
            <Text style={{ color: t.muted, fontSize: 14, lineHeight: 21, marginTop: 10 }}>바뀌는 내용은 카드로 보여드리고, 적용을 눌러야 저장됩니다.</Text>
            <View style={{ gap: 6, marginTop: 24 }}>
              {prompts.map((p) => (
                <Pressable key={p} onPress={() => submit(p)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 16, paddingRight: 14, borderRadius: R.md, ...squircle, backgroundColor: pressed ? t.surface2 : t.surface })}>
                  <Text style={{ flex: 1, color: t.fg, fontSize: 15.5 }}>{p}</Text>
                  <SymbolView name="arrow.up.right" size={13} tintColor={t.muted} weight="medium" />
                </Pressable>
              ))}
            </View>
          </View>
        ) : chat.turns.map((turn) => turn.role === 'user' ? (
          <View key={turn.id} style={{ alignItems: 'flex-end' }}>
            <View style={{ maxWidth: '86%', paddingHorizontal: 15, paddingVertical: 10, borderRadius: R.lg, ...squircle, backgroundColor: t.fg }}>
              <Text style={{ color: t.onFg, fontSize: 15.5, lineHeight: 22 }}>{turn.text}</Text>
            </View>
          </View>
        ) : (
          <View key={turn.id} style={{ gap: 12 }}>
            <Reply t={t} turn={turn} applied={applied} onApply={(c) => chat.apply(turn.id, c)} onUndo={(id) => chat.undo(turn.id, id)} onView={view} onRetry={chat.retry} />
          </View>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: kbPad > 0 ? 8 : Math.max(insets.bottom, 12) }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 6, paddingLeft: 14, borderRadius: R.lg, ...squircle, backgroundColor: t.surface }}>
          <TextInput
            // iOS keeps the old color on existing text when the theme flips; remount (the draft lives in state)
            key={t.bg}
            value={draft}
            onChangeText={setDraft}
            placeholder="예: 점심에 김치찌개 먹었어"
            placeholderTextColor={t.muted}
            multiline
            style={{ flex: 1, maxHeight: 120, paddingTop: 9, paddingBottom: 9, color: t.fg, fontSize: 16, lineHeight: 21 }}
            selectionColor={t.fg}
            accessibilityLabel="코치에게 보낼 말"
          />
          {chat.busy ? (
            <Pressable accessibilityLabel="멈추기" onPress={chat.stop} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center' }}>
              <SymbolView name="stop.fill" size={13} tintColor={t.onFg} />
            </Pressable>
          ) : (
            <Pressable accessibilityLabel="보내기" disabled={!draft.trim()} onPress={() => submit()} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, backgroundColor: draft.trim() ? t.fg : t.ctrl, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
              <SymbolView name="arrow.up" size={16} tintColor={draft.trim() ? t.onFg : t.bg} weight="bold" />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function Reply({ t, turn, applied, onApply, onUndo, onView, onRetry }: {
  t: Theme; turn: AssistantTurn; applied: Set<string>; onApply: (c: CoachCard) => string | null; onUndo: (id: string) => void; onView: (target: string) => void; onRetry: () => void;
}) {
  const live = turn.status === 'streaming';
  return (
    <>
      {turn.parts.map((p, i) => <Part key={i} t={t} part={p} live={live} turn={turn} applied={applied} onApply={onApply} onUndo={onUndo} onView={onView} />)}
      {live && turn.parts.length === 0 && <Steps t={t} steps={[{ id: 'wait', label: '연결하는 중', state: 'running', kind: 'context' }]} live />}
      {turn.status === 'stopped' && <Text style={{ color: t.muted, fontSize: 13 }}>멈췄습니다</Text>}
      {turn.error && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, paddingLeft: 16, borderRadius: R.md, ...squircle, backgroundColor: t.surface }}>
          <Text style={{ flex: 1, color: t.fg2, fontSize: 14, lineHeight: 20 }}>{turn.error.message}</Text>
          {turn.error.code === 'auth'
            ? <Btn small kind="ghost" label="로그인" onPress={() => router.replace('/settings')} />
            : turn.error.code !== 'refusal' && turn.error.code !== 'forbidden' && <Btn small kind="ghost" icon="rotate-ccw" label="다시 시도" onPress={onRetry} />}
        </View>
      )}
    </>
  );
}

function Part({ t, part, live, turn, applied, onApply, onUndo, onView }: {
  t: Theme; part: TurnPart; live: boolean; turn: AssistantTurn; applied: Set<string>; onApply: (c: CoachCard) => string | null; onUndo: (id: string) => void; onView: (target: string) => void;
}) {
  switch (part.kind) {
    case 'steps': return <Steps t={t} steps={part.steps} live={live} seconds={live ? undefined : turnSeconds(turn)} />;
    case 'text': return <Prose t={t} text={part.text} />;
    case 'card': return <Card t={t} card={part.card} state={part.state} blocked={(part.card.dependsOn ?? []).some((id) => !applied.has(id))} onApply={onApply} onUndo={onUndo} onView={onView} />;
    case 'sources': return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>출처</Text>
        {part.items.map((x) => (
          <Pressable key={x.url} onPress={() => void WebBrowser.openBrowserAsync(x.url)} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
            <Text numberOfLines={1} style={{ color: t.fg2, fontSize: 13.5, textDecorationLine: 'underline', textDecorationColor: t.ctrl }}>{x.title || x.url}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{hostOf(x.url)}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function StepIcon({ t, step }: { t: Theme; step: CoachStep }) {
  if (step.kind === 'note') return <View style={{ width: 8, height: 1.6, borderRadius: 1, backgroundColor: t.ctrl, marginTop: 9, marginLeft: 3 }} />;
  if (step.state === 'done') return <SymbolView name="checkmark" size={12} tintColor={t.fg} weight="bold" style={{ marginTop: 3 }} />;
  if (step.state === 'error') return <SymbolView name="xmark" size={11} tintColor={t.muted} weight="bold" style={{ marginTop: 4 }} />;
  return <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1.6, borderColor: t.ctrl, marginTop: 3, marginLeft: 1 }} />;
}

function Steps({ t, steps, live, seconds }: { t: Theme; steps: CoachStep[]; live: boolean; seconds?: number }) {
  const [open, setOpen] = useState(false);
  if (!live && !open && steps.length > 1) {
    const work = steps.filter((x) => x.kind !== 'note').length;
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', opacity: pressed ? 0.5 : 1 })}>
        <SymbolView name="checkmark" size={12} tintColor={t.muted} weight="bold" />
        <Text style={{ color: t.muted, fontSize: 13 }}>{work}단계 확인{seconds ? ` · ${seconds}초` : ''}</Text>
        <SymbolView name="chevron.down" size={11} tintColor={t.muted} weight="semibold" />
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 7 }}>
      {steps.map((x) => (
        <Animated.View key={x.id} entering={rise} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
          <View style={{ width: 16 }}><StepIcon t={t} step={x} /></View>
          <Text style={{ flex: 1, color: x.state === 'done' && x.kind !== 'note' ? t.muted : t.fg2, fontSize: 13.5, lineHeight: 19.5 }}>{x.label}</Text>
        </Animated.View>
      ))}
    </View>
  );
}

function Prose({ t, text }: { t: Theme; text: string }) {
  const blocks = text.replace(/\*\*(.+?)\*\*/g, '$1').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  blocks.forEach((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-·•]\s+/.test(l))) {
      out.push(
        <View key={i} style={{ gap: 4 }}>
          {lines.map((l, j) => (
            <View key={j} style={{ flexDirection: 'row', gap: 9 }}>
              <View style={{ width: 7, height: 1.6, borderRadius: 1, backgroundColor: t.muted, marginTop: 12 }} />
              <Text style={{ flex: 1, color: t.fg, fontSize: 16, lineHeight: 25 }}>{l.replace(/^\s*[-·•]\s+/, '')}</Text>
            </View>
          ))}
        </View>,
      );
    } else out.push(<Text key={i} style={{ color: t.fg, fontSize: 16, lineHeight: 25 }}>{b}</Text>);
  });
  return <View style={{ gap: 10 }}>{out}</View>;
}

function Card({ t, card, state, blocked, onApply, onUndo, onView }: {
  t: Theme; card: CoachCard; state: 'idle' | 'applied' | 'undone'; blocked: boolean; onApply: (c: CoachCard) => string | null; onUndo: (id: string) => void; onView: (target: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const applied = state === 'applied';
  const showTotals = card.kind === 'rebalance' || card.kind === 'skip_meal' || card.kind === 'day_adjustment';
  const changed = card.delta.kcal !== 0 || card.delta.protein !== 0;
  return (
    <View style={{ padding: 16, paddingBottom: 14, borderRadius: R.lg, ...squircle, backgroundColor: t.surface }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{KIND[card.kind]}{applied ? ' · 적용함' : ''}</Text>
        {changed && (
          <Text style={{ color: t.muted, fontSize: 12.5 }}>
            <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{signed(card.delta.kcal, 'kcal')}</Text>
            {card.delta.protein !== 0 ? `  단백질 ${signed(card.delta.protein, 'g')}` : ''}
          </Text>
        )}
      </View>
      <Text style={{ color: applied ? t.fg2 : t.fg, fontSize: 17, fontWeight: '600', letterSpacing: -0.3, marginTop: 6, lineHeight: 23 }}>{card.title}</Text>
      <View style={{ gap: 9, marginTop: 12 }}>
        {card.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={{ width: 62, color: t.muted, fontSize: 12.5, paddingTop: 1 }}>{l.label}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              {l.before && <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20, textDecorationLine: 'line-through' }}>{l.before}</Text>}
              <Text style={{ color: t.fg, fontSize: 14, lineHeight: 20 }}>{l.after}</Text>
            </View>
          </View>
        ))}
        {showTotals && (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={{ width: 62, color: t.muted, fontSize: 12.5, paddingTop: 1 }}>오늘 예상</Text>
            <Text style={{ flex: 1, color: t.fg, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] }}>{fmt(card.totals.before.kcal)} → {fmt(card.totals.after.kcal)}kcal · 목표 {fmt(card.totals.target)}</Text>
          </View>
        )}
      </View>
      {card.note && <Text style={{ color: t.fg2, fontSize: 13, lineHeight: 19, marginTop: 12 }}>{card.note}</Text>}
      {err && <Text style={{ color: t.fg, fontSize: 13, marginTop: 10 }}>{err}</Text>}
      {blocked && !applied && <Text style={{ color: t.fg2, fontSize: 13, lineHeight: 19, marginTop: 10 }}>위 카드를 먼저 적용해야 이 숫자가 맞습니다</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
        {applied ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 36 }}>
              <SymbolView name="checkmark" size={13} tintColor={t.fg} weight="bold" />
              <Text style={{ color: t.fg, fontSize: 14, fontWeight: '600' }}>적용했습니다</Text>
            </View>
            <Btn small kind="ghost" icon="rotate-ccw" label="되돌리기" onPress={() => onUndo(card.id)} />
          </>
        ) : (
          <Btn small label="적용" style={{ paddingHorizontal: 22, opacity: blocked ? 0.35 : 1 }} onPress={() => {
            if (blocked) return;
            const e = onApply(card);
            setErr(e);
            if (!e) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }} />
        )}
        <Pressable onPress={() => onView(card.target)} style={({ pressed }) => ({ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: 6, opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '600' }}>보기</Text>
          <SymbolView name="arrow.up.right" size={12} tintColor={t.fg2} weight="semibold" />
        </Pressable>
      </View>
    </View>
  );
}
