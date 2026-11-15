import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { SCEN, SCEN_ORDER } from '@diet/core';
import { setDay, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { Icon } from '@/components/Icon';
import { SheetBody, SheetHead } from '@/components/sheet';

export default function ScenarioSheet() {
  const env = useEnv();
  const t = useTheme();
  const v = todayView(env);
  const cur = SCEN[v.scen];
  return (
    <SheetBody>
      <SheetHead eyebrow="오늘 상황" title="오늘은 어떤 날이에요?" />
      <View style={{ marginTop: 12 }}>
        {SCEN_ORDER.map((id, i) => {
          const s = SCEN[id];
          const on = v.scen === id;
          return (
            <Pressable
              key={id}
              onPress={() => { void Haptics.selectionAsync(); setDay(env, v.ctx.key, { scenario: id }); router.back(); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: i ? 1 : 0, borderColor: t.line, opacity: pressed ? 0.6 : 1 })}
            >
              <View style={{ width: 32, alignItems: 'center' }}><Icon name={s.icon} size={20} color={t.fg} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.fg, fontSize: 15, fontWeight: '700' }}>{s.name}{on ? <Text style={{ color: t.muted, fontWeight: '500' }}> · 오늘</Text> : null}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{s.short}</Text>
              </View>
              {on && <Icon name="check" size={16} color={t.fg} weight="bold" />}
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: t.surface, gap: 6 }}>
        <Text style={{ color: t.muted, fontSize: 12.5, fontWeight: '600' }}>{cur.name} 규칙</Text>
        {cur.rules.map((r) => <Text key={r} style={{ color: t.fg2, fontSize: 14, lineHeight: 20 }}>· {r}</Text>)}
      </View>
    </SheetBody>
  );
}
