import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, SafeAreaView, KeyboardAvoidingView, Platform, Image, Alert, StatusBar, Modal, Pressable, ScrollView } from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, deleteDoc, getDoc, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Send, Camera, Zap, MoreVertical, BellOff, Pin, Archive, Star, Users, Calendar, ContactRound, Shield, UserX, FileText, Trash2, Reply, X } from 'lucide-react-native';
import { generateWarmIntro } from '../lib/ai';

const formatLastSeen = (timestamp: any) => {
  if (!timestamp) return 'Offline';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (diffInSeconds < 60) return `Last seen ${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `Last seen ${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `Last seen ${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  return `Last seen ${diffInDays}d ago`;
};

const formatMessageTime = (timestamp: any) => {
  if (!timestamp) return '';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

export default function ChatScreen({ route, navigation }: any) {
  const matchId = route?.params?.matchId;
  const otherUserParam = route?.params?.otherUser;
  const isDemo = !matchId;
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const [otherUser, setOtherUser] = useState<any>(otherUserParam || null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mutePickerOpen, setMutePickerOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [matchMeta, setMatchMeta] = useState<any>(null);
  const [replyTo, setReplyTo] = useState<null | { messageId: string; senderId: string; text: string }>(null);

  useEffect(() => {
    if (!isDemo) return;
    setOtherUser({
      uid: 'demo_user',
      displayName: 'Demo Builder',
      profilePic: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200',
      isOnline: true,
    });
    setMessages([
      {
        id: 'd1',
        senderId: 'demo_user',
        content: "Hey — saw you're building LINKUP. The UI is premium.",
        timestamp: new Date(),
        type: 'text',
      },
      {
        id: 'd2',
        senderId: user?.uid || 'me',
        content: "Thanks! I’m tuning swipe + search. What should I improve next?",
        timestamp: new Date(),
        type: 'text',
      },
      {
        id: 'd3',
        senderId: 'demo_user',
        content: "Make search feel like magic: 'AI engineer in SA into fintech' → perfect results.",
        timestamp: new Date(),
        type: 'text',
      },
    ]);
  }, [isDemo, user?.uid]);

  useEffect(() => {
    if (!matchId) return;
    const q = query(
      collection(db, 'matches', matchId, 'messages'),
      orderBy('timestamp', 'asc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });

    return () => unsub();
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    const unsub = onSnapshot(doc(db, 'matches', matchId), (snap) => {
      if (!snap.exists()) return;
      setMatchMeta({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [matchId]);

  useEffect(() => {
    const otherId = otherUserParam?.uid;
    if (!otherId) return;
    const unsub = onSnapshot(doc(db, 'users', otherId), (snap) => {
      if (!snap.exists()) return;
      setOtherUser({ uid: otherId, ...(snap.data() as any) });
    });
    return () => unsub();
  }, [otherUserParam?.uid]);

  const myUid = user?.uid;

  const isPinned = useMemo(() => {
    if (!myUid) return false;
    const pinnedBy = Array.isArray(matchMeta?.pinnedBy) ? matchMeta.pinnedBy : [];
    return pinnedBy.includes(myUid);
  }, [matchMeta?.pinnedBy, myUid]);

  const isImportant = useMemo(() => {
    if (!myUid) return false;
    const importantBy = Array.isArray(matchMeta?.importantBy) ? matchMeta.importantBy : [];
    return importantBy.includes(myUid);
  }, [matchMeta?.importantBy, myUid]);

  const mutedUntilLabel = useMemo(() => {
    if (!myUid) return null;
    const m = matchMeta?.mutedUntilBy?.[myUid];
    if (!m) return null;
    const date = m?.toDate ? m.toDate() : new Date(m);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getTime() <= Date.now()) return null;
    return `Muted until ${date.toLocaleString()}`;
  }, [matchMeta?.mutedUntilBy, myUid]);

  const handleSend = async () => {
    if (!inputText.trim() || !user) return;

    if (isDemo) {
      const text = inputText;
      setInputText('');
      setMessages((prev) => [
        ...prev,
        {
          id: `demo_${Date.now()}`,
          senderId: user.uid,
          content: text,
          timestamp: new Date(),
          type: 'text',
          ...(replyTo ? { replyToMessageId: replyTo.messageId, replyToSenderId: replyTo.senderId, replyToText: replyTo.text } : {}),
        },
      ]);
      setReplyTo(null);
      return;
    }

    if (!matchId) return;
    
    const text = inputText;
    setInputText('');
    const replyPayload = replyTo
      ? { replyToMessageId: replyTo.messageId, replyToSenderId: replyTo.senderId, replyToText: replyTo.text }
      : {};
    setReplyTo(null);

    try {
      await addDoc(collection(db, 'matches', matchId, 'messages'), {
        senderId: user.uid,
        content: text,
        timestamp: serverTimestamp(),
        type: 'text',
        ...replyPayload,
      });

      await updateDoc(doc(db, 'matches', matchId), {
        lastMessage: text,
        lastMessageTime: serverTimestamp()
      });

      // In-app notification for the recipient (unread badge increments).
      const recipientId = otherUser?.uid;
      if (recipientId && recipientId !== user.uid) {
        await addDoc(collection(db, 'notifications'), {
          userId: recipientId,
          fromId: user.uid,
          fromName: profile?.displayName || 'Someone',
          fromPic: profile?.profilePic || '',
          type: 'system',
          content: 'sent you a message.',
          isRead: false,
          timestamp: serverTimestamp(),
        });
      }

      await updateDoc(doc(db, 'users', user.uid), {
        isOnline: true,
        lastActiveAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const toggleArrayField = async (field: 'pinnedBy' | 'archivedBy' | 'importantBy') => {
    if (!matchId || !myUid) return;
    try {
      setBusyAction(true);
      const ref = doc(db, 'matches', matchId);
      const current = Array.isArray(matchMeta?.[field]) ? matchMeta[field] : [];
      const has = current.includes(myUid);
      await updateDoc(ref, { [field]: has ? arrayRemove(myUid) : arrayUnion(myUid) } as any);
    } catch (e) {
      console.error('toggle field error', e);
      Alert.alert('Error', 'Action failed.');
    } finally {
      setBusyAction(false);
    }
  };

  const setMute = async (hours: number | 'forever' | 'off') => {
    if (!matchId || !myUid) return;
    try {
      setBusyAction(true);
      const ref = doc(db, 'matches', matchId);
      const snap = await getDoc(ref);
      const current = (snap.exists() ? (snap.data() as any) : {}) || {};
      const mutedUntilBy = { ...(current.mutedUntilBy || {}) };
      if (hours === 'off') {
        delete mutedUntilBy[myUid];
      } else if (hours === 'forever') {
        mutedUntilBy[myUid] = new Date('2099-12-31T00:00:00Z');
      } else {
        mutedUntilBy[myUid] = new Date(Date.now() + hours * 60 * 60 * 1000);
      }
      await updateDoc(ref, { mutedUntilBy } as any);
    } catch (e) {
      console.error('mute error', e);
      Alert.alert('Error', 'Could not update mute.');
    } finally {
      setBusyAction(false);
      setMutePickerOpen(false);
    }
  };

  const blockUser = async () => {
    if (!myUid || !otherUser?.uid) return;
    try {
      setBusyAction(true);
      const blockId = `${myUid}_${otherUser.uid}`;
      await setDoc(doc(db, 'blocks', blockId), {
        blockedById: myUid,
        blockedUserId: otherUser.uid,
        timestamp: serverTimestamp(),
      });
      Alert.alert('Blocked', `${otherUser.displayName || 'User'} has been blocked.`);
      navigation.goBack();
    } catch (e) {
      console.error('block error', e);
      Alert.alert('Error', 'Could not block user.');
    } finally {
      setBusyAction(false);
    }
  };

  const deleteConversation = async () => {
    if (!matchId) return;
    Alert.alert('Delete conversation', 'Delete this chat from your inbox?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            setBusyAction(true);
            await deleteDoc(doc(db, 'matches', matchId));
            navigation.goBack();
          } catch (e) {
            console.error('delete conversation error', e);
            Alert.alert('Error', 'Could not delete conversation.');
          } finally {
            setBusyAction(false);
          }
        },
      },
    ]);
  };

  const MenuItem = ({ icon, title, subtitle, danger, onPress }: any) => (
    <TouchableOpacity
      disabled={busyAction}
      onPress={onPress}
      style={[styles.menuItem, { opacity: busyAction ? 0.6 : 1 }]}
    >
      <View style={[styles.menuIcon, { backgroundColor: danger ? '#EF444420' : (isDark ? '#16161A' : '#F3F4F6') }]}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuTitle, { color: danger ? '#EF4444' : (isDark ? '#FFF' : '#000') }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.menuSub, { color: isDark ? '#AAA' : '#666' }]}>{subtitle}</Text>}
      </View>
    </TouchableOpacity>
  );

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.senderId === user?.uid;
    const swipeRef = React.createRef<Swipeable>();
    return (
      <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
        <Swipeable
          ref={swipeRef as any}
          friction={2}
          leftThreshold={40}
          rightThreshold={40}
          renderLeftActions={() => (
            <View style={[styles.replyAction, { backgroundColor: isDark ? '#16161A' : '#EEF2FF' }]}>
              <Reply size={18} color={isDark ? '#FBE618' : '#2563EB'} />
            </View>
          )}
          renderRightActions={() => (
            <View style={[styles.replyAction, { backgroundColor: isDark ? '#16161A' : '#EEF2FF' }]}>
              <Reply size={18} color={isDark ? '#FBE618' : '#2563EB'} />
            </View>
          )}
          onSwipeableOpen={() => {
            setReplyTo({
              messageId: String(item.id),
              senderId: String(item.senderId),
              text: String(item.content ?? '').slice(0, 180),
            });
            // close immediately so the row resets
            setTimeout(() => (swipeRef.current as any)?.close?.(), 10);
          }}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onLongPress={() => {
              if (!matchId) return;
              if (!isMe) return;
              Alert.alert('Delete message', 'Delete this message for everyone?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await deleteDoc(doc(db, 'matches', matchId, 'messages', item.id));
                    } catch (e) {
                      console.error('Delete message error:', e);
                      Alert.alert('Error', 'Could not delete message.');
                    }
                  },
                },
              ]);
            }}
          >
            <View style={[
              styles.messageBubble,
              isMe ? styles.myBubble : [styles.theirBubble, { backgroundColor: isDark ? '#16161A' : '#F0F0F0' }]
            ]}>
              {!!item.replyToText && (
                <View style={[styles.replyPreviewInBubble, { borderLeftColor: isMe ? '#00000035' : (isDark ? '#FFFFFF35' : '#00000025') }]}>
                  <Text style={[styles.replyPreviewSender, { color: isMe ? '#00000090' : (isDark ? '#FFFFFF90' : '#00000090') }]}>
                    Replying to {item.replyToSenderId === user?.uid ? 'you' : 'them'}
                  </Text>
                  <Text style={[styles.replyPreviewText, { color: isMe ? '#00000090' : (isDark ? '#FFFFFF90' : '#00000090') }]} numberOfLines={2}>
                    {String(item.replyToText)}
                  </Text>
                </View>
              )}
              <Text style={[styles.messageText, { color: isMe ? '#000' : (isDark ? '#FFF' : '#000') }]}>
                {item.content}
              </Text>
              <Text style={[styles.messageTime, { color: isMe ? '#00000080' : (isDark ? '#FFFFFF80' : '#00000080') }]}>
                {formatMessageTime(item.timestamp)}
              </Text>
            </View>
          </TouchableOpacity>
        </Swipeable>
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={[styles.header, { borderBottomColor: isDark ? '#1A1A1F' : '#EEE', justifyContent: 'space-between' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ChevronLeft size={24} color={isDark ? '#FFF' : '#000'} />
          </TouchableOpacity>
          {otherUser ? (
            <TouchableOpacity 
              style={{ flexDirection: 'row', alignItems: 'center' }} 
              onPress={() => navigation.navigate('Profile', { userId: otherUser.uid })}
            >
              <Image source={{ uri: otherUser.profilePic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={styles.avatar} />
              <View>
                <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]}>{otherUser.displayName || 'Builder'}</Text>
                <Text style={styles.status}>
                  {otherUser.isOnline ? 'ONLINE' : formatLastSeen(otherUser.lastActiveAt)}
                </Text>
              </View>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.avatar, { backgroundColor: isDark ? '#16161A' : '#EEE' }]} />
              <View>
                <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]}>CHAT</Text>
                <Text style={styles.status}>Loading…</Text>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={() => setOptionsOpen(true)} style={{ padding: 8, alignItems: 'center', justifyContent: 'center' }}>
          <MoreVertical size={22} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : ((StatusBar.currentHeight || 0) + 90)}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
        />

        <View style={[styles.inputContainer, { backgroundColor: isDark ? '#0A0A0C' : '#FFF', borderTopColor: isDark ? '#1A1A1F' : '#EEE' }]}>
          {!!replyTo && (
            <View style={[styles.replyBar, { backgroundColor: isDark ? '#111115' : '#F3F4F6', borderColor: isDark ? '#222226' : '#E5E7EB' }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.replyBarTitle, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                  Replying to {replyTo.senderId === user?.uid ? 'your message' : (otherUser?.displayName || 'message')}
                </Text>
                <Text style={[styles.replyBarText, { color: isDark ? '#AAA' : '#666' }]} numberOfLines={1}>
                  {replyTo.text}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} style={styles.replyClose}>
                <X size={16} color={isDark ? '#CCC' : '#111'} />
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity 
            style={[styles.toolBtn, { backgroundColor: '#2563EB20' }]} 
            onPress={async () => {
              Alert.alert("AI INTRO", "Drafting a perfect opening based on your profiles...");
              const intro = await generateWarmIntro(profile, otherUser);
              setInputText((intro || '').trim());
            }}
          >
            <Zap size={20} color="#2563EB" fill="#2563EB" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn}>
            <Camera size={20} color="#666" />
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { color: isDark ? '#FFF' : '#000', backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}
            placeholder="Type a message..."
            placeholderTextColor="#666"
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <TouchableOpacity 
            style={[styles.sendBtn, { opacity: inputText.trim() ? 1 : 0.5, backgroundColor: '#2563EB' }]} 
            onPress={handleSend}
            disabled={!inputText.trim()}
          >
            <Send size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent visible={optionsOpen} animationType="fade" onRequestClose={() => setOptionsOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setOptionsOpen(false)} />
        <View style={[styles.menuSheet, { backgroundColor: isDark ? '#0F0F12' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
          <View style={styles.menuHeaderRow}>
            <Text style={[styles.menuHeader, { color: isDark ? '#FFF' : '#000' }]}>CHAT OPTIONS</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {isPinned && <Pin size={14} color="#FBE618" />}
              {isImportant && <Star size={14} color="#FBE618" fill="#FBE618" />}
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
            <MenuItem
              icon={<ContactRound size={18} color={isDark ? '#FFF' : '#000'} />}
              title="View Profile"
              subtitle="Open full business profile"
              onPress={() => {
                setOptionsOpen(false);
                if (!otherUser?.uid) return;
                navigation.navigate('Profile', { userId: otherUser.uid });
              }}
            />

            <MenuItem
              icon={<BellOff size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Mute Notifications"
              subtitle={mutedUntilLabel || 'Choose duration'}
              onPress={() => setMutePickerOpen(true)}
            />

            <MenuItem
              icon={<Pin size={18} color={isDark ? '#FFF' : '#000'} />}
              title={isPinned ? 'Unpin Conversation' : 'Pin Conversation'}
              subtitle="Keep this chat at the top"
              onPress={() => toggleArrayField('pinnedBy')}
            />

            <MenuItem
              icon={<Archive size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Archive Chat"
              subtitle="Hide from inbox without deleting"
              onPress={() => toggleArrayField('archivedBy')}
            />

            <MenuItem
              icon={<Star size={18} color={isDark ? '#FFF' : '#000'} fill={isImportant ? '#FBE618' : 'transparent'} />}
              title={isImportant ? 'Unmark Important' : 'Mark as Important'}
              subtitle="⭐ Highlight serious conversations"
              onPress={() => toggleArrayField('importantBy')}
            />

            <MenuItem
              icon={<Users size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Invite to Team"
              subtitle="Coming soon"
              onPress={() => Alert.alert('Coming soon', 'Team invites will appear here.')}
            />

            <MenuItem
              icon={<Calendar size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Schedule Meeting"
              subtitle="Zoom / Google Meet / Calendly"
              onPress={() => Alert.alert('Schedule', 'Add your meeting links in profile settings (coming soon).')}
            />

            <MenuItem
              icon={<Shield size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Confidential Mode"
              subtitle="Premium (coming soon)"
              onPress={() => Alert.alert('Premium feature', 'Confidential mode will be available soon.')}
            />

            <MenuItem
              icon={<FileText size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Export Conversation"
              subtitle="PDF / TXT (coming soon)"
              onPress={() => Alert.alert('Coming soon', 'Export will be available soon.')}
            />

            <MenuItem
              icon={<UserX size={18} color="#EF4444" />}
              title="Block User"
              subtitle="Remove access and messaging"
              danger
              onPress={() => {
                Alert.alert('Block user', 'Block this user completely?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Block', style: 'destructive', onPress: blockUser },
                ]);
              }}
            />

            {!isDemo && (
              <MenuItem
                icon={<Trash2 size={18} color="#EF4444" />}
                title="Delete Conversation"
                subtitle="Deletes locally for you"
                danger
                onPress={deleteConversation}
              />
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal transparent visible={mutePickerOpen} animationType="fade" onRequestClose={() => setMutePickerOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMutePickerOpen(false)} />
        <View style={[styles.menuSheet, { backgroundColor: isDark ? '#0F0F12' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
          <Text style={[styles.menuHeader, { color: isDark ? '#FFF' : '#000' }]}>MUTE</Text>
          <MenuItem icon={<BellOff size={18} color={isDark ? '#FFF' : '#000'} />} title="1 hour" onPress={() => setMute(1)} />
          <MenuItem icon={<BellOff size={18} color={isDark ? '#FFF' : '#000'} />} title="8 hours" onPress={() => setMute(8)} />
          <MenuItem icon={<BellOff size={18} color={isDark ? '#FFF' : '#000'} />} title="24 hours" onPress={() => setMute(24)} />
          <MenuItem icon={<BellOff size={18} color={isDark ? '#FFF' : '#000'} />} title="Forever" onPress={() => setMute('forever')} />
          <MenuItem icon={<BellOff size={18} color={isDark ? '#FFF' : '#000'} />} title="Unmute" onPress={() => setMute('off')} />
        </View>
      </Modal>
    </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'android' ? ((StatusBar.currentHeight || 0) + 8) : 16,
    borderBottomWidth: 1,
  },
  backBtn: {
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  status: {
    fontSize: 10,
    color: '#4ADE80',
    fontWeight: '900',
  },
  listContent: {
    padding: 16,
  },
  messageWrapper: {
    marginBottom: 12,
    maxWidth: '80%',
  },
  myMessageWrapper: {
    alignSelf: 'flex-end',
  },
  theirMessageWrapper: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    padding: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  messageTime: {
    fontSize: 10,
    fontWeight: '900',
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  myBubble: {
    backgroundColor: '#FBE618',
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 14,
    fontWeight: '500',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    gap: 12,
  },
  replyAction: {
    width: 54,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    marginVertical: 6,
  },
  replyBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: -56,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  replyBarTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  replyBarText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
  },
  replyClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyPreviewInBubble: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    marginBottom: 8,
  },
  replyPreviewSender: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  replyPreviewText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
  },
  toolBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  menuSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 22,
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  menuHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  menuHeader: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  menuSub: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: '700',
  },
});
