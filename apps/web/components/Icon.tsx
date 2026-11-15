import {
  Activity, AlarmClock, Apple, ArrowLeftRight, ArrowUpRight, Backpack, Ban, Bed, Building2, CalendarCheck, Car, Check,
  ChevronRight, ClipboardPaste, Clock, Cloud, CloudOff, Delete, Drumstick, Dumbbell, Footprints, GlassWater, HeartPulse,
  House, LogIn, Moon, MoonStar, PanelLeftClose, PanelLeftOpen, Play, Plus, RotateCcw, Search, ShoppingBasket, Signpost, SkipForward,
  Store, Sun, Sunrise, Timer, Tv, Utensils, UtensilsCrossed, Volume2, VolumeX, Weight, Wine, X, type LucideIcon,
} from 'lucide-react';

// Semantic names from @diet/core data -> Lucide components. One stroke width everywhere.
const MAP: Record<string, LucideIcon> = {
  activity: Activity, 'alarm-clock': AlarmClock, apple: Apple, 'arrow-left-right': ArrowLeftRight, 'arrow-up-right': ArrowUpRight,
  backpack: Backpack, ban: Ban, bed: Bed, 'building-2': Building2, 'calendar-check': CalendarCheck, car: Car, check: Check,
  'chevron-right': ChevronRight, 'clipboard-paste': ClipboardPaste, clock: Clock, cloud: Cloud, 'cloud-off': CloudOff, delete: Delete,
  drumstick: Drumstick, dumbbell: Dumbbell, footprints: Footprints, 'glass-water': GlassWater, 'heart-pulse': HeartPulse,
  house: House, 'log-in': LogIn, moon: Moon, 'moon-star': MoonStar, 'panel-left-close': PanelLeftClose, 'panel-left-open': PanelLeftOpen,
  play: Play, plus: Plus, 'rotate-ccw': RotateCcw, search: Search, 'shopping-basket': ShoppingBasket, signpost: Signpost, 'skip-forward': SkipForward,
  store: Store, sun: Sun, sunrise: Sunrise, timer: Timer, tv: Tv, utensils: Utensils, 'utensils-crossed': UtensilsCrossed,
  'volume-2': Volume2, 'volume-x': VolumeX, weight: Weight, wine: Wine, x: X,
};

export function Icon({ name, className, strokeWidth = 1.75 }: { name: string; className?: string; strokeWidth?: number }) {
  const C = MAP[name] ?? Check;
  return <C className={`lucide${className ? ` ${className}` : ''}`} strokeWidth={strokeWidth} aria-hidden="true" />;
}
