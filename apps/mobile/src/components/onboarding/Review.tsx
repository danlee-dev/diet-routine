// The generated plan before it is saved: the day's target and why, every meal with items and kcal, the workout
// week, the shopping list (each line opens a Coupang search) with the weekly cost, and the rules.
// Open layout: section titles and spacing, no cards inside cards.
import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addDays, fmt, hhmm, MEALS, schedule, type GeneratedPlan, type MealKey, type OnboardingAnswers, type ShopItem,
} from '@diet/core';
import { R, squircle, useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Cta, Sym } from './controls';
import { kg1 } from './answers';
import { WeekStrip } from './steps';

const ORDER: MealKey[] = ['breakfast', 'lunch', 'snack', 'post', 'dinner'];
const won = (n: number) => `${fmt(Math.round(n / 100) * 100)}원`;

function Section({ title, right, children, first }: { title: string; right?: string; children: ReactNode; first?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: first ? 0 : 40 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <Text accessibilityRole="header" style={{ color: t.fg, fontSize: 21, fontWeight: '600', letterSpacing: -0.4 }}>{title}</Text>
        {right ? <Text style={{ color: t.muted, fontSize: 14, fontVariant: ['tabular-nums'] }}>{right}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ShopRow({ item }: { item: ShopItem }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${item.name}, ${item.qty}, ${won(item.price)}. 쿠팡에서 찾기`}
      onPress={() => { void Haptics.selectionAsync(); void Linking.openURL(item.url); }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, marginHorizontal: -12, borderRadius: R.sm, backgroundColor: pressed ? t.surface : 'transparent' }, squircle]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '500' }}>{item.name}</Text>
        <Text style={{ color: t.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>{item.qty} · {won(item.price)}</Text>
      </View>
      <Text style={{ color: t.fg2, fontSize: 13.5, fontWeight: '600' }}>쿠팡</Text>
      <Sym name="arrow.up.right" size={11} color={t.fg2} weight="bold" />
    </Pressable>
  );
}

export function Review({ answers, plan, source, mode, onSave, saving }: {
  answers: OnboardingAnswers;
  plan: GeneratedPlan;
  source: 'user' | 'ai';
  mode: 'new' | 'edit';
  onSave: () => void;
  saving: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tg = plan.targets;
  const end = addDays(new Date(), tg.days - 1);
  const s = schedule(answers.wakeMin);
  const timeOf = (k: MealKey): string =>
    !s ? '' : k === 'breakfast' ? hhmm(s.b) : k === 'lunch' ? hhmm(s.l) : k === 'snack' ? (s.merge ? '점심과' : hhmm(s.s)) : k === 'dinner' ? hhmm(s.d) : '';
  const meals = plan.plan.meals ?? {};
  const workout = plan.plan.workout;
  const strength = Object.values(workout?.week ?? {}).filter((w) => w === 'A' || w === 'B').length;
  const shop = plan.plan.shop;
  const name = answers.name?.trim();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 22, paddingBottom: 32 }}>
        <Text style={{ color: t.muted, fontSize: 14, fontWeight: '600' }}>{name ? `${name}님의 ${answers.weeks}주 계획` : `내 ${answers.weeks}주 계획`}</Text>
        <Text accessibilityLabel={`하루 ${fmt(tg.kcal)}킬로칼로리`} style={{ color: t.fg, fontSize: 64, fontWeight: '200', letterSpacing: -2.5, fontVariant: ['tabular-nums'], marginTop: 2 }}>
          {fmt(tg.kcal)}<Text style={{ fontSize: 22, fontWeight: '500', letterSpacing: 0 }}> kcal</Text>
        </Text>
        <Text style={{ color: t.fg2, fontSize: 15.5, fontWeight: '500', marginTop: -2 }}>하루 목표 · 단백질 {tg.proteinFloor}g 이상</Text>
        <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 14.5, lineHeight: 22, marginTop: 14 }}>
          하루 소모 {fmt(tg.tdee)}kcal에서 {fmt(tg.deficit)}kcal를 줄입니다. {tg.paceCapped ? `일주일에 ${tg.weeklyLossKg}kg 정도 빠집니다.` : `일주일에 ${tg.weeklyLossKg}kg 정도 빠지고, ${end.getMonth() + 1}월 ${end.getDate()}일에는 ${kg1(tg.endWeightKg)}kg 안팎이 됩니다.`}
        </Text>
        {plan.notes.map((n) => <Text lineBreakStrategyIOS="hangul-word" key={n} style={{ color: t.fg2, fontSize: 14, lineHeight: 21, marginTop: 8 }}>{n}</Text>)}
        {source === 'ai' && <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.fg2, fontSize: 14, lineHeight: 21, marginTop: 8 }}>코치가 답을 보고 식단을 다듬었습니다.</Text>}

        <Section title="끼니" right={`합계 ${fmt(plan.day.kcal)}kcal · 단백질 ${plan.day.protein}g`}>
          <View style={{ gap: 18 }}>
            {ORDER.map((k) => {
              const m = meals[k];
              if (!m) return null;
              const label = m.name ?? MEALS[k].name;
              return (
                <View key={k} style={{ flexDirection: 'row', gap: 14 }} accessible accessibilityLabel={`${timeOf(k)} ${label}, ${m.removed ? '뺌' : `${m.kcal ?? 0}킬로칼로리`}`}>
                  <Text style={{ width: 52, color: t.muted, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'], paddingTop: 1 }}>{timeOf(k)}</Text>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Text style={{ color: m.removed ? t.muted : t.fg, fontSize: 16.5, fontWeight: '600' }}>{label}</Text>
                      {!m.removed && <Text style={{ color: t.fg, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{fmt(m.kcal ?? 0)}</Text>}
                    </View>
                    <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 13.5, lineHeight: 20 }}>
                      {m.removed ? (m.note ?? '뺐습니다') : (m.items ?? []).map((it) => `${it.name} ${it.amount}`).join(' · ')}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </Section>

        {workout?.week && (
          <Section title="운동" right={strength ? `근력 주 ${strength}회` : '걷기 위주'}>
            <WeekStrip week={workout.week} />
            {strength > 0 && (
              <View style={{ marginTop: 18, gap: 14 }}>
                {(['A', 'B'] as const).map((k) => {
                  const r = workout.routines?.[k];
                  if (!r) return null;
                  return (
                    <View key={k} style={{ flexDirection: 'row', gap: 14 }}>
                      <View style={[{ width: 28, height: 28, borderRadius: 9, backgroundColor: t.fg, alignItems: 'center', justifyContent: 'center' }, squircle]}>
                        <Text style={{ color: t.onFg, fontSize: 13, fontWeight: '700' }}>{k}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '600' }}>{r.name ?? `루틴 ${k}`}{r.focus ? <Text style={{ color: t.muted, fontWeight: '500' }}>  {r.focus}</Text> : null}</Text>
                        <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 13.5, lineHeight: 20 }}>{r.items.map((x) => `${x.name} ${x.n}${x.unit}`).join(' · ')}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </Section>
        )}

        {shop && (shop.now.length > 0 || shop.week.length > 0) && (
          <Section title="장보기" right={`주 약 ${fmt(Math.round(plan.weeklyCost / 1000) * 1000)}원`}>
            {shop.now.length > 0 && <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginBottom: 2 }}>처음 한 번 · 2주 넘게 갑니다</Text>}
            {shop.now.map((it) => <ShopRow key={it.id} item={it} />)}
            {shop.week.length > 0 && <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 2 }}>매주 · 신선식품</Text>}
            {shop.week.map((it) => <ShopRow key={it.id} item={it} />)}
            <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 }}>누르면 쿠팡 검색 결과가 열립니다. 가격은 대략이고, 계획 탭에서 다시 볼 수 있습니다.</Text>
          </Section>
        )}

        {(plan.plan.rules?.length ?? 0) > 0 && (
          <Section title="지킬 것">
            <View style={{ gap: 14 }}>
              {plan.plan.rules!.map((r) => (
                <View key={r.title} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
                  <View style={{ width: 28, alignItems: 'center', paddingTop: 1 }}><Icon name={r.icon} size={17} color={t.fg} /></View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '600' }}>{r.title}</Text>
                    <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>{r.desc}</Text>
                  </View>
                </View>
              ))}
            </View>
          </Section>
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: insets.bottom + 12 }}>
        <Cta label={mode === 'new' ? '이대로 시작하기' : '이대로 바꾸기'} icon={null} busy={saving} onPress={onSave} wide />
      </View>
    </View>
  );
}
