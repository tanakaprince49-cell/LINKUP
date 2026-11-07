import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * THE LINKUP COLD OPEN.
 *
 * The mascot is the brand mark itself: the black cat plugging the cable in.
 * Nothing is redrawn or reimagined here — the artwork is the LOGO cat, rendered
 * in 3D, with its yellow eyes and the socket it is about to light up.
 *
 * It stays alive without ever becoming a flat still: the cat hovers, breathes,
 * leans on a real Y axis in perspective, and lands a spark when the opening
 * beat hits. Behind it, gold halos orbit in a tilted 3D plane and shockwaves
 * roll outward, while the LINKUP letters hinge up out of the floor.
 *
 * Silent by design: no audio is played on launch.
 *
 * Rules this screen keeps:
 *  - never blocks the app longer than ~2.6s, and a tap skips it instantly;
 *  - reduced-motion users get a short calm fade (no loops, no sway);
 *  - transform/opacity work stays on the native driver;
 *  - it shows once per session, never on navigation or theme changes.
 */

const CAT = require('../../assets/launch-cat.png');
const CAT_ASPECT = 820 / 538;
const CAT_WIDTH = 272;
const CAT_HEIGHT = Math.round(CAT_WIDTH / CAT_ASPECT);
const STAGE = 208;
const WORDMARK = 'LINKUP';
const BEAT_AT = 900;

let shownThisSession = false;

