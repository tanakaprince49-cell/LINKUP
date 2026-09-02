import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Animated,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { sendMessage, LinkyMessage, MiniProfile } from '../lib/linky';
import type { OpenRouterMessage } from '../lib/linky';
import { useAuth } from '../contexts/AuthContext';
import { ensureDirectMatch } from '../lib/chat';
import { generateWarmIntro } from '../lib/ai';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ArrowLeft, ArrowUp, FileText, Lock, RefreshCw, Send, X } from 'lucide-react-native';
import PaywallModal from '../components/PaywallModal';
import { hasLinkupPro } from '../lib/paywall';
import { notifyUser } from '../lib/notify';
import VerifiedBadge from '../components/VerifiedBadge';
import ProCrownBadge from '../components/ProCrownBadge';

const STORAGE_KEY = (uid: string) => `linky_history_${uid}`;
const LINKY_STREAK_KEY = (uid: string) => `linky_streak_${uid}`;
const LINKY_SCORE_KEY = (uid: string) => `linky_score_${uid}`;

const LinkyAvatar = ({ size = 32, onPress }: { size?: number; onPress?: () => void }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontSize: size * 0.4, fontWeight: '900', color: '#000', letterSpacing: 1 }}>AI</Text>
  </TouchableOpacity>
);

