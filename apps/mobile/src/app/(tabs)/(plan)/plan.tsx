import { useState } from 'react';
import { LayoutAnimation, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  cycleSchedule, diffText, EXTRA, fmt, hhmm, MEALS, md, mdw, parseKey, programDate, SCEN, SCEN_ORDER,
  type MealKey, type ShopItem,
} from '@diet/core';
import { checklistSet, planMeta, setDay, setMealOverride, todayView, toggleChecklist } from '@diet/data';
import { useEnv, useRefresh } from '@/lib/hooks';
import { devicePref } from '@/lib/env';
import { squircle, useTheme, type Theme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn, useToast } from '@/components/ui';
import { Section } from '@/components/list';

type Tab = 'meals' | 'situations' | 'shop';
const TABS: [Tab, string][] = [['meals', '식단'], ['situations', '상황별'], ['shop', '장보기']];

function Segmented<T extends string>({ items, value, onChange, t }: { items: [T, string][]; value: T; onChange: (v: T) => void; t: Theme }) {
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

function Check({ on, onPress, t, label }: { on: boolean; onPress: () => void; t: Theme; label: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityState={{ checked: on }} hitSlop={8} onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: on ? t.fg : t.ctrl, backgroundColor: on ? t.fg : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on && <Icon name="check" size={12} color={t.onFg} weight="bold" />}
    </Pressable>
  );
}

/** Every meal of the day at a glance: time, items and amounts, kcal and protein. Tap to edit. */
function Meals({ t }: { t: Theme }) {
  const env = useEnv();
  const { toast } = useToast();
  const v = todayView(env);
  const meta = planMeta(env, v.ctx.key);
  const who = meta?.source === 'ai' ? '코치가 바꿈' : '내가 바꿈';
  const total = v.meals.reduce((s, m) => s + m.kcal, 0);
  const protein = v.meals.reduce((s, m) => s + m.protein, 0);
  const removed = (Object.entries(v.override?.meals ?? {}) as [MealKey, { removed?: boolean }][]).filter(([, o]) => o?.removed);
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 20 }}>
        <Text style={{ color: t.fg, fontSize: 34, fontWeight: '300', letterSpacing: -1, fontVariant: ['tabular-nums'] }}>{fmt(total)}</Text>
        <Text style={{ color: t.muted, fontSize: 15, marginBottom: 5 }}>/ {fmt(v.target)} kcal</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 13.5 }}>
        단백질 {protein}g / 최소 {env.program.proteinFloor}g{total > v.target ? ` · 목표보다 ${fmt(total - v.target)}kcal 많습니다` : ''}
      </Text>
      {meta && <Text style={{ color: t.fg2, fontSize: 13, marginTop: 6 }}>{md(parseKey(meta.from))} {who}{meta.note ? ` · ${meta.note}` : ''}</Text>}
      <Btn small kind="ghost" icon="arrow-up-right" label="식단표 공유" style={{ alignSelf: 'flex-start', marginTop: 12 }} onPress={() => router.push('/sheet/share-meals')} />

      <Section style={{ marginTop: 16 }}>
        {v.meals.map((m) => (
          <Pressable
            key={m.key}
            accessibilityRole="button"
            accessibilityLabel={`${m.name} ${fmt(m.kcal)}kcal. 바꾸기`}
            onPress={() => { void Haptics.selectionAsync(); router.push({ pathname: '/sheet/meal', params: { key: m.key } }); }}
            style={({ pressed }) => [{ paddingVertical: 14, paddingHorizontal: 16, gap: 6 }, pressed && { backgroundColor: t.surface2 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ width: 44, color: t.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>{m.at != null ? hhmm(m.at) : ''}</Text>
              <Text style={{ flex: 1, color: t.fg, fontSize: 16, fontWeight: '600' }}>{m.name}</Text>
              <Text style={{ color: t.fg, fontSize: 15.5, fontVariant: ['tabular-nums'] }}>{m.est ? '약 ' : ''}{fmt(m.kcal)}<Text style={{ color: t.muted, fontSize: 12 }}> kcal</Text></Text>
            </View>
            <View style={{ paddingLeft: 54, gap: 3 }}>
              {m.items.map((x, i) => (
                <View key={`${x.name}-${i}`} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text style={{ flex: 1, color: t.fg2, fontSize: 14 }}>{x.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 14 }}>{x.amount}</Text>
                </View>
              ))}
              <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 2 }}>
                단백질 {m.protein}g{m.edited ? ` · ${who}` : ''}{m.changes?.length ? ` · 오늘만: ${m.changes.join(', ')}` : ''}
              </Text>
            </View>
          </Pressable>
        ))}
      </Section>

      {removed.length > 0 && (
        <Section title="뺀 끼니">
          {removed.map(([k]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16 }}>
              <Text style={{ flex: 1, color: t.muted, fontSize: 15.5 }}>{MEALS[k].name}</Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { const undo = setMealOverride(env, k, null, 'user', `${MEALS[k].name}을 다시 넣었습니다`); toast(`${MEALS[k].name}을 다시 넣었습니다`, undo); }}>
                <Text style={{ color: t.fg, fontSize: 14.5, fontWeight: '600' }}>다시 넣기</Text>
              </Pressable>
            </View>
          ))}
        </Section>
      )}
      <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: 12 }}>끼니를 누르면 항목, 양, 시간을 바꿉니다. 코치에게 말로 부탁해도 같은 곳이 바뀝니다.</Text>
    </>
  );
}

