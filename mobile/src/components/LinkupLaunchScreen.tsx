import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { playLaunchSound, stopLaunchSound } from '../lib/launchSound';

/**
 * THE LINKUP COLD OPEN.
 *
 * The cat is the brand, so the cat is the loading screen: a 3D coin that spins
 * on its Y axis in real perspective, front face the cat plugging the cable in,
 * back face the wordmark. Gold halos orbit it in a tilted 3D plane, shockwaves
 * roll out on the beat of the opening chime, and the LINKUP letters rise out of
 * the floor on a staggered 3D hinge.
 *
 * Rules this screen keeps:
 *  - it never blocks the app for more than ~2.6s and a tap skips it instantly;
 *  - reduced-motion users get a short, calm fade (no loops, no spin);
 *  - every animation is transform/opacity only, so it runs on the native driver
 *    and stays smooth on low-end Android;
 *  - it shows once per session, never again on navigation or theme changes.
 */

const CAT = require('../../assets/logo-cat.png');
const WORDMARK = 'LINKUP';
const COIN = 136;

let shownThisSession = false;

export default function LinkupLaunchScreen({ onFinish }: { onFinish?: () => void }) {
  const [gone, setGone] = useState(() => shownThisSession);
  const [reduceMotion, setReduceMotion] = useState(false);

  const intro = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);

  const finish = useCallback((skipped = false) => {
    if (finished.current) return;
    finished.current = true;
    if (skipped) stopLaunchSound();
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

    // Audio goes first: it has to land on the same frame the cat appears.
    playLaunchSound();

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
      // One full Y-axis revolution per 3.2s: slow enough to read the cat.
      loops.push(Animated.loop(Animated.timing(spin, {
        toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true,
      })));
      loops.push(Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])));
      loops.forEach((loop) => loop.start());
    }

    timers.push(setTimeout(() => finish(), hold));
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((loop) => loop.stop());
    };
  }, [gone, reduceMotion, finish, intro, progress, pulse, spin]);

  if (gone) return null;

  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const orbitDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.34, 0.6] });

  const kickerOpacity = intro.interpolate({ inputRange: [0, 0.35], outputRange: [0, 1], extrapolate: 'clamp' });
  const taglineOpacity = intro.interpolate({ inputRange: [0.55, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const taglineShift = intro.interpolate({ inputRange: [0.55, 1], outputRange: [12, 0], extrapolate: 'clamp' });

  return (
    <Animated.View
      style={[styles.root, { opacity: exit }]}
      accessibilityViewIsModal
      accessibilityLabel="LINKUP is starting. The LINKUP cat spins as the app loads."
    >
      <TouchableWithoutFeedback
        accessibilityRole="button"
        accessibilityLabel="Skip the LINKUP opening animation"
        onPress={() => finish(true)}
      >
        <View style={styles.fill}>
          {/* depth: two soft gold light pools behind everything */}
          <View style={[styles.lightPool, styles.poolTop]} pointerEvents="none" />
          <View style={[styles.lightPool, styles.poolBottom]} pointerEvents="none" />

          {/* shockwaves on the chime's beat */}
          {[0, 1, 2].map((ring) => (
            <Animated.View
              key={`wave-${ring}`}
              pointerEvents="none"
              style={[styles.shockwave, {
                opacity: reduceMotion ? 0 : pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [ring === 0 ? 0.42 : 0.26, 0],
                }),
                transform: [{
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.62 + ring * 0.06, 1.5 + ring * 0.22],
                  }),
                }],
              }, ring === 1 && { width: COIN * 2.1, height: COIN * 2.1, borderRadius: COIN * 1.05 },
                 ring === 2 && { width: COIN * 2.9, height: COIN * 2.9, borderRadius: COIN * 1.45 }]}
            />
          ))}

          {/* orbit halo: real 3D rings tilted into perspective */}
          <View style={styles.orbitStage} pointerEvents="none">
            {[0, 1, 2].map((orbit) => (
              <Animated.View
                key={`orbit-${orbit}`}
                style={[styles.orbit, {
                  width: COIN * (1.85 + orbit * 0.42),
                  height: COIN * (1.85 + orbit * 0.42),
                  borderRadius: COIN,
                  borderColor: orbit === 1 ? 'rgba(251,230,24,0.5)' : 'rgba(251,230,24,0.22)',
                  opacity: orbit === 2 ? 0.5 : 1,
                  transform: [
                    { perspective: 900 },
                    { rotateX: `${64 + orbit * 5}deg` },
                    { rotateZ: orbitDeg },
                  ],
                }]}
              />
            ))}
          </View>

          {/* the stage: cat coin + floor reflection */}
          <View style={styles.stage} pointerEvents="none">
            <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
            <Animated.View
              style={[styles.coin, {
                transform: [
                  { perspective: 1000 },
                  { rotateY: reduceMotion ? '0deg' : spinDeg },
                  { rotateX: '-7deg' },
                ],
              }]}
            >
              {/* FRONT — the cat */}
              <View style={[styles.face, styles.faceFront]}>
                <Image source={CAT} style={styles.cat} resizeMode="cover" fadeDuration={0} />
                <View style={styles.faceShine} pointerEvents="none" />
              </View>
              {/* BACK — the wordmark */}
              <View style={[styles.face, styles.faceBack]}>
                <Text style={styles.faceBackText}>L</Text>
                <View style={styles.faceBackRule} />
              </View>
            </Animated.View>
            <Animated.View style={[styles.reflection, { opacity: kickerOpacity }]} pointerEvents="none" />
          </View>

          {/* wordmark rises out of the floor on a 3D hinge */}
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
  cat: 'logo-cat.png',
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
    width: COIN * 1.5,
    height: COIN * 1.5,
    borderRadius: COIN * 0.75,
    borderWidth: 1,
    borderColor: 'rgba(251,230,24,0.55)',
  },
  orbitStage: {
    position: 'absolute',
    width: COIN * 3.2,
    height: COIN * 3.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: { position: 'absolute', borderWidth: 1 },
  stage: { width: COIN, height: COIN, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: COIN * 2,
    height: COIN * 2,
    borderRadius: COIN,
    backgroundColor: 'rgba(251,230,24,0.20)',
  },
  coin: {
    width: COIN,
    height: COIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: COIN * 0.28,
    alignItems: 'center',
    justifyContent: 'center',
    backfaceVisibility: 'hidden',
    overflow: 'hidden',
  },
  faceFront: {
    backgroundColor: '#FBE618',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.65)',
    shadowColor: '#FBE618',
    shadowOpacity: 0.55,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
    elevation: Platform.OS === 'android' ? 12 : 0,
  },
  faceBack: {
    backgroundColor: '#12141A',
    borderWidth: 2,
    borderColor: '#FBE618',
    transform: [{ rotateY: '180deg' }],
  },
  faceShine: {
    position: 'absolute',
    top: -COIN * 0.55,
    left: -COIN * 0.15,
    width: COIN * 0.7,
    height: COIN * 1.7,
    backgroundColor: 'rgba(255,255,255,0.20)',
    transform: [{ rotate: '22deg' }],
  },
  cat: { width: '100%', height: '100%' },
  faceBackText: { color: '#FBE618', fontSize: COIN * 0.46, fontWeight: '900', letterSpacing: -2 },
  faceBackRule: { width: COIN * 0.28, height: 3, borderRadius: 2, backgroundColor: '#FBE618', marginTop: 5 },
  reflection: {
    position: 'absolute',
    bottom: -COIN * 0.42,
    width: COIN * 0.9,
    height: COIN * 0.5,
    borderRadius: COIN,
    backgroundColor: 'rgba(251,230,24,0.16)',
    transform: [{ scaleY: 0.22 }],
  },
  wordmark: { flexDirection: 'row', marginTop: 46, gap: 2 },
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
