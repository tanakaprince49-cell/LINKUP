import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, SafeAreaView, KeyboardAvoidingView, Platform, Image, Alert, StatusBar } from 'react-native';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Send, Camera, Zap } from 'lucide-react-native';
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
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const [otherUser, setOtherUser] = useState<any>(otherUserParam || null);

  useEffect(() => {
    if (matchId) return;
    Alert.alert('Chat error', 'This conversation could not be opened.');
    navigation.goBack();
  }, [matchId, navigation]);

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
    const otherId = otherUserParam?.uid;
    if (!otherId) return;
    const unsub = onSnapshot(doc(db, 'users', otherId), (snap) => {
      if (!snap.exists()) return;
      setOtherUser({ uid: otherId, ...(snap.data() as any) });
    });
    return () => unsub();
  }, [otherUserParam?.uid]);

  const handleSend = async () => {
    if (!inputText.trim() || !user || !matchId) return;
    
    const text = inputText;
    setInputText('');

    try {
      await addDoc(collection(db, 'matches', matchId, 'messages'), {
        senderId: user.uid,
        content: text,
        timestamp: serverTimestamp(),
        type: 'text'
      });

      await updateDoc(doc(db, 'matches', matchId), {
        lastMessage: text,
        lastMessageTime: serverTimestamp()
      });

      await updateDoc(doc(db, 'users', user.uid), {
        isOnline: true,
        lastActiveAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.senderId === user?.uid;
    return (
      <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
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
            <Text style={[styles.messageText, { color: isMe ? '#000' : (isDark ? '#FFF' : '#000') }]}>
              {item.content}
            </Text>
            <Text style={[styles.messageTime, { color: isMe ? '#00000080' : (isDark ? '#FFFFFF80' : '#00000080') }]}>
              {formatMessageTime(item.timestamp)}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
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

        <TouchableOpacity onPress={() => {
          Alert.alert(
            "Options",
            `Report or Block ${otherUser?.displayName || 'this user'}?`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Report User", style: "destructive", onPress: async () => {
                await addDoc(collection(db, 'reports'), {
                  reportedId: otherUser?.uid,
                  reportedBy: user?.uid,
                  reason: 'Inappropriate behavior in chat',
                  timestamp: serverTimestamp()
                });
                Alert.alert("Report Sent", "This report has been sent directly to tanakaprince49@gmail.com for immediate review.");
              }},
              { text: "Block User", style: "destructive", onPress: () => {
                Alert.alert("Blocked", `${otherUser?.displayName || 'This user'} has been blocked.`);
                navigation.goBack();
              }}
            ]
          );
        }}>
          <Text style={{ fontSize: 24, color: isDark ? '#FFF' : '#000', fontWeight: 'bold', paddingBottom: 10 }}>⋮</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={[styles.inputContainer, { backgroundColor: isDark ? '#0A0A0C' : '#FFF', borderTopColor: isDark ? '#1A1A1F' : '#EEE' }]}>
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
  }
});
