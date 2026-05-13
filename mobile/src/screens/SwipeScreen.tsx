import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, SafeAreaView, ActivityIndicator, Dimensions, ScrollView } from 'react-native';
import { collection, query, onSnapshot, where, addDoc, limit, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile, Block } from '../types';
import { X, Heart, Zap, RotateCcw, Info, Users, MapPin, Briefcase } from 'lucide-react-native';
import { getMatchingExplanation } from '../lib/ai';

const { width, height } = Dimensions.get('window');

export default function SwipeScreen() {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<UserProfile[]>([]);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Use onSnapshot to automatically see new seeded founders
    const q = query(collection(db, 'users'), where('uid', '!=', user.uid), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => doc.data() as UserProfile);
      // Filter out profiles we've already swiped in this session
      const remaining = data.filter(p => !history.find(h => h.uid === p.uid));
      setProfiles(remaining);
      setLoading(false);
    }, (err) => {
      console.error("Fetch profiles error:", err);
      setLoading(false);
    });
    return () => unsub();
  }, [user, history]);

  const handleSwipe = async (direction: 'left' | 'right' | 'super') => {
    if (profiles.length === 0) return;
    
    const targetUser = profiles[0];
    setHistory(prev => [targetUser, ...prev]);
    // Profiles state will update via the onSnapshot filter
    setExplanation(null);
    setIsExpanded(false);

    if (direction === 'left') return;

    try {
      await addDoc(collection(db, 'swipes'), {
        fromId: user?.uid,
        toId: targetUser.uid,
        type: direction === 'right' ? 'like' : 'superconnect',
        timestamp: serverTimestamp()
      });

      // Also add a notification to the target user
      await addDoc(collection(db, 'notifications'), {
        userId: targetUser.uid,
        type: direction === 'right' ? 'like' : 'match',
        content: `Someone is interested in your Proof of Work!`,
        isRead: false,
        timestamp: serverTimestamp()
      });
    } catch (err) {
      console.error("Swipe record error:", err);
    }
  };

  const handleRewind = () => {
    if (history.length === 0) return;
    const lastUser = history[0];
    setHistory(prev => prev.slice(1));
    setProfiles(prev => [lastUser, ...prev]);
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#121212' : '#FFFFFF', justifyContent: 'center' }]}>
        <ActivityIndicator color="#FBE618" />
      </View>
    );
  }

  const currentProfile = profiles[0];

  if (!currentProfile) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#121212' : '#FFFFFF', justifyContent: 'center', alignItems: 'center' }]}>
        <RotateCcw size={48} color={isDark ? '#333333' : '#EEEEEE'} />
        <Text style={{ color: isDark ? '#666666' : '#999999', marginTop: 20, fontWeight: '700' }}>No more builders found.</Text>
        <TouchableOpacity 
          style={styles.refreshButton}
          onPress={() => setHistory([])}
        >
          <Text style={styles.refreshButtonText}>RESET DECK</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#121212' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Find<Text style={{ color: '#FBE618' }}>Partners</Text>
        </Text>
      </View>

      <View style={styles.cardContainer}>
        <View style={[styles.card, { backgroundColor: isDark ? '#1E1E1E' : '#F8F8F8', borderColor: isDark ? '#333333' : '#EEEEEE' }]}>
          <View style={styles.imageContainer}>
            {currentProfile.profilePic ? (
              <Image source={{ uri: currentProfile.profilePic }} style={styles.profilePic} />
            ) : (
              <View style={styles.profilePicPlaceholder}>
                <Users size={80} color={isDark ? '#222222' : '#EEEEEE'} />
              </View>
            )}
            <View style={styles.imageOverlay} />
            
            <View style={styles.badge}>
              <Text style={styles.badgeText}>AI TOP PICK</Text>
            </View>

            <View style={styles.infoOverlay}>
              <Text style={styles.nameText}>{currentProfile.displayName}, {currentProfile.age}</Text>
              <Text style={styles.bioText} numberOfLines={2}>"{currentProfile.bio}"</Text>
              
              <View style={styles.skillsContainer}>
                {currentProfile.skills.slice(0, 3).map((skill, i) => (
                  <View key={i} style={styles.skillTag}>
                    <Text style={styles.skillText}>{skill.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {explanation && (
          <View style={styles.aiNote}>
            <View style={styles.aiNoteHeader}>
              <Zap size={14} color="#FBE618" />
              <Text style={styles.aiNoteTitle}>CO-PILOT NOTE</Text>
            </View>
            <Text style={styles.aiNoteText}>"{explanation}"</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity onPress={handleRewind} style={[styles.actionButtonSmall, { opacity: history.length > 0 ? 1 : 0.3 }]}>
          <RotateCcw size={24} color="#FBE618" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleSwipe('left')} style={styles.actionButtonX}>
          <X size={32} color={isDark ? '#FFFFFF' : '#000000'} strokeWidth={3} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleSwipe('super')} style={styles.actionButtonZap}>
          <Zap size={24} color="#FBE618" fill="#FBE618" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleSwipe('right')} style={styles.actionButtonHeart}>
          <Heart size={36} color="#000000" fill="#000000" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  cardContainer: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    flex: 1,
    borderRadius: 40,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  profilePic: {
    width: '100%',
    height: '100%',
  },
  profilePicPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  infoOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 30,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  nameText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  bioText: {
    fontSize: 14,
    color: '#FFFFFFCC',
    fontWeight: '500',
    marginTop: 8,
    lineHeight: 20,
  },
  skillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 20,
  },
  skillTag: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  skillText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF80',
    letterSpacing: 1,
  },
  badge: {
    position: 'absolute',
    top: 30,
    left: 30,
    backgroundColor: '#FBE618',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 1,
  },
  aiNote: {
    marginTop: 20,
    padding: 20,
    backgroundColor: '#111111',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FBE61820',
  },
  aiNoteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  aiNoteTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FBE618',
    letterSpacing: 1,
  },
  aiNoteText: {
    fontSize: 12,
    color: '#CCCCCC',
    fontWeight: '500',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingBottom: 40,
  },
  actionButtonSmall: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222222',
  },
  actionButtonX: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222222',
  },
  actionButtonZap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FBE61815',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FBE61830',
  },
  actionButtonHeart: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
    shadowColor: '#FBE618',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  refreshButton: {
    marginTop: 20,
    backgroundColor: '#FBE618',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 16,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 1,
  },
});
