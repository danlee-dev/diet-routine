// Suggestions on Today that change the plan only when accepted: split yesterday's overshoot, a new daily
// target from the record, or dropping a meal that keeps getting skipped. Same cards as the web (todaySuggestions).
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { daysBetween, keyOf, parseKey } from '@diet/core';
import { todaySuggestions, type Suggestion } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/env';
import { R, squircle, useTheme } from '@/lib/theme';
import { Btn, useToast } from './ui';

interface Dismissed { id: string; on: string }

/** "그대로 두기" hides the morning-after card for that morning, the others for a week. */
export function isDismissed(s: Suggestion, today: string): boolean {
  const d = devicePref.get<Dismissed | null>(`sg:${s.kind}`, null);
  if (!d) return false;
  return s.kind === 'carry' ? d.id === s.id : daysBetween(parseKey(d.on), parseKey(today)) < 7;
}

export function SuggestionCards() {
  // reads store rows through a stable env; the compiler would cache them
  'use no memo';
  const env = useEnv();
  const t = useTheme();
  const { toast } = useToast();
  const [, bump] = useState(0);
  const today = keyOf(env.now());
  // one at a time, most pressing first: the next shows once this one is accepted or dismissed
  const list = todaySuggestions(env).filter((s) => !isDismissed(s, today)).slice(0, 1);
  if (!list.length) return null;
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      {list.map((s) => (
        <View key={s.id} accessibilityLabel={s.title} style={[{ padding: 18, borderRadius: R.lg, backgroundColor: t.surface, gap: 12 }, squircle]}>
          <View style={{ gap: 4 }}>
            <Text style={{ color: t.fg, fontSize: 16.5, fontWeight: '600', letterSpacing: -0.2 }}>{s.title}</Text>
            <Text style={{ color: t.fg2, fontSize: 13.5, lineHeight: 19.5 }}>{s.body}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <Btn small label={s.accept} icon="check" onPress={() => { const undo = s.apply(); toast(s.done, undo); }} />
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { devicePref.set(`sg:${s.kind}`, { id: s.id, on: today }); bump((n) => n + 1); }}>
              <Text style={{ color: t.fg2, fontSize: 14, fontWeight: '500' }}>그대로 두기</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
