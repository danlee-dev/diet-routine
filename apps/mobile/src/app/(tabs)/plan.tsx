import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  cycleSchedule, diffText, EXTRA, fmt, KEEP, mdw, programDate, repMultiplier, ROUTINES, SCEN, SCEN_ORDER, SHOP_NOW, SHOP_WEEK, WEEK, DOW,
  type RoutineKey, type ShopItem,
} from '@diet/core';
import { checklistSet, setDay, todayView, toggleChecklist } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/env';
import { R, squircle, useTheme, type Theme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { Btn } from '@/components/ui';

type Tab = 'situations' | 'workout' | 'shop' | 'basics';
const TABS: [Tab, string][] = [['situations', '상황별'], ['workout', '홈트'], ['shop', '장보기'], ['basics', '기본']];

function Box({ t, children }: { t: Theme; children: React.ReactNode }) {
  return <View style={[{ padding: 16, borderRadius: R.lg, backgroundColor: t.surface, marginTop: 12 }, squircle]}>{children}</View>;
}

function Check({ on, onPress, t, label }: { on: boolean; onPress: () => void; t: Theme; label: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      style={[{ width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: on ? t.fg : t.ctrl, backgroundColor: on ? t.fg : 'transparent', alignItems: 'center', justifyContent: 'center' }, squircle]}>
      {on && <Icon name="check" size={13} color={t.onFg} weight="bold" />}
    </Pressable>
  );
}

export default function PlanScreen() {
  const env = useEnv();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const v = todayView(env);
  const [tab, setTabState] = useState<Tab>(() => devicePref.get<Tab>('planTab', 'situations'));
  const setTab = (x: Tab) => { setTabState(x); devicePref.set('planTab', x); };
  const [rt, setRt] = useState<RoutineKey>(WEEK[v.ctx.dow]!.t === 'B' ? 'B' : 'A');
  const shop = checklistSet(env, 'shop');
  const cycle = checklistSet(env, 'cycle');
  const mult = repMultiplier(v.ctx.week);

  const shopRow = (x: ShopItem, i: number) => (
    <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
      <Check t={t} on={shop.has(x.id)} label={`${x.name} 담음`} onPress={() => toggleChecklist(env, 'shop', x.id)} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: shop.has(x.id) ? t.muted : t.fg, fontSize: 14.5, fontWeight: '600', textDecorationLine: shop.has(x.id) ? 'line-through' : 'none' }}>{x.name}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{x.qty} · {fmt(x.price)}원</Text>
      </View>
      <Btn small kind="ghost" label="쿠팡" icon="arrow-up-right" onPress={() => void Linking.openURL(x.url)} />
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}>
      <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '500' }}>계획</Text>
      <Text style={{ color: t.fg, fontSize: 40, fontWeight: '300', letterSpacing: -1 }}>식단과 운동</Text>
      <View style={[{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.surface, marginTop: 14 }, squircle]}>
        {TABS.map(([k, l]) => (
          <Pressable key={k} onPress={() => { void Haptics.selectionAsync(); setTab(k); }} style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === k ? t.bg : 'transparent' }}>
            <Text style={{ color: tab === k ? t.fg : t.muted, fontWeight: '600', fontSize: 14 }}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'situations' && [...SCEN_ORDER.map((id) => ({ id, s: SCEN[id] })), ...EXTRA.map((s) => ({ id: null, s }))].map(({ id, s }) => {
        const cur = id != null && v.scen === id;
        return (
          <View key={s.name} style={[{ padding: 16, borderRadius: R.lg, backgroundColor: cur ? t.fg : t.surface, marginTop: 12, gap: 10 }, squircle]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name={s.icon} size={20} color={cur ? t.onFg : t.fg} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: cur ? t.onFg : t.fg, fontSize: 16, fontWeight: '700' }}>{s.name}</Text>
                <Text style={{ color: cur ? t.onFg : t.muted, opacity: cur ? 0.75 : 1, fontSize: 13 }}>{s.short}</Text>
              </View>
            </View>
            {s.rules.map((r) => <Text key={r} style={{ color: cur ? t.onFg : t.fg2, opacity: cur ? 0.85 : 1, fontSize: 14, lineHeight: 20 }}>· {r}</Text>)}
            {id && !cur && <Btn small kind="ghost" label="오늘 이걸로 보기" style={{ alignSelf: 'flex-start' }} onPress={() => { setDay(env, v.ctx.key, { scenario: id }); router.navigate('/'); }} />}
          </View>
        );
      })}

      {tab === 'workout' && (
        <>
          <Box t={t}>
            <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 10 }}>이번 주</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <View key={d} style={[{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: R.sm, backgroundColor: d === v.ctx.dow ? t.fg : t.bg }, squircle]}>
                  <Text style={{ color: d === v.ctx.dow ? t.onFg : t.muted, fontSize: 12 }}>{DOW[d]}</Text>
                  <Text style={{ color: d === v.ctx.dow ? t.onFg : t.fg, fontSize: 13, fontWeight: '700' }}>{WEEK[d]!.label}</Text>
                </View>
              ))}
            </View>
          </Box>
          <Box t={t}>
            <View style={[{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.bg, marginBottom: 8 }, squircle]}>
              {(['A', 'B'] as const).map((k) => (
                <Pressable key={k} onPress={() => setRt(k)} style={{ flex: 1, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: rt === k ? t.surface2 : 'transparent' }}>
                  <Text style={{ color: rt === k ? t.fg : t.muted, fontWeight: '600' }}>{ROUTINES[k].name} · {k === 'A' ? '상체' : '하체'}</Text>
                </Pressable>
              ))}
            </View>
            {ROUTINES[rt].items.map((x, i) => (
              <View key={x.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
                <Text style={{ color: t.fg, fontSize: 15 }}>{x.name}</Text><Text style={{ color: t.muted, fontSize: 15, fontVariant: ['tabular-nums'] }}>{Math.round(x.n * mult)}{x.unit}</Text>
              </View>
            ))}
            <Btn icon="play" label={`${ROUTINES[rt].name} 따라하기`} style={{ marginTop: 12 }} onPress={() => router.push({ pathname: '/workout', params: { routine: rt } })} />
          </Box>
        </>
      )}

      {tab === 'shop' && (
        <>
          <Box t={t}><Text style={{ color: t.fg, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>지금 한 번</Text>{SHOP_NOW.map(shopRow)}</Box>
          <Box t={t}><Text style={{ color: t.fg, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>매주</Text>{SHOP_WEEK.map(shopRow)}</Box>
          <Box t={t}>
            <Text style={{ color: t.fg, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>날짜별</Text>
            {cycleSchedule(v.ctx.idx, cycle).map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
                <Check t={t} on={r.done} label={`${r.name} 주문함`} onPress={() => toggleChecklist(env, 'cycle', r.id)} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: r.done ? t.muted : t.fg, fontSize: 14.5, fontWeight: '600' }}>{r.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{mdw(programDate(env.program, r.dayNo - 1))} · {r.sub}</Text>
                </View>
                {!r.done && (r.diff <= 1 ? <Btn small kind="ghost" label="쿠팡" icon="arrow-up-right" onPress={() => void Linking.openURL(r.url)} /> : <Text style={{ color: t.fg2, fontSize: 12, fontWeight: '700' }}>{diffText(r.diff)}</Text>)}
              </View>
            ))}
          </Box>
        </>
      )}

      {tab === 'basics' && (
        <>
          <Box t={t}>
            <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 6 }}>항상 지키는 것</Text>
            {KEEP.map((k) => (
              <View key={k.title} style={{ flexDirection: 'row', gap: 12, paddingVertical: 8 }}>
                <Icon name={k.icon} size={18} color={t.fg} />
                <View style={{ flex: 1 }}><Text style={{ color: t.fg, fontSize: 15, fontWeight: '700' }}>{k.title}</Text><Text style={{ color: t.muted, fontSize: 13.5 }}>{k.desc}</Text></View>
              </View>
            ))}
          </Box>
          <Box t={t}>
            <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 6 }}>동기화</Text>
            <Text style={{ color: t.muted, fontSize: 13.5 }}>로그인하면 웹과 이 앱이 같은 기록을 봅니다.</Text>
            <Btn kind="ghost" icon={env.store.syncState === 'synced' ? 'cloud' : 'cloud-off'} label={env.store.syncState === 'synced' ? '동기화됨' : '로그인'} style={{ marginTop: 12, alignSelf: 'flex-start' }} onPress={() => router.push('/sheet/sync')} />
          </Box>
        </>
      )}
    </ScrollView>
  );
}
