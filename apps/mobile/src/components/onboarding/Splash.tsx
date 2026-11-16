// Cold-start splash. It takes over from the native splash (same background, same orb size and place). The orb
// rises like a sun and swells past its size before settling, its light turning; under it the wordmark 다루
// comes up syllable by syllable from behind a baseline. Then both travel: the orb into Welcome's orb, the
// wordmark into Welcome's 다루 label, so the first screen is built from the splash itself. Into Today the orb
// opens up and fades instead. About 1.5 s; a tap anywhere skips straight to the hand-over.
// Reduce Motion: no scaling or travel, the wordmark fades in place and the whole layer crossfades.
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, interpolate, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import * as SplashScreen from 'expo-splash-screen';
import { useTheme } from '@/lib/theme';
import { FONT } from '@/lib/fonts';
import { Orb } from '@/components/ui';
import { MARK_SPACING, ORB_TURN_DEG, splashHandoff, type MarkFrame } from './handoff';

// Safety net: if the first render throws before <Splash> lays out, never leave the native splash up forever.
setTimeout(() => { void SplashScreen.hideAsync().catch(() => {}); }, 6000);

const NATIVE_IMAGE = 76; // app.json > expo-splash-screen > imageWidth
const NATIVE_ORB = NATIVE_IMAGE * 0.6; // the orb fills 60% of splash-icon.png
const DRAW = 400; // the vector orb is drawn large and scaled down, so it stays sharp when it grows into Welcome
const S0 = NATIVE_ORB / DRAW;
const S1 = S0 * 2.3; // size it settles at, after swelling past it
const RISE = 46; // how far the sun climbs
const WORD = ['다', '루']; // 다루 (다이어트 루틴)
const MARK = 60; // wordmark size; it lands on Welcome's label, scaled down
const LINE = Math.round(MARK * 1.3);
const travel = Easing.bezier(0.2, 0, 0, 1);
const settle = Easing.bezier(0.16, 1, 0.3, 1);

function Syllable({ ch, i, p, color, reduce }: { ch: string; i: number; p: SharedValue<number>; color: string; reduce: boolean }) {
  const st = useAnimatedStyle(() => {
    const v = interpolate(p.get(), [i * 0.18, i * 0.18 + 0.82], [0, 1], 'clamp');
    return reduce
      ? { opacity: v }
      : { transform: [{ translateY: (1 - v) * LINE }, { rotate: `${(1 - v) * 7}deg` }] };
  });
  // the clip is the baseline the syllable climbs out from behind
  return (
    <View style={{ height: LINE, overflow: 'hidden' }}>
      <Animated.Text style={[{ color, fontFamily: FONT.mark, fontSize: MARK, lineHeight: LINE, letterSpacing: MARK * MARK_SPACING }, st]}>{ch}</Animated.Text>
    </View>
  );
}

