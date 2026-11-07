import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

/**
 * THE LINKUP CAT — ALIVE.
 *
 * This is the mascot as a character, not a photograph. Nothing about it is a
 * still image: every frame is drawn from vectors, and the drawing itself moves.
 *
 *   breathing   the whole cat rises and settles, twice a second and a bit
 *   blinking    a real blink every few seconds, and an occasional double blink
 *   ears        each ear flicks on its own hinge
 *   tail        swishes continuously, slower than the breathing
 *   eyes        pupils drift and glance, and go wide on the beat
 *   meow        opens its mouth and lets out a spark when the chime hits
 *
 * Every layer is a full-viewBox SVG stacked in one square, so each part can be
 * animated independently while staying pixel-aligned with the others. Layers
 * that only move (transform/opacity) use the native driver; the cat is cheap
 * enough to sit on top of a cold start without stealing frames from the app.
 */

const GOLD = '#FBE618';
const GOLD_EDGE = '#E7C400';
const INK = '#0A0B0D';
const PINK = '#F4738C';
const CREAM = '#FFFDF2';
const MOUTH = '#3B1A22';

const VIEW = 200;

type Props = {
  size?: number;
  /** Set false for reduced-motion: the cat stays awake but calm. */
  alive?: boolean;
  /** Milliseconds after mount for the meow + spark, tuned to the chime's hit. */
  beatAt?: number;
  style?: any;
};

