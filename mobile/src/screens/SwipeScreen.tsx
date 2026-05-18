import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, SafeAreaView, ActivityIndicator, Dimensions, Animated, PanResponder, ScrollView } from 'react-native';
import { collection, query, onSnapshot, where, addDoc, updateDoc, doc, arrayUnion, limit, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { rankCandidatesWithAI } from '../lib/matchmaking';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { X, Heart, Zap, RotateCcw, Target, ChevronDown, ChevronLeft } from 'lucide-react-native';

const { width, height } = Dimensions.get('window');
const SWIPE_THRESHOLD = 0.25 * width;

export default function SwipeScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [aiOrderingDone, setAiOrderingDone] = useState(false);

  const position = useRef(new Animated.ValueXY()).current;

  const rotate = position.x.interpolate({
    inputRange: [-width / 2, 0, width / 2],
    outputRange: ['-10deg', '0deg', '10deg'],
    extrapolate: 'clamp'
  });

  const nextCardScale = position.x.interpolate({
    inputRange: [-width / 2, 0, width / 2],
    outputRange: [1, 0.9, 1],
    extrapolate: 'clamp'
  });

  const nextCardOpacity = position.x.interpolate({
    inputRange: [-width / 2, 0, width / 2],
    outputRange: [1, 0.5, 1],
    extrapolate: 'clamp'
  });

  const likeOpacity = position.x.interpolate({
    inputRange: [0, width / 4],
    outputRange: [0, 1],
    extrapolate: 'clamp'
  });

  const nopeOpacity = position.x.interpolate({
    inputRange: [-width / 4, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp'
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (evt, gestureState) => {
        // Only take over if the user is swiping horizontally significantly
        return Math.abs(gestureState.dx) > 10;
      },
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dx) > 10;
      },
      onPanResponderMove: (evt, gestureState) => {
        position.setValue({ x: gestureState.dx, y: gestureState.dy });
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > SWIPE_THRESHOLD) {
          forceSwipe('right');
        } else if (gestureState.dx < -SWIPE_THRESHOLD) {
          forceSwipe('left');
        } else {
          resetPosition();
        }
      }
    })
  ).current;

  const forceSwipe = (direction: 'left' | 'right') => {
    const x = direction === 'right' ? width + 100 : -width - 100;
    Animated.timing(position, {
      toValue: { x, y: 0 },
      duration: 250,
      useNativeDriver: false
    }).start(() => onSwipeComplete(direction));
  };

  const onSwipeComplete = (direction: 'left' | 'right') => {
    const item = profiles[currentIndex];
    direction === 'right' ? handleLike(item) : handleSkip(item);
    position.setValue({ x: 0, y: 0 });
    setCurrentIndex(prev => prev + 1);
    setActivePhotoIndex(0);
  };

  const handleLike = async (target: UserProfile) => {
    if (!user || !target) return;
    try {
      await addDoc(collection(db, 'swipes'), {
        fromId: user.uid,
        toId: target.uid,
        type: 'like',
        timestamp: serverTimestamp()
      });

      // Check if they already liked us
      const q = query(
        collection(db, 'swipes'), 
        where('fromId', '==', target.uid), 
        where('toId', '==', user.uid),
        where('type', '==', 'like')
      );
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        // It's a MATCH!
        const matchDoc = await addDoc(collection(db, 'matches'), {
          userIds: [user.uid, target.uid],
          timestamp: serverTimestamp(),
        });
        
        // Notify both users
        await addDoc(collection(db, 'notifications'), {
          userId: target.uid,
          fromId: user.uid,
          type: 'match',
          content: 'You got a new match!',
          matchId: matchDoc.id,
          isRead: false,
          timestamp: serverTimestamp()
        });
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          fromId: target.uid,
          type: 'match',
          content: 'You got a new match!',
          matchId: matchDoc.id,
          isRead: false,
          timestamp: serverTimestamp()
        });
      } else {
        // Just a like notification
        await addDoc(collection(db, 'notifications'), {
          userId: target.uid,
          fromId: user.uid,
          type: 'like',
          content: 'liked your profile!',
          isRead: false,
          timestamp: serverTimestamp()
        });
      }
    } catch (e) { console.error(e); }
  };

  const handleSkip = (target: UserProfile) => {
    // Just skip
  };

  const resetPosition = () => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      friction: 4,
      useNativeDriver: false
    }).start();
  };

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users'), 
      where('uid', '!=', user.uid), 
      limit(40)
    );
    const unsub = onSnapshot(q, (snap) => {
      const allUsers = snap.docs.map(doc => doc.data() as UserProfile);
      // Filter out stealth users on the client side (avoids needing a composite index)
      const visibleUsers = allUsers.filter(u => !u.isStealthMode);
      setProfiles(visibleUsers);
      setAiOrderingDone(false);
      setLoading(false);
    }, (error) => {
      console.error("SwipeScreen query error:", error);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (aiOrderingDone) return;
    if (!profiles || profiles.length < 2) return;

    let cancelled = false;
    (async () => {
      try {
        const candidateIds = profiles.map((p) => p.uid).filter(Boolean).slice(0, 40);
        const ranked = await rankCandidatesWithAI(candidateIds, 20);
        if (cancelled || ranked.length === 0) return;

        const scoreById = new Map(ranked.map((r) => [r.uid, r.score]));
        const ordered = [...profiles].sort(
          (a, b) => (scoreById.get(b.uid) ?? -1) - (scoreById.get(a.uid) ?? -1)
        );
        setProfiles(ordered);
      } catch (e) {
        console.warn('AI ranking unavailable, using default discovery order.', e);
      } finally {
        if (!cancelled) setAiOrderingDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, profiles, aiOrderingDone]);

  useEffect(() => {
    if (!user || !profiles[currentIndex]) return;
    const target = profiles[currentIndex];
    const trackView = async () => {
      try {
        await updateDoc(doc(db, 'users', target.uid), {
          viewedBy: arrayUnion(user.uid)
        });
        
        // Also create a notification for the viewed user
        await addDoc(collection(db, 'notifications'), {
          userId: target.uid,
          fromId: user.uid,
          type: 'view',
          content: `${user.displayName || 'Someone'} viewed your profile.`,
          timestamp: serverTimestamp(),
          isRead: false
        });
      } catch (e) {
        console.error("Tracking view failed:", e);
      }
    };
    trackView();
  }, [currentIndex, profiles, user]);

  const renderCards = () => {
    if (currentIndex >= profiles.length) {
      return (
        <View style={styles.emptyContainer}>
          <RotateCcw size={48} color="#FBE618" />
          <Text style={[styles.emptyText, { color: isDark ? '#FFF' : '#000' }]}>NO MORE PROFILES</Text>
          <TouchableOpacity style={styles.resetBtn} onPress={() => setCurrentIndex(0)}>
            <Text style={styles.resetText}>REFRESH DISCOVERY</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return profiles.slice(currentIndex, currentIndex + 2).map((profile, i) => {
      const isTop = i === 0;
      const dragHandlers = isTop ? panResponder.panHandlers : {};
      const photos = (Array.isArray((profile as any).photos) && (profile as any).photos.length > 0
        ? (profile as any).photos
        : [profile.profilePic].filter(Boolean)) as string[];
      const safeIndex = Math.min(activePhotoIndex, Math.max(0, photos.length - 1));
      
      const cardStyle = isTop ? {
        transform: [...position.getTranslateTransform(), { rotate }],
        zIndex: 10
      } : {
        transform: [{ scale: nextCardScale }],
        opacity: nextCardOpacity,
        zIndex: 5
      };

      return (
        <Animated.View
          key={profile.uid}
          style={[styles.card, cardStyle, { backgroundColor: isDark ? '#111115' : '#F8F8F8' }]}
          {...dragHandlers}
        >
          {isTop && (
            <>
              <Animated.View style={[styles.badge, { opacity: likeOpacity, right: 30, borderColor: '#4ADE80' }]}>
                <Text style={[styles.badgeText, { color: '#4ADE80' }]}>LIKE</Text>
              </Animated.View>
              <Animated.View style={[styles.badge, { opacity: nopeOpacity, left: 30, borderColor: '#FF4444' }]}>
                <Text style={[styles.badgeText, { color: '#FF4444' }]}>NOPE</Text>
              </Animated.View>
            </>
          )}

          <Image source={{ uri: photos[safeIndex] || 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800' }} style={styles.cardImg} />
          <View style={styles.cardOverlay} />
          
          <View style={styles.cardInfo}>
            {isTop && photos.length > 1 && (
              <View style={styles.photoThumbRow}>
                {photos.slice(0, 3).map((uri, idx) => (
                  <TouchableOpacity
                    key={idx}
                    activeOpacity={0.9}
                    onPress={() => setActivePhotoIndex(idx)}
                    style={[styles.photoThumbWrap, idx === safeIndex && styles.photoThumbWrapActive]}
                  >
                    <Image source={{ uri }} style={styles.photoThumbImg} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={styles.repBadge}>
              <Zap size={10} color="#000" fill="#000" />
              <Text style={styles.repVal}>{profile.reputationScore || 500} REP</Text>
            </View>
            
            <ScrollView 
              style={styles.bottomMeta} 
              showsVerticalScrollIndicator={false}
              scrollEnabled={isTop} // Only allow scrolling on the top card
            >
            <View style={styles.nameRow}>
              <Text style={styles.nameText}>{profile.displayName}, {profile.age}</Text>
              {profile.hasExit && (
                <View style={styles.exitBadge}>
                  <Target size={12} color="#000" />
                  <Text style={styles.exitText}>EXIT</Text>
                </View>
              )}
            </View>
            <Text style={styles.bioText}>"{profile.bio}"</Text>
              
              <View style={styles.tagGrid}>
                {profile.skills?.slice(0, 5).map((s, idx) => (
                  <View key={idx} style={styles.skillTag}>
                    <Text style={styles.skillTagText}>{s.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
              
              <View style={styles.scrollIndicator}>
                <ChevronDown size={14} color="#FBE618" />
                <Text style={styles.scrollText}>SCROLL FOR BIO</Text>
              </View>
            </ScrollView>
          </View>
        </Animated.View>
      );
    }).reverse();
  };

  if (loading) return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFF', justifyContent: 'center' }]}>
      <ActivityIndicator color="#FBE618" />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFF' }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation?.goBack?.()} style={styles.topBtn}>
          <ChevronLeft size={22} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: isDark ? '#FFF' : '#000' }]}>SWIPE</Text>
        <View style={styles.topBtn} />
      </View>

      <View style={styles.stackArea}>
        {renderCards()}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtnSmall} onPress={() => forceSwipe('left')}>
          <X size={24} color="#EF4444" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnLarge} onPress={() => forceSwipe('right')}>
          <Heart size={32} color="#FFF" fill="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnSmall} onPress={() => setCurrentIndex(0)}>
          <RotateCcw size={24} color="#888" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00000000',
  },
  topTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
  },
  stackArea: {
    flex: 1,
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 16,
    justifyContent: 'center',
  },
  card: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#222226',
    overflow: 'hidden',
  },
  cardImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  cardInfo: {
    ...StyleSheet.absoluteFillObject,
    padding: 24,
    justifyContent: 'space-between',
  },
  repBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563EB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  photoThumbRow: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'flex-end',
    marginTop: 6,
    marginBottom: 10,
  },
  photoThumbWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  photoThumbWrapActive: {
    borderColor: '#FBE618',
  },
  photoThumbImg: {
    width: '100%',
    height: '100%',
  },
  repVal: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFF',
  },
  bottomMeta: {
    flex: 1,
    maxHeight: '60%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    marginHorizontal: -24,
    marginBottom: -24,
    padding: 24,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4ADE80',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 4,
  },
  exitText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
  },
  nameText: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFF',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  bioText: {
    fontSize: 14,
    color: '#CCC',
    marginTop: 8,
    fontWeight: '500',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
    marginBottom: 20,
  },
  skillTag: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  skillTagText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
  },
  scrollIndicator: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  scrollText: {
    fontSize: 8,
    color: '#AAA',
    fontWeight: '900',
    marginTop: 4,
  },
  badge: {
    position: 'absolute',
    top: 40,
    zIndex: 100,
    borderWidth: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    transform: [{ rotate: '-15deg' }]
  },
  badgeText: {
    fontSize: 32,
    fontWeight: '900',
    textTransform: 'uppercase'
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 25,
    paddingBottom: 36,
  },
  actionBtnSmall: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#16161A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222226',
  },
  actionBtnLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2563EB',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  resetBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  resetText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 1,
  }
});
