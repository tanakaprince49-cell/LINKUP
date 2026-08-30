import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { notifyUser } from '../lib/notify';
import { useIsFocused } from '@react-navigation/native';
import { addDoc, collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { ChevronLeft, Heart, Lightbulb, MessageSquare, Plus, RefreshCw, X, Zap } from 'lucide-react-native';
import { db } from '../lib/firebase';
import { ensureDirectMatch } from '../lib/chat';
import { requestConnection } from '../lib/connectionRequests';
import { displayNameFor, isDiscoverableProfile } from '../lib/discovery';
import { collectIdeaDeck, IdeaDeckItem, safeIdeaId } from '../lib/ideas';
import { StartupIdea, UserProfile } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import VerifiedBadge from '../components/VerifiedBadge';
import PaywallModal from '../components/PaywallModal';
import { FREE_LIMITS, PRO_FEATURES, hasLinkupPro } from '../lib/paywall';
import {
  injectSponsored,
  recordCampaignClick,
  recordCampaignImpression,
  sponsoredIdeaCardsForViewer,
  subscribeActiveCampaigns,
} from '../lib/campaigns';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { getIdeaHabit, markIdeaHabitDone, todayKey } from '../lib/dailyLoop';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

const USE_NATIVE_DRIVER = Platform.OS !== 'web';
const SWIPE_DISTANCE = 140;
const IDEA_STAGE_OPTIONS = ['Idea Stage', 'Research', 'Prototype', 'MVP', 'Early Users', 'Revenue', 'Fundraising'];
const IDEA_LOOKING_FOR_OPTIONS = ['CTO', 'Developer', 'Designer', 'Marketer', 'Investor', 'Cofounder', 'Beta Users', 'Mentor'];
const IDEA_FIELD_OPTIONS = ['SaaS', 'AI', 'Fintech', 'Healthtech', 'EdTech', 'Gaming', 'E-commerce', 'Creator Economy', 'Social', 'Cybersecurity', 'Robotics'];

const toggleValue = (values: string[], value: string) =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

export default function IdeaDeckScreen({ navigation }: any) {
  const { user, profile: myProfile } = useAuth();
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const isDark = theme === 'dark';
  const [ideas, setIdeas] = useState<IdeaDeckItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaDescription, setIdeaDescription] = useState('');
  const [ideaStage, setIdeaStage] = useState(IDEA_STAGE_OPTIONS[0]);
  const [ideaLookingFor, setIdeaLookingFor] = useState<string[]>([]);
  const [ideaFields, setIdeaFields] = useState<string[]>([]);
  const [confettiActive, setConfettiActive] = useState(false);
  const [inviteIdea, setInviteIdea] = useState<IdeaDeckItem | null>(null);
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('');
  const swipedIdeasRef = useRef<Set<string>>(new Set());
  const organicIdeasRef = useRef<IdeaDeckItem[]>([]);
  const sponsoredIdeasRef = useRef<IdeaDeckItem[]>([]);
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const animateSwipeRef = useRef<(direction: 'left' | 'right') => void>(() => {});
  const completeSwipeRef = useRef<(direction: 'left' | 'right', swipedIdea?: IdeaDeckItem) => void>(() => {});

  const topIdea = ideas[0];
  const nextIdea = ideas[1];
  const openPaywall = (feature: string = PRO_FEATURES.startupAnalyzer) => setPaywallFeature(feature);
  const cardWidth = Math.min(Math.max(width - 28, 320), 720);
  const cardHeight = Math.min(Math.max(height * 0.62, 500), 660);

  const rotate = position.x.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ['-11deg', '0deg', '11deg'],
    extrapolate: 'clamp',
  });
  const nextScale = position.x.interpolate({
    inputRange: [-SWIPE_DISTANCE, 0, SWIPE_DISTANCE],
    outputRange: [1, 0.94, 1],
    extrapolate: 'clamp',
  });
  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const skipOpacity = position.x.interpolate({
    inputRange: [-SWIPE_DISTANCE, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_evt, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy * 0.08 });
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx > SWIPE_DISTANCE) animateSwipeRef.current('right');
        else if (gesture.dx < -SWIPE_DISTANCE) animateSwipeRef.current('left');
        else Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: USE_NATIVE_DRIVER, tension: 80, friction: 9 }).start();
      },
    })
  ).current;

  // Organic deck + sponsored cards merge here. Density is capped viewer-side
  // (SPONSORED_INTERVAL), so advertisers can never flood the deck.
  const rebuildDeckRef = useRef<() => void>(() => {});
  rebuildDeckRef.current = () => {
    const organic = organicIdeasRef.current.filter((idea) => !swipedIdeasRef.current.has(idea.id));
    const merged = injectSponsored(organic, sponsoredIdeasRef.current);
    setIdeas((current) => (merged.length > 0 || current.length === 0 ? merged : current));
  };

  useEffect(() => {
    if (!user?.uid) {
      setIdeas([]);
      setLoading(false);
      return;
    }
    if (!isFocused) return;

    const unsubscribe = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (profiles) => {
        const users = profiles.filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        organicIdeasRef.current = collectIdeaDeck(users as UserProfile[], user.uid);
        rebuildDeckRef.current();
        setLoading(false);
      },
      onError: (error) => {
        console.warn('Ideas deck unavailable:', error);
        setLoading(false);
      },
    });

    return () => unsubscribe();
  }, [isFocused, user?.uid]);

  // Sponsored cards: PLUS members are ad-free; everyone else sees at most
  // 1 sponsored card per SPONSORED_INTERVAL organic cards.
  const viewerIsPlus = hasLinkupPro(myProfile);
  useEffect(() => {
    if (!user?.uid || !isFocused) return;
    if (Platform.OS !== 'web' && viewerIsPlus) {
      sponsoredIdeasRef.current = [];
      rebuildDeckRef.current();
      return;
    }
    let cancelled = false;
    const unsubscribeSponsored = subscribeActiveCampaigns(async (campaigns) => {
      try {
        const items = await sponsoredIdeaCardsForViewer(campaigns, user.uid);
        if (cancelled) return;
        sponsoredIdeasRef.current = items;
        rebuildDeckRef.current();
      } catch {
        // Sponsored delivery is best-effort; the organic deck always renders.
      }
    }, () => {});
    return () => {
      cancelled = true;
      unsubscribeSponsored();
    };
  }, [isFocused, user?.uid, viewerIsPlus]);

  // Impression bookkeeping: one counted view per render of a sponsored top card,
  // capped per viewer per day inside recordCampaignImpression.
  useEffect(() => {
    const top = ideas[0] as any;
    if (top?.sponsored && top?.campaignId && user?.uid) {
      void recordCampaignImpression(top.campaignId, user.uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas[0]?.id, user?.uid]);

  const notify = async (payload: Record<string, any>) => {
    try {
      await addDoc(collection(db, 'notifications'), {
        isRead: false,
        timestamp: serverTimestamp(),
        ...payload,
      });
    } catch {
      // Notifications should never block the idea match.
    }
  };

  const likeIdea = async (idea: IdeaDeckItem) => {
    if (!user?.uid || !idea?.id) return;
    if ((idea as any).sponsored && (idea as any).campaignId) {
      void recordCampaignClick((idea as any).campaignId, user.uid);
    }
    const swipeId = `${idea.id}_${user.uid}`;
    const myName = displayNameFor(myProfile || user);
    const myPic = safeProfileImageUri(myProfile?.profilePic || user.photoURL || '', MOBILE_LIST_IMAGE_LIMIT);

    await setDoc(
      doc(db, 'ideaSwipes', swipeId),
      {
        ideaId: idea.id,
        ideaOwnerId: idea.ownerId,
        ideaTitle: idea.title,
        swiperId: user.uid,
        swiperName: myName,
        swiperPic: myPic,
        direction: 'right',
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );

    const previousSwipes = await getDocs(query(collection(db, 'ideaSwipes'), where('ideaId', '==', idea.id), limit(12)));
    const partnerDoc = previousSwipes.docs
      .map((snap) => snap.data() as any)
      .find((swipe) => swipe.swiperId && swipe.swiperId !== user.uid && swipe.swiperId !== idea.ownerId);

    if (partnerDoc?.swiperId) {
      const matchId = await ensureDirectMatch(user.uid, partnerDoc.swiperId);
      const partnerSnap = await getDoc(doc(db, 'users', partnerDoc.swiperId)).catch(() => null);
      const partnerProfile = partnerSnap?.exists() ? ({ ...partnerSnap.data(), uid: partnerSnap.id } as UserProfile) : null;
      await notify({
        userId: partnerDoc.swiperId,
        fromId: user.uid,
        fromName: myName,
        fromPic: myPic,
        type: 'match',
        matchId,
        content: `You both liked "${idea.title}".`,
      });
      await notify({
        userId: user.uid,
        fromId: partnerDoc.swiperId,
        fromName: partnerProfile ? displayNameFor(partnerProfile) : partnerDoc.swiperName || 'Builder',
        fromPic: safeProfileImageUri(partnerProfile?.profilePic || partnerDoc.swiperPic || '', MOBILE_LIST_IMAGE_LIMIT),
        type: 'match',
        matchId,
        content: `You both liked "${idea.title}".`,
      });
      notifyUser('Idea match', `You and ${partnerProfile ? displayNameFor(partnerProfile) : partnerDoc.swiperName || 'a builder'} both want to build around "${idea.title}".`, [
        { text: 'Keep swiping', style: 'cancel' },
        { text: 'Open chat', onPress: () => navigation.navigate('Chat', { matchId, otherUser: partnerProfile || { uid: partnerDoc.swiperId, displayName: partnerDoc.swiperName } }) },
      ]);
      return;
    }

    await notify({
      userId: idea.ownerId,
      fromId: user.uid,
      fromName: myName,
      fromPic: myPic,
      type: 'like',
      content: `${myName} liked your idea: "${idea.title}".`,
    });
  };

  const completeSwipe = async (direction: 'left' | 'right', swipedIdea?: IdeaDeckItem) => {
    const idea = swipedIdea || ideas[0];
    if (!idea || busy) return;
    swipedIdeasRef.current.add(idea.id);
    setIdeas((current) => {
      if (current[0]?.id === idea.id) return current.slice(1);
      return current.filter((item) => item.id !== idea.id);
    });
    requestAnimationFrame(() => position.setValue({ x: 0, y: 0 }));
    if (direction !== 'right') return;
    setBusy(true);
    try {
      await likeIdea(idea);
    } catch (error: any) {
      console.warn('Idea like failed:', error);
      notifyUser('Idea swipe failed', error?.message || 'Could not save this idea swipe. Deploy the latest Firestore rules and try again.');
    } finally {
      setBusy(false);
    }
  };

  const startIdeaSwipeAnimation = (direction: 'left' | 'right', swipedIdea: IdeaDeckItem) => {
    Animated.timing(position, {
      toValue: { x: direction === 'right' ? width + 220 : -width - 220, y: 18 },
      duration: 230,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (finished) completeSwipeRef.current(direction, swipedIdea);
      else position.setValue({ x: 0, y: 0 });
    });
  };

  const animateSwipe = (direction: 'left' | 'right') => {
    const swipedIdea = ideas[0];
    if (!swipedIdea) return;
    startIdeaSwipeAnimation(direction, swipedIdea);
  };

  useEffect(() => {
    animateSwipeRef.current = animateSwipe;
    completeSwipeRef.current = completeSwipe;
  }, [animateSwipe, completeSwipe]);

  const resetIdeaComposer = () => {
    setIdeaTitle('');
    setIdeaDescription('');
    setIdeaStage(IDEA_STAGE_OPTIONS[0]);
    setIdeaLookingFor([]);
    setIdeaFields([]);
  };

  const postIdea = async () => {
    if (!user?.uid) {
      notifyUser('Sign in required', 'Please sign in before posting an idea.');
      return;
    }

    const title = ideaTitle.trim();
    const description = ideaDescription.trim();
    if (!title || !description) {
      notifyUser('Finish your idea', 'Add a title and short description so builders understand what you want to build.');
      return;
    }
    if (ideaFields.length === 0 || ideaLookingFor.length === 0) {
      notifyUser('Add signals', 'Choose at least one field and one thing you are looking for.');
      return;
    }

    setPosting(true);
    try {
      const currentIdeas = Array.isArray((myProfile as any)?.startupIdeas)
        ? ((myProfile as any).startupIdeas as StartupIdea[]).filter((idea) => String(idea?.title || idea?.description || '').trim())
        : [];
      const nextIdea: StartupIdea = {
        id: safeIdeaId(`${user.uid}_${Date.now()}_${title}`),
        title: title.slice(0, 90),
        description: description.slice(0, 500),
        stage: ideaStage,
        lookingFor: ideaLookingFor,
        tags: ideaFields,
      };
      const nextIdeas = [nextIdea, ...currentIdeas.filter((idea) => idea.id !== nextIdea.id)];
      const existingBadges = Array.isArray((myProfile as any)?.badges) ? ((myProfile as any).badges as string[]) : [];
      const ideaBadges = ['Idea Starter'];
      if (nextIdeas.length >= 3) ideaBadges.push('Idea Builder');
      if (nextIdeas.length >= 7) ideaBadges.push('Idea Machine');
      const nextBadges = Array.from(new Set([...existingBadges, ...ideaBadges]));

      await setDoc(
        doc(db, 'users', user.uid),
        {
          startupIdeas: nextIdeas,
          badges: nextBadges,
        },
        { merge: true }
      );

      setComposerOpen(false);
      resetIdeaComposer();
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 1200);
    } catch (error: any) {
      notifyUser('Could not post idea', error?.message || 'Please deploy the latest Firestore rules and try again.');
    } finally {
      setPosting(false);
    }
  };

  const openInviteComposer = (idea: IdeaDeckItem) => {
    if ((idea as any).sponsored && (idea as any).campaignId) {
      void recordCampaignClick((idea as any).campaignId, user?.uid || '');
    }
    setInviteIdea(idea);
    setInviteMessage(`I like this idea. I can help with ${String((myProfile as any)?.occupation || 'building it')}.`);
  };

  const limitInviteMessageLines = (value: string) => {
    const lines = value.replace(/\r/g, '').split('\n').slice(0, 5);
    setInviteMessage(lines.join('\n').slice(0, 600));
  };

  const sendIdeaInvite = async () => {
    if (!user?.uid || !inviteIdea || inviteBusy) return;
    const message = inviteMessage.trim();
    if (!message) {
      notifyUser('Add a message', 'Write a short message so the idea owner knows why you want to connect.');
      return;
    }
    if (inviteIdea.ownerId === user.uid) {
      notifyUser('This is your idea', 'Other builders can request to connect with you from this card.');
      return;
    }

    setInviteBusy(true);
    try {
      const request = await requestConnection({
        senderId: user.uid,
        recipientId: inviteIdea.ownerId,
        senderName: displayNameFor(myProfile || user),
        senderPic: myProfile?.profilePic || user.photoURL || '',
        message,
        contextType: 'idea',
        ideaId: inviteIdea.id,
        ideaTitle: inviteIdea.title,
        recipientName: String((inviteIdea as any).ownerName || ''),
      });
      setInviteIdea(null);
      setInviteMessage('');
      notifyUser(
        request.status === 'approved' ? 'Already connected' : 'Invite sent',
        request.status === 'approved'
          ? 'You can already message this builder.'
          : `${inviteIdea.ownerName} can approve or reject your invite from notifications.`
      );
    } catch (error: any) {
      notifyUser('Could not send invite', error?.message || 'Please deploy the latest Firestore rules and try again.');
    } finally {
      setInviteBusy(false);
    }
  };

  const renderIdeaCard = (idea: IdeaDeckItem, isPreview = false) => (
    <Animated.View
      key={idea.id}
        style={[
        styles.card,
        liquidGlass(isDark),
        {
          width: cardWidth,
          minHeight: cardHeight,
          borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
        },
        isPreview
          ? { transform: [{ scale: nextScale }], opacity: 0.58 }
          : { transform: [...position.getTranslateTransform(), { rotate }] },
      ]}
      {...(!isPreview ? panResponder.panHandlers : {})}
    >
      {!isPreview && (
        <>
          <Animated.View style={[styles.swipeBadge, styles.likeBadge, { opacity: likeOpacity }]}>
            <Text style={styles.likeBadgeText}>Build</Text>
          </Animated.View>
          <Animated.View style={[styles.swipeBadge, styles.skipBadge, { opacity: skipOpacity }]}>
            <Text style={styles.skipBadgeText}>Pass</Text>
          </Animated.View>
        </>
      )}

      <View style={styles.cardGlow} />
      <View style={styles.cardHeader}>
        <View style={styles.ideaIcon}>
          <Lightbulb size={24} color="#000" fill="#00000012" />
        </View>
        <View style={[styles.sourcePill, (idea as any).sponsored && styles.sponsoredPill]}>
          <Text style={[styles.sourceText, (idea as any).sponsored && styles.sponsoredText]}>
            {(idea as any).sponsored ? 'Sponsored' : 'Tinder for Ideas'}
          </Text>
        </View>
      </View>

      <Text style={[styles.ideaTitle, { color: textColor(isDark) }]}>{idea.title}</Text>
      <Text style={[styles.ideaDescription, { color: textColor(isDark, 'secondary') }]}>{idea.description}</Text>

      <View style={styles.signalGrid}>
        <View style={[styles.signalCard, liquidGlass(isDark)]}>
          <Text style={styles.signalLabel}>Stage</Text>
          <Text style={[styles.signalValue, { color: textColor(isDark) }]}>{idea.stage || 'Idea Stage'}</Text>
        </View>
        <View style={[styles.signalCard, liquidGlass(isDark)]}>
          <Text style={styles.signalLabel}>Looking for</Text>
          <Text style={[styles.signalValue, { color: textColor(isDark) }]}>
            {(idea.lookingFor || []).slice(0, 4).join(', ') || 'Builders'}
          </Text>
        </View>
      </View>

      <View style={styles.tagsRow}>
        {(idea.tags || []).slice(0, 6).map((tag, index) => (
          <View key={`${idea.id}-${tag}-${index}`} style={styles.tagPill}>
            <Text style={styles.tagText}>{String(tag).toUpperCase()}</Text>
          </View>
        ))}
      </View>

      {!isPreview && (
        <TouchableOpacity onPress={() => openInviteComposer(idea)} style={styles.ideaInviteBtn}>
          <MessageSquare size={17} color="#000" />
          <Text style={styles.ideaInviteText}>Send 5-line Invite</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.ownerCard, liquidGlass(isDark, false)]}>
        <Image source={{ uri: idea.ownerPic || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256' }} style={styles.ownerPic} />
        <View style={{ flex: 1 }}>
          <View style={styles.ownerNameRow}>
            <Text style={[styles.ownerName, { color: textColor(isDark) }]} numberOfLines={1}>
              {idea.ownerName}
            </Text>
            {idea.ownerVerified ? <VerifiedBadge size={18} /> : null}
          </View>
          <Text style={styles.ownerMeta} numberOfLines={1}>
            {[idea.ownerOccupation || 'Builder', [idea.ownerCity, idea.ownerCountry].filter(Boolean).join(', ')].filter(Boolean).join(' - ')}
          </Text>
        </View>
        <View style={styles.ideaOwnerBadge}>
          <Text style={styles.ideaOwnerBadgeText}>Idea Owner</Text>
        </View>
      </View>
    </Animated.View>
  );

  const renderChip = (label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} onPress={onPress} style={[styles.composeChip, active && styles.composeChipActive]}>
      <Text style={[styles.composeChipText, active && styles.composeChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderIdeaComposer = () => (
    <Modal visible={composerOpen} transparent animationType="fade" onRequestClose={() => setComposerOpen(false)}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.composeSheet, liquidGlass(isDark)]}>
          <View style={styles.composeHeader}>
            <View>
              <Text style={[styles.composeTitle, { color: textColor(isDark) }]}>Post an Idea</Text>
              <Text style={styles.composeSub}>Builders can swipe right if they want in.</Text>
            </View>
            <TouchableOpacity onPress={() => setComposerOpen(false)} style={styles.composeCloseBtn}>
              <X size={22} color={textColor(isDark)} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.composeScroll}>
            <TextInput
              value={ideaTitle}
              onChangeText={setIdeaTitle}
              placeholder="Idea title"
              placeholderTextColor="#777"
              maxLength={90}
              style={[styles.composeInput, { color: textColor(isDark), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
            />
            <TextInput
              value={ideaDescription}
              onChangeText={setIdeaDescription}
              placeholder="What do you want to build?"
              placeholderTextColor="#777"
              maxLength={500}
              multiline
              textAlignVertical="top"
              style={[
                styles.composeInput,
                styles.composeTextArea,
                { color: textColor(isDark), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
              ]}
            />

            <Text style={[styles.composeLabel, { color: textColor(isDark) }]}>Stage</Text>
            <View style={styles.composeChipRow}>
              {IDEA_STAGE_OPTIONS.map((stage) => renderChip(stage, ideaStage === stage, () => setIdeaStage(stage)))}
            </View>

            <Text style={[styles.composeLabel, { color: textColor(isDark) }]}>Looking for</Text>
            <View style={styles.composeChipRow}>
              {IDEA_LOOKING_FOR_OPTIONS.map((item) =>
                renderChip(item, ideaLookingFor.includes(item), () => setIdeaLookingFor((current) => toggleValue(current, item)))
              )}
            </View>

            <Text style={[styles.composeLabel, { color: textColor(isDark) }]}>Field</Text>
            <View style={styles.composeChipRow}>
              {IDEA_FIELD_OPTIONS.map((field) =>
                renderChip(field, ideaFields.includes(field), () => setIdeaFields((current) => toggleValue(current, field)))
              )}
            </View>
          </ScrollView>

          <TouchableOpacity onPress={postIdea} disabled={posting} style={[styles.postIdeaBtn, posting && styles.postIdeaBtnDisabled]}>
            {posting ? <ActivityIndicator color="#000" /> : <Text style={styles.postIdeaText}>Post Idea</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const renderInviteComposer = () => (
    <Modal visible={!!inviteIdea} transparent animationType="fade" onRequestClose={() => setInviteIdea(null)}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.composeSheet, styles.inviteSheet, liquidGlass(isDark)]}>
          <View style={styles.composeHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.composeTitle, { color: textColor(isDark) }]}>Request to Connect</Text>
              <Text style={styles.composeSub} numberOfLines={2}>
                {inviteIdea ? `About: ${inviteIdea.title}` : 'Send a short invite.'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setInviteIdea(null)} style={styles.composeCloseBtn}>
              <X size={22} color={textColor(isDark)} />
            </TouchableOpacity>
          </View>

          <TextInput
            value={inviteMessage}
            onChangeText={limitInviteMessageLines}
            placeholder="Write up to 5 lines..."
            placeholderTextColor="#777"
            multiline
            numberOfLines={5}
            maxLength={600}
            textAlignVertical="top"
            style={[
              styles.composeInput,
              styles.inviteTextArea,
              { color: textColor(isDark), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
            ]}
          />
          <Text style={styles.inviteHint}>The idea owner can approve or reject this request before chat opens.</Text>

          <TouchableOpacity onPress={sendIdeaInvite} disabled={inviteBusy} style={[styles.postIdeaBtn, inviteBusy && styles.postIdeaBtnDisabled]}>
            {inviteBusy ? <ActivityIndicator color="#000" /> : <Text style={styles.postIdeaText}>Send Invite</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.headerBtn, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>Ideas</Text>
          <Text style={styles.headerSub}>Swipe ideas. Match on intent.</Text>
        </View>
        <TouchableOpacity onPress={() => setComposerOpen(true)} style={[styles.headerBtn, styles.plusBtn]}>
          <Plus size={22} color="#000" />
        </TouchableOpacity>
      </View>

      {loading && ideas.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primaryStrong} />
        </View>
      ) : topIdea ? (
        <View style={styles.deckWrap}>
          {nextIdea ? <View style={styles.previewLayer}>{renderIdeaCard(nextIdea, true)}</View> : null}
          <View style={styles.topLayer}>{renderIdeaCard(topIdea)}</View>
          <View style={styles.actionRow}>
            <TouchableOpacity onPress={() => animateSwipe('left')} style={styles.actionBtn}>
              <X size={30} color="#FF4D4D" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => animateSwipe('right')} style={[styles.actionBtn, styles.likeBtn]} disabled={busy}>
              {busy ? <ActivityIndicator color="#000" /> : <Heart size={36} color="#000" fill="#000" />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIdeas((current) => (current.length > 1 ? [...current.slice(1), current[0]] : current))} style={styles.actionBtn}>
              <RefreshCw size={30} color="#A1A1AA" />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          <Zap size={48} color={COLORS.primaryStrong} fill={COLORS.primary} />
          <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>No Ideas Yet</Text>
          <Text style={styles.emptyText}>Post an idea here so builders can swipe into it.</Text>
          <TouchableOpacity onPress={() => setComposerOpen(true)} style={styles.emptyButton}>
            <Plus size={16} color="#000" />
            <Text style={styles.emptyButtonText}>Add an Idea</Text>
          </TouchableOpacity>
        </View>
      )}
      {renderIdeaComposer()}
      {renderInviteComposer()}
      <ConfettiBurst active={confettiActive} width={width} />
      <PaywallModal
        visible={!!paywallFeature}
        feature={paywallFeature || PRO_FEATURES.startupAnalyzer}
        description={`Free accounts get ${FREE_LIMITS.dailyIdeaSwipes} idea swipes per day and ${FREE_LIMITS.startupIdeas} posted ideas. LINKUP PLUS unlocks unlimited ideas.`}
        onClose={() => setPaywallFeature('')}
      />
    </SafeAreaView>
  );
}

function ConfettiBurst({ active, width }: { active: boolean; width: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [active, progress]);

  if (!active) return null;

  const colors = [COLORS.primary, '#0A84FF', '#22C55E', '#FF4D4D', '#A855F7'];
  const safeWidth = Math.max(width || 360, 320);

  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {Array.from({ length: 24 }).map((_, index) => {
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-36, 360 + (index % 5) * 46],
        });
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, ((index % 2 === 0 ? 1 : -1) * (24 + (index % 7) * 12))],
        });
        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${180 + index * 37}deg`],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 0.82, 1],
          outputRange: [1, 1, 0],
        });

        return (
          <Animated.View
            key={`confetti-${index}`}
            style={[
              styles.confettiPiece,
              {
                left: (index * 53) % safeWidth,
                backgroundColor: colors[index % colors.length],
                opacity,
                transform: [{ translateX }, { translateY }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 74,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBtn: { backgroundColor: COLORS.primary },
  headerBtnGhost: { width: 44, height: 44 },
  headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 4 },
  headerSub: { marginTop: 4, color: '#666', fontSize: 10, fontWeight: '900', letterSpacing: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deckWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 112 },
  previewLayer: { position: 'absolute', top: 36, zIndex: 1 },
  topLayer: { zIndex: 2 },
  card: {
    borderWidth: 1,
    borderRadius: 36,
    overflow: 'hidden',
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  cardGlow: {
    position: 'absolute',
    right: -70,
    top: -70,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(17, 24, 39,0.19)',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  ideaIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourcePill: { borderRadius: 999, backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 7 },
  sponsoredPill: { backgroundColor: '#111217' },
  sponsoredText: { color: '#FFF' },
  sourceText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 0 },
  ideaTitle: { marginTop: 36, fontSize: 34, lineHeight: 40, fontWeight: '900', textTransform: 'uppercase' },
  ideaDescription: { marginTop: 16, fontSize: 16, lineHeight: 24, fontWeight: '800' },
  signalGrid: { flexDirection: 'row', gap: 10, marginTop: 22 },
  signalCard: { flex: 1, borderRadius: 16, padding: 14 },
  signalLabel: { fontSize: 8, fontWeight: '900', letterSpacing: -0.2, color: '#777' },
  signalValue: { marginTop: 6, fontSize: 12, fontWeight: '900' },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  tagPill: { borderRadius: 999, backgroundColor: 'rgba(17, 24, 39,0.10)', borderWidth: 1, borderColor: 'rgba(17, 24, 39,0.27)', paddingHorizontal: 10, paddingVertical: 7 },
  tagText: { fontSize: 9, fontWeight: '900', color: '#8A7900', letterSpacing: 0.9 },
  ideaInviteBtn: { marginTop: 18, height: 50, borderRadius: 16, backgroundColor: COLORS.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ideaInviteText: { color: '#000', fontSize: 11, fontWeight: '900', letterSpacing: -0.2 },
  ownerCard: { marginTop: 'auto', borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ownerPic: { width: 48, height: 48, borderRadius: 16 },
  ownerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ownerName: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase', flexShrink: 1 },
  ownerMeta: { marginTop: 3, fontSize: 10, fontWeight: '800', color: '#777' },
  ideaOwnerBadge: { height: 38, borderRadius: 14, backgroundColor: COLORS.primary, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  ideaOwnerBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: '#000' },
  swipeBadge: { position: 'absolute', top: 24, zIndex: 4, borderWidth: 4, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.32)' },
  likeBadge: { right: 22, borderColor: '#22C55E' },
  skipBadge: { left: 22, borderColor: '#FF4D4D' },
  likeBadgeText: { color: '#22C55E', fontSize: 28, fontWeight: '900' },
  skipBadgeText: { color: '#FF4D4D', fontSize: 28, fontWeight: '900' },
  actionRow: { position: 'absolute', bottom: 24, left: 0, right: 0, zIndex: 5, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 24 },
  actionBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#111217', alignItems: 'center', justifyContent: 'center' },
  likeBtn: { width: 84, height: 84, borderRadius: 42, backgroundColor: COLORS.primary,     shadowColor: COLORS.primary, shadowOpacity: 0.24, shadowRadius: 18, elevation: 8 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  emptyTitle: { marginTop: 14, fontSize: 24, fontWeight: '900', },
  emptyText: { marginTop: 8, maxWidth: 340, textAlign: 'center', color: '#666', fontSize: 13, lineHeight: 20, fontWeight: '800' },
  emptyButton: { marginTop: 18, height: 52, borderRadius: 16, backgroundColor: COLORS.primary, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  emptyButtonText: { fontSize: 11, fontWeight: '900', letterSpacing: -0.2, color: '#000' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.58)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  composeSheet: { width: '100%', maxWidth: 560, maxHeight: '88%', borderRadius: 30, padding: 18 },
  inviteSheet: { maxHeight: 440 },
  composeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  composeTitle: { fontSize: 20, fontWeight: '900', letterSpacing: 1.8 },
  composeSub: { marginTop: 4, color: '#777', fontSize: 12, fontWeight: '800' },
  composeCloseBtn: { width: 42, height: 42, borderRadius: 16, backgroundColor: '#F4F4F5', alignItems: 'center', justifyContent: 'center' },
  composeScroll: { paddingTop: 16, paddingBottom: 12 },
  composeInput: { minHeight: 54, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, fontSize: 15, fontWeight: '800', marginBottom: 12 },
  composeTextArea: { minHeight: 112, paddingTop: 14, lineHeight: 22 },
  inviteTextArea: { minHeight: 150, marginTop: 18, paddingTop: 14, lineHeight: 22 },
  inviteHint: { marginBottom: 14, color: '#777', fontSize: 11, fontWeight: '800', lineHeight: 17 },
  composeLabel: { marginTop: 8, marginBottom: 10, fontSize: 11, fontWeight: '900', letterSpacing: -0.2 },
  composeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  composeChip: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: COLORS.lightCard },
  composeChipActive: {     borderColor: COLORS.lightBorderActive, backgroundColor: COLORS.primary },
  composeChipText: { color: '#555', fontSize: 11, fontWeight: '900' },
  composeChipTextActive: { color: '#000' },
  postIdeaBtn: { height: 56, borderRadius: 16, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  postIdeaBtnDisabled: { opacity: 0.55 },
  postIdeaText: { color: '#000', fontSize: 13, fontWeight: '900', letterSpacing: 1.8 },
  confettiLayer: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  confettiPiece: { position: 'absolute', top: 42, width: 10, height: 18, borderRadius: 4 },
});