function Layer({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <Animated.View style={[styles.layer, style]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
        {children}
      </Svg>
    </Animated.View>
  );
}

export default function LinkyCatAlive({ size = 168, alive = true, beatAt = 900, style }: Props) {
  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const earLeft = useRef(new Animated.Value(0)).current;
  const earRight = useRef(new Animated.Value(0)).current;
  const tail = useRef(new Animated.Value(0)).current;
  const glance = useRef(new Animated.Value(0)).current;
  const meow = useRef(new Animated.Value(0)).current;
  const spark = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!alive) return;
    const loops: Animated.CompositeAnimation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    loops.push(Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 840, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ])));

    // A blink is 90ms closed / 110ms open. Two of them, then a long gap: that
    // irregularity is what stops it reading as a machine.
    loops.push(Animated.loop(Animated.sequence([
      Animated.delay(2300),
      Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: false }),
      Animated.timing(blink, { toValue: 0, duration: 110, useNativeDriver: false }),
      Animated.delay(160),
      Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: false }),
      Animated.timing(blink, { toValue: 0, duration: 130, useNativeDriver: false }),
      Animated.delay(3400),
    ])));

    const flick = (value: Animated.Value, to: number) => Animated.sequence([
      Animated.timing(value, { toValue: to, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    loops.push(Animated.loop(Animated.sequence([
      Animated.delay(1500), flick(earLeft, -1), Animated.delay(900), flick(earRight, 1), Animated.delay(2600),
    ])));

    loops.push(Animated.loop(Animated.sequence([
      Animated.timing(tail, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(tail, { toValue: -1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])));

    loops.push(Animated.loop(Animated.sequence([
      Animated.delay(1700),
      Animated.timing(glance, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(glance, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(2100),
    ])));

    loops.forEach((loop) => loop.start());

    // The beat: right where the chime lands, the cat meows and sparks.
    timers.push(setTimeout(() => {
      Animated.sequence([
        Animated.timing(meow, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.delay(360),
        Animated.timing(meow, { toValue: 0, duration: 240, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]).start();
      Animated.sequence([
        Animated.timing(spark, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(spark, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }, beatAt));

    return () => {
      loops.forEach((loop) => { loop.stop(); });
      timers.forEach(clearTimeout);
    };
  }, [alive, beatAt, blink, breathe, earLeft, earRight, glance, meow, spark, tail]);

  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.028] });
  const earLeftDeg = earLeft.interpolate({ inputRange: [-1, 0], outputRange: ['-13deg', '0deg'] });
  const earRightDeg = earRight.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '13deg'] });
  const tailDeg = tail.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] });
  const glanceX = glance.interpolate({ inputRange: [0, 1], outputRange: [0, 3.4] });
  const eyesOpen = blink.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const eyesClosed = blink.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const meowOpacity = meow.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const meowScale = meow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const sparkOpacity = spark.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const sparkScale = spark.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.25] });

  return (
    <View style={[{ width: size, height: size }, style]} accessibilityLabel="The LINKUP cat, awake and blinking">
      <Animated.View
        style={[
          styles.layer,
          alive && { transform: [{ scale: breatheScale }] },
        ]}
        pointerEvents="none"
      >
        {/* TAIL — behind the body, hinged at its base */}
        <Animated.View
          style={[styles.layer, {
            transformOrigin: '74% 76%',
            transform: [{ rotate: alive ? tailDeg : '0deg' }],
          }]}
        >
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
            <Path d="M148 148 Q188 150 186 116 Q184 96 166 94" stroke={INK} strokeWidth={19} strokeLinecap="round" fill="none" />
            <Path d="M148 148 Q188 150 186 116 Q184 96 166 94" stroke={GOLD} strokeWidth={13} strokeLinecap="round" fill="none" />
            <Circle cx={166} cy={94} r={9} fill={GOLD} stroke={INK} strokeWidth={4.5} />
          </Svg>
        </Animated.View>

        {/* EARS — each on its own hinge so they flick separately */}
        <Animated.View style={[styles.layer, { transformOrigin: '30% 26%', transform: [{ rotate: alive ? earLeftDeg : '0deg' }] }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
            <Path d="M46 78 L40 26 L94 52" fill={GOLD} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            <Path d="M55 66 L52 39 L80 52" fill={PINK} stroke="none" />
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.layer, { transformOrigin: '70% 26%', transform: [{ rotate: alive ? earRightDeg : '0deg' }] }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
            <Path d="M154 78 L160 26 L106 52" fill={GOLD} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
            <Path d="M145 66 L148 39 L120 52" fill={PINK} stroke="none" />
          </Svg>
        </Animated.View>

        {/* PAWS */}
        <Layer>
          <Rect x={74} y={148} width={22} height={20} rx={10} fill={GOLD} stroke={INK} strokeWidth={5} />
          <Rect x={104} y={148} width={22} height={20} rx={10} fill={GOLD} stroke={INK} strokeWidth={5} />
        </Layer>

        {/* HEAD, MUZZLE, WHISKERS */}
        <Layer>
          <Ellipse cx={100} cy={104} rx={63} ry={55} fill={GOLD} stroke={INK} strokeWidth={6} />
          <Ellipse cx={62} cy={126} rx={11} ry={7} fill={PINK} opacity={0.26} />
          <Ellipse cx={138} cy={126} rx={11} ry={7} fill={PINK} opacity={0.26} />
          <Ellipse cx={100} cy={133} rx={25} ry={16} fill={CREAM} />
          <Path d="M92 125 Q100 121 108 125 Q104 134 100 134 Q96 134 92 125 Z" fill={PINK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
          <Path d="M100 134 Q100 142 92 144" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M100 134 Q100 142 108 144" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M74 128 L36 120 M74 136 L34 138" stroke={INK} strokeWidth={3} strokeLinecap="round" opacity={0.75} />
          <Path d="M126 128 L164 120 M126 136 L166 138" stroke={INK} strokeWidth={3} strokeLinecap="round" opacity={0.75} />
        </Layer>

        {/* EYES OPEN (with pupils + glints) */}
        <Animated.View style={[styles.layer, { opacity: eyesOpen }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
            <Ellipse cx={78} cy={100} rx={16} ry={18} fill={CREAM} stroke={INK} strokeWidth={4} />
            <Ellipse cx={122} cy={100} rx={16} ry={18} fill={CREAM} stroke={INK} strokeWidth={4} />
          </Svg>
          <Animated.View style={[styles.layer, { transform: [{ translateX: alive ? glanceX : 0 }] }]}>
            <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
              <Circle cx={79} cy={101} r={8.5} fill={INK} />
              <Circle cx={121} cy={101} r={8.5} fill={INK} />
              <Circle cx={75.5} cy={96} r={3.1} fill="#FFFFFF" />
              <Circle cx={117.5} cy={96} r={3.1} fill="#FFFFFF" />
            </Svg>
          </Animated.View>
        </Animated.View>

        {/* EYES CLOSED — a blink is a cross-fade, not a squash */}
        <Animated.View style={[styles.layer, { opacity: eyesClosed }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
            <Path d="M62 100 Q78 112 94 100" stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />
            <Path d="M106 100 Q122 112 138 100" stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />
          </Svg>
        </Animated.View>

        {/* MEOW — opens on the chime's hit */}
        <Animated.View style={[styles.layer, { opacity: meowOpacity, transform: [{ scale: meowScale }] }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
            <Ellipse cx={100} cy={145} rx={9.5} ry={11} fill={MOUTH} stroke={INK} strokeWidth={3} />
            <Ellipse cx={100} cy={150} rx={5.5} ry={4} fill={PINK} />
          </Svg>
        </Animated.View>

        {/* SPARK — one gold burst, emitted with the meow */}
        <Animated.View style={[styles.layer, { opacity: sparkOpacity, transform: [{ scale: sparkScale }] }]}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW} ${VIEW}`}>
            <Path d="M32 62 L36 74 L48 78 L36 82 L32 94 L28 82 L16 78 L28 74 Z" fill={GOLD} opacity={0.95} />
            <Path d="M170 58 L173 67 L182 70 L173 73 L170 82 L167 73 L158 70 L167 67 Z" fill={GOLD} opacity={0.8} />
            <Circle cx={100} cy={18} r={4} fill={GOLD} opacity={0.7} />
            <Circle cx={20} cy={140} r={3.2} fill={GOLD} opacity={0.6} />
            <Circle cx={182} cy={132} r={3.6} fill={GOLD} opacity={0.55} />
          </Svg>
        </Animated.View>

        {/* RIM LIGHT — keeps the gold edge reading against the dark stage */}
        <Layer>
          <Ellipse cx={100} cy={104} rx={63} ry={55} fill="none" stroke={GOLD_EDGE} strokeWidth={1.5} opacity={0.55} />
        </Layer>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
