import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowDown } from 'lucide-react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { buildFacts, WEEKLY_REVEAL_VOICE, type VoiceProfile } from '../lib/brandVoice';

/**
 * THE WEEKLY WAIT.
 *
 * Once a week, one person gets chosen for you. That is the whole product, so
 * the four seconds before their face appears are not a spinner — they are the
 * moment the decision happens, and they should feel like it. The cat thinks:
 * it leans, the thought rings orbit it in 3D, the status line escalates from
 * "scanning" to "deciding", and the last line tells you it is about to land.
 *
 * Rules:
 *  - it runs for ~4 seconds, measured from the first painted frame, and then
 *    hands straight over to the card (no second tap);
 *  - a tap skips it immediately — nobody is trapped in an ad;
 *  - silent, like every other brand moment in this app;
 *  - reduced motion gets a calm, short version that still says all four
 *    things, so nothing is lost by being motion-sensitive;
 *  - it renders in a transparent Modal so the page underneath cannot clip it.
 */

const CAT = require('../../assets/launch-cat.png');
const CAT_ASPECT = 820 / 538;
const CAT_WIDTH = 250;

/** The thinking itself: four beats, then the decision is made. */
const THINKING_MS = 4000;
const THINKING_REDUCED_MS = 1600;
const EXIT_MS = 320;
/**
 * After the thinking lands, the member holds the moment in their hand: a gold
 * button that pulses until they tap it. Nobody is trapped — if they do not tap,
 * the founder is revealed anyway after this long — but the reveal belongs to them,
 * which is the whole point of doing it once a week.
 */
const REVEAL_TAP_AT_MS = 3000;
const REVEAL_AUTO_MS = 12000;
/** Each beat lands a second after the last, so all four are readable. */
const LINE_AT = [0, 900, 1900, 2900] as const;
const RING_COUNT = 3;
/** Width of the light band that crosses the reveal button. */
const SHEEN_WIDTH = 54;
const DOTS = 9;

type Props = {
  profile: VoiceProfile;
  visible: boolean;
  onDone: () => void;
};

