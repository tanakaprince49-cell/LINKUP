import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Image, Modal, Pressable, ScrollView, Linking, ActivityIndicator, Animated, PanResponder } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, deleteDoc, getDoc, getDocs, getDocsFromCache, setDoc, arrayUnion, arrayRemove, increment, limitToLast } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { ChevronLeft, Send, Camera, WandSparkles, MoreVertical, BellOff, Pin, Archive, Star, Users, Calendar, ContactRound, Shield, UserX, FileText, Trash2, Reply, X, Flag } from 'lucide-react-native';
import { generateWarmIntro } from '../lib/ai';
import { blurActiveElementOnWeb } from '../lib/webFocus';
import { profileLinkFor, publicProfileLink } from '../lib/profileLinks';
import VerifiedBadge from '../components/VerifiedBadge';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { imageAssetToDataUri } from '../lib/imageUploadLimits';
import { uploadImageToImageKit } from '../lib/imagekitUpload';
import { AppImage } from '../components/AppImage';
import { ikAvatar, ikImage } from '../lib/ikImage';
import PaywallModal from '../components/PaywallModal';
import { isAndroidProLocked, PRO_FEATURES } from '../lib/paywall';
import { MOBILE_CHAT_MESSAGE_LIMIT, MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { conversationAvatarUri, loadConversationProfile, normalizeConversationProfile } from '../lib/conversationProfiles';
import { subscribeToConnectionGate, type ConnectionGate } from '../lib/connectionRequests';
import { allowSendRate, reportSafetyIssue, scanMessageSafety, theyBlockedMe } from '../lib/messageSafety';
import { ensureDirectMatch } from '../lib/chat';
import { notifyUser } from '../lib/notify';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👏', '😮'] as const;
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

function ChatBubbleRow({
  children,
  onReply,
  onReactHold,
}: {
  children: React.ReactNode;
  onReply: () => void;
  onReactHold: () => void;
}) {
  const shift = useRef(new Animated.Value(0)).current;
  const replied = useRef(false);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 22 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_e, g) => {
        const x = Math.max(0, Math.min(88, g.dx));
        shift.setValue(x);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 56 && !replied.current) {
          replied.current = true;
          onReply();
          setTimeout(() => {
            replied.current = false;
          }, 400);
        }
        Animated.spring(shift, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(shift, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      },
    })
  ).current;

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 8,
          top: 0,
          bottom: 0,
          justifyContent: 'center',
          opacity: shift.interpolate({ inputRange: [0, 56], outputRange: [0, 1], extrapolate: 'clamp' }),
        }}
      >
        <Text style={{ fontSize: 18 }}>↩</Text>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: shift }] }} {...pan.panHandlers}>
        <Pressable delayLongPress={2000} onLongPress={onReactHold}>
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default function ChatScreen({ route, navigation }: any) {
  const matchId = route?.params?.matchId;
  const otherUserParam = route?.params?.otherUser;
  const draftMessage = route?.params?.draftMessage;
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const matchRepairRef = useRef(false);
  const [otherUser, setOtherUser] = useState<any>(otherUserParam || null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [mutePickerOpen, setMutePickerOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [matchMeta, setMatchMeta] = useState<any>(null);
  const [replyTo, setReplyTo] = useState<null | { messageId: string; senderId: string; text: string }>(null);
  const [hasBlockedUser, setHasBlockedUser] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('');
  const [connectionGate, setConnectionGate] = useState<ConnectionGate>({ status: 'none' });
  const [blockedByThem, setBlockedByThem] = useState(false);
  const [revealedUnsafe, setRevealedUnsafe] = useState<Record<string, boolean>>({});
  const [reactTarget, setReactTarget] = useState<any>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingValueRef = useRef(false);
  const sendingTextRef = useRef(false);
  const myUid = user?.uid;
  const proLocked = isAndroidProLocked(profile);
  const openPaywall = (feature: string) => setPaywallFeature(feature);
  const [introBusy, setIntroBusy] = useState(false);
  const handleDraftIntro = async () => {
    if (introBusy) return;
    if (proLocked) {
      openPaywall(PRO_FEATURES.warmIntro);
      return;
    }
    setIntroBusy(true);
    try {
      const intro = await generateWarmIntro(profile, otherUser);
      const cleanIntro = String(intro || '').trim();
      if (cleanIntro) {
        setInputText(cleanIntro);
      } else {
        notifyUser('Intro unavailable', 'Try again in a moment.');
      }
    } catch (error) {
      notifyUser('Intro unavailable', 'Try again in a moment.');
    } finally {
      setIntroBusy(false);
    }
  };
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
  const canSendMessages =
    !blockedByThem &&
    !hasBlockedUser &&
    (connectionGate.status === 'approved' || messages.length > 0);

  useEffect(() => {
    if (!myUid || !otherUserId) {
      setConnectionGate({ status: 'none' });
      return;
    }
    return subscribeToConnectionGate(myUid, otherUserId, setConnectionGate);
  }, [myUid, otherUserId]);

  useEffect(() => {
    if (!myUid || !otherUserId) {
      setBlockedByThem(false);
      return;
    }
    theyBlockedMe(myUid, otherUserId).then(setBlockedByThem).catch(() => setBlockedByThem(false));
  }, [myUid, otherUserId]);

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
    notifyUser('Chat unavailable', 'Open a chat from a real connection (match).');
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

    // Lane 0: disk cache — the last conversation re-opens instantly even
    // fully offline; fresh network results replace it right after.
    let painted = false;
    void getDocsFromCache(q)
      .then((snap) => {
        if (!painted && !snap.empty) {
          painted = true;
          const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          setMessages(msgs);
          scrollToLatest();
        }
      })
      .catch(() => {});

    // Lane 1 (race): paint history from a one-shot read instantly — streams
    // can hang silently on hostile networks, one-shots can't.
    void getDocs(q)
      .then((snap) => {
        if (!snap.empty) painted = true;
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setMessages(msgs);
        scrollToLatest();
      })
      .catch(() => {});

    // Lane 2: live stream keeps the thread real-time when it works.
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) painted = true;
        const msgs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMessages(msgs);
        scrollToLatest();
      },
      (err) => {
        console.warn('Chat messages unavailable:', err);
        if (!painted) setMessages([]); // keep cache-painted history on screen
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
        if (!snap.exists()) {
          // Self-heal: messages can exist under a match doc that never got
          // created, which hides the whole conversation from the Inbox.
          if (!matchRepairRef.current && user?.uid && otherUserId) {
            matchRepairRef.current = true;
            ensureDirectMatch(user.uid, otherUserId).catch(() => {
              matchRepairRef.current = false;
            });
          }
          return;
        }
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

  const draftSentRef = useRef(false);
  useEffect(() => {
    if (!matchId || !draftMessage || draftSentRef.current || !user) return;
    draftSentRef.current = true;
    sendChatText(draftMessage).catch(() => {});
  }, [matchId, draftMessage]);

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
    if (!canSendMessages) {
      notifyUser('Wait for approval', 'You can only message after they approve your connection request.');
      return;
    }
    if (hasBlockedUser) {
      notifyUser('User blocked', 'Unblock this user before sending a message.');
      return;
    }
    if (blockedByThem) {
      notifyUser('Cannot message', 'This builder has blocked you.');
      return;
    }
    if (!allowSendRate(user.uid)) {
      notifyUser('Slow down', 'Too many messages in a short time. Wait a minute.');
      return;
    }
    const scan = scanMessageSafety(text);
    if (scan.blocked) {
      notifyUser('Blocked for safety', scan.warning || 'That message is not allowed.');
      return;
    }
    if (!scan.ok) {
      const proceed = await new Promise<boolean>((resolve) => {
        notifyUser('Check this message', scan.warning, [
          { text: 'Edit', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Send anyway', onPress: () => resolve(true) },
        ]);
      });
      if (!proceed) return;
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
      notifyUser('Message failed', 'Could not send this message. Check your connection and Firebase rules.');
    }
  };

  const sendChatMedia = async (asset: ImagePicker.ImagePickerAsset, mediaKind: 'image' | 'video') => {
    if (!user || !matchId) return;
    if (hasBlockedUser) {
      notifyUser('User blocked', 'Unblock this user before sending media.');
      return;
    }

    const size = Number(asset.fileSize || 0);
    if (mediaKind === 'video' && !cloudinaryEnabled()) {
      notifyUser(
        'Video host needed',
        'Firebase Storage is not available on your plan, so videos need a free media host. Add Cloudinary cloud name and unsigned upload preset to enable video chat.'
      );
      return;
    }
    if (mediaKind === 'video' && size > MAX_CHAT_VIDEO_BYTES) {
      notifyUser('File too large', `Video must be under ${Math.round(MAX_CHAT_VIDEO_BYTES / 1024 / 1024)} MB.`);
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
        const preparedImage = await imageAssetToDataUri(asset, MAX_FREE_INLINE_IMAGE_CHARS);
        mediaUrl = preparedImage.dataUri || inlineImageDataUri(asset);
        if (mediaUrl.length > MAX_FREE_INLINE_IMAGE_CHARS) {
          notifyUser('Photo too large', 'Choose a smaller photo. This no-storage mode supports compact chat photos only.');
          return;
        }
        if (!mediaUrl) {
          throw new Error(preparedImage.error || 'Image data was unavailable.');
        }
        // CDN-FIRST: park the photo on ImageKit so message docs stay a few
        // hundred bytes and history loads instantly. Base64 inline stays as
        // the offline/degraded fallback only.
        const hosted = await uploadImageToImageKit(
          user.uid,
          mediaUrl,
          { folder: '/linkup-chat-media', fileName: `${user.uid}-${Date.now()}.${ext}` }
        ).catch(() => null);
        if (hosted) {
          mediaUrl = hosted;
          storedMediaSize = size;
        } else {
          storedMediaSize = mediaUrl.length;
        }
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
      notifyUser('Media failed', 'Could not send this media. Check your connection and try a smaller file.');
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
      notifyUser('Permission needed', source === 'camera' ? 'Allow camera access to take media.' : 'Allow photo access to send media.');
      return;
    }

    const pickerOptions: ImagePicker.ImagePickerOptions = {
      mediaTypes: mediaKind === 'video' ? ['videos'] : ['images'],
      quality: mediaKind === 'image' ? 0.5 : 1,
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
      notifyUser('User blocked', 'Unblock this user before sending media.');
      return;
    }
    if (Platform.OS === 'web') {
      void pickAndSendMedia('library', 'image');
      return;
    }
    notifyUser('Send media', 'Choose what to send.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Photo Library', onPress: () => pickAndSendMedia('library', 'image') },
      { text: 'Video Library', onPress: () => pickAndSendMedia('library', 'video') },
      { text: 'Take Photo', onPress: () => pickAndSendMedia('camera', 'image') },
      { text: 'Record Video', onPress: () => pickAndSendMedia('camera', 'video') },
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
    if (!matchId) {
      notifyUser('Demo chat', 'Pin/Archive/Important works on real chats (a matchId is required).');
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
        notifyUser(has ? 'Unarchived' : 'Archived', has ? 'This chat is back in your inbox.' : 'This chat is now archived.');
        if (!has) navigation.goBack();
        return;
      }

      if (field === 'deletedBy') {
        closeOptionsMenu();
        notifyUser('Deleted', 'This conversation was removed from your inbox.');
        navigation.goBack();
        return;
      }

      closeOptionsMenu();
      if (field === 'pinnedBy') notifyUser(has ? 'Unpinned' : 'Pinned', has ? 'Conversation unpinned.' : 'Conversation pinned.');
      if (field === 'importantBy') notifyUser(has ? 'Unmarked' : 'Marked Important', has ? 'Removed from important.' : 'Marked as important.');
      if (field === 'confidentialBy') notifyUser(has ? 'Confidential Off' : 'Confidential On', has ? 'Confidential mode disabled.' : 'This conversation is now marked confidential.');
    } catch (e) {
      console.error('toggle field error', e);
      notifyUser('Error', 'Action failed. Check Firebase permissions.');
    } finally {
      setBusyAction(false);
    }
  };

  const setMute = async (hours: number | 'forever' | 'off') => {
    if (!matchId) {
      notifyUser('Demo chat', 'Mute works on real chats (a matchId is required).');
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
      if (hours === 'off') notifyUser('Unmuted', 'Notifications unmuted.');
      else notifyUser('Muted', hours === 'forever' ? 'Muted forever.' : `Muted for ${hours} hour(s).`);
    } catch (e) {
      console.error('mute error', e);
      notifyUser('Error', 'Could not update mute.');
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
        notifyUser('Unblocked', `${otherUser.displayName || 'User'} can now message you again.`);
        return;
      }

      await setDoc(doc(db, 'blocks', blockId), {
        blockedById: myUid,
        blockedUserId,
        timestamp: serverTimestamp(),
      });

      closeOptionsMenu();
      notifyUser('Blocked', `${otherUser.displayName || 'User'} is blocked. The chat stays here so you can unblock later.`);
    } catch (e) {
      console.error('block toggle error', e);
      notifyUser('Error', hasBlockedUser ? 'Could not unblock user.' : 'Could not block user.');
    } finally {
      setBusyAction(false);
    }
  };

  const deleteConversation = async () => {
    if (!matchId) return;
    notifyUser('Delete conversation', 'Delete this chat from your inbox?', [
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

  const reportPerson = (reason: string, messageId?: string) => {
    if (!myUid || !otherUserId) return;
    reportSafetyIssue({
      reporterId: myUid,
      reportedUserId: otherUserId,
      matchId,
      messageId,
      reason,
    })
      .then(() => notifyUser('Report sent', 'Thanks. LINKUP will review this. You can also block them so they cannot write you.'))
      .catch(() => notifyUser('Report failed', 'Could not send the report. Try again.'));
  };

  const openReportUser = () => {
    closeOptionsMenu();
    notifyUser('Report this person', 'Why are you reporting them?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Scam / money ask', onPress: () => reportPerson('scam') },
      { text: 'Harassment', onPress: () => reportPerson('harassment') },
      { text: 'Spam', onPress: () => reportPerson('spam') },
      { text: 'Inappropriate', onPress: () => reportPerson('inappropriate') },
    ]);
  };

  const toggleReaction = async (item: any, emoji: string) => {
    if (!matchId || !myUid || !item?.id) return;
    const current = item.reactions && typeof item.reactions === 'object' ? { ...item.reactions } : {};
    const list = Array.isArray(current[emoji]) ? current[emoji].map(String) : [];
    const nextList = list.includes(myUid) ? list.filter((id: string) => id !== myUid) : [...list, myUid].slice(0, 40);
    if (nextList.length) current[emoji] = nextList;
    else delete current[emoji];
    try {
      await updateDoc(doc(db, 'matches', matchId, 'messages', String(item.id)), { reactions: current });
    } catch (error) {
      console.warn('Reaction failed:', error);
      notifyUser('Could not react', 'Try again in a moment.');
    }
  };

  const deleteMessage = (messageId: string) => {
    if (!matchId || !messageId) return;
    notifyUser('Delete message', 'Delete this message for everyone?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'matches', matchId, 'messages', messageId));
          } catch (e) {
            console.error('Delete message error:', e);
            notifyUser('Error', 'Could not delete message.');
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
    } else {
      options.push({
        text: 'Report message',
        style: 'destructive',
        onPress: () => reportPerson('message', String(item.id)),
      });
    }
    options.push({ text: 'Cancel', style: 'cancel' });
    notifyUser('Message options', '', options);
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
    const incomingScan = !isMe ? scanMessageSafety(String(item.content || '')) : { ok: true, blocked: false, flags: [] as any };
    const hideUnsafe = !isMe && !incomingScan.ok && !revealedUnsafe[item.id];
    if (hideUnsafe) {
      return (
        <View style={[styles.messageWrapper, styles.theirMessageWrapper]}>
          <View style={[styles.messageBubble, styles.theirBubble, liquidGlass(isDark, false)]}>
            <Text style={[styles.messageText, { color: textColor(isDark, 'secondary') }]}>
              Hidden for safety. This may be a scam or personal-data ask.
            </Text>
            <TouchableOpacity onPress={() => setRevealedUnsafe((c) => ({ ...c, [item.id]: true }))} style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.primaryStrong }}>Show message</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    const reactionEntries = Object.entries(item.reactions || {}).filter(([, ids]) => Array.isArray(ids) && ids.length > 0) as [string, string[]][];
    return (
      <View style={[styles.messageWrapper, isMe ? styles.myMessageWrapper : styles.theirMessageWrapper]}>
        <ChatBubbleRow onReply={() => replyToMessage(item)} onReactHold={() => setReactTarget(item)}>
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
                <AppImage uri={ikImage(safeProfileImageUri(item.mediaUrl, MOBILE_LIST_IMAGE_LIMIT) || item.mediaUrl, 640, 65)} style={styles.messageImage} />
              </TouchableOpacity>
            )}
            {item.type === 'video' && !!item.mediaUrl && (
              <TouchableOpacity
                activeOpacity={0.9}
                style={[styles.videoMessageCard, { backgroundColor: isMe ? '#00000018' : (isDark ? '#222226' : '#FFFFFF') }]}
                onPress={() => Linking.openURL(item.mediaUrl).catch(() => notifyUser('Video unavailable', 'Could not open this video.'))}
              >
                <Camera size={24} color={isMe ? '#000' : (isDark ? '#FFF' : '#000')} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.videoMessageTitle, { color: isMe ? '#000' : (isDark ? '#FFF' : '#000') }]}>Video</Text>
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
          {reactionEntries.length ? (
            <View style={[styles.reactionRow, isMe ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
              {reactionEntries.map(([emoji, ids]) => {
                const mine = ids.includes(String(user?.uid || ''));
                return (
                  <TouchableOpacity
                    key={emoji}
                    onPress={() => toggleReaction(item, emoji)}
                    style={[styles.reactionChip, mine && { backgroundColor: COLORS.primary, borderColor: COLORS.lightBorderActive }]}
                  >
                    <Text style={styles.reactionChipText}>{emoji} {ids.length}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </ChatBubbleRow>
      </View>
    );
  };

  const otherIsTyping = !!(otherUserId && matchMeta?.typingBy?.[otherUserId]);
  const otherIsOnline = isPresenceOnline(otherUser);
  const headerStatus = otherIsTyping ? 'TYPING...' : (otherIsOnline ? 'ONLINE' : '');
  const headerStatusColor = otherIsTyping ? COLORS.primary : (otherIsOnline ? COLORS.success : textColor(isDark, 'muted'));
  const headerAvatarUri = conversationAvatarUri(otherUser?.profilePic);
  const headerInitial = String(otherUser?.displayName || 'L').trim().charAt(0).toUpperCase() || 'L';
  const canOpenOtherProfile = !!otherUserId && otherUserId !== 'undefined';
  const openOtherProfile = () => {
    if (!canOpenOtherProfile) {
      notifyUser('Profile unavailable', 'This chat is missing the other builder profile. Try reopening it from Messages.');
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
                <AppImage uri={ikAvatar(headerAvatarUri)} style={styles.avatar} />
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
                {headerStatus ? (
                  <Text style={[styles.status, { color: headerStatusColor }]}>
                    {headerStatus}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.avatar, { backgroundColor: isDark ? '#16161A' : '#EEE' }]} />
              <View>
                <Text style={[styles.name, { color: textColor(isDark) }]}>Chat</Text>
                <Text style={styles.status}>Loading...</Text>
              </View>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={openOptionsMenu} style={{ padding: 8, alignItems: 'center', justifyContent: 'center' }}>
          <MoreVertical size={22} color={textColor(isDark)} />
        </TouchableOpacity>
      </View>

      {isConfidential && (
        <View style={[styles.confidentialBanner, liquidGlass(isDark, false), { borderColor: 'rgba(17, 24, 39,0.33)' }]}>
          <Shield size={14} color={COLORS.primaryStrong} />
          <Text style={[styles.confidentialText, { color: isDark ? COLORS.primary : '#92400E' }]}>
            CONFIDENTIAL BUSINESS CHAT
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 50}
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

        {!canSendMessages ? (
          <View style={[styles.inputContainer, { paddingVertical: 16 }]}>
            <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: textColor(isDark), lineHeight: 20 }}>
              {connectionGate.status === 'pending_out'
                ? 'Request sent. You can chat after they approve.'
                : connectionGate.status === 'pending_in'
                  ? 'They asked to connect. Approve them in Notifications.'
                  : 'Send a connection request first. Nobody can message until it’s approved.'}
            </Text>
          </View>
        ) : (
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
            onPress={handleDraftIntro}
            disabled={introBusy}
          >
            {introBusy ? <ActivityIndicator size="small" color={COLORS.primaryStrong} /> : <WandSparkles size={20} color={COLORS.primaryStrong} />}
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
        )}
      </KeyboardAvoidingView>

      <Modal transparent visible={optionsOpen} animationType="fade" onRequestClose={closeOptionsMenu}>
        <Pressable style={styles.modalOverlay} onPress={closeOptionsMenu} />
        <View style={[styles.menuSheet, liquidGlass(isDark)]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.menuHeader, { color: textColor(isDark) }]}>Chat</Text>
          <Text style={[styles.sheetHint, { color: textColor(isDark, 'muted') }]}>
            Swipe a message to reply. Hold a message to react.
          </Text>

          <MenuItem
            icon={<ContactRound size={18} color={textColor(isDark)} />}
            title="View profile"
            subtitle={otherUser?.displayName || 'Open their profile'}
            onPress={() => {
              closeOptionsMenu();
              openOtherProfile();
            }}
          />
          <MenuItem
            icon={<BellOff size={18} color={textColor(isDark)} />}
            title={mutedUntilLabel ? 'Muted' : 'Mute'}
            subtitle={mutedUntilLabel || 'Pause notifications'}
            onPress={() => {
              closeOptionsMenu();
              openMutePicker();
            }}
          />
          <MenuItem
            icon={<Pin size={18} color={textColor(isDark)} />}
            title={isPinned ? 'Unpin' : 'Pin'}
            subtitle={isPinned ? 'Remove from the top of inbox' : 'Keep this chat at the top'}
            onPress={() => toggleArrayField('pinnedBy')}
          />
          <MenuItem
            icon={<Archive size={18} color={textColor(isDark)} />}
            title={isArchived ? 'Unarchive' : 'Archive'}
            subtitle={isArchived ? 'Show in inbox again' : 'Hide from inbox'}
            onPress={() => toggleArrayField('archivedBy')}
          />
          <View style={[styles.sheetDivider, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(11,18,32,0.08)' }]} />
          <MenuItem
            icon={<Flag size={18} color="#EF4444" />}
            title="Report"
            subtitle="Scam, harassment, or spam"
            danger
            onPress={openReportUser}
          />
          <MenuItem
            icon={<UserX size={18} color="#EF4444" />}
            title={hasBlockedUser ? 'Unblock' : 'Block'}
            subtitle={hasBlockedUser ? 'They can message you again' : 'They cannot write you'}
            danger
            onPress={() => {
              notifyUser(hasBlockedUser ? 'Unblock?' : 'Block this person?', hasBlockedUser ? 'They will be able to message you again.' : 'They will not be able to send you messages.', [
                { text: 'Cancel', style: 'cancel' },
                { text: hasBlockedUser ? 'Unblock' : 'Block', style: hasBlockedUser ? 'default' : 'destructive', onPress: toggleBlockUser },
              ]);
            }}
          />
          <MenuItem
            icon={<Trash2 size={18} color="#EF4444" />}
            title="Delete chat"
            subtitle="Removes it from your inbox only"
            danger
            onPress={deleteConversation}
          />
        </View>
      </Modal>

      <Modal transparent visible={!!reactTarget} animationType="fade" onRequestClose={() => setReactTarget(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setReactTarget(null)} />
        <View style={[styles.reactSheet, liquidGlass(isDark)]}>
          <Text style={[styles.menuHeader, { color: textColor(isDark) }]}>React</Text>
          <View style={styles.reactEmojiRow}>
            {REACTION_EMOJIS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.reactEmojiBtn}
                onPress={() => {
                  const target = reactTarget;
                  setReactTarget(null);
                  if (target) void toggleReaction(target, emoji);
                }}
              >
                <Text style={styles.reactEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={styles.reactExtra}
            onPress={() => {
              const target = reactTarget;
              setReactTarget(null);
              if (target) replyToMessage(target);
            }}
          >
            <Text style={[styles.reactExtraText, { color: textColor(isDark) }]}>Reply</Text>
          </TouchableOpacity>
          {reactTarget && reactTarget.senderId === user?.uid ? (
            <TouchableOpacity
              style={styles.reactExtra}
              onPress={() => {
                const id = String(reactTarget.id || '');
                setReactTarget(null);
                if (id) deleteMessage(id);
              }}
            >
              <Text style={[styles.reactExtraText, { color: COLORS.danger }]}>Delete</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.reactExtra}
              onPress={() => {
                const id = String(reactTarget?.id || '');
                setReactTarget(null);
                if (id) reportPerson('message', id);
              }}
            >
              <Text style={[styles.reactExtraText, { color: COLORS.danger }]}>Report message</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      <Modal transparent visible={mutePickerOpen} animationType="fade" onRequestClose={closeMutePicker}>
        <Pressable style={styles.modalOverlay} onPress={closeMutePicker} />
        <View style={[styles.menuSheet, liquidGlass(isDark)]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.menuHeader, { color: textColor(isDark) }]}>Mute</Text>
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
        description="AI warm intros are a LINKUP PLUS feature on Android."
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
  scene: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  scenePane: {
    position: 'absolute',
    width: 280,
    height: 130,
    borderRadius: 34,
  },
  scenePaneA: {
    top: 90,
    right: -120,
    transform: [{ rotate: '-16deg' }],
  },
  scenePaneB: {
    top: 330,
    left: -120,
    transform: [{ rotate: '16deg' }],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: 8,
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
    borderColor: COLORS.lightBorderActive,
  },
  avatarFallbackText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '900',
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
    letterSpacing: -0.2,
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
    borderRadius: 16,
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
    borderRadius: 16,
    marginVertical: 6,
  },
  replyBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: -56,
    borderWidth: 1,
    borderRadius: 16,
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
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    maxHeight: 100,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
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
    borderRadius: 16,
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
    letterSpacing: -0.2,
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
    fontSize: 12,
    fontWeight: '600',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128,128,128,0.35)',
    marginBottom: 12,
  },
  sheetHint: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginBottom: 10,
  },
  sheetDivider: {
    height: 1,
    marginVertical: 8,
  },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  reactionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  reactionChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reactSheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 28,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  reactEmojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 8,
  },
  reactEmojiBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(128,128,128,0.12)',
  },
  reactEmoji: { fontSize: 24 },
  reactExtra: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactExtraText: { fontSize: 15, fontWeight: '800' },
});
