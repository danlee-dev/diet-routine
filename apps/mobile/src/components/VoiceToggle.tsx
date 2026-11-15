// Header pill in the workout players: spoken cues on or off (filled = on).
import { Pressable, Text } from 'react-native';
import { useTheme } from '@/lib/theme';

export function VoiceToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="음성 안내"
      hitSlop={6}
      onPress={onToggle}
      style={({ pressed }) => ({ height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: on ? t.fg : t.surface, opacity: pressed ? 0.7 : 1 })}
    >
      <Text style={{ color: on ? t.onFg : t.fg2, fontSize: 13.5, fontWeight: '600' }}>음성 {on ? '켬' : '끔'}</Text>
    </Pressable>
  );
}