export default function WeeklyMatchThinking({ profile, visible, onDone }: Props) {
  const facts = useMemo(() => buildFacts(profile), [profile]);
  const lines = useMemo(() => WEEKLY_REVEAL_VOICE.thinkingLines(facts), [facts]);
  const status = useMemo(() => WEEKLY_REVEAL_VOICE.status(facts), [facts]);

  const [show, setShow] = useState(visible);
  const [beat, setBeat] = useState(0);
  /** The thinking is done and the button is in their hand. */
  const [armed, setArmed] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  /** Two rings leave the button and die out, like a heartbeat you can see. */
  const rippleA = useRef(new Animated.Value(0)).current;
  const rippleB = useRef(new Animated.Value(0)).current;
  /** A band of light crosses the ink pill, left to right, every couple of seconds. */
  const sheen = useRef(new Animated.Value(0)).current;
  /** Tapping is not a cut — the button flares once, then the founder lands. */
  const burst = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const think = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const lineAnims = useRef(lines.map(() => new Animated.Value(0))).current;
  const finished = useRef(false);
  const reduceMotion = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(exit, {
      toValue: 1,
      duration: reduceMotion.current ? 90 : EXIT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setShow(false);
      onDone();
    });
  }, [exit, onDone]);

  useEffect(() => {
    if (visible) {
      finished.current = false;
      setShow(true);
      setBeat(0);
      setArmed(false);
      pulse.setValue(0);
      rippleA.setValue(0);
      rippleB.setValue(0);
      sheen.setValue(0);
      burst.setValue(0);
      lineAnims.forEach((anim) => anim.setValue(0));
    }
  }, [visible, lineAnims]);

  useEffect(() => {
    if (!show) return;
    const reduced = Platform.OS === 'web'
      ? typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      : false;
    reduceMotion.current = reduced;

    if (reduced) {
      entrance.setValue(1);
      lineAnims.forEach((anim) => anim.setValue(1));
      setBeat(lines.length - 1);
      const timer = setTimeout(finish, THINKING_REDUCED_MS);
      return () => clearTimeout(timer);
    }

    Animated.timing(entrance, {
      toValue: 1,
      duration: 560,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // The cat is thinking: it breathes, slowly, the whole time.
    Animated.loop(Animated.sequence([
      Animated.timing(think, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(think, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])).start();

    // The thought rings orbit it, unhurried.
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 11000, easing: Easing.linear, useNativeDriver: true })).start();

    const timers: ReturnType<typeof setTimeout>[] = [];
    LINE_AT.slice(0, lines.length).forEach((at, index) => {
      timers.push(setTimeout(() => {
        setBeat(index);
        Animated.timing(lineAnims[index], {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, at));
    });

    // The thinking lands, then the moment is handed to the member.
    timers.push(setTimeout(() => setArmed(true), REVEAL_TAP_AT_MS));
    timers.push(setTimeout(finish, REVEAL_AUTO_MS));
    return () => timers.forEach(clearTimeout);
  }, [show, lines.length, entrance, think, spin, lineAnims, finish]);

  // The button is alive while it waits to be tapped. Three things run together,
  // all on the native driver so a mid-range Android phone keeps 60fps:
  //  - it breathes (scale 1 -> 1.045, 620ms each way);
  //  - two ink rings leave it and fade out, offset from each other, so the eye
  //    is pulled to the pill before it reads the words;
  //  - a band of light crosses the ink every two seconds, so the pill reads as
  //    a live surface rather than a painted one.
  // Reduced motion gets none of it: the button is simply there, and it still
  // reveals on tap.
  useEffect(() => {
    if (!armed || reduceMotion.current) return;
    const loops = [
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])),
      Animated.loop(Animated.timing(rippleA, { toValue: 1, duration: 1900, easing: Easing.out(Easing.quad), useNativeDriver: true })),
      Animated.loop(Animated.sequence([
        Animated.delay(950),
        Animated.timing(rippleB, { toValue: 1, duration: 1900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(rippleB, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])),
      Animated.loop(Animated.sequence([
        Animated.timing(sheen, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(900),
        Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])),
    ];
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [armed, pulse, rippleA, rippleB, sheen]);

  /**
   * The tap. A 220ms flare goes out from under the thumb and the screen leaves
   * on the tail of it, so the founder arrives out of the member's own action
   * instead of replacing it.
   */
  const reveal = useCallback(() => {
    if (finished.current) return;
    if (reduceMotion.current) {
      finish();
      return;
    }
    Animated.sequence([
      Animated.timing(burst, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(finish);
  }, [burst, finish]);

  if (!show) return null;

  const catStyle = {
    opacity: entrance,
    transform: [
      { perspective: 1000 },
      { rotateY: entrance.interpolate({ inputRange: [0, 1], outputRange: ['-38deg', '0deg'] }) },
      // a slow, searching lean — the head is working
      { rotateZ: think.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] }) },
      { translateY: think.interpolate({ inputRange: [0, 1], outputRange: [4, -6] }) },
      { scale: think.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1.02] }) },
    ],
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={finish}>
      <Animated.View
        testID="weekly-thinking"
        style={[styles.root, { opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
      >
        <TouchableOpacity activeOpacity={1} style={styles.root} onPress={finish} accessibilityLabel={WEEKLY_REVEAL_VOICE.skip}>
          <View style={styles.stage}>
            {/* Three halo rings in a tilted 3D plane — the cat is inside a decision. */}
            {Array.from({ length: RING_COUNT }).map((_, ring) => (
              <Animated.View
                key={`ring-${ring}`}
                style={[
                  styles.ring,
                  {
                    width: CAT_WIDTH * (1.15 + ring * 0.34),
                    height: CAT_WIDTH * (1.15 + ring * 0.34),
                    borderRadius: CAT_WIDTH,
                    transform: [
                      { perspective: 900 },
                      { rotateX: `${68 + ring * 4}deg` },
                      {
                        rotate: spin.interpolate({
                          inputRange: [0, 1],
                          outputRange: ring % 2 === 0 ? ['0deg', '360deg'] : ['360deg', '0deg'],
                        }),
                      },
                    ],
                    opacity: 0.5 - ring * 0.11,
                  },
                ]}
              >
                {Array.from({ length: DOTS }).map((__, dot) => (
                  <View
                    key={`dot-${ring}-${dot}`}
                    style={[
                      styles.dot,
                      {
                        left: `${50 + 48 * Math.cos((dot / DOTS) * Math.PI * 2)}%`,
                        top: `${50 + 48 * Math.sin((dot / DOTS) * Math.PI * 2)}%`,
                      },
                    ]}
                  />
                ))}
              </Animated.View>
            ))}

            <Animated.Image testID="weekly-thinking-cat" source={CAT} resizeMode="contain" style={[styles.cat, catStyle]} />

            {/* The thought dots that say "it is working on something". */}
            <View style={styles.thoughts}>
              {[0, 1, 2].map((dot) => (
                <Animated.View
                  key={`thought-${dot}`}
                  style={[
                    styles.thoughtDot,
                    {
                      opacity: think.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: dot === 0 ? [0.9, 0.4, 0.9] : dot === 1 ? [0.5, 0.9, 0.5] : [0.35, 0.8, 0.35],
                      }),
                    },
                  ]}
                />
              ))}
            </View>

            <View style={styles.lines}>
              {lines.map((line, index) => (
                <Animated.Text
                  key={`${index}-${line}`}
                  testID={`weekly-thinking-line-${index}`}
                  style={[
                    styles.line,
                    index === 0 && styles.firstLine,
                    index === lines.length - 1 && styles.lastLine,
                    beat >= index
                      ? {
                          opacity: lineAnims[index],
                          transform: [{ translateY: lineAnims[index].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
                        }
                      : { opacity: 0 },
                  ]}
                >
                  {line}
                </Animated.Text>
              ))}
            </View>

            <Text testID="weekly-thinking-status" style={styles.status}>
              {String(status[Math.min(beat, status.length - 1)]).toUpperCase()}
            </Text>

            {/* TAP TO REVEAL. The one decision the member gets to make with their
                own thumb: the founder appears when they say so, not when a timer
                says so. The glow ring under it pulses; the button lifts a pixel
                on the beat so it reads as alive without being a carnival. */}
            {armed ? (
              <Animated.View
                style={[
                  styles.revealWrap,
                  {
                    opacity: entrance,
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] }) }],
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.revealGlow,
                    {
                      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.36] }),
                      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }) }],
                    },
                  ]}
                />
                {/* Two rings, half a beat apart, walking outwards and dying. */}
                {[rippleA, rippleB].map((ring, index) => (
                  <Animated.View
                    key={`halo-${index}`}
                    pointerEvents="none"
                    style={[
                      styles.revealHalo,
                      {
                        opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.34, 0] }),
                        transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.85] }) }],
                      },
                    ]}
                  />
                ))}
                {/* The flare the thumb sets off. */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.revealBurst,
                    {
                      opacity: burst.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                      transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
                    },
                  ]}
                />
                <TouchableOpacity
                  testID="weekly-reveal-tap"
                  accessibilityRole="button"
                  accessibilityLabel="Tap to reveal your founder"
                  activeOpacity={0.9}
                  onPress={reveal}
                  style={styles.revealBtn}
                >
                  {/* A soft band of light, not a grey slab: the gradient means
                      both edges of the glint fall off instead of ending. */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.revealSheen,
                      { transform: [{ translateX: sheen.interpolate({ inputRange: [0, 1], outputRange: [-120, 190] }) }] },
                    ]}
                  >
                    <Svg width={SHEEN_WIDTH} height={60}>
                      <Defs>
                        <LinearGradient id="revealSheen" x1="0" y1="0" x2="1" y2="0">
                          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                          <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.22" />
                          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                        </LinearGradient>
                      </Defs>
                      <Rect x={0} y={0} width={SHEEN_WIDTH} height={60} fill="url(#revealSheen)" />
                    </Svg>
                  </Animated.View>
                  <Text style={styles.revealText}>TAP TO REVEAL YOUR FOUNDER</Text>
                  <Animated.View
                    style={{
                      transform: [{ translateY: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 3] }) }],
                    }}
                  >
                    <ArrowDown size={17} color="#FBE618" />
                  </Animated.View>
                </TouchableOpacity>
              </Animated.View>
            ) : null}
          </View>

          <Text style={styles.skip}>{armed ? 'or wait — they appear on their own' : WEEKLY_REVEAL_VOICE.skip}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FBE618' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(10,11,13,0.16)' },
  dot: {
    position: 'absolute',
    width: 5,
    height: 5,
    marginLeft: -2.5,
    marginTop: -2.5,
    borderRadius: 3,
    backgroundColor: 'rgba(10,11,13,0.5)',
  },
  cat: { width: CAT_WIDTH, height: CAT_WIDTH / CAT_ASPECT },
  thoughts: { flexDirection: 'row', gap: 6, marginTop: 2, marginBottom: 4 },
  thoughtDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(10,11,13,0.55)' },
  lines: { marginTop: 8, gap: 9, alignItems: 'center', minHeight: 132 },
  line: { fontSize: 15.5, lineHeight: 22, fontWeight: '700', color: 'rgba(10,11,13,0.68)', textAlign: 'center', maxWidth: 330 },
  firstLine: { fontSize: 26, lineHeight: 32, fontWeight: '900', letterSpacing: -0.4, color: '#0A0B0D' },
  lastLine: { fontSize: 17.5, lineHeight: 24, fontWeight: '900', color: '#0A0B0D' },
  status: {
    marginTop: 14,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 2.2,
    color: 'rgba(10,11,13,0.55)',
  },
  revealWrap: {
    marginTop: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealGlow: {
    position: 'absolute',
    width: 268,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#0A0B0D',
  },
  // Ink rings on gold: they read outwards from the pill without adding a colour.
  revealHalo: {
    position: 'absolute',
    width: 268,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: 'rgba(10,11,13,0.55)',
  },
  revealBurst: {
    position: 'absolute',
    width: 268,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#0A0B0D',
  },
  // Ink on gold: the only dark button in a full-gold screen, so the eye lands here.
  revealBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingHorizontal: 22,
    paddingVertical: 15,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#0A0B0D',
  },
  // The glint itself has no fill — the SVG inside it is the gradient — so it
  // reads as light crossing the pill rather than a pale rectangle sliding over it.
  revealSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SHEEN_WIDTH,
  },
  revealText: {
    color: '#FBE618',
    fontSize: 12.5,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  skip: {
    textAlign: 'center',
    paddingBottom: 44,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(10,11,13,0.5)',
  },
});
