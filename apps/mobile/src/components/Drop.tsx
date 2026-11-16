import { useEffect, useState, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** Same curve as the web's --spring: quick start, long soft landing. */
const EASE = Easing.bezier(0.32, 0.72, 0, 1);

/**
 * A panel that opens downward. Its height grows from 0 to the content's height while the content slides
 * down and fades in, so the rows under it move along instead of jumping. Closing runs backward and only
 * then unmounts. The content is measured in an absolutely placed layer, so it never squeezes while the
 * box is still short.
 */
export function Drop({ open, children, style, space = 0 }: {
  open: boolean; children: ReactNode;
  /** the growing box itself (background, corners), so the rounded card grows instead of being cut off */
  style?: StyleProp<ViewStyle>;
  /** room below the box, eased in and out with it */
  space?: number;
}) {
  const reduce = useReducedMotion();
  const [prevOpen, setPrevOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== prevOpen) { setPrevOpen(open); setClosing(!open); }
  const h = useSharedValue(0);
  const p = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    const done = () => setClosing(false);
    p.set(open
      ? withTiming(1, { duration: reduce ? 0 : 440, easing: EASE, reduceMotion: ReduceMotion.Never })
      : withTiming(0, { duration: reduce ? 0 : 300, easing: EASE, reduceMotion: ReduceMotion.Never }, (fin) => { if (fin) scheduleOnRN(done); }));
  }, [open, reduce, p]);

  const box = useAnimatedStyle(() => ({ height: h.get() * p.get(), marginBottom: space * p.get() }));
  const body = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: (p.get() - 1) * 14 }] }));

  if (!open && !closing) return null;
  return (
    <Animated.View style={[{ overflow: 'hidden' }, style, box]}>
      <Animated.View onLayout={(e) => h.set(e.nativeEvent.layout.height)} style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, body]}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}
