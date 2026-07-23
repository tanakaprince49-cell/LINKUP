import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image, Alert, StatusBar, Modal, Pressable, ScrollView, Linking, Share, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, deleteDoc, getDoc, setDoc, arrayUnion, arrayRemove, increment, limitToLast } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Send, Camera, Zap, MoreVertical, BellOff, Pin, Archive, Star, Users, Calendar, ContactRound, Shield, UserX, FileText, Trash2, Reply, X } from 'lucide-react-native';
import { generateWarmIntro } from '../lib/ai';
import { blurActiveElementOnWeb } from '../lib/webFocus';
import { profileLinkFor, publicProfileLink } from '../lib/profileLinks';
import VerifiedBadge from '../components/VerifiedBadge';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { imageAssetToDataUri } from '../lib/imageUploadLimits';
import PaywallModal from '../components/PaywallModal';
import { isAndroidProLocked, PRO_FEATURES } from '../lib/paywall';
import { MOBILE_CHAT_MESSAGE_LIMIT, MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { conversationAvatarUri, loadConversationProfile, normalizeConversationProfile } from '../lib/conversationProfiles';

const isPermissionDenied = (error: any) => String(error?.code || '').includes('permission-denied');
const MAX_FREE_INLINE_IMAGE_CHARS = 900_000;
const MAX_PRO_INLINE_IMAGE_CHARS = 900_000;
const MAX_CHAT_VIDEO_BYTES = 75 * 1024 * 1024;
const CLOUDINARY_CLOUD_NAME = String(process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || '').trim();
const CLOUDINARY_UPLOAD_PRESET = String(process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || '').trim();
const cloudinaryEnabled = () => !!CLOUDINARY_CLOUD_NAME && !!CLOUDINARY_UPLOAD_PRESET;

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

const guessMediaExtension = (asset: ImagePicker.ImagePickerAsset, mediaKind: 'image' | 'video') => {
  const fromName = asset.fileName?.split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const mimeExt = asset.mimeType?.split('/').pop()?.toLowerCase();
  if (mimeExt && /^[a-z0-9]{2,5}$/.test(mimeExt)) return mimeExt === 'jpeg' ? 'jpg' : mimeExt;
  return mediaKind === 'video' ? 'mp4' : 'jpg';
};

const mediaLabel = (mediaKind: 'image' | 'video') => (mediaKind === 'video' ? 'Video' : 'Photo');

const inlineImageDataUri = (asset: ImagePicker.ImagePickerAsset) => {
  if (!asset.base64) return '';
  const mimeType = asset.mimeType || 'image/jpeg';
  return `data:${mimeType};base64,${asset.base64}`;
};

const webUploadFileFor = async (asset: ImagePicker.ImagePickerAsset, mediaKind: 'image' | 'video') => {
  if (Platform.OS !== 'web') return null;
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error('Could not prepare selected media.');
  const blob = await response.blob();
  const fileName = asset.fileName || `linkup-chat-${Date.now()}.${guessMediaExtension(asset, mediaKind)}`;
  const mimeType = asset.mimeType || blob.type || (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg');
  const WebFile = (globalThis as any).File;
  return typeof WebFile === 'function' ? new WebFile([blob], fileName, { type: mimeType }) : blob;
};

const uploadToCloudinary = async (asset: ImagePicker.ImagePickerAsset, mediaKind: 'image' | 'video') => {
  if (!cloudinaryEnabled()) return null;
  const form = new FormData();
  const webFile = await webUploadFileFor(asset, mediaKind);
  form.append(
    'file',
    webFile ||
      ({
        uri: asset.uri,
        name: asset.fileName || `linkup-chat-${Date.now()}.${guessMediaExtension(asset, mediaKind)}`,
        type: asset.mimeType || (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg'),
      } as any)
  );
  form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  form.append('folder', 'linkup/chat');

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${mediaKind}/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data?.secure_url !== 'string') {
    throw new Error(data?.error?.message || 'Media host upload failed.');
  }
  return data.secure_url as string;
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
  const [mediaBusy, setMediaBusy] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('');
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingValueRef = useRef(false);
  const sendingTextRef = useRef(false);
  const myUid = user?.uid;
  const proLocked = isAndroidProLocked(profile);
  const openPaywall = (feature: string) => setPaywallFeature(feature);
  const otherUserId = useMemo(
    () => {
      if (otherUser?.uid) return otherUser.uid;
      if (otherUserParam?.uid) return otherUserParam.uid;
      if (Array.isArray(matchMeta?.userIds)) {
        return matchMeta.userIds.find((id: string) => id && id !== myUid) || '';
      }
      const participants = matchMeta?.participants && typeof matchMeta.participants === 'object' ? matchMeta.participants : {};
      return Object.keys(participants).find((id) => id && id !== myUid && participants[id]) || '';
    },
    [matchMeta?.participants, matchMeta?.userIds, myUid, otherUser?.uid, otherUserParam?.uid]
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
    const scrollToLatest = () => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: Platform.OS !== 'android' });
      }, Platform.OS === 'android' ? 0 : 80);
    };
    const q = query(
      collection(db, 'matches', matchId, 'messages'),
      orderBy('timestamp', 'asc'),
      limitToLast(MOBILE_CHAT_MESSAGE_LIMIT)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const msgs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMessages(msgs);
        scrollToLatest();
      },
      (err) => {
        console.warn('Chat messages unavailable:', err);
        setMessages([]);
      }
    );

    return () => {
      unsub();
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
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

    let cancelled = false;
    const profileMap = matchMeta?.participantProfiles || matchMeta?.profiles || {};
    const fallback = normalizeConversationProfile(otherId, profileMap?.[otherId] || otherUserParam || otherUser || {});
    setOtherUser((prev: any) => normalizeConversationProfile(otherId, prev || {}, fallback));

    loadConversationProfile(otherId, fallback)
      .then((profile) => {
        if (!cancelled) setOtherUser((prev: any) => ({ ...(prev || {}), ...profile }));
      })
      .catch((err) => {
        if (cancelled || isPermissionDenied(err)) return;
        console.warn('Chat user unavailable:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [matchMeta?.participantProfiles, otherUserId]);

  useEffect(() => {
    const otherId = otherUserId;
    if (!otherId || !otherUser) return;
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
        if (!isPermissionDenied(err)) {
          console.warn('Chat presence unavailable:', err);
        }
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
          fromPic: safeProfileImageUri(profile?.profilePic, MOBILE_LIST_IMAGE_LIMIT),
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

  const sendChatMedia = async (asset: ImagePicker.ImagePickerAsset, mediaKind: 'image' | 'video') => {
    if (!user || !matchId) return;
    if (hasBlockedUser) {
      Alert.alert('User blocked', 'Unblock this user before sending media.');
      return;
    }

    const size = Number(asset.fileSize || 0);
    if (mediaKind === 'video' && !cloudinaryEnabled()) {
      Alert.alert(
        'Video host needed',
        'Firebase Storage is not available on your plan, so videos need a free media host. Add Cloudinary cloud name and unsigned upload preset to enable video chat.'
      );
      return;
    }
    if (mediaKind === 'video' && size > MAX_CHAT_VIDEO_BYTES) {
      Alert.alert('File too large', `Video must be under ${Math.round(MAX_CHAT_VIDEO_BYTES / 1024 / 1024)} MB.`);
      return;
    }

    setMediaBusy(true);
    try {
      const ext = guessMediaExtension(asset, mediaKind);
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      let mediaUrl = '';
      let storedMediaSize = size;
      if (cloudinaryEnabled()) {
        mediaUrl = await uploadToCloudinary(asset, mediaKind) || '';
      } else {
        const inlineLimit = proLocked ? MAX_FREE_INLINE_IMAGE_CHARS : MAX_PRO_INLINE_IMAGE_CHARS;
        const preparedImage = await imageAssetToDataUri(asset, inlineLimit);
        mediaUrl = preparedImage.dataUri || inlineImageDataUri(asset);
        if (mediaUrl.length > inlineLimit) {
          if (proLocked) openPaywall(PRO_FEATURES.largerMedia);
          else Alert.alert('Photo too large', 'Choose a smaller photo. This no-storage mode supports compact chat photos only.');
          return;
        }
        if (!mediaUrl) {
          throw new Error(preparedImage.error || 'Image data was unavailable.');
        }
        storedMediaSize = mediaUrl.length;
      }

      const caption = inputText.trim();
      setInputText('');
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      void setTypingState(false);
      const replyPayload = replyTo
        ? { replyToMessageId: replyTo.messageId, replyToSenderId: replyTo.senderId, replyToText: replyTo.text }
        : {};
      setReplyTo(null);

      await addDoc(collection(db, 'matches', matchId, 'messages'), {
        senderId: user.uid,
        content: caption || mediaLabel(mediaKind),
        timestamp: serverTimestamp(),
        type: mediaKind,
        mediaUrl,
        mediaName: asset.fileName || fileName,
        mediaType: asset.mimeType || (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg'),
        mediaSize: storedMediaSize || mediaUrl.length || 0,
        ...replyPayload,
      });

      const recipientId = otherUserId || otherUser?.uid;
      const lastMessage = caption || (mediaKind === 'video' ? 'Sent a video' : 'Sent a photo');
      const matchPatch: Record<string, unknown> = {
        lastMessage,
        lastMessageTime: serverTimestamp(),
        [`unreadBy.${user.uid}`]: 0,
      };
      if (recipientId && recipientId !== user.uid) {
        matchPatch[`unreadBy.${recipientId}`] = increment(1);
      }
      await updateDoc(doc(db, 'matches', matchId), matchPatch as any);

      if (recipientId && recipientId !== user.uid && !isRecipientMuted(recipientId)) {
        await addDoc(collection(db, 'notifications'), {
          userId: recipientId,
          fromId: user.uid,
          fromName: profile?.displayName || 'Someone',
          fromPic: safeProfileImageUri(profile?.profilePic, MOBILE_LIST_IMAGE_LIMIT),
          type: 'message',
          content: mediaKind === 'video' ? 'sent you a video.' : 'sent you a photo.',
          matchId,
          isRead: false,
          timestamp: serverTimestamp(),
        });
      }

      await setDoc(doc(db, 'presence', user.uid), { isOnline: true, lastActiveAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error('Media message failed:', e);
      Alert.alert('Media failed', 'Could not send this media. Check your connection and try a smaller file.');
    } finally {
      setMediaBusy(false);
    }
  };

  const pickAndSendMedia = async (source: 'library' | 'camera', mediaKind: 'image' | 'video') => {
    if (mediaBusy) return;
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', source === 'camera' ? 'Allow camera access to take media.' : 'Allow photo access to send media.');
      return;
    }

    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: mediaKind === 'video' ? ['videos'] : ['images'],
      quality: mediaKind === 'image' ? (proLocked ? 0.22 : 0.5) : 1,
      allowsEditing: false,
      base64: mediaKind === 'image' && !cloudinaryEnabled(),
      videoMaxDuration: 60,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOptions)
        : await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (result.canceled || !result.assets?.[0]) return;
    await sendChatMedia(result.assets[0], mediaKind);
  };

  const openMediaPicker = () => {
    if (!user || !matchId) return;
    if (hasBlockedUser) {
      Alert.alert('User blocked', 'Unblock this user before sending media.');
      return;
    }
    if (Platform.OS === 'web') {
      void pickAndSendMedia('library', 'image');
      return;
    }
    Alert.alert('Send media', 'Choose what to send.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Photo Library', onPress: () => pickAndSendMedia('library', 'image') },
      { text: 'Video Library', onPress: () => proLocked ? openPaywall(PRO_FEATURES.largerMedia) : pickAndSendMedia('library', 'video') },
      { text: 'Take Photo', onPress: () => pickAndSendMedia('camera', 'image') },
      { text: 'Record Video', onPress: () => proLocked ? openPaywall(PRO_FEATURES.largerMedia) : pickAndSendMedia('camera', 'video') },
    ]);
  };

  const handleSend = async () => {
    if (!inputText.trim() || !user) return;
    if (sendingTextRef.current) return;

    sendingTextRef.current = true;
    const text = inputText.trim();
    setInputText('');
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    void setTypingState(false);
    const replyPayload = replyTo
      ? { replyToMessageId: replyTo.messageId, replyToSenderId: replyTo.senderId, replyToText: replyTo.text }
      : {};
    setReplyTo(null);
    try {
      await sendChatText(text, replyPayload);
    } finally {
      sendingTextRef.current = false;
    }
  };

  const handleComposerKeyPress = (event: any) => {
    if (Platform.OS !== 'web') return;
    const nativeEvent = event?.nativeEvent || {};
    if (nativeEvent.key !== 'Enter' || nativeEvent.shiftKey) return;
    event?.preventDefault?.();
    nativeEvent?.preventDefault?.();
    void handleSend();
  };

  const toggleArrayField = async (field: 'pinnedBy' | 'archivedBy' | 'importantBy' | 'confidentialBy' | 'deletedBy') => {
    if (field === 'importantBy' && proLocked) {
      openPaywall(PRO_FEATURES.messagePriority);
      return;
    }
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
    const inviteText = `Team invite: I'd like to explore building together on LINKUP. Are you open to joining a startup/project conversation?`;
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
        profileLinkFor(profile) || publicProfileLink(user?.uid),
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

  const deleteMessage = (messageId: string) => {
    if (!matchId || !messageId) return;
    Alert.alert('Delete message', 'Delete this message for everyone?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'matches', matchId, 'messages', messageId));
          } catch (e) {
            console.error('Delete message error:', e);
            Alert.alert('Error', 'Could not delete message.');
          }
        },
      },
    ]);
  };

  const replyToMessage = (item: any) => {
    setReplyTo({
      messageId: String(item.id),
      senderId: String(item.senderId),
      text: String(item.content ?? '').slice(0, 180),
    });
  };

  const openMessageOptions = (item: any, isMe: boolean) => {
    const options: any[] = [
      { text: 'Reply', onPress: () => replyToMessage(item) },
    ];
    if (isMe) {
      options.push({ text: 'Delete', style: 'destructive', onPress: () => deleteMessage(String(item.id)) });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Message options', '', options);
  };

  const MenuItem = ({ icon, title, subtitle, danger, onPress }: any) => (
    <TouchableOpacity
      disabled={busyAction}
      onPress={onPress}
      style={[styles.menuItem, { opacity: busyAction ? 0.6 : 1 }]}
    >
      <View style={[styles.menuIcon, danger ? { backgroundColor: '#EF444420' } : liquidGlass(isDark, false)]}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.menuTitle, { color: danger ? '#EF4444' : textColor(isDark) }]}>{title}</Text>
        {!!subtitle && <Text style={[styles.menuSub, { color: textColor(isDark, 'secondary') }]}>{subtitle}</Text>}
      </View>
    </TouchableOpacity>
  );

  const renderMessage = ({ item }: { item: any }) => {
    const isMe = item.senderId === user?.uid;
    return (
      <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
        <Pressable
          onLongPress={() => {
            if (!matchId) return;
            openMessageOptions(item, isMe);
          }}
          delayLongPress={350}
        >
          <View style={[
            styles.messageBubble,
            isMe ? styles.myBubble : styles.theirBubble,
            liquidGlass(isDark, false),
            {
              backgroundColor: isMe ? COLORS.primary : (isDark ? COLORS.darkCard : COLORS.lightCard),
              borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
            }
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
            {item.type === 'image' && !!item.mediaUrl && (
              <TouchableOpacity activeOpacity={0.92} onPress={() => Linking.openURL(item.mediaUrl).catch(() => {})}>
                <Image source={{ uri: safeProfileImageUri(item.mediaUrl, MOBILE_LIST_IMAGE_LIMIT) || item.mediaUrl }} style={styles.messageImage} resizeMode="cover" />
              </TouchableOpacity>
            )}
            {item.type === 'video' && !!item.mediaUrl && (
              <TouchableOpacity
                activeOpacity={0.9}
                style={[styles.videoMessageCard, { backgroundColor: isMe ? '#00000018' : (isDark ? '#222226' : '#FFFFFF') }]}
                onPress={() => Linking.openURL(item.mediaUrl).catch(() => Alert.alert('Video unavailable', 'Could not open this video.'))}
              >
                <Camera size={24} color={isMe ? '#000' : (isDark ? '#FFF' : '#000')} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.videoMessageTitle, { color: isMe ? '#000' : (isDark ? '#FFF' : '#000') }]}>VIDEO</Text>
                  <Text style={[styles.videoMessageSub, { color: isMe ? '#00000080' : (isDark ? '#FFFFFF80' : '#00000080') }]} numberOfLines={1}>
                    Tap to open
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            {!!item.content && item.content !== 'Photo' && item.content !== 'Video' && (
              <Text style={[styles.messageText, { color: isMe ? '#000' : (isDark ? '#FFF' : '#000') }]}>
                {item.content}
              </Text>
            )}
            <Text style={[styles.messageTime, { color: isMe ? '#00000080' : (isDark ? '#FFFFFF80' : '#00000080') }]}>
              {formatMessageTime(item.timestamp)}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  };

  const otherIsTyping = !!(otherUserId && matchMeta?.typingBy?.[otherUserId]);
  const otherIsOnline = isPresenceOnline(otherUser);
  const headerStatus = otherIsTyping ? 'TYPING...' : (otherIsOnline ? 'ONLINE' : formatLastSeen(otherUser?.lastActiveAt));
  const headerStatusColor = otherIsTyping ? COLORS.primary : (otherIsOnline ? COLORS.success : textColor(isDark, 'muted'));
  const headerAvatarUri = conversationAvatarUri(otherUser?.profilePic);
  const headerInitial = String(otherUser?.displayName || 'L').trim().charAt(0).toUpperCase() || 'L';
  const canOpenOtherProfile = !!otherUserId && otherUserId !== 'undefined';
  const openOtherProfile = () => {
    if (!canOpenOtherProfile) {
      Alert.alert('Profile unavailable', 'This chat is missing the other builder profile. Try reopening it from Messages.');
      return;
    }
    navigation.navigate('Profile', { userId: otherUserId });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={[styles.header, liquidGlass(isDark, false), { borderBottomColor: isDark ? COLORS.darkBorder : COLORS.lightBorder, justifyContent: 'space-between' }]}> 
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ChevronLeft size={24} color={textColor(isDark)} />
          </TouchableOpacity>
          {otherUser ? (
            <TouchableOpacity 
              style={{ flexDirection: 'row', alignItems: 'center' }} 
              onPress={openOtherProfile}
            >
              {headerAvatarUri ? (
                <Image source={{ uri: headerAvatarUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: isDark ? '#181818' : '#FFF8B8' }]}>
                  <Text style={styles.avatarFallbackText}>{headerInitial}</Text>
                </View>
              )}
              <View>
                <View style={styles.chatNameRow}>
                  <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={1}>{otherUser.displayName || 'Builder'}</Text>
                  {!!otherUser.isVerified && <VerifiedBadge size={20} />}
                </View>
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
                <Text style={[styles.name, { color: textColor(isDark) }]}>CHAT</Text>
                <Text style={styles.status}>Loading...</Text>
                <View style={styles.securityLine}>
                  <Shield size={10} color="#22C55E" />
                  <Text style={styles.securityText}>END-TO-END ENCRYPTED</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={openOptionsMenu} style={{ padding: 8, alignItems: 'center', justifyContent: 'center' }}>
          <MoreVertical size={22} color={textColor(isDark)} />
        </TouchableOpacity>
      </View>

      {isConfidential && (
        <View style={[styles.confidentialBanner, liquidGlass(isDark, false), { borderColor: 'rgba(251,230,24,0.33)' }]}>
          <Shield size={14} color={COLORS.primary} />
          <Text style={[styles.confidentialText, { color: isDark ? COLORS.primary : '#92400E' }]}>
            CONFIDENTIAL BUSINESS CHAT
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : ((StatusBar.currentHeight || 0) + 90)}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: Platform.OS !== 'android' })}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={Platform.OS === 'android' ? 10 : 20}
          maxToRenderPerBatch={Platform.OS === 'android' ? 6 : 12}
          updateCellsBatchingPeriod={80}
          windowSize={Platform.OS === 'android' ? 5 : 7}
          removeClippedSubviews={Platform.OS !== 'web'}
        />

        <View style={[styles.inputContainer, liquidGlass(isDark, false), { borderTopColor: 'transparent' }]}>
          {otherIsTyping && (
            <View style={[styles.typingPill, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <Text style={[styles.typingText, { color: textColor(isDark) }]}>
                {(otherUser?.displayName || 'Builder').split(' ')[0]} is typing...
              </Text>
            </View>
          )}
          {!!replyTo && (
            <View style={[styles.replyBar, liquidGlass(isDark)]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.replyBarTitle, { color: textColor(isDark) }]} numberOfLines={1}>
                  Replying to {replyTo.senderId === user?.uid ? 'your message' : (otherUser?.displayName || 'message')}
                </Text>
                <Text style={[styles.replyBarText, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
                  {replyTo.text}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyTo(null)} style={styles.replyClose}>
                <X size={16} color={textColor(isDark, 'secondary')} />
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity 
            style={[styles.toolBtn, liquidGlass(isDark, false), { backgroundColor: isDark ? COLORS.darkGlassStrong : COLORS.lightGlassStrong }]} 
            onPress={async () => {
              if (proLocked) {
                openPaywall(PRO_FEATURES.warmIntro);
                return;
              }
              Alert.alert("INTRO", "Drafting a perfect opening based on your profiles...");
              const intro = await generateWarmIntro(profile, otherUser);
              setInputText((intro || '').trim());
            }}
          >
            <Zap size={20} color={COLORS.primary} fill={COLORS.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, liquidGlass(isDark, false), mediaBusy && styles.toolBtnDisabled, { backgroundColor: isDark ? COLORS.darkGlassStrong : COLORS.lightGlassStrong }]} onPress={openMediaPicker} disabled={mediaBusy}>
            {mediaBusy ? <ActivityIndicator size="small" color="#666" /> : <Camera size={20} color="#666" />}
          </TouchableOpacity>
          <TextInput
            style={[styles.input, { color: textColor(isDark) }, liquidGlass(isDark, false)]}
            placeholder="Type a message..."
            placeholderTextColor="#666"
            value={inputText}
            onChangeText={handleInputChange}
            onKeyPress={handleComposerKeyPress}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
            returnKeyType="send"
            submitBehavior="submit"
            multiline
          />
          <TouchableOpacity 
            style={[styles.sendBtn, { opacity: inputText.trim() ? 1 : 0.5, backgroundColor: COLORS.primary }]} 
            onPress={handleSend}
            disabled={!inputText.trim()}
          >
            <Send size={20} color="#000" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <Modal transparent visible={optionsOpen} animationType="fade" onRequestClose={closeOptionsMenu}>
        <Pressable style={styles.modalOverlay} onPress={closeOptionsMenu} />
        <View style={[styles.menuSheet, liquidGlass(isDark)]}>
          <View style={styles.menuHeaderRow}>
            <Text style={[styles.menuHeader, { color: textColor(isDark) }]}>CHAT OPTIONS</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {isPinned && <Pin size={14} color={COLORS.primary} />}
              {isImportant && <Star size={14} color={COLORS.primary} fill={COLORS.primary} />}
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 520 }}>
            <MenuItem
              icon={<ContactRound size={18} color={textColor(isDark)} />}
              title="View Profile"
              subtitle="Open full business profile"
              onPress={() => {
                closeOptionsMenu();
                openOtherProfile();
              }}
            />

            <MenuItem
              icon={<BellOff size={18} color={textColor(isDark)} />}
              title="Mute Notifications"
              subtitle={mutedUntilLabel || 'Choose duration'}
              onPress={() => {
                closeOptionsMenu();
                openMutePicker();
              }}
            />

            <MenuItem
              icon={<Pin size={18} color={textColor(isDark)} />}
              title={isPinned ? 'Unpin Conversation' : 'Pin Conversation'}
              subtitle="Keep this chat at the top"
              onPress={() => toggleArrayField('pinnedBy')}
            />

            <MenuItem
              icon={<Archive size={18} color={textColor(isDark)} />}
              title={isArchived ? 'Unarchive Chat' : 'Archive Chat'}
              subtitle={isArchived ? 'Show in inbox again' : 'Hide from inbox without deleting'}
              onPress={() => toggleArrayField('archivedBy')}
            />

            <MenuItem
              icon={<Star size={18} color={textColor(isDark)} fill={isImportant ? COLORS.primary : 'transparent'} />}
              title={isImportant ? 'Unmark Important' : 'Mark as Important'}
              subtitle="Highlight serious conversations"
              onPress={() => toggleArrayField('importantBy')}
            />

            <MenuItem
              icon={<Users size={18} color={textColor(isDark)} />}
              title="Invite to Team"
              subtitle="Send a collaboration invite"
              onPress={inviteToTeam}
            />

            <MenuItem
              icon={<Calendar size={18} color={textColor(isDark)} />}
              title="Schedule Meeting"
              subtitle="Zoom / Google Meet / Calendly"
              onPress={scheduleMeeting}
            />

            <MenuItem
              icon={<ContactRound size={18} color={textColor(isDark)} />}
              title="Share Contact Card"
              subtitle="Share your LINKUP identity"
              onPress={shareContactCard}
            />

            <MenuItem
              icon={<Shield size={18} color={isConfidential ? COLORS.primary : textColor(isDark)} />}
              title={isConfidential ? 'Disable Confidential Mode' : 'Confidential Mode'}
              subtitle={isConfidential ? 'Conversation marked confidential' : 'Mark this business chat confidential'}
              onPress={() => toggleArrayField('confidentialBy')}
            />

            <MenuItem
              icon={<FileText size={18} color={textColor(isDark)} />}
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
        <View style={[styles.menuSheet, liquidGlass(isDark)]}>
          <Text style={[styles.menuHeader, { color: textColor(isDark) }]}>MUTE</Text>
          <MenuItem icon={<BellOff size={18} color={textColor(isDark)} />} title="1 hour" onPress={() => setMute(1)} />
          <MenuItem icon={<BellOff size={18} color={textColor(isDark)} />} title="8 hours" onPress={() => setMute(8)} />
          <MenuItem icon={<BellOff size={18} color={textColor(isDark)} />} title="24 hours" onPress={() => setMute(24)} />
          <MenuItem icon={<BellOff size={18} color={textColor(isDark)} />} title="Forever" onPress={() => setMute('forever')} />
          <MenuItem icon={<BellOff size={18} color={textColor(isDark)} />} title="Unmute" onPress={() => setMute('off')} />
        </View>
      </Modal>
      <PaywallModal
        visible={!!paywallFeature}
        feature={paywallFeature || PRO_FEATURES.warmIntro}
        description="AI warm intros, message priority, and larger media sending are LINKUP PLUS features on Android."
        onClose={() => setPaywallFeature('')}
      />
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
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  avatarFallbackText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  name: {
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  chatNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: 220,
  },
  verifiedMiniBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
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
  messageImage: {
    width: 220,
    height: 260,
    borderRadius: 16,
    marginBottom: 6,
    backgroundColor: '#00000018',
  },
  videoMessageCard: {
    width: 220,
    minHeight: 82,
    borderRadius: 16,
    padding: 14,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  videoMessageTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  videoMessageSub: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '800',
  },
  messageTime: {
    fontSize: 10,
    fontWeight: '900',
    marginTop: 6,
    alignSelf: 'flex-end',
  },
  myBubble: {
    backgroundColor: COLORS.primary,
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
  toolBtnDisabled: {
    opacity: 0.55,
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
    backgroundColor: COLORS.primary,
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
