import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { ChevronLeft, Eye, UserPlus } from 'lucide-react-native';

export default function ViewersScreen({ navigation }: any) {
  const { profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [viewers, setViewers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.viewedBy || profile.viewedBy.length === 0) {
      setLoading(false);
      return;
    }

    const fetchViewers = async () => {
      try {
        // Fetch full profiles for everyone who viewed me
        const viewerProfiles = await Promise.all(
          profile.viewedBy.slice(0, 20).map(async (uid: string) => {
            const snap = await getDoc(doc(db, 'users', uid));
            return snap.exists() ? { id: snap.id, ...snap.data() } as UserProfile : null;
          })
        );
        setViewers(viewerProfiles.filter(p => p !== null) as UserProfile[]);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchViewers();
  }, [profile]);

  const renderViewer = ({ item }: { item: UserProfile }) => (
    <TouchableOpacity 
      style={[styles.viewerCard, { backgroundColor: isDark ? '#111115' : '#F8F8F8' }]}
      onPress={() => navigation.navigate('Profile', { userId: item.uid })}
    >
      <Image source={{ uri: item.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={styles.avatar} />
      <View style={styles.info}>
        <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]}>{item.displayName}</Text>
        <Text style={styles.bio} numberOfLines={1}>{item.bio || 'Building the future'}</Text>
      </View>
      <UserPlus size={20} color="#FBE618" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={24} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: isDark ? '#FFF' : '#000' }]}>WHO VIEWED YOU</Text>
      </View>

      {loading ? <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} /> : (
        <FlatList
          data={viewers}
          renderItem={renderViewer}
          keyExtractor={item => item.uid}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Eye size={48} color="#222" />
              <Text style={styles.emptyText}>NO RECENT VIEWERS</Text>
              <Text style={styles.emptySub}>START POSTING TO GET NOTICED</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  list: {
    padding: 20,
  },
  viewerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    marginBottom: 12,
    gap: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 18,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bio: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  empty: {
    alignItems: 'center',
    marginTop: 100,
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#222',
    letterSpacing: 2,
  },
  emptySub: {
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
  }
});
