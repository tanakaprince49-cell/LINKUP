import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { buildFacts, LINKY_VOICE, type VoiceProfile } from '../lib/brandVoice';

/**
 * LINKY · THE CAT THAT KNOWS YOU
 *
 * Opening the Linky page is the beginning of a conversation, not a form. So
 * before the thread appears, the cat does: it swings in on a 3D hinge, says the
 * member's first name, says what they are building — which it already knows,
 * because onboarding asked — and promises the thing they came for: the
 * teammates who finish the build, inside three minutes.
 *
 * Silent by design. The launch screen has no sound and neither does this: the
 * only thing that speaks is the copy, and it speaks to one person by name.
 *
 * The shell is the same proven shell as the cold open — a transparent Modal
 * with a fully sized `flex: 1` surface, so nothing on the page beneath can
 * clip it or paint over it.
 */

const CAT = require('../../assets/launch-cat.png');
const CAT_ASPECT = 820 / 538;
const CAT_WIDTH = 240;

const LINE_AT = [700, 1750, 2800] as const;
const EXIT_AT = 3900;
const EXIT_MS = 320;
const REDUCED_EXIT_AT = 2000;

type Props = {
  profile: VoiceProfile;
  visible: boolean;
  onDone: () => void;
};

export default function LinkyCatIntro({ profile, visible, onDone }: Props) {
  const facts = useMemo(() => buildFacts(profile), [profile]);
  const lines = useMemo(() => LINKY_VOICE.introLines(facts), [facts]);

  const [show, setShow] = useState(visible);
  const [visibleLines, setVisibleLines] = useState(0);
  const entrance = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const lineAnims = useRef(lines.map(() => new Animated.Value(0))).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
      setVisibleLines(0);
      lineAnims.forEach((anim) => anim.setValue(0));
    }
  }, [visible, lineAnims]);

  const finish = useCallback(() => {
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

  // The cat arrives first: a 3D hinge from below, then the three lines land one
  // at a time so each one is actually read.
  useEffect(() => {
    if (!show) return;
    const reduced = Platform.OS === 'web'
      ? typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      : false;
    reduceMotion.current = reduced;

    if (reduced) {
      entrance.setValue(1);
      lineAnims.forEach((anim) => anim.setValue(1));
      setVisibleLines(lines.length);
      const t = setTimeout(finish, REDUCED_EXIT_AT);
      return () => clearTimeout(t);
    }

    Animated.timing(entrance, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();

    const timers = LINE_AT.slice(0, lines.length).map((at, index) =>
      setTimeout(() => {
        setVisibleLines(index + 1);
        Animated.timing(lineAnims[index], {
          toValue: 1,
          duration: 340,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }, at)
    );
    timers.push(setTimeout(finish, EXIT_AT));
    return () => timers.forEach(clearTimeout);
  }, [show, lines.length, entrance, lineAnims, finish]);

  if (!show) return null;

  const catStyle = {
    opacity: entrance,
    transform: [
      { perspective: 1000 },
      { rotateY: entrance.interpolate({ inputRange: [0, 1], outputRange: ['-64deg', '0deg'] }) },
      { rotateX: entrance.interpolate({ inputRange: [0, 1], outputRange: ['18deg', '0deg'] }) },
      { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [46, 0] }) },
      { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
    ],
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={finish}>
      <Animated.View
        testID="linky-cat-intro"
        style={[styles.root, { opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
      >
        <TouchableOpacity activeOpacity={1} style={styles.root} onPress={finish} accessibilityLabel={LINKY_VOICE.skip}>
          <View style={styles.stage}>
            <View style={styles.halo} />
            <Animated.Image
              testID="linky-cat-intro-cat"
              source={CAT}
              resizeMode="contain"
              style={[styles.cat, catStyle]}
            />

            <View style={styles.lines}>
              {lines.map((line, index) => {
                const anim = lineAnims[index];
                const isName = index === 0;
                const isPromise = index === lines.length - 1;
                return (
                  <Animated.Text
                    key={`${index}-${line}`}
                    testID={`linky-cat-intro-line-${index}`}
                    style={[
                      styles.line,
                      isName && styles.nameLine,
                      isPromise && styles.promiseLine,
                      visibleLines > index
                        ? {
                            opacity: anim,
                            transform: [
                              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
                            ],
                          }
                        : { opacity: 0 },
                    ]}
                  >
                    {line}
                  </Animated.Text>
                );
              })}
            </View>
          </View>

          <Text style={styles.skip}>{LINKY_VOICE.skip}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FBE618' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  halo: {
    position: 'absolute',
    width: CAT_WIDTH * 1.5,
    height: CAT_WIDTH * 1.5,
    borderRadius: CAT_WIDTH,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  cat: { width: CAT_WIDTH, height: CAT_WIDTH / CAT_ASPECT },
  lines: { marginTop: 26, gap: 12, alignItems: 'center', minHeight: 150, justifyContent: 'flex-start' },
  line: {
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '700',
    color: '#0A0B0D',
    textAlign: 'center',
    maxWidth: 340,
  },
  nameLine: { fontSize: 30, lineHeight: 38, fontWeight: '900', letterSpacing: -0.5 },
  promiseLine: { fontWeight: '900', fontSize: 20 },
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
