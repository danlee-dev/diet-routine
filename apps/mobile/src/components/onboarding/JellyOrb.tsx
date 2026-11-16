// Welcome's orb, made to be touched. Press and it gives a little; drag and it follows on a rubber band,
// stretching along the way it moves and turning its light; let go and it springs home with the speed it had,
// wobbling like jelly until it settles. Haptics: a soft tap on touch, a firm one at the end of the band, a
// tick on release. Nothing moves on its own: every motion here answers a finger.
import * as Haptics from 'expo-haptics';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Orb } from '@/components/ui';

/** Farthest the orb travels, however far the finger goes. */
const PULL = 150;

const touchFeel = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft); };
const edgeFeel = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid); };
const letGoFeel = () => { void Haptics.selectionAsync(); };

/** Follows the finger 1:1 at first, then ever more slowly toward PULL. */
function band(d: number): number {
  'worklet';
  return Math.sign(d) * PULL * (1 - 1 / ((Math.abs(d) / PULL) * 0.9 + 1));
}

export function JellyOrb({ size, turn, ox, oy }: {
  size: number;
  /** resting angle of the light, in degrees (the splash leaves the orb at this angle) */
  turn: number;
  /** where the orb is pulled to; Welcome moves its text a little the other way */
  ox: SharedValue<number>;
  oy: SharedValue<number>;
}) {
  const reduce = useReducedMotion();
  const stretch = useSharedValue(0);
  const angle = useSharedValue(0);
  const press = useSharedValue(0);
  const spin = useSharedValue(0);
  const far = useSharedValue(0);
  const vx = useSharedValue(0);
  const vy = useSharedValue(0);

  const pan = usePanGesture({
    minDistance: 0,
    onBegin: () => {
      'worklet';
      vx.set(0); vy.set(0);
      press.set(withSpring(1, { damping: 18, stiffness: 340 }));
      scheduleOnRN(touchFeel);
    },
    onUpdate: (e) => {
      'worklet';
      const x = band(e.translationX);
      const y = band(e.translationY);
      ox.set(x); oy.set(y);
      vx.set(e.velocityX); vy.set(e.velocityY);
      spin.set(x * 0.22 - y * 0.08);
      if (!reduce) {
        const v = Math.hypot(e.velocityX, e.velocityY);
        stretch.set(withSpring(Math.min(v / 2600, 0.24), { damping: 22, stiffness: 320 }));
        if (v > 80) angle.set(Math.atan2(e.velocityY, e.velocityX));
      }
      const atEnd = Math.hypot(x, y) > PULL * 0.64 ? 1 : 0;
      if (atEnd && !far.get()) scheduleOnRN(edgeFeel);
      far.set(atEnd);
    },
    onFinalize: () => {
      'worklet';
      const home = { damping: 11, stiffness: 130, mass: 0.9 };
      ox.set(withSpring(0, { ...home, velocity: vx.get() }));
      oy.set(withSpring(0, { ...home, velocity: vy.get() }));
      // released at speed it keeps stretching for a moment, then wobbles back through round
      const fling = Math.min(Math.hypot(vx.get(), vy.get()) / 1800, 1);
      stretch.set(withSpring(0, reduce ? { damping: 40, stiffness: 300 } : { damping: 5, stiffness: 230, velocity: fling * 3 }));
      press.set(withSpring(0, reduce ? { damping: 40, stiffness: 300 } : { damping: 7, stiffness: 320 }));
      spin.set(withSpring(0, { damping: 9, stiffness: 80 }));
      far.set(0);
      scheduleOnRN(letGoFeel);
    },
  });

  const body = useAnimatedStyle(() => {
    const a = angle.get();
    const s = stretch.get();
    return {
      transform: [
        { translateX: ox.get() }, { translateY: oy.get() },
        // stretch along the direction of travel, thinner across it, so the volume reads the same
        { rotate: `${a}rad` }, { scaleX: 1 + s }, { scaleY: 1 - s * 0.55 }, { rotate: `${-a}rad` },
        { scale: 1 - press.get() * 0.07 },
      ],
    };
  });
  const light = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn + spin.get()}deg` }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityRole="image"
        accessibilityLabel="다루의 해. 끌어 볼 수 있습니다"
        style={[{ width: size, height: size, borderRadius: size / 2 }, body]}
      >
        <Animated.View style={[{ width: size, height: size }, light]}>
          <Orb size={size} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