export default function LinkupLaunchScreen({ onFinish }: { onFinish?: () => void }) {
  const [gone, setGone] = useState(() => shownThisSession);
  const [reduceMotion, setReduceMotion] = useState(false);

  const intro = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const beat = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);

  const finish = useCallback((skipped = false) => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(exit, {
      toValue: 0,
      duration: skipped ? 120 : 340,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setGone(true);
      onFinish?.();
    });
  }, [exit, onFinish]);

  useEffect(() => {
    if (shownThisSession) return;
    shownThisSession = true;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((reduced) => { if (!cancelled && reduced) setReduceMotion(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (gone) return;
    const hold = reduceMotion ? 820 : 2600;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const loops: Animated.CompositeAnimation[] = [];

    Animated.timing(intro, {
      toValue: 1,
      duration: reduceMotion ? 420 : 1250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    Animated.timing(progress, {
      toValue: 1,
      duration: hold,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();

    if (!reduceMotion) {
      // one halo revolution every 9s; the scene sways so the 3D never flattens
      loops.push(Animated.loop(Animated.timing(orbit, {
        toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true,
      })));
      loops.push(Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])));
      // the cat hovers: slow, weightless, never a static picture
      loops.push(Animated.loop(Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])));
      loops.forEach((loop) => loop.start());
    }

    // the beat: a spark and a glow flash where the plug bites
    timers.push(setTimeout(() => {
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0, duration: 600, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }, BEAT_AT));

    timers.push(setTimeout(() => finish(), hold));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((loop) => loop.stop());
    };
  }, [gone, reduceMotion, finish, intro, progress, pulse, orbit, float, beat]);

  if (gone) return null;

  const orbitDeg = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const swayDeg = pulse.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] });
  const hoverY = float.interpolate({ inputRange: [0, 1], outputRange: [5, -7] });
  const hoverScale = float.interpolate({ inputRange: [0, 1], outputRange: [1, 1.018] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.30, 0.55] });
  const floorScale = float.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const floorOpacity = float.interpolate({ inputRange: [0, 1], outputRange: [0.34, 0.2] });
  const sparkOpacity = beat.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const sparkScale = beat.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.2] });
  const beatFlash = beat.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] });

  const kickerOpacity = intro.interpolate({ inputRange: [0, 0.35], outputRange: [0, 1], extrapolate: 'clamp' });
  const taglineOpacity = intro.interpolate({ inputRange: [0.55, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const taglineShift = intro.interpolate({ inputRange: [0.55, 1], outputRange: [12, 0], extrapolate: 'clamp' });
  const catOpacity = intro.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' });
  const catRise = intro.interpolate({ inputRange: [0, 0.45], outputRange: [26, 0], extrapolate: 'clamp' });

  return (
    <Animated.View
      style={[styles.root, { opacity: exit }]}
      accessibilityViewIsModal
      accessibilityLabel="LINKUP is starting. The LINKUP cat is plugging you in while the app loads."
    >
      <TouchableWithoutFeedback
        accessibilityRole="button"
        accessibilityLabel="Skip the LINKUP opening animation"
        onPress={() => finish(true)}
      >
        <View style={styles.fill}>
          <View style={[styles.lightPool, styles.poolTop]} pointerEvents="none" />
          <View style={[styles.lightPool, styles.poolBottom]} pointerEvents="none" />

          {/* shockwaves rolling out on the beat */}
          {[0, 1, 2].map((ring) => (
            <Animated.View
              key={`wave-${ring}`}
              pointerEvents="none"
              style={[styles.shockwave, {
                opacity: reduceMotion ? 0 : pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [ring === 0 ? 0.42 : 0.24, 0],
                }),
                transform: [{
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.62 + ring * 0.06, 1.5 + ring * 0.22],
                  }),
                }],
              }, ring === 1 && { width: STAGE * 2.2, height: STAGE * 2.2, borderRadius: STAGE * 1.1 },
                 ring === 2 && { width: STAGE * 3, height: STAGE * 3, borderRadius: STAGE * 1.5 }]}
            />
          ))}

          {/* gold halos in a tilted 3D plane */}
          <View style={styles.orbitStage} pointerEvents="none">
            {[0, 1, 2].map((ring) => (
              <Animated.View
                key={`orbit-${ring}`}
                style={[styles.orbit, {
                  width: STAGE * (1.5 + ring * 0.34),
                  height: STAGE * (1.5 + ring * 0.34),
                  borderRadius: STAGE,
                  borderColor: ring === 1 ? 'rgba(251,230,24,0.45)' : 'rgba(251,230,24,0.2)',
                  opacity: ring === 2 ? 0.5 : 1,
                  transform: [
                    { perspective: 900 },
                    { rotateX: `${64 + ring * 5}deg` },
                    { rotateZ: orbitDeg },
                  ],
                }]}
              />
            ))}
          </View>

          {/* THE CAT — the real logo cat, hovering and leaning in 3D */}
          <View style={styles.stage} pointerEvents="none">
            <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
            <Animated.View
              style={[styles.catStage, {
                opacity: catOpacity,
                transform: [
                  { perspective: 1000 },
                  { rotateY: reduceMotion ? '0deg' : swayDeg },
                  { translateY: reduceMotion ? 0 : hoverY },
                  { translateY: catRise },
                  { scale: reduceMotion ? 1 : hoverScale },
                ],
              }]}
            >
              <Image
                source={CAT}
                style={styles.cat}
                resizeMode="contain"
                fadeDuration={0}
                accessibilityIgnoresInvertColors
              />
              {/* the plug bites: one gold flash + a spark burst */}
              <Animated.View style={[styles.flash, { opacity: beatFlash }]} pointerEvents="none" />
              <Animated.View style={[styles.spark, { opacity: sparkOpacity, transform: [{ scale: sparkScale }] }]} pointerEvents="none">
                <Svg width="100%" height="100%" viewBox="0 0 300 200">
                  <Path d="M246 28 L250 40 L262 44 L250 48 L246 60 L242 48 L230 44 L242 40 Z" fill="#FBE618" />
                  <Path d="M282 76 L285 85 L294 88 L285 91 L282 100 L279 91 L270 88 L279 85 Z" fill="#FBE618" opacity={0.85} />
                  <Circle cx={268} cy={20} r={3.4} fill="#FBE618" opacity={0.7} />
                  <Circle cx={298} cy={54} r={2.6} fill="#FBE618" opacity={0.6} />
                </Svg>
              </Animated.View>
            </Animated.View>
            <Animated.View
              style={[styles.floor, { opacity: floorOpacity, transform: [{ scaleX: floorScale }] }]}
              pointerEvents="none"
            />
          </View>

          {/* wordmark hinges up out of the floor */}
          <View style={styles.wordmark} pointerEvents="none">
            {WORDMARK.split('').map((letter, index) => {
              const start = 0.16 + index * 0.055;
              return (
                <Animated.Text
                  key={`${letter}-${index}`}
                  style={[styles.letter, {
                    opacity: intro.interpolate({
                      inputRange: [start, start + 0.22],
                      outputRange: [0, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      { perspective: 800 },
                      {
                        rotateX: intro.interpolate({
                          inputRange: [start, start + 0.3],
                          outputRange: ['74deg', '0deg'],
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: intro.interpolate({
                          inputRange: [start, start + 0.3],
                          outputRange: [26, 0],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  }]}
                >
                  {letter}
                </Animated.Text>
              );
            })}
          </View>

          <Animated.Text style={[styles.tagline, { opacity: taglineOpacity, transform: [{ translateY: taglineShift }] }]}>
            The cat is plugging you in…
          </Animated.Text>

          <View style={styles.footer} pointerEvents="none">
            <View style={styles.track}>
              <Animated.View style={[styles.trackFill, {
                transform: [{
                  translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-160, 0] }),
                }],
              }]} />
            </View>
            <Text style={styles.skip}>Tap to skip</Text>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </Animated.View>
  );
}

export const LAUNCH_SCREEN_COPY = {
  tagline: 'The cat is plugging you in…',
  skip: 'Tap to skip',
  /** The real brand mark, rendered in 3D. */
  cat: 'launch-cat.png',
  beatAt: BEAT_AT,
  silent: true,
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#07080A',
    zIndex: 9999,
    elevation: 9999,
  },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  lightPool: {
    position: 'absolute',
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: 'rgba(251,230,24,0.10)',
  },
  poolTop: { top: -260, left: -180 },
  poolBottom: { bottom: -300, right: -200, backgroundColor: 'rgba(251,230,24,0.07)' },
  shockwave: {
    position: 'absolute',
    width: STAGE * 1.5,
    height: STAGE * 1.5,
    borderRadius: STAGE * 0.75,
    borderWidth: 1,
    borderColor: 'rgba(251,230,24,0.5)',
  },
  orbitStage: {
    position: 'absolute',
    width: STAGE * 3.2,
    height: STAGE * 3.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: { position: 'absolute', borderWidth: 1 },
  stage: { width: CAT_WIDTH, height: CAT_HEIGHT + 30, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: CAT_WIDTH * 1.35,
    height: CAT_WIDTH * 1.35,
    borderRadius: CAT_WIDTH,
    backgroundColor: 'rgba(251,230,24,0.16)',
  },
  catStage: { width: CAT_WIDTH, height: CAT_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  cat: { width: CAT_WIDTH, height: CAT_HEIGHT },
  flash: {
    position: 'absolute',
    width: CAT_WIDTH * 0.55,
    height: CAT_HEIGHT * 0.6,
    borderRadius: CAT_WIDTH,
    backgroundColor: '#FBE618',
  },
  spark: { position: 'absolute', right: -CAT_WIDTH * 0.02, top: -CAT_HEIGHT * 0.1, width: 300, height: 200, transform: [{ scale: 0.62 }] },
  floor: {
    position: 'absolute',
    bottom: 2,
    width: CAT_WIDTH * 0.72,
    height: CAT_HEIGHT * 0.34,
    borderRadius: CAT_WIDTH,
    backgroundColor: 'rgba(251,230,24,0.16)',
    transform: [{ scaleY: 0.16 }],
  },
  wordmark: { flexDirection: 'row', marginTop: 26, gap: 2 },
  letter: {
    color: '#F7F7F2',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 2,
  },
  tagline: {
    marginTop: 10,
    color: 'rgba(247,247,242,0.72)',
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  footer: { position: 'absolute', bottom: 46, alignItems: 'center', gap: 10 },
  track: {
    width: 160,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(247,247,242,0.16)',
    overflow: 'hidden',
  },
  trackFill: { width: 160, height: 3, borderRadius: 2, backgroundColor: '#FBE618' },
  skip: {
    color: 'rgba(247,247,242,0.45)',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
