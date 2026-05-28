import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { ChevronLeft, Heart, Lightbulb, MessageSquare, RefreshCw, X, Zap } from 'lucide-react-native';
import { db } from '../lib/firebase';
import { ensureDirectMatch } from '../lib/chat';
import { displayNameFor, isDiscoverableProfile } from '../lib/discovery';
import { collectIdeaDeck, IdeaDeckItem } from '../lib/ideas';
import { demoBuilders } from '../lib/demoBuilders';
import { UserProfile } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import VerifiedBadge from '../components/VerifiedBadge';

const USE_NATIVE_DRIVER = Platform.OS !== 'web';
const SWIPE_DISTANCE = 140;

export default function IdeaDeckScreen({ navigation }: any) {
  const { user, profile: myProfile } = useAuth();
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  const isDark = theme === 'dark';
  const [ideas, setIdeas] = useState<IdeaDeckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const swipedIdeasRef = useRef<Set<string>>(new Set());
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const animateSwipeRef = useRef<(direction: 'left' | 'right') => void>(() => {});
  const completeSwipeRef = useRef<(direction: 'left' | 'right') => void>(() => {});

  const topIdea = ideas[0];
  const nextIdea = ideas[1];
  const cardWidth = Math.min(Math.max(width - 28, 320), 720);
  const cardHeight = Math.min(Math.max(height * 0.62, 500), 660);

  const rotate = position.x.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ['-11deg', '0deg', '11deg'],
    extrapolate: 'clamp',
  });
  const nextScale = position.x.interpolate({
    inputRange: [-SWIPE_DISTANCE, 0, SWIPE_DISTANCE],
    outputRange: [1, 0.94, 1],
    extrapolate: 'clamp',
  });
  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const skipOpacity = position.x.interpolate({
    inputRange: [-SWIPE_DISTANCE, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_evt, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy * 0.08 });
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx > SWIPE_DISTANCE) animateSwipeRef.current('right');
        else if (gesture.dx < -SWIPE_DISTANCE) animateSwipeRef.current('left');
        else Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: USE_NATIVE_DRIVER, tension: 80, friction: 9 }).start();
      },
    })
  ).current;

  useEffect(() => {
    if (!user?.uid) {
      setIdeas([]);
      setLoading(false);
      return;
    }

    const instantIdeas = collectIdeaDeck(demoBuilders as UserProfile[], user.uid);
    setIdeas(instantIdeas);
    setLoading(false);

    const usersQuery = query(
      collection(db, 'users'),
      where('isVisible', '==', true),
      where('isStealthMode', '==', false),
      limit(80)
    );

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const users = snapshot.docs
          .map((snap) => snap.data() as UserProfile)
          .filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        const merged = [...users, ...demoBuilders].filter(
          (profile, index, list) => list.findIndex((item) => item.uid === profile.uid) === index
        );
        const deck = collectIdeaDeck(merged as UserProfile[], user.uid).filter((idea) => !swipedIdeasRef.current.has(idea.id));
        setIdeas(deck);
      },
      (error) => {
        console.warn('Ideas deck unavailable:', error);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  const notify = async (payload: Record<string, any>) => {
    try {
      await addDoc(collection(db, 'notifications'), {
        isRead: false,
        timestamp: serverTimestamp(),
        ...payload,
      });
    } catch {
      // Notifications should never block the idea match.
    }
  };

  const likeIdea = async (idea: IdeaDeckItem) => {
    if (!user?.uid || !idea?.id) return;
    const swipeId = `${idea.id}_${user.uid}`;
    const myName = displayNameFor(myProfile || user);
    const myPic = myProfile?.profilePic || user.photoURL || '';

    await setDoc(
      doc(db, 'ideaSwipes', swipeId),
      {
        ideaId: idea.id,
        ideaOwnerId: idea.ownerId,
        ideaTitle: idea.title,
        swiperId: user.uid,
        swiperName: myName,
        swiperPic: myPic,
        direction: 'right',
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    const previousSwipes = await getDocs(query(collection(db, 'ideaSwipes'), where('ideaId', '==', idea.id), limit(12)));
    const partnerDoc = previousSwipes.docs
      .map((snap) => snap.data() as any)
      .find((swipe) => swipe.swiperId && swipe.swiperId !== user.uid && swipe.swiperId !== idea.ownerId);

    if (partnerDoc?.swiperId) {
      const matchId = await ensureDirectMatch(user.uid, partnerDoc.swiperId);
      const partnerSnap = await getDoc(doc(db, 'users', partnerDoc.swiperId)).catch(() => null);
      const partnerProfile = partnerSnap?.exists() ? ({ ...partnerSnap.data(), uid: partnerSnap.id } as UserProfile) : null;
      await notify({
        userId: partnerDoc.swiperId,
        fromId: user.uid,
        fromName: myName,
        fromPic: myPic,
        type: 'match',
        matchId,
        content: `You both liked "${idea.title}".`,
      });
      await notify({
        userId: user.uid,
        fromId: partnerDoc.swiperId,
        fromName: partnerProfile ? displayNameFor(partnerProfile) : partnerDoc.swiperName || 'Builder',
        fromPic: partnerProfile?.profilePic || partnerDoc.swiperPic || '',
        type: 'match',
        matchId,
        content: `You both liked "${idea.title}".`,
      });
      Alert.alert('Idea match', `You and ${partnerProfile ? displayNameFor(partnerProfile) : partnerDoc.swiperName || 'a builder'} both want to build around "${idea.title}".`, [
        { text: 'Keep swiping', style: 'cancel' },
        { text: 'Open chat', onPress: () => navigation.navigate('Chat', { matchId, otherUser: partnerProfile || { uid: partnerDoc.swiperId, displayName: partnerDoc.swiperName } }) },
      ]);
      return;
    }

    await notify({
      userId: idea.ownerId,
      fromId: user.uid,
      fromName: myName,
      fromPic: myPic,
      type: 'like',
      content: `${myName} liked your idea: "${idea.title}".`,
    });
  };

  const completeSwipe = async (direction: 'left' | 'right') => {
    const idea = ideas[0];
    if (!idea || busy) return;
    swipedIdeasRef.current.add(idea.id);
    setIdeas((current) => current.slice(1));
    position.setValue({ x: 0, y: 0 });
    if (direction !== 'right') return;
    setBusy(true);
    try {
      await likeIdea(idea);
    } catch (error: any) {
      console.warn('Idea like failed:', error);
      Alert.alert('Idea swipe failed', error?.message || 'Could not save this idea swipe. Deploy the latest Firestore rules and try again.');
    } finally {
      setBusy(false);
    }
  };

  const animateSwipe = (direction: 'left' | 'right') => {
    Animated.timing(position, {
      toValue: { x: direction === 'right' ? width + 220 : -width - 220, y: 18 },
      duration: 230,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(() => completeSwipeRef.current(direction));
  };

  useEffect(() => {
    animateSwipeRef.current = animateSwipe;
    completeSwipeRef.current = completeSwipe;
  }, [animateSwipe, completeSwipe]);

  const renderIdeaCard = (idea: IdeaDeckItem, isPreview = false) => (
    <Animated.View
      key={idea.id}
      style={[
        styles.card,
        {
          width: cardWidth,
          minHeight: cardHeight,
          backgroundColor: isDark ? '#101014' : '#FFFFFF',
          borderColor: isDark ? '#25252A' : '#E5E7EB',
        },
        isPreview
          ? { transform: [{ scale: nextScale }], opacity: 0.58 }
          : { transform: [...position.getTranslateTransform(), { rotate }] },
      ]}
      {...(!isPreview ? panResponder.panHandlers : {})}
    >
      {!isPreview && (
        <>
          <Animated.View style={[styles.swipeBadge, styles.likeBadge, { opacity: likeOpacity }]}>
            <Text style={styles.likeBadgeText}>BUILD</Text>
          </Animated.View>
          <Animated.View style={[styles.swipeBadge, styles.skipBadge, { opacity: skipOpacity }]}>
            <Text style={styles.skipBadgeText}>PASS</Text>
          </Animated.View>
        </>
      )}

      <View style={styles.cardGlow} />
      <View style={styles.cardHeader}>
        <View style={styles.ideaIcon}>
          <Lightbulb size={24} color="#000" fill="#00000012" />
        </View>
        <View style={styles.sourcePill}>
          <Text style={styles.sourceText}>TINDER FOR IDEAS</Text>
        </View>
      </View>

      <Text style={[styles.ideaTitle, { color: isDark ? '#FFF' : '#000' }]}>{idea.title}</Text>
      <Text style={[styles.ideaDescription, { color: isDark ? '#D4D4D8' : '#333' }]}>{idea.description}</Text>

      <View style={styles.signalGrid}>
        <View style={[styles.signalCard, { backgroundColor: isDark ? '#17171C' : '#F8FAFC' }]}>
          <Text style={styles.signalLabel}>STAGE</Text>
          <Text style={[styles.signalValue, { color: isDark ? '#FFF' : '#000' }]}>{idea.stage || 'Idea Stage'}</Text>
        </View>
        <View style={[styles.signalCard, { backgroundColor: isDark ? '#17171C' : '#F8FAFC' }]}>
          <Text style={styles.signalLabel}>LOOKING FOR</Text>
          <Text style={[styles.signalValue, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={2}>
            {(idea.lookingFor || []).slice(0, 3).join(', ') || 'Builders'}
          </Text>
        </View>
      </View>

      <View style={styles.tagsRow}>
        {(idea.tags || []).slice(0, 6).map((tag) => (
          <View key={`${idea.id}-${tag}`} style={styles.tagPill}>
            <Text style={styles.tagText}>{String(tag).toUpperCase()}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.ownerCard, { backgroundColor: isDark ? '#17171C' : '#F8F8F8' }]}>
        <Image source={{ uri: idea.ownerPic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }} style={styles.ownerPic} />
        <View style={{ flex: 1 }}>
          <View style={styles.ownerNameRow}>
            <Text style={[styles.ownerName, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
              {idea.ownerName}
            </Text>
            {idea.ownerVerified ? <VerifiedBadge size={18} /> : null}
          </View>
          <Text style={styles.ownerMeta} numberOfLines={1}>
            {[idea.ownerOccupation || 'Builder', [idea.ownerCity, idea.ownerCountry].filter(Boolean).join(', ')].filter(Boolean).join(' • ')}
          </Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: idea.ownerId })} style={styles.profileBtn}>
          <Text style={styles.profileBtnText}>VIEW</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.headerBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
          <ChevronLeft size={22} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>IDEAS</Text>
          <Text style={styles.headerSub}>Swipe ideas. Match on intent.</Text>
        </View>
        <View style={styles.headerBtnGhost} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FBE618" />
        </View>
      ) : topIdea ? (
        <View style={styles.deckWrap}>
          {nextIdea ? <View style={styles.previewLayer}>{renderIdeaCard(nextIdea, true)}</View> : null}
          <View style={styles.topLayer}>{renderIdeaCard(topIdea)}</View>
          <View style={styles.actionRow}>
            <TouchableOpacity onPress={() => animateSwipe('left')} style={styles.actionBtn}>
              <X size={30} color="#FF4D4D" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => animateSwipe('right')} style={[styles.actionBtn, styles.likeBtn]} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Heart size={36} color="#FFF" fill="#FFF" />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIdeas((current) => (current.length > 1 ? [...current.slice(1), current[0]] : current))} style={styles.actionBtn}>
              <RefreshCw size={30} color="#A1A1AA" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          <Zap size={48} color="#FBE618" fill="#FBE618" />
          <Text style={[styles.emptyTitle, { color: isDark ? '#FFF' : '#000' }]}>NO IDEAS YET</Text>
          <Text style={styles.emptyText}>Post an idea from your profile so builders can swipe into it.</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Profile', { userId: user?.uid })} style={styles.emptyButton}>
            <MessageSquare size={16} color="#000" />
            <Text style={styles.emptyButtonText}>ADD AN IDEA</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 74,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnGhost: { width: 44, height: 44 },
  headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 4 },
  headerSub: { marginTop: 4, color: '#666', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deckWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 112 },
  previewLayer: { position: 'absolute', top: 36, zIndex: 1 },
  topLayer: { zIndex: 2 },
  card: {
    borderWidth: 1,
    borderRadius: 36,
    overflow: 'hidden',
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  cardGlow: {
    position: 'absolute',
    right: -70,
    top: -70,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: '#FBE61830',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  ideaIcon: {
    width: 54,
    height: 54,
    borderRadius: 20,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourcePill: { borderRadius: 999, backgroundColor: '#2563EB', paddingHorizontal: 12, paddingVertical: 7 },
  sourceText: { color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  ideaTitle: { marginTop: 36, fontSize: 34, lineHeight: 40, fontWeight: '900', fontStyle: 'italic', textTransform: 'uppercase' },
  ideaDescription: { marginTop: 16, fontSize: 16, lineHeight: 24, fontWeight: '800' },
  signalGrid: { flexDirection: 'row', gap: 10, marginTop: 22 },
  signalCard: { flex: 1, borderRadius: 18, padding: 14 },
  signalLabel: { fontSize: 8, fontWeight: '900', letterSpacing: 1.4, color: '#777' },
  signalValue: { marginTop: 6, fontSize: 12, fontWeight: '900' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  tagPill: { borderRadius: 999, backgroundColor: '#FBE61818', borderWidth: 1, borderColor: '#FBE61844', paddingHorizontal: 10, paddingVertical: 7 },
  tagText: { fontSize: 9, fontWeight: '900', color: '#8A7900', letterSpacing: 0.9 },
  ownerCard: { marginTop: 'auto', borderRadius: 22, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ownerPic: { width: 48, height: 48, borderRadius: 18 },
  ownerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ownerName: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase', flexShrink: 1 },
  ownerMeta: { marginTop: 3, fontSize: 10, fontWeight: '800', color: '#777' },
  profileBtn: { height: 38, borderRadius: 14, backgroundColor: '#FBE618', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  profileBtnText: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, color: '#000' },
  swipeBadge: { position: 'absolute', top: 24, zIndex: 4, borderWidth: 4, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.32)' },
  likeBadge: { right: 22, borderColor: '#22C55E' },
  skipBadge: { left: 22, borderColor: '#FF4D4D' },
  likeBadgeText: { color: '#22C55E', fontSize: 28, fontWeight: '900' },
  skipBadgeText: { color: '#FF4D4D', fontSize: 28, fontWeight: '900' },
  actionRow: { position: 'absolute', bottom: 24, left: 0, right: 0, zIndex: 5, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24 },
  actionBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#111217', alignItems: 'center', justifyContent: 'center' },
  likeBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#2563EB', shadowColor: '#2563EB', shadowOpacity: 0.24, shadowRadius: 18, elevation: 8 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emptyTitle: { marginTop: 14, fontSize: 24, fontWeight: '900', fontStyle: 'italic' },
  emptyText: { marginTop: 8, maxWidth: 340, textAlign: 'center', color: '#666', fontSize: 13, lineHeight: 20, fontWeight: '800' },
  emptyButton: { marginTop: 18, height: 52, borderRadius: 18, backgroundColor: '#FBE618', paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyButtonText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: '#000' },
});
