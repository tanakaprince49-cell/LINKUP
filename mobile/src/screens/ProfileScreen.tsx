import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, SafeAreaView, ScrollView, Switch } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { User, LogOut, Moon, Sun, Settings, Rocket, Award, Briefcase, Shield, Zap, Check, ExternalLink, Trash2 } from 'lucide-react-native';
import { seedDatabase } from '../lib/seed';

const Badge = ({ name, icon: Icon }: { name: string, icon: any }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <View style={[styles.badgeItem, { backgroundColor: isDark ? '#FBE61810' : '#FBE61820' }]}>
      <Icon size={14} color="#FBE618" />
      <Text style={styles.badgeText}>{name}</Text>
    </View>
  );
};

export default function ProfileScreen() {
  const { profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const [showSettings, setShowSettings] = useState(false);

  if (!profile) return null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#121212' : '#FFFFFF' }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.profileHeader}>
            <View style={styles.avatarContainer}>
              {profile.profilePic ? (
                <Image source={{ uri: profile.profilePic }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: isDark ? '#1E1E1E' : '#F8F8F8' }]}>
                  <User size={40} color={isDark ? '#444444' : '#EEEEEE'} />
                </View>
              )}
              <TouchableOpacity style={styles.editAvatar}>
                <Settings size={16} color="#000000" />
              </TouchableOpacity>
            </View>
            <View style={styles.mainInfo}>
              <Text style={[styles.name, { color: isDark ? '#FFFFFF' : '#000000' }]}>{profile.displayName}</Text>
              <Text style={styles.location}>{profile.city}, {profile.country}</Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={[styles.statValue, { color: '#FBE618' }]}>{profile.reputationScore}</Text>
                  <Text style={styles.statLabel}>REPUTATION</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={[styles.statValue, { color: '#FBE618' }]}>{profile.streakCount} 🔥</Text>
                  <Text style={styles.statLabel}>STREAK</Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.seedButton, { borderColor: isDark ? '#FBE61820' : '#FBE61850' }]}
          onPress={async () => {
            await seedDatabase(profile.uid);
            alert("Network Seeded! 10 Founders added.");
          }}
        >
          <Shield size={20} color="#FBE618" />
          <Text style={styles.seedButtonText}>SEED DEMO NETWORK</Text>
        </TouchableOpacity>

        {/* ACHIEVEMENT BADGES */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>SKILL BADGES</Text>
          <View style={styles.badgesContainer}>
            <Badge name="TOP BUILDER" icon={Rocket} />
            <Badge name="FAST EXECUTOR" icon={Zap} />
            <Badge name="CONSISTENT" icon={Check} />
            <Badge name="LEADERSHIP" icon={Shield} />
          </View>
        </View>

        {/* STARTUP RESUME */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>STARTUP RESUME</Text>
          <View style={styles.resumeContainer}>
            <View style={[styles.resumeItem, { backgroundColor: isDark ? '#1E1E1E' : '#F8F8F8' }]}>
              <Briefcase size={18} color="#FBE618" />
              <View style={styles.resumeInfo}>
                <Text style={[styles.resumeTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>Shipped Products</Text>
                <Text style={styles.resumeDesc}>{profile.resume?.shippedProducts?.length || 0} Products Live</Text>
              </View>
              <ExternalLink size={16} color="#666666" />
            </View>
            <View style={[styles.resumeItem, { backgroundColor: isDark ? '#1E1E1E' : '#F8F8F8' }]}>
              <Award size={18} color="#FBE618" />
              <View style={styles.resumeInfo}>
                <Text style={[styles.resumeTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>Hackathon Wins</Text>
                <Text style={styles.resumeDesc}>{profile.resume?.hackathonWins?.length || 0} Victories</Text>
              </View>
              <ExternalLink size={16} color="#666666" />
            </View>
          </View>
        </View>

        {/* SETTINGS TOGGLE SECTION */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>SETTINGS & PREFERENCES</Text>
          <View style={[styles.settingRow, { backgroundColor: isDark ? '#1E1E1E' : '#F8F8F8' }]}>
            <View style={styles.settingLabelContainer}>
              {isDark ? <Moon size={20} color="#FBE618" /> : <Sun size={20} color="#FBE618" />}
              <Text style={[styles.settingLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>Dark Mode</Text>
            </View>
            <Switch value={isDark} onValueChange={toggleTheme} trackColor={{ true: '#FBE61840', false: '#CCC' }} thumbColor={isDark ? '#FBE618' : '#FFF'} />
          </View>
          
          <View style={[styles.settingRow, { backgroundColor: isDark ? '#1E1E1E' : '#F8F8F8' }]}>
            <View style={styles.settingLabelContainer}>
              <Shield size={20} color="#FBE618" />
              <Text style={[styles.settingLabel, { color: isDark ? '#FFFFFF' : '#000000' }]}>Profile Visibility</Text>
            </View>
            <Switch value={profile.isVisible} trackColor={{ true: '#FBE61840', false: '#CCC' }} thumbColor={profile.isVisible ? '#FBE618' : '#FFF'} />
          </View>

          <TouchableOpacity style={[styles.logoutButton, { marginTop: 20 }]} onPress={logout}>
            <LogOut size={20} color="#FF4444" />
            <Text style={styles.logoutText}>TERMINATE SESSION</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.deleteButton, { marginTop: 10 }]}>
            <Trash2 size={20} color="#FF444460" />
            <Text style={styles.deleteText}>DELETE ACCOUNT</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  header: {
    marginBottom: 40,
    marginTop: 20,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 40,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editAvatar: {
    position: 'absolute',
    bottom: -5,
    right: -5,
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#050508',
  },
  mainInfo: {
    flex: 1,
  },
  name: {
    fontSize: 24,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  location: {
    fontSize: 14,
    color: '#666666',
    fontWeight: '600',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 20,
  },
  stat: {
    alignItems: 'flex-start',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 9,
    color: '#666666',
    fontWeight: '900',
    letterSpacing: 1,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 16,
    opacity: 0.6,
  },
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  badgeText: {
    color: '#FBE618',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  resumeContainer: {
    gap: 10,
  },
  resumeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 20,
    gap: 16,
  },
  resumeInfo: {
    flex: 1,
  },
  resumeTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  resumeDesc: {
    fontSize: 12,
    color: '#666666',
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 20,
    marginBottom: 10,
  },
  settingLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  seedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 30,
    backgroundColor: '#FBE61805',
  },
  seedButtonText: {
    color: '#FBE618',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FF444420',
  },
  logoutText: {
    color: '#FF4444',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
  },
  deleteText: {
    color: '#FF444460',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
});