export function Splash() {
  const t = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<'intro' | 'exit' | 'gone'>('intro');
  const started = useRef(false);
  const exiting = useRef(false);
  const markBox = useRef<MarkFrame | null>(null);
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
  const mx = useSharedValue(0);
  const my = useSharedValue(0);
  const ms = useSharedValue(1);
  const markO = useSharedValue(1);

  const exit = () => {
    if (exiting.current) return;
    exiting.current = true;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('exit');
    const f = splashHandoff.target();
    const m = splashHandoff.mark();
    const src = markBox.current;
    if (f) {
      const go = { duration: 520, easing: travel };
      // shared-element move: land exactly on Welcome's orb, then let Welcome show its own
      tx.set(withTiming(f.x + f.size / 2 - W / 2, go));
      ty.set(withTiming(f.y + f.size / 2 - H / 2, go));
      scale.set(withTiming(f.size / DRAW, go));
      rot.set(withTiming(ORB_TURN_DEG, go));
      png.set(withTiming(0, { duration: 120 }));
      word.set(withTiming(1, { duration: 200 }));
      if (m && src) {
        // the wordmark shrinks into Welcome's label: same font, same spacing ratio, so the swap is invisible
        mx.set(withTiming(m.x + m.w / 2 - (src.x + src.w / 2), go));
        my.set(withTiming(m.y + m.h / 2 - (src.y + src.h / 2), go));
        ms.set(withTiming(m.w / src.w, go));
      } else {
        markO.set(withTiming(0, { duration: 160 }));
      }
      bg.set(withDelay(160, withTiming(0, { duration: 360 })));
      later(() => { splashHandoff.finish(); requestAnimationFrame(() => setPhase('gone')); }, 530);
    } else {
      markO.set(withTiming(0, { duration: 220 }));
      my.set(withTiming(-14, { duration: 300, easing: settle }));
      scale.set(withTiming(S1 * 3.2, { duration: 460, easing: Easing.out(Easing.cubic) }));
      orbO.set(withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }));
      bg.set(withDelay(30, withTiming(0, { duration: 300 })));
      later(() => { splashHandoff.finish(); setPhase('gone'); }, 460);
    }
  };

  const start = () => {
    if (started.current) return;
    started.current = true;
    if (reduce) {
      // fades only; Reanimated skips animations under Reduce Motion unless told a crossfade is fine
      const fade = (duration: number) => ({ duration, reduceMotion: ReduceMotion.Never });
      png.set(withTiming(0, fade(200)));
      word.set(withTiming(1, fade(240)));
      later(() => {
        exiting.current = true;
        splashHandoff.finish();
        setPhase('exit');
        bg.set(withTiming(0, fade(320)));
        orbO.set(withTiming(0, fade(320)));
        markO.set(withTiming(0, fade(320)));
        later(() => setPhase('gone'), 340);
      }, 620);
      return;
    }
    // the sun comes up: it swells past its size and settles, the light turns, the wordmark climbs in under it
    scale.set(withSpring(S1, { damping: 9, stiffness: 95, mass: 1 }));
    ty.set(withSpring(-RISE, { damping: 15, stiffness: 110 }));
    rot.set(withTiming(ORB_TURN_DEG, { duration: 1000, easing: Easing.inOut(Easing.quad) }));
    png.set(withDelay(30, withTiming(0, { duration: 220 })));
    word.set(withDelay(320, withTiming(1, { duration: 820, easing: settle })));
    later(exit, 1180);
  };

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.get() }));
  const orbStyle = useAnimatedStyle(() => ({
    opacity: orbO.get(),
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }, { rotate: `${rot.get()}deg` }],
  }));
  const pngStyle = useAnimatedStyle(() => ({ opacity: png.get() }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markO.get(),
    transform: [{ translateX: mx.get() }, { translateY: my.get() }, { scale: ms.get() }],
  }));

  if (phase === 'gone') return null;
  const pngBox = NATIVE_IMAGE / S0;
  const markY = reduce ? H / 2 + 40 : H / 2 - RISE + (NATIVE_ORB * (S1 / S0)) / 2 + 20;
  return (
    <View
      pointerEvents={phase === 'intro' ? 'auto' : 'none'}
      style={StyleSheet.absoluteFill}
      onLayout={() => { void SplashScreen.hideAsync().catch(() => {}).finally(start); }}
      onTouchEnd={() => { if (started.current && !reduce) exit(); }}
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
      <View style={{ position: 'absolute', top: markY, left: 0, right: 0, alignItems: 'center' }}>
        <Animated.View
          onLayout={(e) => { const l = e.nativeEvent.layout; markBox.current = { x: l.x, y: markY + l.y, w: l.width, h: l.height }; }}
          style={[{ flexDirection: 'row' }, markStyle]}
        >
          {WORD.map((ch, i) => <Syllable key={i} ch={ch} i={i} p={word} color={t.fg} reduce={reduce} />)}
        </Animated.View>
      </View>
    </View>
  );
}
