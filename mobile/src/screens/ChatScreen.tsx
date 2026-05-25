import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image, Alert, StatusBar, Modal, Pressable, ScrollView, Linking, Share } from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, deleteDoc, getDoc, setDoc, arrayUnion, arrayRemove, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Send, Camera, Zap, MoreVertical, BellOff, Pin, Archive, Star, Users, Calendar, ContactRound, Shield, UserX, FileText, Trash2, Reply, X } from 'lucide-react-native';
import { generateWarmIntro } from '../lib/ai';
import { blurActiveElementOnWeb } from '../lib/webFocus';

const getFutureDate = (value: any) => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now() ? null : date;
};

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

const isPresenceOnline = (presence: any) => {
  if (!presence?.isOnline || !presence?.lastActiveAt) return false;
  const date = presence.lastActiveAt?.toDate ? presence.lastActiveAt.toDate() : new Date(presence.lastActiveAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < 2 * 60 * 1000;
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
  const [hasBlockedUser, setHasBlockedUser] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingValueRef = useRef(false);
  const myUid = user?.uid;
  const otherUserId = useMemo(
    () => otherUser?.uid || otherUserParam?.uid || (Array.isArray(matchMeta?.userIds) ? matchMeta.userIds.find((id: string) => id !== myUid) : ''),
    [matchMeta?.userIds, myUid, otherUser?.uid, otherUserParam?.uid]
  );
  const openOptionsMenu = () => {
    blurActiveElementOnWeb();
    setOptionsOpen(true);
  };
  const closeOptionsMenu = () => {
    blurActiveElementOnWeb();
    setOptionsOpen(false);
  };
  const openMutePicker = () => {
    blurActiveElementOnWeb();
    setMutePickerOpen(true);
  };
  const closeMutePicker = () => {
    blurActiveElementOnWeb();
    setMutePickerOpen(false);
  };

  useEffect(() => {
    if (matchId) return;
    Alert.alert('Chat unavailable', 'Open a chat from a real connection (match).');
    navigation.goBack();
  }, [matchId, navigation]);

  useEffect(() => {
    if (!matchId) return;
    const q = query(
      collection(db, 'matches', matchId, 'messages'),
      orderBy('timestamp', 'asc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const msgs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMessages(msgs);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      },
      (err) => {
        console.warn('Chat messages unavailable:', err);
        setMessages([]);
      }
    );

    return () => unsub();
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    const unsub = onSnapshot(
      doc(db, 'matches', matchId),
      (snap) => {
        if (!snap.exists()) return;
        setMatchMeta({ id: snap.id, ...snap.data() });
      },
      (err) => {
        console.warn('Chat metadata unavailable:', err);
        setMatchMeta(null);
      }
    );
    return () => unsub();
  }, [matchId]);

  useEffect(() => {
    const otherId = otherUserId;
    if (!otherId) return;

    const unsubUser = onSnapshot(
      doc(db, 'users', otherId),
      (snap) => {
        if (!snap.exists()) return;
        setOtherUser((prev: any) => ({ ...(prev || {}), uid: otherId, ...(snap.data() as any) }));
      },
      (err) => {
        console.warn('Chat user unavailable:', err);
      }
    );

    return () => {
      unsubUser();
    };
  }, [otherUserId]);

  useEffect(() => {
    const otherId = otherUserId;
    if (!otherId) return;
    if (otherUser?.hideOnlineStatus) {
      setOtherUser((prev: any) => ({ ...(prev || {}), isOnline: false, lastActiveAt: null }));
      return;
    }

    const unsubPresence = onSnapshot(
      doc(db, 'presence', otherId),
      (snap) => {
        if (!snap.exists()) {
          setOtherUser((prev: any) => ({ ...(prev || {}), isOnline: false }));
          return;
        }
        const p = snap.data() as any;
        setOtherUser((prev: any) => ({ ...(prev || {}), isOnline: isPresenceOnline(p), lastActiveAt: p.lastActiveAt }));
      },
      (err) => {
        console.warn('Chat presence unavailable:', err);
        setOtherUser((prev: any) => ({ ...(prev || {}), isOnline: false }));
      }
    );

    return () => unsubPresence();
  }, [otherUserId, otherUser?.hideOnlineStatus]);

  useEffect(() => {
    if (!matchId || !myUid) return;
    updateDoc(doc(db, 'matches', matchId), { [`unreadBy.${myUid}`]: 0 } as any).catch((error) => {
      console.warn('Could not clear chat unread count:', error);
    });
  }, [matchId, myUid]);

  useEffect(() => {
    if (!myUid || !otherUserId) {
      setHasBlockedUser(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'blocks', `${myUid}_${otherUserId}`),
      (snap) => setHasBlockedUser(snap.exists()),
      (err) => {
        console.warn('Block status unavailable:', err);
        setHasBlockedUser(false);
      }
    );

    return () => unsub();
  }, [myUid, otherUserId]);

  const mutedUntilLabel = useMemo(() => {
    if (!myUid) return null;
    const date = getFutureDate(matchMeta?.mutedUntilBy?.[myUid]);
    if (!date) return null;
    return `Muted until ${date.toLocaleString()}`;
  }, [matchMeta?.mutedUntilBy, myUid]);

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

  const isArchived = useMemo(() => {
    if (!myUid) return false;
    const archivedBy = Array.isArray(matchMeta?.archivedBy) ? matchMeta.archivedBy : [];
    return archivedBy.includes(myUid);
  }, [matchMeta?.archivedBy, myUid]);

  const isConfidential = useMemo(() => {
    if (!myUid) return false;
    const confidentialBy = Array.isArray(matchMeta?.confidentialBy) ? matchMeta.confidentialBy : [];
    return confidentialBy.includes(myUid);
  }, [matchMeta?.confidentialBy, myUid]);

  const isRecipientMuted = (recipientId?: string) => {
    if (!recipientId) return false;
    return !!getFutureDate(matchMeta?.mutedUntilBy?.[recipientId]);
  };

  const setTypingState = async (isTyping: boolean) => {
    if (!matchId || !myUid) return;
    if (lastTypingValueRef.current === isTyping) return;
    lastTypingValueRef.current = isTyping;
    try {
      await updateDoc(doc(db, 'matches', matchId), { [`typingBy.${myUid}`]: isTyping } as any);
    } catch (error) {
      console.warn('Typing indicator update failed:', error);
    }
  };

  const handleInputChange = (text: string) => {
    setInputText(text);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

    if (text.trim()) {
      void setTypingState(true);
      typingTimerRef.current = setTimeout(() => {
        void setTypingState(false);
      }, 1400);
      return;
    }

    void setTypingState(false);
  };

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      void setTypingState(false);
    };
  }, [matchId, myUid]);

  const sendChatText = async (text: string, replyPayload: Record<string, unknown> = {}, notificationContent = 'sent you a message.') => {
    if (!text.trim() || !user) return;
    if (!matchId) return;
    if (hasBlockedUser) {
      Alert.alert('User blocked', 'Unblock this user before sending a message.');
      return;
    }

    try {
      await addDoc(collection(db, 'matches', matchId, 'messages'), {
        senderId: user.uid,
        content: text,
        timestamp: serverTimestamp(),
        type: 'text',
        ...replyPayload,
      });

      const recipientId = otherUserId || otherUser?.uid;
      const matchPatch: Record<string, unknown> = {
        lastMessage: text,
        lastMessageTime: serverTimestamp(),
        [`unreadBy.${user.uid}`]: 0,
      };

      if (recipientId && recipientId !== user.uid) {
        matchPatch[`unreadBy.${recipientId}`] = increment(1);
      }

      await updateDoc(doc(db, 'matches', matchId), matchPatch as any);

      // In-app notification for the recipient (unread badge increments).
      if (recipientId && recipientId !== user.uid && !isRecipientMuted(recipientId)) {
        await addDoc(collection(db, 'notifications'), {
          userId: recipientId,
          fromId: user.uid,
          fromName: profile?.displayName || 'Someone',
          fromPic: profile?.profilePic || '',
          type: 'message',
          content: notificationContent,
          matchId,
          isRead: false,
          timestamp: serverTimestamp(),
        });
      }

      await setDoc(doc(db, 'presence', user.uid), { isOnline: true, lastActiveAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error(e);
      Alert.alert('Message failed', 'Could not send this message. Check your connection and Firebase rules.');
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || !user) return;

    const text = inputText.trim();
    setInputText('');
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    void setTypingState(false);
    const replyPayload = replyTo
      ? { replyToMessageId: replyTo.messageId, replyToSenderId: replyTo.senderId, replyToText: replyTo.text }
      : {};
    setReplyTo(null);
    await sendChatText(text, replyPayload);
  };

  const toggleArrayField = async (field: 'pinnedBy' | 'archivedBy' | 'importantBy' | 'confidentialBy' | 'deletedBy') => {
    if (!matchId) {
      Alert.alert('Demo chat', 'Pin/Archive/Important works on real chats (a matchId is required).');
      return;
    }
    if (!myUid) return;
    try {
      setBusyAction(true);
      const ref = doc(db, 'matches', matchId);
      const current = Array.isArray(matchMeta?.[field]) ? matchMeta[field] : [];
      const has = current.includes(myUid);
      await updateDoc(ref, { [field]: has ? arrayRemove(myUid) : arrayUnion(myUid) } as any);

      if (field === 'archivedBy') {
        closeOptionsMenu();
        Alert.alert(has ? 'Unarchived' : 'Archived', has ? 'This chat is back in your inbox.' : 'This chat is now archived.');
        if (!has) navigation.goBack();
        return;
      }

      if (field === 'deletedBy') {
        closeOptionsMenu();
        Alert.alert('Deleted', 'This conversation was removed from your inbox.');
        navigation.goBack();
        return;
      }

      closeOptionsMenu();
      if (field === 'pinnedBy') Alert.alert(has ? 'Unpinned' : 'Pinned', has ? 'Conversation unpinned.' : 'Conversation pinned.');
      if (field === 'importantBy') Alert.alert(has ? 'Unmarked' : 'Marked Important', has ? 'Removed from important.' : 'Marked as important.');
      if (field === 'confidentialBy') Alert.alert(has ? 'Confidential Off' : 'Confidential On', has ? 'Confidential mode disabled.' : 'This conversation is now marked confidential.');
    } catch (e) {
      console.error('toggle field error', e);
      Alert.alert('Error', 'Action failed. Check Firebase permissions.');
    } finally {
      setBusyAction(false);
    }
  };

  const setMute = async (hours: number | 'forever' | 'off') => {
    if (!matchId) {
      Alert.alert('Demo chat', 'Mute works on real chats (a matchId is required).');
      return;
    }
    if (!myUid) return;
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
      closeMutePicker();
      closeOptionsMenu();
      if (hours === 'off') Alert.alert('Unmuted', 'Notifications unmuted.');
      else Alert.alert('Muted', hours === 'forever' ? 'Muted forever.' : `Muted for ${hours} hour(s).`);
    } catch (e) {
      console.error('mute error', e);
      Alert.alert('Error', 'Could not update mute.');
    } finally {
      setBusyAction(false);
    }
  };

  const toggleBlockUser = async () => {
    if (!matchId) return;
    const blockedUserId = otherUserId || otherUser?.uid;
    if (!myUid || !blockedUserId) return;
    try {
      setBusyAction(true);
      const blockId = `${myUid}_${blockedUserId}`;
      if (hasBlockedUser) {
        await deleteDoc(doc(db, 'blocks', blockId));
        closeOptionsMenu();
        Alert.alert('Unblocked', `${otherUser.displayName || 'User'} can now message you again.`);
        return;
      }

      await setDoc(doc(db, 'blocks', blockId), {
        blockedById: myUid,
        blockedUserId,
        timestamp: serverTimestamp(),
      });

      closeOptionsMenu();
      Alert.alert('Blocked', `${otherUser.displayName || 'User'} is blocked. The chat stays here so you can unblock later.`);
    } catch (e) {
      console.error('block toggle error', e);
      Alert.alert('Error', hasBlockedUser ? 'Could not unblock user.' : 'Could not block user.');
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
          await toggleArrayField('deletedBy');
        },
      },
    ]);
  };

  const inviteToTeam = async () => {
    if (!otherUser?.uid) return;
    const inviteText = `Team invite: I’d like to explore building together on LINKUP. Are you open to joining a startup/project conversation?`;
    await sendChatText(inviteText, {}, 'invited you to collaborate on a team.');
    closeOptionsMenu();
    Alert.alert('Invite Sent', 'A team invite message was sent in this chat.');
  };

  const scheduleMeeting = () => {
    const meetingText = `Meeting request: Are you available for a quick LINKUP call this week?`;
    closeOptionsMenu();
    Alert.alert('Schedule Meeting', 'Choose how you want to schedule.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Message Request',
        onPress: () => setInputText(meetingText),
      },
      {
        text: 'Google Meet',
        onPress: () => Linking.openURL('https://meet.google.com/new').catch(() => setInputText(meetingText)),
      },
      {
        text: 'Calendly',
        onPress: () => Linking.openURL('https://calendly.com/').catch(() => setInputText(meetingText)),
      },
    ]);
  };

  const shareContactCard = async () => {
    try {
      const card = [
        `${profile?.displayName || user?.displayName || 'LINKUP Builder'}`,
        profile?.occupation ? `${profile.occupation}${profile?.company ? ` @ ${profile.company}` : ''}` : '',
        profile?.city || profile?.country ? [profile.city, profile.country].filter(Boolean).join(', ') : '',
        profile?.profileLink || (user?.uid ? `linkup://profile/${user.uid}` : ''),
      ].filter(Boolean).join('\n');
      await Share.share({ title: 'LINKUP contact card', message: card });
      closeOptionsMenu();
    } catch (e) {
      console.error('share contact error', e);
      Alert.alert('Share failed', 'Could not open the share sheet.');
    }
  };

  const exportConversation = async () => {
    try {
      const transcript = messages.length
        ? messages.map((message) => {
            const sender = message.senderId === user?.uid ? 'You' : (otherUser?.displayName || 'Them');
            const time = formatMessageTime(message.timestamp) || '--:--';
            return `[${time}] ${sender}: ${message.content || ''}`;
          }).join('\n')
        : 'No messages yet.';
      await Share.share({
        title: 'LINKUP conversation export',
        message: `LINKUP Conversation with ${otherUser?.displayName || 'Builder'}\n\n${transcript}`,
      });
      closeOptionsMenu();
    } catch (e) {
      console.error('export conversation error', e);
      Alert.alert('Export failed', 'Could not export this conversation.');
    }
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

  const otherIsTyping = !!(otherUserId && matchMeta?.typingBy?.[otherUserId]);
  const otherIsOnline = isPresenceOnline(otherUser);
  const headerStatus = otherIsTyping ? 'TYPING...' : (otherIsOnline ? 'ONLINE' : formatLastSeen(otherUser?.lastActiveAt));
  const headerStatusColor = otherIsTyping ? '#2563EB' : (otherIsOnline ? '#4ADE80' : '#888');

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
                <Text style={[styles.status, { color: headerStatusColor }]}>
                  {headerStatus}
                </Text>
                <View style={styles.securityLine}>
                  <Shield size={10} color="#22C55E" />
                  <Text style={styles.securityText}>END-TO-END ENCRYPTED</Text>
                </View>
              </View>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.avatar, { backgroundColor: isDark ? '#16161A' : '#EEE' }]} />
              <View>
                <Text style={[styles.name, { color: isDark ? '#FFF' : '#000' }]}>CHAT</Text>
                <Text style={styles.status}>Loading…</Text>
                <View style={styles.securityLine}>
                  <Shield size={10} color="#22C55E" />
                  <Text style={styles.securityText}>END-TO-END ENCRYPTED</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={openOptionsMenu} style={{ padding: 8, alignItems: 'center', justifyContent: 'center' }}>
          <MoreVertical size={22} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>
      </View>

      {isConfidential && (
        <View style={[styles.confidentialBanner, { backgroundColor: isDark ? '#16161A' : '#FFFBEA', borderColor: '#FBE61855' }]}>
          <Shield size={14} color="#FBE618" />
          <Text style={[styles.confidentialText, { color: isDark ? '#FBE618' : '#92400E' }]}>
            CONFIDENTIAL BUSINESS CHAT
          </Text>
        </View>
      )}

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
          {otherIsTyping && (
            <View style={[styles.typingPill, { backgroundColor: isDark ? '#111115' : '#EEF2FF', borderColor: isDark ? '#222226' : '#DBEAFE' }]}>
              <Text style={[styles.typingText, { color: isDark ? '#FBE618' : '#2563EB' }]}>
                {(otherUser?.displayName || 'Builder').split(' ')[0]} is typing...
              </Text>
            </View>
          )}
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
              Alert.alert("INTRO", "Drafting a perfect opening based on your profiles...");
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
            onChangeText={handleInputChange}
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

      <Modal transparent visible={optionsOpen} animationType="fade" onRequestClose={closeOptionsMenu}>
        <Pressable style={styles.modalOverlay} onPress={closeOptionsMenu} />
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
                closeOptionsMenu();
                if (!otherUser?.uid) return;
                navigation.navigate('Profile', { userId: otherUser.uid });
              }}
            />

            <MenuItem
              icon={<BellOff size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Mute Notifications"
              subtitle={mutedUntilLabel || 'Choose duration'}
              onPress={() => {
                closeOptionsMenu();
                openMutePicker();
              }}
            />

            <MenuItem
              icon={<Pin size={18} color={isDark ? '#FFF' : '#000'} />}
              title={isPinned ? 'Unpin Conversation' : 'Pin Conversation'}
              subtitle="Keep this chat at the top"
              onPress={() => toggleArrayField('pinnedBy')}
            />

            <MenuItem
              icon={<Archive size={18} color={isDark ? '#FFF' : '#000'} />}
              title={isArchived ? 'Unarchive Chat' : 'Archive Chat'}
              subtitle={isArchived ? 'Show in inbox again' : 'Hide from inbox without deleting'}
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
              subtitle="Send a collaboration invite"
              onPress={inviteToTeam}
            />

            <MenuItem
              icon={<Calendar size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Schedule Meeting"
              subtitle="Zoom / Google Meet / Calendly"
              onPress={scheduleMeeting}
            />

            <MenuItem
              icon={<ContactRound size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Share Contact Card"
              subtitle="Share your LINKUP identity"
              onPress={shareContactCard}
            />

            <MenuItem
              icon={<Shield size={18} color={isConfidential ? '#FBE618' : (isDark ? '#FFF' : '#000')} />}
              title={isConfidential ? 'Disable Confidential Mode' : 'Confidential Mode'}
              subtitle={isConfidential ? 'Conversation marked confidential' : 'Mark this business chat confidential'}
              onPress={() => toggleArrayField('confidentialBy')}
            />

            <MenuItem
              icon={<FileText size={18} color={isDark ? '#FFF' : '#000'} />}
              title="Export Conversation"
              subtitle="Share as text transcript"
              onPress={exportConversation}
            />

            <MenuItem
              icon={<UserX size={18} color="#EF4444" />}
              title={hasBlockedUser ? 'Unblock User' : 'Block User'}
              subtitle={hasBlockedUser ? 'Allow messaging again' : 'Stop messages without deleting this chat'}
              danger
              onPress={() => {
                Alert.alert(hasBlockedUser ? 'Unblock user' : 'Block user', hasBlockedUser ? 'Allow this user to message you again?' : 'Block this user? The chat will stay available so you can unblock later.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: hasBlockedUser ? 'Unblock' : 'Block', style: hasBlockedUser ? 'default' : 'destructive', onPress: toggleBlockUser },
                ]);
              }}
            />

            <MenuItem
              icon={<Trash2 size={18} color="#EF4444" />}
              title="Delete Conversation"
              subtitle="Deletes locally for you"
              danger
              onPress={deleteConversation}
            />
          </ScrollView>
        </View>
      </Modal>

      <Modal transparent visible={mutePickerOpen} animationType="fade" onRequestClose={closeMutePicker}>
        <Pressable style={styles.modalOverlay} onPress={closeMutePicker} />
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
    fontWeight: '900',
  },
  securityLine: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  securityText: {
    fontSize: 9,
    color: '#22C55E',
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  confidentialBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confidentialText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
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
  typingPill: {
    position: 'absolute',
    left: 16,
    top: -38,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  typingText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