const LinkyDashboard = ({ onSuggestion, streak, score }: { onSuggestion: (t: string) => void; streak: number; score: number }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const suggestions = ['Find me a technical co-founder', 'Show me investors in fintech', 'Message a developer for my project'];
  return (
    <View style={styles.dashContainer}>
      <View style={styles.dashAvatarRow}>
        <LinkyAvatar size={48} />
        <View>
          <Text style={[styles.dashTitle, { color: textColor(isDark) }]}>Linky AI</Text>
          <Text style={[styles.dashSubtitle, { color: textColor(isDark, 'muted') }]}>Your AI networking assistant</Text>
        </View>
      </View>
      <View style={styles.dashScoreRow}>
        <View style={styles.dashScoreItem}>
          <Text style={[styles.dashScoreValue, { color: COLORS.primaryStrong }]}>{score}</Text>
          <Text style={[styles.dashScoreLabel, { color: textColor(isDark, 'muted') }]}>Score</Text>
        </View>
        <View style={styles.dashScoreDivider} />
        <View style={styles.dashScoreItem}>
          <Text style={[styles.dashScoreValue, { color: COLORS.primaryStrong }]}>{streak}</Text>
          <Text style={[styles.dashScoreLabel, { color: textColor(isDark, 'muted') }]}>Streak</Text>
        </View>
      </View>
      <Text style={[styles.dashHint, { color: textColor(isDark, 'secondary') }]}>Try these:</Text>
      {suggestions.map((s) => (
        <TouchableOpacity key={s} style={[styles.dashChip, { backgroundColor: isDark ? COLORS.primaryGlow : 'rgba(17, 24, 39,0.12)' }]} onPress={() => onSuggestion(s)} activeOpacity={0.7}>
          <View style={[styles.dashChipDot, { backgroundColor: COLORS.primaryStrong }]} />
          <Text style={[styles.dashChipText, { color: textColor(isDark) }]}>{s}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

/**
 * The locked Linky screen is a sales page, not a wall.
 *
 * Free members used to land on a padlock and one line of text. Now Linky
 * talks to them in first person, shows exactly what he would do the second
 * they upgrade, and every chip they would have tapped is right there -
 * greyed, tapping any of them opens the paywall. The point is to make them
 * want HIM, not a feature list.
 */
const ProOnlyScreen = ({ onUpgrade, firstName }: { onUpgrade: () => void; firstName: string }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const hello = firstName ? `Hey ${firstName}.` : 'Hey.';
  const teasers = [
    'Find me a technical co-founder in my city',
    'Which investors here back fintech?',
    'Write a warm intro to a designer for my project',
    'Who should I talk to this week?',
  ];
  const promises = [
    { title: 'I know everyone here', body: 'I read every builder profile on LINKUP so you never cold-search again.' },
    { title: 'I make the intro', body: 'Say who you need and I draft the message and send it for you.' },
    { title: 'I pick your people', body: 'Every week I hand you the few people actually worth your time.' },
  ];
  return (
    <ScrollView contentContainerStyle={styles.proScroll} showsVerticalScrollIndicator={false}>
      <View style={styles.proHero}>
        <LinkyAvatar size={64} />
        <View style={styles.proBadge}>
          <Lock size={10} color="#000" />
          <Text style={styles.proBadgeText}>PLUS</Text>
        </View>
      </View>
      <Text style={[styles.proTitle, { color: textColor(isDark) }]}>{hello} I'm Linky.</Text>
      <Text style={[styles.proSub, { color: textColor(isDark, 'secondary') }]}>
        I've already looked at who's on LINKUP for you. There are people here who fit what you're building — I just can't introduce you until you unlock me.
      </Text>

      <View style={[styles.proChat, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }]}>
        <View style={styles.proChatRow}>
          <LinkyAvatar size={22} />
          <Text style={[styles.proChatText, { color: textColor(isDark) }]}>
            Tell me what you're building and who you're missing. I'll find them, rank them, and write the first message.
          </Text>
        </View>
        <Text style={[styles.proChatHint, { color: textColor(isDark, 'muted') }]}>Try asking me:</Text>
        {teasers.map((t) => (
          <TouchableOpacity key={t} style={[styles.proChip, { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' }]} onPress={onUpgrade} activeOpacity={0.7}>
            <Text style={[styles.proChipText, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>{t}</Text>
            <Lock size={11} color={textColor(isDark, 'muted')} />
          </TouchableOpacity>
        ))}
      </View>

      {promises.map((p) => (
        <View key={p.title} style={styles.proPromise}>
          <View style={styles.proPromiseDot} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.proPromiseTitle, { color: textColor(isDark) }]}>{p.title}</Text>
            <Text style={[styles.proPromiseBody, { color: textColor(isDark, 'muted') }]}>{p.body}</Text>
          </View>
        </View>
      ))}

      <TouchableOpacity style={styles.proBtn} onPress={onUpgrade} activeOpacity={0.85}>
        <Text style={styles.proBtnText}>Unlock Linky</Text>
      </TouchableOpacity>
      <Text style={[styles.proFine, { color: textColor(isDark, 'muted') }]}>Comes with LINKUP PLUS · unlimited discovery, warm intros and no sponsored cards.</Text>
    </ScrollView>
  );
};

const ProfileCard = ({ profile, onPress, onConnect, connectBusy }: { profile: MiniProfile; onPress: () => void; onConnect?: () => void; connectBusy?: boolean }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <View style={styles.profileCardOuter}>
      <TouchableOpacity style={styles.profileCard} onPress={onPress} activeOpacity={0.7}>
        <Image source={{ uri: profile.profilePic || 'https://ui-avatars.com/api/?name=U&background=DFFB3F&color=000&size=80' }} style={styles.profileAvatar} />
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: textColor(isDark) }]} numberOfLines={1}>{profile.displayName || 'User'}</Text>
          {profile.occupation || profile.company ? (
            <Text style={[styles.profileRole, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>{[profile.occupation, profile.company].filter(Boolean).join(' at ')}</Text>
          ) : null}
          {profile.skills?.length > 0 && (
            <Text style={styles.profileSkills} numberOfLines={1}>{profile.skills.slice(0, 3).join(' · ')}</Text>
          )}
          {profile.city || profile.country ? (
            <Text style={[styles.profileLocation, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>{[profile.city, profile.country].filter(Boolean).join(', ')}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
      {onConnect && (
        <TouchableOpacity style={styles.connectBtn} onPress={onConnect} disabled={connectBusy} activeOpacity={0.7}>
          {connectBusy ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <>
              <Send size={12} color="#000" />
              <Text style={styles.connectBtnText}>Intro</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const TypingIndicator = ({ seconds, isDark }: { seconds: number; isDark: boolean }) => {
  // Three bouncing dots — the universal "Linky is thinking" signal.
  const dotAnims = React.useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  React.useEffect(() => {
    const loops = dotAnims.map((anim, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(anim, { toValue: -5, duration: 260, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 260, useNativeDriver: true }),
          Animated.delay(460),
        ])
      )
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dotAnims]);

  return (
    <View style={styles.typingRow}>
      <LinkyAvatar size={28} />
      <View style={[styles.typingBubble, { backgroundColor: isDark ? COLORS.darkBgSec : '#F0F0F0' }]}>
        <Text style={[styles.typingDotsLabel, { color: textColor(isDark, 'muted') }]}>Linky is typing</Text>
        <View style={styles.typingDotsWrap}>
          {dotAnims.map((anim, index) => (
            <Animated.View
              key={index}
              style={[
                styles.typingDot,
                { backgroundColor: COLORS.primaryStrong, transform: [{ translateY: anim }] },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
};

export default function LinkyScreen({ navigation }: any) {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<LinkyMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [thinkingSec, setThinkingSec] = useState(0);
  const [streak, setStreak] = useState(0);
  const [linkyScore, setLinkyScore] = useState(0);
  const [connectingProfiles, setConnectingProfiles] = useState<Set<string>>(new Set());
  const [draftIntro, setDraftIntro] = useState<{ recipient: MiniProfile; text: string } | null>(null);
  const [editDraftText, setEditDraftText] = useState('');
  const draftTextRef = useRef('');
  const flatListRef = useRef<FlatList>(null);
  const historyRef = useRef<OpenRouterMessage[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadedRef = useRef(false);
  const isPro = !!user && hasLinkupPro(profile);
  const [paywallFeature, setPaywallFeature] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid || loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY(user.uid));
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.history?.length) {
          data.history = data.history.map((m: any) => ({ role: m.role, content: m.content }));
          historyRef.current = data.history;
        }
        if (data.messages?.length) setMessages(data.messages);
      } catch {}
    })();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !loadedRef.current) return;
    AsyncStorage.setItem(STORAGE_KEY(user.uid), JSON.stringify({ messages, history: historyRef.current })).catch(() => {});
  }, [messages, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    AsyncStorage.getItem(LINKY_STREAK_KEY(user.uid)).then((v) => { if (v) setStreak(Number(v)); }).catch(() => {});
    AsyncStorage.getItem(LINKY_SCORE_KEY(user.uid)).then((v) => { if (v) setLinkyScore(Number(v)); }).catch(() => {});
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    AsyncStorage.setItem(LINKY_STREAK_KEY(user.uid), String(streak)).catch(() => {});
    AsyncStorage.setItem(LINKY_SCORE_KEY(user.uid), String(linkyScore)).catch(() => {});
    updateDoc(doc(db, 'profiles', user.uid), { linkyScore }).catch(() => {});
  }, [streak, linkyScore, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !loadedRef.current) return;
    const today = new Date().toDateString();
    (async () => {
      const lastActive = await AsyncStorage.getItem(`linky_last_active_${user.uid}`).catch(() => null);
      if (lastActive === today) return;
      if (lastActive) {
        const diff = Math.round((Date.now() - new Date(lastActive).getTime()) / 86400000);
        if (diff === 1) {
          setStreak((s) => s + 1);
        } else {
          setStreak(0);
        }
      } else {
        setStreak(1);
      }
      AsyncStorage.setItem(`linky_last_active_${user.uid}`, today).catch(() => {});
      const newScore = Math.min(100, linkyScore + 1 + Math.floor(streak / 3));
      setLinkyScore(newScore);
      AsyncStorage.setItem(LINKY_SCORE_KEY(user.uid), String(newScore)).catch(() => {});
      updateDoc(doc(db, 'profiles', user.uid), { linkyScore: newScore }).catch(() => {});
    })();
  }, [user?.uid, linkyScore]);

  useEffect(() => {
    if (loading) {
      setThinkingSec(0);
      timerRef.current = setInterval(() => setThinkingSec((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading]);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 60);
  }, []);

  const handleConnect = async (target: MiniProfile) => {
    if (!user?.uid || connectingProfiles.has(target.uid)) return;
    setConnectingProfiles((prev) => new Set(prev).add(target.uid));
    try {
      const matchId = await ensureDirectMatch(user.uid, target.uid);
      const intro = await generateWarmIntro(profile || { uid: user.uid, displayName: user.displayName || 'Me' }, target);
      navigation.navigate('Chat', { matchId, otherUser: target, draftMessage: intro || '' });
    } catch (err) {
      const em = err instanceof Error ? err.message : 'Could not connect';
      notifyUser('Connection failed', em);
    } finally {
      setConnectingProfiles((prev) => { const next = new Set(prev); next.delete(target.uid); return next; });
    }
  };

  const handleConnectAll = async (profiles: MiniProfile[]) => {
    if (!user?.uid || profiles.length === 0) return;
    await handleConnect(profiles[0]);
  };

  const handleSendDraft = async (customText?: string) => {
    if (!user?.uid || !draftIntro) return;
    const { recipient, text: introText } = draftIntro;
    const textToSend = (customText || draftTextRef.current || introText).trim();
    if (!textToSend) return;
    setConnectingProfiles((prev) => new Set(prev).add(recipient.uid));
    try {
      const matchId = await ensureDirectMatch(user.uid, recipient.uid);
      setDraftIntro(null);
      setEditDraftText('');
      draftTextRef.current = '';
      setMessages((prev) => prev.concat({
        id: `draft-sent-${Date.now()}`, role: 'assistant',
        content: `Sent your message to ${recipient.displayName || recipient.uid.slice(0, 6)}`,
      }));
      navigation.navigate('Chat', { matchId, otherUser: recipient, draftMessage: textToSend });
    } catch (err) {
      const em = err instanceof Error ? err.message : 'Could not send';
      notifyUser('Send failed', em);
    } finally {
      setConnectingProfiles((prev) => { const next = new Set(prev); next.delete(recipient.uid); return next; });
    }
  };

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    if (draftIntro && /^(yes|yeah|send|send it|do it|go ahead|confirm|sure|ok|okay|yep|yup)\b/i.test(msg)) {
      setInput('');
      await handleSendDraft(draftTextRef.current);
      return;
    }
    if (draftIntro && /^(no|nope|cancel|stop|never mind|dont|don't)\b/i.test(msg)) {
      setDraftIntro(null);
      setEditDraftText('');
      draftTextRef.current = '';
    }

    setInput('');

    const userMsg: LinkyMessage = { id: `u-${Date.now()}`, role: 'user', content: msg };
    setMessages((prev) => [...prev, userMsg]);
    scrollToEnd();

    const loadMsg: LinkyMessage = { id: 'load', role: 'assistant', content: '' };
    setMessages((prev) => [...prev, loadMsg]);
    setLoading(true);
    scrollToEnd();

    try {
      const result = await sendMessage(msg, historyRef.current);
      historyRef.current = result.updatedHistory;
      const asst: LinkyMessage = {
        id: `a-${Date.now()}`, role: 'assistant', content: result.text,
        profileResults: result.profiles,
      };
      setMessages((prev) => prev.filter((m) => m.id !== 'load').concat(asst));

      const lower = msg.toLowerCase();
      const isMessaging =
        /^(message|tell|send|intro|dm|contact|connect)\b/i.test(msg.trim()) ||
        /\b(send a message|reach out|get introduced|connect me to|message them|tell them about)\b/i.test(lower);
      if (isMessaging && result.profiles?.length) {
        const target = result.profiles[0];
        let introText = '';
        const quoteMatch = result.text.match(/"([^"]+)"/);
        if (quoteMatch && quoteMatch[1].length > 20) {
          introText = quoteMatch[1];
        }
        if (!introText) {
          introText = await generateWarmIntro(profile || { uid: user!.uid, displayName: user?.displayName || 'Me' }, target) || '';
        }
        if (introText) {
          draftTextRef.current = introText;
          setEditDraftText(introText);
          setDraftIntro({ recipient: target, text: introText });
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== 'load').concat({
        id: `e-${Date.now()}`, role: 'assistant', content: `I'm offline right now. Please try again in a moment.`,
      }));
    }
    setLoading(false);
    scrollToEnd();
  };

  const hasMessages = messages.length > 0;
  const showWelcome = !hasMessages && !loading;

  return (
    <View style={[styles.root, appBackground(isDark)]}>
      <SafeAreaView edges={['top']} style={[styles.header, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, borderBottomColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => {
          if (navigation.canGoBack()) navigation.goBack();
        }}>
          <ArrowLeft size={20} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <LinkyAvatar size={36} />
          <View>
            <View style={styles.headerNameRow}>
              <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>Linky</Text>
              <VerifiedBadge size={15} />
            </View>
            <View style={styles.headerMetaRow}>
              <View style={styles.headerOnlineDot} />
              <Text style={[styles.headerMetaText, { color: textColor(isDark, 'muted') }]}>Online · AI Assistant</Text>
            </View>
          </View>
        </View>
        <ProCrownBadge />
        <TouchableOpacity style={styles.headerBtn} onPress={() => {
          setMessages([]);
          historyRef.current = [];
          if (user?.uid) AsyncStorage.removeItem(STORAGE_KEY(user.uid)).catch(() => {});
        }}>
          <RefreshCw size={16} color={textColor(isDark, 'muted')} />
        </TouchableOpacity>
      </SafeAreaView>

      {!isPro ? (
        <ProOnlyScreen onUpgrade={() => setPaywallFeature('Linky AI Assistant')} firstName={String((profile as any)?.displayName || (profile as any)?.fullName || '').trim().split(' ')[0] || ''} />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => {
              const isUser = item.role === 'user';
              return (
                <View style={[styles.row, isUser ? styles.userRow : styles.asstRow]}>
                  {!isUser && <LinkyAvatar size={28} />}
                  <View style={[
                    styles.bubble,
                    isUser ? [styles.userBubble, { backgroundColor: COLORS.primary }]
                      : [styles.asstBubble, { backgroundColor: isDark ? COLORS.darkBgSec : '#F0F0F0' }],
                  ]}>
                    <Text style={[styles.bubbleText, { color: isUser ? '#000' : textColor(isDark) }]}>
                      {item.content}
                    </Text>
                    {item.profileResults?.length ? (
                      <View style={styles.profileSection}>
                        <View style={styles.profileSectionHeader}>
                          <Text style={[styles.profileSectionCount, { color: textColor(isDark, 'muted') }]}>{item.profileResults.length} found</Text>
                          <TouchableOpacity style={styles.connectAllBtn} onPress={() => handleConnectAll(item.profileResults!)} activeOpacity={0.8}>
                            <Send size={11} color="#000" />
                            <Text style={styles.connectAllText}>Intro All</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.profileDivider} />
                        {item.profileResults.map((p: MiniProfile) => (
                          <ProfileCard key={p.uid} profile={p} onPress={() => user && navigation.navigate('Profile', { userId: p.uid })} onConnect={() => handleConnect(p)} connectBusy={connectingProfiles.has(p.uid)} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            }}
            contentContainerStyle={[styles.listContent, showWelcome && styles.listContentWelcome]}
            onContentSizeChange={() => hasMessages && scrollToEnd()}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={showWelcome ? <LinkyDashboard onSuggestion={handleSend} streak={streak} score={linkyScore} /> : null}
            ListFooterComponent={loading ? <TypingIndicator seconds={thinkingSec} isDark={isDark} /> : null}
          />

          <View style={[styles.inputArea, { paddingBottom: Math.max(8, insets.bottom + 4), borderTopColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            {draftIntro ? (
              <View style={[styles.draftBanner, { backgroundColor: isDark ? COLORS.darkBgSec : '#F0F0F0' }]}>
                <View style={styles.draftRow}>
                  <FileText size={13} color={COLORS.primaryStrong} />
                  <Text style={[styles.draftTo, { color: textColor(isDark) }]} numberOfLines={1}>
                    To: {draftIntro.recipient.displayName || 'User'}
                    {draftIntro.recipient.occupation ? ` · ${draftIntro.recipient.occupation}` : ''}
                  </Text>
                  <TouchableOpacity onPress={() => { setDraftIntro(null); setEditDraftText(''); draftTextRef.current = ''; }}>
                    <X size={14} color="#999" />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.draftInput, { color: textColor(isDark) }]}
                  value={editDraftText}
                  onChangeText={(v) => { draftTextRef.current = v; setEditDraftText(v); }}
                  multiline
                  maxLength={1000}
                  placeholder="Edit your intro message..."
                  placeholderTextColor="#999"
                />
                <View style={styles.draftActions}>
                  <TouchableOpacity
                    style={[styles.draftSendBtn, { backgroundColor: COLORS.primary, opacity: editDraftText.trim() ? 1 : 0.4 }]}
                    onPress={() => handleSendDraft(draftTextRef.current)}
                    disabled={!editDraftText.trim() || connectingProfiles.size > 0}
                  >
                    {connectingProfiles.has(draftIntro.recipient.uid) ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <Send size={11} color="#000" />
                        <Text style={styles.draftSendText}>Send</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={[styles.inputWrap, { backgroundColor: isDark ? COLORS.darkBgSec : '#F0F0F0' }]}>
                <TextInput
                  style={[styles.input, { color: textColor(isDark) }]}
                  placeholder="Ask Linky anything..."
                  placeholderTextColor="#999"
                  value={input}
                  onChangeText={setInput}
                  multiline
                  maxLength={500}
                  onKeyPress={({ nativeEvent }) => {
                    if (nativeEvent.key === 'Enter' && Platform.OS === 'web') handleSend();
                  }}
                />
              </View>
            )}
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: COLORS.primary, opacity: draftIntro ? (editDraftText.trim() ? 1 : 0.4) : (input.trim() ? 1 : 0.4) }]}
              onPress={() => draftIntro ? handleSendDraft(draftTextRef.current) : handleSend()}
              disabled={draftIntro ? !editDraftText.trim() || connectingProfiles.size > 0 : !input.trim() || loading}
            >
              {connectingProfiles.size > 0 ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <ArrowUp size={20} color="#000" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      <PaywallModal
        visible={!!paywallFeature}
        onClose={() => setPaywallFeature(null)}
        feature={paywallFeature || 'Linky AI Assistant'}
        description={"Unlock Linky and he finds your co-founder, your investor or your next teammate, then writes the intro for you. Unlimited discovery and warm intros included — and no more sponsored cards."}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  headerBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 4 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  headerTitle: { fontSize: 17, fontWeight: '900', letterSpacing: 0 },
  headerMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  headerOnlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34C759' },
  headerMetaText: { fontSize: 10, fontWeight: '600', color: '#999', letterSpacing: 0.3 },
  listContent: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 },
  listContentWelcome: { flex: 1, justifyContent: 'center' },
  row: { flexDirection: 'row', marginBottom: 10, gap: 8 },
  userRow: { justifyContent: 'flex-end' },
  asstRow: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 11 },
  userBubble: { borderBottomRightRadius: 4 },
  asstBubble: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginLeft: 14 },
  typingBubble: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: '#F0F0F0', flexDirection: 'row', alignItems: 'center', gap: 10 },
  typingLabel: { fontSize: 13, fontWeight: '600', color: '#999' },
  typingDotsLabel: { fontSize: 12, fontWeight: '700' },
  typingDotsWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  typingDot: { width: 7, height: 7, borderRadius: 4 },
  dashContainer: { alignItems: 'center', paddingVertical: 24 },
  dashAvatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  dashTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  dashSubtitle: { fontSize: 12, fontWeight: '600', color: '#999', marginTop: 2 },
  dashScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 32, marginBottom: 20 },
  dashScoreItem: { alignItems: 'center' },
  dashScoreValue: { fontSize: 32, fontWeight: '900', color: COLORS.primaryStrong },
  dashScoreLabel: { fontSize: 9, fontWeight: '800', color: '#999', marginTop: 3, letterSpacing: 1 },
  dashScoreDivider: { width: 1, height: 36, backgroundColor: '#1A1A1F10' },
  dashHint: { fontSize: 11, fontWeight: '800', marginBottom: 10, alignSelf: 'flex-start', letterSpacing: 0.5, color: '#999' },
  dashChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, marginBottom: 6, alignSelf: 'flex-start' },
  dashChipDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' },
  dashChipText: { fontSize: 13, fontWeight: '600', color: '#555' },
  proScroll: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 40 },
  proHero: { alignItems: 'center', marginBottom: 14 },
  proBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: -10 },
  proBadgeText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 1 },
  proTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -0.4, textAlign: 'center' },
  proSub: { fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  proChat: { borderRadius: 18, padding: 14, marginTop: 18, gap: 8 },
  proChatRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  proChatText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  proChatHint: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4 },
  proChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  proChipText: { flex: 1, fontSize: 12, fontWeight: '700' },
  proPromise: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14 },
  proPromiseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 5 },
  proPromiseTitle: { fontSize: 14, fontWeight: '900', letterSpacing: -0.2 },
  proPromiseBody: { fontSize: 12, lineHeight: 17, fontWeight: '600', marginTop: 2 },
  proBtn: { backgroundColor: COLORS.primary, paddingVertical: 15, borderRadius: 14, marginTop: 22, alignItems: 'center' },
  proBtnText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 0.2 },
  proFine: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 10, lineHeight: 16 },
  draftBanner: { flex: 1, borderRadius: 16, padding: 10 },
  draftRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  draftTo: { flex: 1, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  draftInput: { fontSize: 13, paddingVertical: 8, paddingHorizontal: 10, maxHeight: 80, backgroundColor: 'rgba(0,0,0,0.04)', borderRadius: 10, marginBottom: 8 },
  draftActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  draftSendBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  draftSendText: { fontSize: 10, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
  inputArea: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, gap: 8, alignItems: 'flex-end', borderTopWidth: 1 },
  inputWrap: { flex: 1, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(128,128,128,0.12)' },
  input: { fontSize: 15, paddingVertical: 10, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  profileSection: { marginTop: 8 },
  profileSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 4 },
  profileSectionCount: { fontSize: 10, fontWeight: '900', color: '#666', letterSpacing: 0.5 },
  connectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  connectAllText: { fontSize: 8, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
  profileCardOuter: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, gap: 8 },
  profileDivider: { height: 1, backgroundColor: '#1A1A1F15', marginBottom: 6 },
  profileCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  connectBtn: { width: 52, height: 32, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 },
  connectBtnText: { fontSize: 8, fontWeight: '900', color: '#000', letterSpacing: 0.5 },
  profileAvatar: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#E0E0E0' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 13, fontWeight: '800', color: '#000' },
  profileRole: { fontSize: 10, color: '#666', fontWeight: '500', marginTop: 1 },
  profileSkills: { fontSize: 10, color: COLORS.primaryStrong, fontWeight: '700', marginTop: 1 },
  profileLocation: { fontSize: 9, color: '#999', fontWeight: '600', marginTop: 1 },
});
