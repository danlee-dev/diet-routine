import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

// Semantic names from @diet/core -> SF Symbols (same names the web maps to Lucide).
const MAP: Record<string, SFSymbol> = {
  sun: 'sun.max', utensils: 'fork.knife', apple: 'carrot', dumbbell: 'dumbbell', moon: 'moon', backpack: 'backpack',
  'utensils-crossed': 'takeoutbag.and.cup.and.straw', house: 'house', 'alarm-clock': 'alarm', car: 'car', 'moon-star': 'moon.stars',
  bed: 'bed.double', 'glass-water': 'drop', store: 'storefront', wine: 'wineglass', 'heart-pulse': 'heart.text.square', clock: 'clock',
  drumstick: 'fish', ban: 'nosign', check: 'checkmark', 'chevron-right': 'chevron.right', 'arrow-up-right': 'arrow.up.right',
  sunrise: 'sunrise', weight: 'scalemass', footprints: 'figure.walk', play: 'play.fill', plus: 'plus', 'rotate-ccw': 'arrow.uturn.backward',
  'skip-forward': 'forward.end', 'shopping-basket': 'basket', signpost: 'signpost.right', 'calendar-check': 'calendar', activity: 'chart.xyaxis.line',
  x: 'xmark', delete: 'delete.left', timer: 'timer', 'volume-2': 'speaker.wave.2', 'volume-x': 'speaker.slash', cloud: 'icloud', 'cloud-off': 'icloud.slash', user: 'person.crop.circle', 'chevron-down': 'chevron.down', 'log-out': 'rectangle.portrait.and.arrow.right', mail: 'envelope', 'refresh-cw': 'arrow.clockwise',
  'arrow-left-right': 'arrow.left.arrow.right', 'clipboard-paste': 'doc.on.clipboard', search: 'magnifyingglass', 'building-2': 'building.2', tv: 'tv',
  'figure-run': 'figure.run', pause: 'pause.fill', stop: 'stop.fill', share: 'square.and.arrow.up', list: 'list.bullet', map: 'map',
};

export function Icon({ name, size = 20, color, weight = 'medium' }: { name: string; size?: number; color: ColorValue; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }) {
  return <SymbolView name={MAP[name] ?? 'circle'} size={size} tintColor={color} weight={weight} />;
}
