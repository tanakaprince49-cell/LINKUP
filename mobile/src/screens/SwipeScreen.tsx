import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, SafeAreaView, ActivityIndicator, Dimensions, Animated, PanResponder, ScrollView } from 'react-native';
import { collection, query, onSnapshot, where, addDoc, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { X, Heart, Zap, RotateCcw, Sparkles, Target, Info, MessageSquare, ChevronDown } from 'lucide-react-native';

const { width, height } = Dimensions.get('window');
const SWIPE_THRESHOLD = 0.25 * width;

export default function SwipeScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

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
    const q = query(collection(db, 'users'), where('uid', '!=', user.uid), limit(40));
    const unsub = onSnapshot(q, (snap) => {
      setProfiles(snap.docs.map(doc => doc.data() as UserProfile));
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

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

          <Image source={{ uri: profile.profilePic || 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800' }} style={styles.cardImg} />
          <View style={styles.cardOverlay} />
          
          <View style={styles.cardInfo}>
            <View style={styles.repBadge}>
              <Zap size={10} color="#000" fill="#000" />
              <Text style={styles.repVal}>{profile.reputationScore || 500} REP</Text>
            </View>
            
            <ScrollView 
              style={styles.bottomMeta} 
              showsVerticalScrollIndicator={false}
              scrollEnabled={isTop} // Only allow scrolling on the top card
            >
              <Text style={styles.nameText}>{profile.displayName}, {profile.age}</Text>
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
      <View style={styles.stackArea}>
        {renderCards()}
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtnSmall} onPress={() => forceSwipe('left')}>
          <X size={24} color="#FF4444" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnLarge} onPress={() => forceSwipe('right')}>
          <Heart size={32} color="#000" fill="#000" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtnSmall}>
          <MessageSquare size={24} color="#FBE618" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stackArea: {
    flex: 1,
    margin: 20,
    marginTop: 0,
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
    backgroundColor: '#FBE618',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  repVal: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
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
    color: '#FBE618',
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
    paddingBottom: 110,
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
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FBE618',
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
    backgroundColor: '#FBE618',
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
