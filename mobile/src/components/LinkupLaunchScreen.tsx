import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import LinkyCatAlive from './LinkyCatAlive';
import { playLaunchSound, stopLaunchSound } from '../lib/launchSound';

/**
 * THE LINKUP COLD OPEN.
 *
 * The cat is the brand, so the cat is the loading screen — and the cat is
 * ALIVE: it breathes, blinks (sometimes twice), flicks each ear on its own
 * hinge, swishes its tail, glances around, and meows with a spark on the exact
 * beat the chime lands. Nothing here is a photograph or a spinning logo.
 *
 * Around it, the stage is real 3D: gold halos orbit in a tilted plane, the
 * whole scene sways on its Y axis in perspective, shockwaves roll out from the
 * beat, and the LINKUP letters hinge up out of the floor.
 *
 * Rules this screen keeps:
 *  - never blocks the app longer than ~2.6s, and a tap skips it instantly;
 *  - reduced-motion users get a short calm fade (no loops, no spin);
 *  - transform/opacity work stays on the native driver;
 *  - it shows once per session, never on navigation or theme changes.
 */

const WORDMARK = 'LINKUP';
const STAGE = 176;
const BEAT_AT = 900;

let shownThisSession = false;

export default function LinkupLaunchScreen({ onFinish }: { onFinish?: () => void }) {
  const [gone, setGone] = useState(() => shownThisSession);
  const [reduceMotion, setReduceMotion] = useState(false);

  const intro = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
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
      // The halo ring turns a full revolution every 9s; the scene sways on the
      // pulse so the 3D never reads as a flat card.
      loops.push(Animated.loop(Animated.timing(orbit, {
        toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true,
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
  }, [gone, reduceMotion, finish, intro, progress, pulse, orbit]);

  if (gone) return null;

  const orbitDeg = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const swayDeg = pulse.interpolate({ inputRange: [0, 1], outputRange: ['-7deg', '7deg'] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0.58] });

  const kickerOpacity = intro.interpolate({ inputRange: [0, 0.35], outputRange: [0, 1], extrapolate: 'clamp' });
  const taglineOpacity = intro.interpolate({ inputRange: [0.55, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const taglineShift = intro.interpolate({ inputRange: [0.55, 1], outputRange: [12, 0], extrapolate: 'clamp' });

  return (
    <Animated.View
      style={[styles.root, { opacity: exit }]}
      accessibilityViewIsModal
      accessibilityLabel="LINKUP is starting. The LINKUP cat is waking up while the app loads."
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
              }, ring === 1 && { width: STAGE * 2.1, height: STAGE * 2.1, borderRadius: STAGE * 1.05 },
                 ring === 2 && { width: STAGE * 2.9, height: STAGE * 2.9, borderRadius: STAGE * 1.45 }]}
            />
          ))}

          {/* orbit halo: rings tilted into perspective, turning behind the cat */}
          <View style={styles.orbitStage} pointerEvents="none">
            {[0, 1, 2].map((ring) => (
              <Animated.View
                key={`orbit-${ring}`}
                style={[styles.orbit, {
                  width: STAGE * (1.55 + ring * 0.36),
                  height: STAGE * (1.55 + ring * 0.36),
                  borderRadius: STAGE,
                  borderColor: ring === 1 ? 'rgba(251,230,24,0.5)' : 'rgba(251,230,24,0.22)',
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

          {/* THE CAT — breathing, blinking, flicking, swishing, meowing */}
          <View style={styles.stage} pointerEvents="none">
            <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
            <Animated.View
              style={{
                transform: [
                  { perspective: 1000 },
                  { rotateY: reduceMotion ? '0deg' : swayDeg },
                ],
              }}
            >
              <LinkyCatAlive size={STAGE} alive={!reduceMotion} beatAt={BEAT_AT} />
            </Animated.View>
            <Animated.View style={[styles.reflection, { opacity: kickerOpacity }]} pointerEvents="none" />
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
  // The mascot is drawn, not photographed: see LinkyCatAlive.
  cat: 'LinkyCatAlive',
  beatAt: BEAT_AT,
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
    borderColor: 'rgba(251,230,24,0.55)',
  },
  orbitStage: {
    position: 'absolute',
    width: STAGE * 3.2,
    height: STAGE * 3.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbit: { position: 'absolute', borderWidth: 1 },
  stage: { width: STAGE, height: STAGE + 24, alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: STAGE * 2,
    height: STAGE * 2,
    borderRadius: STAGE,
    backgroundColor: 'rgba(251,230,24,0.18)',
  },
  reflection: {
    position: 'absolute',
    bottom: 0,
    width: STAGE * 0.9,
    height: STAGE * 0.5,
    borderRadius: STAGE,
    backgroundColor: 'rgba(251,230,24,0.16)',
    transform: [{ scaleY: 0.2 }],
  },
  wordmark: { flexDirection: 'row', marginTop: 30, gap: 2 },
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
