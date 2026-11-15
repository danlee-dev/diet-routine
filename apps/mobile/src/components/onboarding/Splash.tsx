// Cold-start splash. It takes over from the native splash (same background, same orb size and place), the orb
// breathes once and turns while the wordmark tracks in, then the orb flies into Welcome's orb, or opens up and
// fades into Today. About 1.2 s, on top of a first screen that is already rendered underneath.
// Reduce Motion: no scaling or travel, the wordmark fades in at its final spacing and the whole layer crossfades.
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { useTheme } from '@/lib/theme';
import { Orb } from '@/components/ui';
import { ORB_TURN_DEG, splashHandoff } from './handoff';

const NATIVE_IMAGE = 76; // app.json > expo-splash-screen > imageWidth
const NATIVE_ORB = NATIVE_IMAGE * 0.6; // the orb fills 60% of splash-icon.png
const DRAW = 400; // the vector orb is drawn large and scaled down, so it stays sharp when it grows into Welcome
const S0 = NATIVE_ORB / DRAW;
const WORD = ['감', '량', ' ', '루', '틴'];
const out = Easing.out(Easing.cubic);
const travel = Easing.bezier(0.2, 0, 0, 1);

function Char({ ch, i, p, color }: { ch: string; i: number; p: SharedValue<number>; color: string }) {
  const st = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateX: (i - 2) * 9 * (1 - p.value) }, { translateY: 4 * (1 - p.value) }],
  }));
  if (ch === ' ') return <View style={{ width: 6 }} />;
  return <Animated.Text style={[{ color, fontSize: 21, fontWeight: '600', letterSpacing: -0.3 }, st]}>{ch}</Animated.Text>;
}

export function Splash() {
  const t = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<'intro' | 'exit' | 'gone'>('intro');
  const started = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };

  const bg = useSharedValue(1);
  const scale = useSharedValue(S0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const rot = useSharedValue(0);
  const orbO = useSharedValue(1);
  const png = useSharedValue(1);
  const word = useSharedValue(0);
  const wordO = useSharedValue(1);

  const exit = () => {
    setPhase('exit');
    const f = splashHandoff.target();
    wordO.value = withTiming(0, { duration: 160 });
    if (f) {
      // shared-element move: land exactly on Welcome's orb, then let Welcome show its own
      tx.value = withTiming(f.x + f.size / 2 - W / 2, { duration: 460, easing: travel });
      ty.value = withTiming(f.y + f.size / 2 - H / 2, { duration: 460, easing: travel });
      scale.value = withTiming(f.size / DRAW, { duration: 460, easing: travel });
      bg.value = withDelay(140, withTiming(0, { duration: 320 }));
      later(() => { splashHandoff.finish(); requestAnimationFrame(() => setPhase('gone')); }, 470);
    } else {
      scale.value = withTiming(S0 * 2.8, { duration: 420, easing: out });
      orbO.value = withTiming(0, { duration: 380, easing: out });
      bg.value = withDelay(60, withTiming(0, { duration: 340 }));
      later(() => { splashHandoff.finish(); setPhase('gone'); }, 420);
    }
  };

  const start = () => {
    if (started.current) return;
    started.current = true;
    if (reduce) {
      // fades only; Reanimated skips animations under Reduce Motion unless told a crossfade is fine
      const fade = (duration: number) => ({ duration, reduceMotion: ReduceMotion.Never });
      png.value = withTiming(0, fade(200));
      word.value = withTiming(1, fade(200));
      later(() => {
        splashHandoff.finish();
        setPhase('exit');
        bg.value = withTiming(0, fade(320));
        orbO.value = withTiming(0, fade(320));
        wordO.value = withTiming(0, fade(320));
        later(() => setPhase('gone'), 340);
      }, 520);
      return;
    }
    // one breath (in, out), the orb lifts to make room, the gradient turns, the wordmark closes in
    scale.value = withSequence(
      withTiming(S0 * 1.2, { duration: 380, easing: Easing.inOut(Easing.quad) }),
      withTiming(S0, { duration: 420, easing: out }),
    );
    ty.value = withDelay(340, withTiming(-22, { duration: 440, easing: out }));
    rot.value = withTiming(ORB_TURN_DEG, { duration: 800, easing: Easing.inOut(Easing.quad) });
    png.value = withDelay(40, withTiming(0, { duration: 240 }));
    word.value = withDelay(300, withTiming(1, { duration: 480, easing: out }));
    later(exit, 800);
  };

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const orbStyle = useAnimatedStyle(() => ({
    opacity: orbO.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }, { rotate: `${rot.value}deg` }],
  }));
  const pngStyle = useAnimatedStyle(() => ({ opacity: png.value }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: wordO.value }));

  if (phase === 'gone') return null;
  const pngBox = NATIVE_IMAGE / S0;
  return (
    <View
      pointerEvents={phase === 'intro' ? 'auto' : 'none'}
      style={StyleSheet.absoluteFill}
      onLayout={() => { void SplashScreen.hideAsync().catch(() => {}).finally(start); }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }, bgStyle]} />
      <Animated.View style={[{ position: 'absolute', width: DRAW, height: DRAW, left: W / 2 - DRAW / 2, top: H / 2 - DRAW / 2 }, orbStyle]}>
        <Orb size={DRAW} />
        {/* the native splash image itself for the first frames, so the handover has no color or size jump */}
        <Animated.View style={[{ position: 'absolute', width: pngBox, height: pngBox, left: DRAW / 2 - pngBox / 2, top: DRAW / 2 - pngBox / 2 }, pngStyle]}>
          <Image source={require('../../../assets/images/splash-icon.png')} style={{ width: '100%', height: '100%' }} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: H / 2 + (reduce ? 34 : 14), flexDirection: 'row', justifyContent: 'center' }, wordStyle]}>
        {WORD.map((ch, i) => <Char key={i} ch={ch} i={i} p={word} color={t.fg} />)}
      </Animated.View>
    </View>
  );
}