function Situations({ t }: { t: Theme }) {
  const env = useEnv();
  const { toast } = useToast();
  const v = todayView(env);
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...SCEN_ORDER.map((id) => ({ id, s: SCEN[id] })), ...EXTRA.map((s) => ({ id: null, s }))];
  return (
    <Section style={{ marginTop: 16 }} inset={52}>
      {rows.map(({ id, s }) => {
        const cur = id != null && v.scen === id;
        const expanded = open === s.name;
        return (
          <View key={s.name}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity')); void Haptics.selectionAsync(); setOpen(expanded ? null : s.name); }}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16 }, pressed && { backgroundColor: t.surface2 }]}
            >
              <View style={{ width: 24, alignItems: 'center' }}><Icon name={s.icon} size={18} color={t.fg} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.fg, fontSize: 15.5, fontWeight: '600' }}>{s.name}</Text>
                <Text numberOfLines={expanded ? undefined : 1} style={{ color: t.muted, fontSize: 13 }}>{s.short}</Text>
              </View>
              {cur && <Text style={{ color: t.fg, fontSize: 12.5, fontWeight: '700' }}>오늘</Text>}
              <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}><Icon name="chevron-right" size={12} color={t.muted} weight="semibold" /></View>
            </Pressable>
            {expanded && (
              <View style={{ paddingLeft: 52, paddingRight: 16, paddingBottom: 16, gap: 8 }}>
                {s.rules.map((r) => <Text key={r} style={{ color: t.fg2, fontSize: 14, lineHeight: 20 }}>{r}</Text>)}
                {id && !cur && (
                  <Btn small label="오늘 이걸로" style={{ alignSelf: 'flex-start', marginTop: 4 }} onPress={() => { setDay(env, v.ctx.key, { scenario: id }); toast(`오늘은 ${s.name}로 봅니다`); router.navigate('/'); }} />
                )}
              </View>
            )}
          </View>
        );
      })}
    </Section>
  );
}

function Shop({ t }: { t: Theme }) {
  const env = useEnv();
  const v = todayView(env);
  const shop = checklistSet(env, 'shop');
  const cycle = checklistSet(env, 'cycle');
  const coupang = (url: string) => (
    <Pressable accessibilityRole="link" accessibilityLabel="쿠팡에서 보기" hitSlop={8} onPress={() => void Linking.openURL(url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Text style={{ color: t.fg2, fontSize: 13.5, fontWeight: '600' }}>쿠팡</Text>
      <Icon name="arrow-up-right" size={11} color={t.fg2} weight="semibold" />
    </Pressable>
  );
  const row = (x: ShopItem) => {
    const on = shop.has(x.id);
    return (
      <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
        <Check t={t} on={on} label={`${x.name} 담음`} onPress={() => toggleChecklist(env, 'shop', x.id)} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: on ? t.muted : t.fg, fontSize: 15, fontWeight: '500', textDecorationLine: on ? 'line-through' : 'none' }}>{x.name}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>{x.qty} · {fmt(x.price)}원</Text>
        </View>
        {!on && coupang(x.url)}
      </View>
    );
  };
  return (
    <>
      <Section title="지금 한 번" inset={52}>{v.shop.now.map(row)}</Section>
      {v.shop.week.length > 0 && <Section title="매주" inset={52}>{v.shop.week.map(row)}</Section>}
      {v.shop.cycle.length > 0 && (
        <Section title="날짜별 주문" inset={52}>
          {cycleSchedule(v.ctx.idx, cycle, v.shop.cycle).map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
              <Check t={t} on={r.done} label={`${r.name} 주문함`} onPress={() => toggleChecklist(env, 'cycle', r.id)} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: r.done ? t.muted : t.fg, fontSize: 15, fontWeight: '500' }}>{r.name}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{mdw(programDate(env.program, r.dayNo - 1))} · {r.sub}</Text>
              </View>
              {!r.done && (r.diff <= 1 ? coupang(r.url) : <Text style={{ color: t.muted, fontSize: 13 }}>{diffText(r.diff)}</Text>)}
            </View>
          ))}
        </Section>
      )}
    </>
  );
}

export default function PlanScreen() {
  useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const refresh = useRefresh();
  const [tab, setTabState] = useState<Tab>(() => {
    const saved = devicePref.get<string>('planTab', 'meals');
    return (TABS.some(([k]) => k === saved) ? saved : 'meals') as Tab;
  });
  const setTab = (x: Tab) => { setTabState(x); devicePref.set('planTab', x); };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.onRefresh} tintColor={t.muted} />}
      contentContainerStyle={{ paddingTop: 4, paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
    >
      <Segmented t={t} items={TABS} value={tab} onChange={setTab} />
      {tab === 'meals' && <Meals t={t} />}
      {tab === 'situations' && <Situations t={t} />}
      {tab === 'shop' && <Shop t={t} />}
    </ScrollView>
  );
}
