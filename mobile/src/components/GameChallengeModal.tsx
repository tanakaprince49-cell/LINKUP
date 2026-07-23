import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, FlatList, Image,
} from 'react-native';
import { collection, query, where, onSnapshot, FieldPath, limit as firestoreLimit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sendGameChallenge, GameType } from '../lib/gameChallenges';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, textColor } from '../theme/theme';
import { X, Zap, MessageSquare } from 'lucide-react-native';
import { displayNameFor } from '../lib/discovery';

interface MatchData {
  id: string;
  userIds: string[];
}

interface GameChallengeModalProps {
  visible: boolean;
  gameType: GameType;
  gameLabel: string;
  onClose: () => void;
  onSent?: () => void;
}

const GameChallengeModal: React.FC<GameChallengeModalProps> = ({ visible, gameType, gameLabel, onClose, onSent }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !user?.uid) return;
    setLoading(true);
    const q = query(
      collection(db, 'matches'),
      where(new FieldPath('participants', user.uid), '==', true),
      firestoreLimit(50),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: any[] = [];
      snap.forEach((d) => {
        const data = d.data();
        const otherId = (data.userIds || []).find((id: string) => id !== user.uid);
        if (otherId) {
          const profile = data.participantProfiles?.[otherId] || {};
          list.push({ id: d.id, otherId, profile });
        }
      });
      setMatches(list);
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [visible, user?.uid]);

  const handleChallenge = useCallback(async (connection: any) => {
    if (!user?.uid || sending) return;
    setSending(connection.otherId);
    try {
      await sendGameChallenge({
        senderId: user.uid,
        recipientId: connection.otherId,
        gameType,
        senderName: user.displayName || 'Someone',
        senderPic: user.photoURL || undefined,
        message: `Challenge you to ${gameLabel}!`,
      });
      onSent?.();
      onClose();
    } catch (e) {
      console.warn('Challenge send failed:', e);
    } finally {
      setSending(null);
    }
  }, [user?.uid, sending, gameType, gameLabel, onSent, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: isDark ? '#1C1C1E' : '#FFF' }]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: textColor(isDark) }]}>Challenge a Connection</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={textColor(isDark, 'muted')} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.sheetSub, { color: textColor(isDark, 'secondary') }]}>
            Pick someone to challenge at {gameLabel}
          </Text>

          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
          ) : matches.length === 0 ? (
            <View style={styles.emptyBox}>
              <MessageSquare size={32} color={textColor(isDark, 'muted')} />
              <Text style={[styles.emptyText, { color: textColor(isDark, 'muted') }]}>
                No connections yet. Start matching to challenge friends!
              </Text>
            </View>
          ) : (
            <FlatList
              data={matches}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const name = displayNameFor(item.profile) || item.profile?.displayName || 'Builder';
                const pic = item.profile?.profilePic || item.profile?.photoURL || '';
                return (
                  <TouchableOpacity
                    style={[styles.connectionRow, { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }]}
                    onPress={() => handleChallenge(item)}
                    disabled={sending === item.otherId}
                  >
                    {pic ? (
                      <Image source={{ uri: pic }} style={styles.connAvatar} />
                    ) : (
                      <View style={[styles.connAvatarPlaceholder, { backgroundColor: COLORS.primary + '30' }]}>
                        <Text style={styles.connAvatarLetter}>{name[0]}</Text>
                      </View>
                    )}
                    <Text style={[styles.connName, { color: textColor(isDark) }]}>{name}</Text>
                    {sending === item.otherId ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <View style={[styles.sendBtn, { backgroundColor: COLORS.primary }]}>
                        <Zap size={12} color="#000" fill="#000" />
                        <Text style={styles.sendBtnText}>Challenge</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '70%',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  sheetSub: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 16,
  },
  listContent: {
    paddingBottom: 20,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  connAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  connAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connAvatarLetter: {
    fontSize: 16,
    fontWeight: '900',
    color: '#000',
  },
  connName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  sendBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
  },
  emptyBox: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    maxWidth: 240,
  },
});

export default GameChallengeModal;