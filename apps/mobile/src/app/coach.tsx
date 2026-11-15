// AI coach chat (a tab, or a modal). Same events and change cards as the web panel; text and up to three photos.
import { useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Image, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import Animated, { FadeInDown, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
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
import { pickPhotos, type CoachPhoto } from '@/lib/photo';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import { Btn } from '@/components/ui';

const KIND: Record<CoachCard['kind'], string> = {
  log_food: '기록', plan_change: '식단표', day_adjustment: '오늘만', rebalance: '다시 맞추기', skip_meal: '건너뛰기', workout: '운동', shop: '장보기',
};
const rise = FadeInDown.duration(300).withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] });
const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(Math.round(n)))}${unit}`;

/** The chat. `embedded` in the 코치 tab (no close button); a modal from elsewhere. */
export function CoachView({ embedded = false }: { embedded?: boolean }) {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const chat = useCoachChat(env);
  const [draft, setDraft] = useState('');
  const [photos, setPhotos] = useState<CoachPhoto[]>([]);
  // the input grows with its text (up to 120) and drops back to one line when sent; iOS won't shrink it by itself
  const [inputH, setInputH] = useState(40);
  const [preparing, setPreparing] = useState(false);
  const [height, setHeight] = useState(0);
  const win = useWindowDimensions();
  const scroll = useRef<ScrollViewInstance>(null);
  const stick = useRef(true);

  const snap = coachSnapshot(env);
  const applied = new Set(chat.turns.flatMap((x) => (x.role === 'assistant' ? x.parts : [])).filter((p) => p.kind === 'card' && p.state === 'applied').map((p) => (p.kind === 'card' ? p.card.id : '')));
  const next = snap.meals.find((m) => m.state === 'pending');
  const prompts = suggestedPrompts(next ? { key: next.key, name: next.name } : undefined, Number(snap.now.time.slice(0, 2)));

  // The input rides on the keyboard frame by frame (the system's own spring, interactive dismiss included),
  // instead of jumping between two padding values. This screen's bottom is the screen's bottom (tab or sheet),
  // so the keyboard covers exactly its height; at rest the input keeps clear of the tab bar / home indicator.
  const kb = useAnimatedKeyboard();
  const restPad = Math.max(insets.bottom, 12) + (embedded ? 14 : 0);
  const inputPad = useAnimatedStyle(() => ({ paddingBottom: Math.max(restPad, kb.height.value + 8) }));
  // As a page sheet the screen starts below the status bar; opened from a deep link it is full screen.
  const topInset = height ? Math.max(0, insets.top - (win.height - height)) : 0;

  const submit = (text = draft) => {
    if (chat.busy || (!text.trim() && !photos.length)) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stick.current = true;
    void chat.send(text, photos);
    setDraft('');
    setPhotos([]);
    setInputH(40);
  };
  // photos: food, a menu, a nutrition label; up to three per message, analysed together with the text
  const attach = () => {
    const left = 3 - photos.length;
    if (left <= 0 || preparing) return;
    ActionSheetIOS.showActionSheetWithOptions({ options: ['사진 찍기', '앨범에서 고르기', '취소'], cancelButtonIndex: 2, title: '음식, 메뉴판, 성분표 사진' }, (i) => {
      if (i === 2) return;
      setPreparing(true);
      void pickPhotos(i === 0 ? 'camera' : 'library', left)
        .then((r) => {
          if (r.denied) ActionSheetIOS.showActionSheetWithOptions({ title: '카메라 권한이 꺼져 있습니다', message: '설정 앱 > 다루 > 카메라에서 켜 주세요', options: ['확인'], cancelButtonIndex: 0 }, () => {});
          if (r.photos.length) setPhotos((p) => [...p, ...r.photos].slice(0, 3));
        })
        .finally(() => setPreparing(false));
    });
  };
  const canSend = !!draft.trim() || photos.length > 0;

  // 보기: open the screen that owns the target; that screen switches section / scrolls to it
  const view = (target: string) => {
    emitCoachFocus(target as Parameters<typeof emitCoachFocus>[0]);
    const route = target.startsWith('plan:workout') ? '/workout-tab' : target.startsWith('plan:') ? '/plan' : '/';
    if (embedded) router.navigate(route);
    else router.dismissTo(route);
  };

  return (
    <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ flex: 1, backgroundColor: t.bg }}>
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
        {!embedded && <Pressable accessibilityLabel="닫기" onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}>
          <SymbolView name="xmark" size={14} tintColor={t.fg} weight="semibold" />
        </Pressable>}
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
          <View key={turn.id} style={{ alignItems: 'flex-end', gap: 6 }}>
            {turn.images.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {turn.images.map((uri) => <Image key={uri} source={{ uri }} style={{ width: 96, height: 96, borderRadius: 16 }} />)}
              </View>
            )}
            {!!turn.text && (
              <View style={{ maxWidth: '86%', paddingHorizontal: 15, paddingVertical: 10, borderRadius: R.lg, ...squircle, backgroundColor: t.fg }}>
                <Text style={{ color: t.onFg, fontSize: 15.5, lineHeight: 22 }}>{turn.text}</Text>
              </View>
            )}
          </View>
        ) : (
          <View key={turn.id} style={{ gap: 12 }}>
            <Reply t={t} turn={turn} applied={applied} onApply={(c) => chat.apply(turn.id, c)} onUndo={(id) => chat.undo(turn.id, id)} onView={view} onRetry={chat.retry} />
          </View>
        ))}
      </ScrollView>

      {/* in the tab, keep clear of the floating tab bar */}
      <Animated.View style={[{ paddingHorizontal: 14, paddingTop: 8 }, inputPad]}>
        {(photos.length > 0 || preparing) && (
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4, paddingBottom: 8 }}>
            {photos.map((p, i) => (
              <View key={p.uri}>
                <Image source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: 14 }} />
                <Pressable accessibilityLabel="사진 빼기" hitSlop={8} onPress={() => setPhotos((a) => a.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center' }}>
                  <SymbolView name="xmark" size={9} tintColor={t.onFg} weight="bold" />
                </Pressable>
              </View>
            ))}
            {preparing && <View style={{ width: 64, height: 64, borderRadius: 14, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.muted, fontSize: 11 }}>준비 중</Text></View>}
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 6, paddingLeft: 6, borderRadius: R.lg, ...squircle, backgroundColor: t.surface }}>
          <Pressable accessibilityLabel="사진 올리기" disabled={photos.length >= 3 || chat.busy} onPress={attach} hitSlop={4} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', opacity: photos.length >= 3 ? 0.35 : pressed ? 0.6 : 1 })}>
            <SymbolView name="photo.badge.plus" size={20} tintColor={t.fg} />
          </Pressable>
          <TextInput
            // iOS keeps the old color on existing text when the theme flips; remount (the draft lives in state)
            key={t.bg}
            value={draft}
            onChangeText={(x) => { setDraft(x); if (!x) setInputH(40); }}
            onContentSizeChange={(e) => setInputH(Math.min(120, Math.max(40, Math.ceil(e.nativeEvent.contentSize.height))))}
            placeholder={photos.length ? '사진에 대해 한마디 (선택)' : '예: 점심에 김치찌개 먹었어'}
            placeholderTextColor={t.muted}
            multiline
            scrollEnabled={inputH >= 120}
            style={{ flex: 1, height: inputH, paddingTop: 9, paddingBottom: 9, color: t.fg, fontSize: 16, lineHeight: 21 }}
            selectionColor={t.fg}
            accessibilityLabel="코치에게 보낼 말"
          />
          {chat.busy ? (
            <Pressable accessibilityLabel="멈추기" onPress={chat.stop} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center' }}>
              <SymbolView name="stop.fill" size={13} tintColor={t.onFg} />
            </Pressable>
          ) : (
            <Pressable accessibilityLabel="보내기" disabled={!canSend} onPress={() => submit()} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, backgroundColor: canSend ? t.fg : t.ctrl, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
              <SymbolView name="arrow.up" size={16} tintColor={canSend ? t.onFg : t.bg} weight="bold" />
            </Pressable>
          )}
        </View>
      </Animated.View>
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

export default function CoachScreen() {
  return <CoachView />;
}
