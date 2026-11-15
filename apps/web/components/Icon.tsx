import {
  Activity, AlarmClock, Apple, ArrowLeftRight, ArrowUpRight, Backpack, Ban, Bed, Building2, CalendarCheck, Car, Check,
  ChevronDown, ChevronRight, ClipboardPaste, Clock, Cloud, CloudOff, Delete, Drumstick, Dumbbell, Footprints, GlassWater, HeartPulse,
  House, LogIn, LogOut, Mail, Moon, MoonStar, PanelLeftClose, PanelLeftOpen, Play, Plus, RotateCcw, Search, Settings, ShoppingBasket,
  Signpost, SkipForward, Store, Sun, Sunrise, Timer, Tv, UserRound, Utensils, UtensilsCrossed, Volume2, VolumeX, Weight, Wine, X,
  type LucideIcon,
} from 'lucide-react';

// Semantic names from @diet/core data -> Lucide components.
const MAP: Record<string, LucideIcon> = {
  activity: Activity, 'alarm-clock': AlarmClock, apple: Apple, 'arrow-left-right': ArrowLeftRight, 'arrow-up-right': ArrowUpRight,
  backpack: Backpack, ban: Ban, bed: Bed, 'building-2': Building2, 'calendar-check': CalendarCheck, car: Car, check: Check,
  'chevron-down': ChevronDown, 'chevron-right': ChevronRight, 'clipboard-paste': ClipboardPaste, clock: Clock, cloud: Cloud,
  'cloud-off': CloudOff, delete: Delete, drumstick: Drumstick, dumbbell: Dumbbell, footprints: Footprints, 'glass-water': GlassWater,
  'heart-pulse': HeartPulse, house: House, 'log-in': LogIn, 'log-out': LogOut, mail: Mail, moon: Moon, 'moon-star': MoonStar,
  'panel-left-close': PanelLeftClose, 'panel-left-open': PanelLeftOpen, play: Play, plus: Plus, 'rotate-ccw': RotateCcw,
  search: Search, settings: Settings, 'shopping-basket': ShoppingBasket, signpost: Signpost, 'skip-forward': SkipForward,
  store: Store, sun: Sun, sunrise: Sunrise, timer: Timer, tv: Tv, 'user-round': UserRound, utensils: Utensils,
  'utensils-crossed': UtensilsCrossed, 'volume-2': Volume2, 'volume-x': VolumeX, weight: Weight, wine: Wine, x: X,
};

/** One icon set, one stroke. Sizes: sm 16, md 20 (default), lg 24. */
export type IconSize = 'sm' | 'md' | 'lg';
const PX: Record<IconSize, number> = { sm: 16, md: 20, lg: 24 };
export const ICON_STROKE = 1.75;

export function Icon({ name, size = 'md', className }: { name: string; size?: IconSize; className?: string }) {
  const C = MAP[name] ?? Check;
  return (
    <C
      className={`lucide i-${size}${className ? ` ${className}` : ''}`}
      size={PX[size]}
      strokeWidth={ICON_STROKE}
      aria-hidden="true"
    />
  );
}
