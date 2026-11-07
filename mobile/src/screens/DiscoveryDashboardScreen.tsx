import MemberBadges from '../components/MemberBadges';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { buildFacts, DISCOVERY_VOICE } from '../lib/brandVoice';
import WeeklyMatchThinking from '../components/WeeklyMatchThinking';
import { UserProfile } from '../types';
import { COLORS, getBrandFlavor, textColor } from '../theme/theme';
import {
  BAND_SHORT,
  bandForScore,
  fetchServerWeeklyCofounder,
  selectLocalWeeklyCofounder,
  submitWeeklyCofounderInterest,
  type WeeklyCofounderMatch,
} from '../lib/matchmaking';
import { displayNameFor, earnedScore, handleFor, isDiscoverableProfile, opportunityDetails } from '../lib/discovery';
import { Briefcase, MapPin, Target, Rocket, Zap, UserCheck, Globe, CheckCircle2, MessageSquare, Mail } from 'lucide-react-native';
import { Campaign, isSponsoredHiddenForViewer, pickSponsoredCampaign, recordCampaignClick, SPONSORED_SLOT_ROTATE_MS } from '../lib/campaigns';
import { shareLinkupInvite } from '../lib/activation';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { IS_LOW_END_ANDROID, MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { AppImage } from '../components/AppImage';
import { ikAvatar } from '../lib/ikImage';
import {
  connectionRequestId,
  requestConnection,
  respondToConnectionRequest,
  subscribeToConnectionGate,
  type ConnectionGate,
} from '../lib/connectionRequests';
import { directMatchId, ensureDirectMatch } from '../lib/chat';

const dashboardCacheKey = (uid: string) => `linkup:dashboard:v3:${uid}`;
const weeklyCofounderCacheKey = (uid: string) => `linkup:weekly-cofounder:v1:${uid}`;
const DASHBOARD_CACHE_LIMIT = IS_LOW_END_ANDROID ? 24 : 60;

const HOME_FLAVOR_YELLOW = getBrandFlavor() === 'yellow';
const HOME_GOLD = HOME_FLAVOR_YELLOW ? '#FBE618' : '#FFFFFF';
const HOME_GOLD_DEEP = HOME_FLAVOR_YELLOW ? '#FBE618' : '#111827';
const HOME_GOLD_TINT = HOME_FLAVOR_YELLOW ? 'rgba(251,230,24,0.12)' : 'rgba(17,24,39,0.05)';
const HOME_INK = HOME_FLAVOR_YELLOW ? '#FBE618' : '#111827';
const HOME_LINE = HOME_FLAVOR_YELLOW ? 'rgba(251,230,24,0.45)' : 'rgba(17,24,39,0.12)';

const compactCachedImage = (value: unknown) => {
  return safeProfileImageUri(value, MOBILE_LIST_IMAGE_LIMIT);
};
const compactCachedProject = (project: any, index: number) => ({
  id: String(project?.id || `project_${index}`),
  title: String(project?.title || '').slice(0, 120),
  description: String(project?.description || '').slice(0, 240),
  status: String(project?.status || '').slice(0, 80),
  lookingFor: Array.isArray(project?.lookingFor) ? project.lookingFor.slice(0, 6) : [],
  tags: Array.isArray(project?.tags) ? project.tags.slice(0, 6) : [],
});
const compactDashboardProfile = (profile: UserProfile) => {
  if (!profile?.uid) return null;
  return {
    uid: profile.uid,
    displayName: displayNameFor(profile),
    username: (profile as any).username || '',
    bio: profile.bio || '',
    goals: (profile as any).goals || '',
    profilePic: compactCachedImage(profile.profilePic),
    occupation: (profile as any).occupation || '',
    company: (profile as any).company || '',
    city: profile.city || '',
    country: profile.country || '',
    age: Number(profile.age || 0),
    skills: Array.isArray(profile.skills) ? profile.skills.slice(0, 12) : [],
    industries: Array.isArray((profile as any).industries) ? (profile as any).industries.slice(0, 12) : [],
    lookingFor: Array.isArray((profile as any).lookingFor) ? (profile as any).lookingFor.slice(0, 12) : [],
    startupStage: (profile as any)?.startupStage || '',
    availability: (profile as any).availability || '',
    reputationScore: earnedScore(profile),
    turboConnect: !!(profile as any).turboConnect,
    isVisible: profile.isVisible !== false,
    isStealthMode: !!profile.isStealthMode,
    isVerified: !!profile.isVerified,
    isBot: !!(profile as any).isBot,
    onboarded: !!(profile as any).onboarded,
    projects: Array.isArray((profile as any).projects)
      ? (profile as any).projects.slice(0, 3).map(compactCachedProject)
      : [],
  };
};
const readCachedDashboardPeople = async (uid: string): Promise<UserProfile[]> => {
  try {
    const raw = await AsyncStorage.getItem(dashboardCacheKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((profile) => profile?.uid && isDiscoverableProfile(profile)).slice(0, DASHBOARD_CACHE_LIMIT) : [];
  } catch {
    return [];
  }
};
const writeCachedDashboardPeople = async (uid: string, people: UserProfile[]) => {
  try {
    await AsyncStorage.setItem(
      dashboardCacheKey(uid),
      JSON.stringify(people.slice(0, DASHBOARD_CACHE_LIMIT).map(compactDashboardProfile).filter(Boolean))
    );
  } catch {
    // Cache only makes the dashboard feel instant.
  }
};

/** One key per member per week: the wait is a weekly event, not a nag. */
const weeklyMatchKey = (uid: string | undefined, match: { weekKey?: string; partner?: { uid?: string } } | null): string => {
  if (!match) return '';
  const week = match.weekKey || match.partner?.uid || 'week';
  return `linkup:weekly-thinking:v1:${uid || 'anon'}:${week}`;
};

function DiscoveryDashboardScreen({ navigation }: any) {
  const { user, profile: me } = useAuth();
  const [hubSponsor, setHubSponsor] = useState<Campaign | null>(null);
  const adsHiddenForViewer = isSponsoredHiddenForViewer(me, { email: user?.email, isAdmin: (me as any)?.isAdmin });
  const { theme } = useTheme();
  const isFocused = useIsFocused();

  useEffect(() => {
    if (adsHiddenForViewer || !user?.uid || !isFocused) {
      if (adsHiddenForViewer || !user?.uid) setHubSponsor(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const pick = await pickSponsoredCampaign('hub', user.uid).catch(() => null);
      if (!cancelled) setHubSponsor(pick);
    };
    void load();
    const timer = setInterval(load, SPONSORED_SLOT_ROTATE_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [adsHiddenForViewer, user?.uid, isFocused]);

  const isDark = theme === 'dark';
  const [loading, setLoading] = useState(false);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [serverWeeklyMatch, setServerWeeklyMatch] = useState<WeeklyCofounderMatch | null>(null);
  const [gate, setGate] = useState<ConnectionGate>({ status: 'none' });
  const [interestBusy, setInterestBusy] = useState(false);

  useEffect(() => {
    if (!user || !isFocused) return;
    let isMounted = true;
    readCachedDashboardPeople(user.uid).then((cachedPeople) => {
      if (!isMounted) return;
      if (cachedPeople.length) {
        setPeople(cachedPeople);
        setLoading(false);
      }
    });
    AsyncStorage.getItem(weeklyCofounderCacheKey(user.uid))
      .then((raw) => {
        if (!isMounted || !raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.partner?.uid) setServerWeeklyMatch(parsed);
      })
      .catch(() => {});

    const unsub = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (profiles) => {
        const list = profiles.filter((profile: any) => profile.uid !== user.uid && isDiscoverableProfile(profile));
        setPeople((current) => {
          if (list.length === 0 && current.length > 0) return current;
          if (current.length === list.length && current.every((p, i) => p.uid === list[i]?.uid)) return current;
          return list;
        });
        if (list.length > 0) writeCachedDashboardPeople(user.uid, list).catch(() => {});
        setLoading(false);
      },
      onError: (err) => {
        console.error('dashboard users error', err);
        setLoading(false);
      },
    });
    return () => {
      isMounted = false;
      unsub();
    };
  }, [isFocused, user?.uid]);

  // Deterministic symmetric 1-of-1 weekly co-founder pick from the LINKUP engine
  const localWeeklyMatch = useMemo(() => {
    if (!me?.uid || people.length === 0) return null;
    return selectLocalWeeklyCofounder(me, people);
  }, [me, people]);

  // Server-locked 1-of-1 weekly co-founder match (persists symmetric pairing in Firestore,
  // runs AI explanation, and sends both people an email introducing both profiles).
  useEffect(() => {
    if (!user?.uid || !isFocused) return;
    let cancelled = false;
    void fetchServerWeeklyCofounder().then((remote) => {
      if (cancelled || !remote?.partner?.uid) return;
      setServerWeeklyMatch(remote);
      AsyncStorage.setItem(weeklyCofounderCacheKey(user.uid), JSON.stringify(remote)).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [isFocused, user?.uid, people.length]);

  // Everything the page says about "you" comes from here: their name, their
  // build, and the chair that is still empty. No member should ever read a
  // sentence on this page that would make sense to somebody else.
  const facts = useMemo(() => buildFacts(me as any), [me]);

  const weeklyMatch: WeeklyCofounderMatch | null = useMemo(() => {
    if (serverWeeklyMatch?.partner?.uid) {
      const livePartner = people.find((p) => p.uid === serverWeeklyMatch.partner.uid);
      return livePartner
        ? { ...serverWeeklyMatch, partner: { ...livePartner, ...serverWeeklyMatch.partner, profilePic: livePartner.profilePic || serverWeeklyMatch.partner.profilePic } }
        : serverWeeklyMatch;
    }
    return localWeeklyMatch;
  }, [serverWeeklyMatch, localWeeklyMatch, people]);

  // THE WEEKLY WAIT. Once per week, per member: four seconds of the cat
  // thinking before the one person appears. The wait is the product promise
  // being kept slowly enough to feel like something was decided.
  const [weeklyReveal, setWeeklyReveal] = useState<'idle' | 'thinking' | 'revealed'>('idle');
  const weeklyRevealKey = weeklyMatchKey(me?.uid, weeklyMatch);
  useEffect(() => {
    if (!weeklyRevealKey) return undefined;
    let active = true;
    AsyncStorage.getItem(weeklyRevealKey)
      .then((value) => { if (active) setWeeklyReveal(value === '1' ? 'revealed' : 'thinking'); })
      // If storage is unavailable we still show the card rather than trapping
      // the member behind a screen that will never finish.
      .catch(() => { if (active) setWeeklyReveal('revealed'); });
    return () => { active = false; };
  }, [weeklyRevealKey]);
  const finishWeeklyThinking = useCallback(() => {
    setWeeklyReveal('revealed');
    if (weeklyRevealKey) void AsyncStorage.setItem(weeklyRevealKey, '1').catch(() => {});
  }, [weeklyRevealKey]);

  const partnerUid = weeklyMatch?.partner?.uid || '';

  useEffect(() => {
    if (!user?.uid || !partnerUid) {
      setGate({ status: 'none' });
      return;
    }
    return subscribeToConnectionGate(user.uid, partnerUid, (nextGate) => {
      setGate(nextGate);
    });
  }, [user?.uid, partnerUid]);

  const viewerInterested = !!(
    weeklyMatch?.viewerInterested ||
    gate.status === 'pending_out' ||
    gate.status === 'approved'
  );
  const partnerInterested = !!(
    weeklyMatch?.partnerInterested ||
    gate.status === 'pending_in' ||
    gate.status === 'approved'
  );
  const isMutualMatch = !!(weeklyMatch?.mutualInterest || gate.status === 'approved' || (viewerInterested && partnerInterested));

  const handleOpenMutualChat = async (item: UserProfile) => {
    if (!user?.uid || !item?.uid) return;
    try {
      setInterestBusy(true);
      const matchId = await ensureDirectMatch(user.uid, item.uid);
      navigation.navigate('Chat', { matchId, otherUser: item });
    } catch {
      navigation.navigate('Profile', {
        userId: item.uid,
        compatibilityScore: weeklyMatch?.score,
        compatibilityReason: weeklyMatch?.reason || '',
      });
    } finally {
      setInterestBusy(false);
    }
  };

  const handleExpressInterest = async (item: UserProfile) => {
    if (!user?.uid || !item?.uid || interestBusy) return;
    setInterestBusy(true);
    try {
      const partnerName = displayNameFor(item);
      const introNote = weeklyMatch?.opener
        ? `${weeklyMatch.opener} (Matched as 1-of-1 Weekly Potential Co-Founders on LINKUP)`
        : `Hey ${partnerName}, LINKUP’s algorithm & AI paired us as each other’s 1-of-1 potential co-founder this week — would love to meet!`;

      if (gate.status === 'pending_in' || partnerInterested) {
        const reqId = gate.requestId || connectionRequestId(item.uid, user.uid);
        await respondToConnectionRequest({
          requestId: reqId,
          responderId: user.uid,
          senderId: item.uid,
          approved: true,
          responderName: displayNameFor(me as any),
          responderPic: me?.profilePic,
        }).catch(() => {});
        const serverRes = await submitWeeklyCofounderInterest(item.uid, weeklyMatch?.weekKey, introNote);
        const matchId = serverRes.matchId || (await ensureDirectMatch(user.uid, item.uid).catch(() => directMatchId(user.uid, item.uid)));
        setServerWeeklyMatch((prev) =>
          prev
            ? { ...prev, viewerInterested: true, partnerInterested: true, mutualInterest: true, matchId }
            : prev
        );
        navigation.navigate('Chat', { matchId, otherUser: item });
        return;
      }

      await requestConnection({
        senderId: user.uid,
        recipientId: item.uid,
        senderName: displayNameFor(me as any),
        senderPic: me?.profilePic,
        recipientName: partnerName,
        message: introNote,
      }).catch(() => {});

      const serverRes = await submitWeeklyCofounderInterest(item.uid, weeklyMatch?.weekKey, introNote);
      if (serverRes.mutualInterest) {
        const matchId = serverRes.matchId || (await ensureDirectMatch(user.uid, item.uid).catch(() => directMatchId(user.uid, item.uid)));
        setServerWeeklyMatch((prev) =>
          prev
            ? { ...prev, viewerInterested: true, partnerInterested: true, mutualInterest: true, matchId }
            : prev
        );
        navigation.navigate('Chat', { matchId, otherUser: item });
      } else {
        setServerWeeklyMatch((prev) =>
          prev ? { ...prev, viewerInterested: true } : prev
        );
      }
    } finally {
      setInterestBusy(false);
    }
  };

  const WeeklyCofounderCard = ({ match }: { match: WeeklyCofounderMatch }) => {
    const item = match.partner;
    const details = opportunityDetails(item);
    const partnerName = displayNameFor(item);
    const partnerFirst = partnerName.split(' ')[0] || partnerName;
    const band = bandForScore(match.score);
    const locationLabel = [item.city, item.country].filter(Boolean).join(', ') || details.location || 'Remote';
    const roleLabel = (item as any).occupation || details.roleNeed || 'Founder & Builder';
    const companyLabel = (item as any).company || (item as any)?.projects?.[0]?.title || '';
    const myOffers = Array.isArray(match.myOffers) && match.myOffers.length
      ? match.myOffers
      : (Array.isArray(me?.skills) && me!.skills.length ? me!.skills.slice(0, 3) : ['Product Execution']);
    const partnerOffers = Array.isArray(match.partnerOffers) && match.partnerOffers.length
      ? match.partnerOffers
      : (Array.isArray(item.skills) && item.skills.length ? item.skills.slice(0, 3) : ['Technical & Growth Execution']);
    const tags = [
      ...(Array.isArray(item.skills) ? item.skills.slice(0, 4) : []),
      ...(Array.isArray((item as any).lookingFor) ? (item as any).lookingFor.slice(0, 2) : []),
    ].filter(Boolean);

    return (
      <View
        style={[
          styles.cofounderCard,
          {
            backgroundColor: isDark ? '#12151E' : '#FFFFFF',
            borderColor: isDark ? 'rgba(251,230,24,0.38)' : 'rgba(17,24,39,0.14)',
          },
        ]}
      >
        {/* Top Exclusive 1-of-1 Weekly Header */}
        <View style={styles.exclusiveBanner}>
          <View style={[styles.exclusivePill, { backgroundColor: HOME_GOLD, borderColor: HOME_LINE }]}>
            <Zap size={12} color="#000" />
            <Text style={styles.exclusivePillText}>1-OF-1 WEEKLY POTENTIAL CO-FOUNDER · {match.weekKey || 'THIS WEEK'}</Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                band.label,
                `${match.why?.shared || match.reason || ''}\n\n${match.why?.complement || ''}`.trim()
              )
            }
            style={[styles.scoreBadge, { backgroundColor: HOME_GOLD, borderColor: HOME_LINE }]}
            activeOpacity={0.85}
          >
            <Zap size={11} color="#000" />
            <Text style={styles.scoreBadgeText}>{BAND_SHORT[band.id] || 'STRONG'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.mutualRuleSub, { color: textColor(isDark, 'muted') }]}>
          Selected by the LINKUP AI &amp; Algorithm · When {partnerFirst} opens LINKUP this week, you are shown as their only potential co-founder too.
        </Text>

        {/* Attention-Grabbing Hero Identity */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() =>
            navigation.navigate('Profile', {
              userId: item.uid,
              compatibilityScore: match.score,
              compatibilityReason: match.reason || '',
            })
          }
          style={[
            styles.profileHeroBox,
            { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F8FAFC' },
          ]}
        >
          <View style={styles.avatarRing}>
            <AppImage
              uri={
                ikAvatar(safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT)) ||
                'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256'
              }
              style={styles.heroAvatar}
            />
            <View style={styles.liveDot} />
          </View>

          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.heroName, { color: textColor(isDark) }]} numberOfLines={1}>
                {partnerName}
              </Text>
              <MemberBadges userId={item.uid} verified={!!item.isVerified} size={20} />
            </View>
            <Text style={[styles.handle, { color: HOME_GOLD_DEEP }]} numberOfLines={1}>
              {handleFor(item)}
            </Text>
            <Text style={[styles.roleLine, { color: textColor(isDark) }]} numberOfLines={2}>
              {roleLabel}
              {companyLabel ? ` · ${companyLabel}` : ''}
            </Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.metaChip}>
                <MapPin size={11} color="#4ADE80" />
                <Text style={[styles.metaChipText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                  {locationLabel}
                </Text>
              </View>
              {!!details.stage && (
                <View style={styles.metaChip}>
                  <Briefcase size={11} color={HOME_INK} />
                  <Text style={[styles.metaChipText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                    {details.stage}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {/* Bio / What They Are Building */}
        {!!(item.bio || (item as any).goals || details.summary) && (
          <View style={styles.bioSection}>
            <Text style={[styles.bioLabel, { color: textColor(isDark, 'muted') }]}>{DISCOVERY_VOICE.cardLabel(partnerFirst)}</Text>
            <Text style={[styles.bioText, { color: textColor(isDark, 'secondary') }]} numberOfLines={4}>
              {item.bio || (item as any).goals || details.summary}
            </Text>
          </View>
        )}

        {/* LINKUP Algorithm + AI Co-Founder Synergy Breakdown */}
        <View
          style={[
            styles.synergyBox,
            {
              backgroundColor: isDark ? 'rgba(251,230,24,0.07)' : '#FCFBF3',
              borderColor: isDark ? 'rgba(251,230,24,0.25)' : '#E7E1BF',
            },
          ]}
        >
          <View style={styles.synergyHeader}>
            <Rocket size={14} color={isDark ? '#FBE618' : '#111827'} />
            <Text style={[styles.synergyTitle, { color: textColor(isDark) }]} numberOfLines={1}>
              {match.aiHeadline || `WHY ${partnerFirst.toUpperCase()} IS THIS WEEK'S ONLY INTRODUCTION`}
            </Text>
          </View>

          {!!match.why?.shared && (
            <View style={styles.synergyBullet}>
              <Text style={[styles.synergyBulletKey, { color: isDark ? '#FBE618' : '#6E5B00' }]}>SHARED SIGNAL</Text>
              <Text style={[styles.synergyBulletVal, { color: textColor(isDark) }]}>{match.why.shared}</Text>
            </View>
          )}

          {!!match.why?.complement && (
            <View style={styles.synergyBullet}>
              <Text style={[styles.synergyBulletKey, { color: isDark ? '#FBE618' : '#6E5B00' }]}>CO-FOUNDER COMPLEMENT</Text>
              <Text style={[styles.synergyBulletVal, { color: textColor(isDark) }]}>{match.why.complement}</Text>
            </View>
          )}

          <View style={styles.exchangeGrid}>
            <View style={[styles.exchangeCol, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF' }]}>
              <Text style={[styles.exchangeLabel, { color: textColor(isDark, 'muted') }]}>{DISCOVERY_VOICE.youBring}</Text>
              <Text style={[styles.exchangeValue, { color: textColor(isDark) }]} numberOfLines={2}>
                {myOffers.join(' · ')}
              </Text>
            </View>
            <View style={[styles.exchangeCol, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF' }]}>
              <Text style={[styles.exchangeLabel, { color: textColor(isDark, 'muted') }]}>{DISCOVERY_VOICE.theyBring(partnerFirst)}</Text>
              <Text style={[styles.exchangeValue, { color: textColor(isDark) }]} numberOfLines={2}>
                {partnerOffers.join(' · ')}
              </Text>
            </View>
          </View>

          {!!match.tinyTask && (
            <View style={styles.sprintRow}>
              <Target size={12} color={isDark ? '#4ADE80' : '#15803D'} />
              <Text style={[styles.sprintText, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
                {DISCOVERY_VOICE.sprint(match.tinyTask)}
              </Text>
            </View>
          )}
        </View>

        {/* Skills & Looking For Tags */}
        {tags.length > 0 && (
          <View style={styles.tagsRow}>
            {tags.slice(0, 6).map((tag, index) => (
              <View
                key={`${item.uid}-${tag}-${index}`}
                style={[styles.tagChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}
              >
                <Text style={[styles.tagText, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                  {String(tag).toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Mutual Interest Status Banner */}
        <View
          style={[
            styles.mutualStatusBanner,
            {
              backgroundColor: isMutualMatch
                ? 'rgba(74,222,128,0.14)'
                : partnerInterested
                  ? 'rgba(251,230,24,0.16)'
                  : isDark
                    ? 'rgba(255,255,255,0.04)'
                    : '#F3F4F6',
            },
          ]}
        >
          {isMutualMatch ? (
            <CheckCircle2 size={15} color="#22C55E" />
          ) : (
            <UserCheck size={15} color={partnerInterested ? '#EAB308' : textColor(isDark, 'muted')} />
          )}
          <Text style={[styles.mutualStatusText, { color: textColor(isDark) }]}>
            {isMutualMatch
              ? `Both you and ${partnerFirst} are interested! Your direct co-founder room is unlocked.`
              : partnerInterested
                ? `${partnerFirst} is already interested in meeting you as a co-founder! Tap below to meet.`
                : viewerInterested
                  ? `You're marked as interested. When ${partnerFirst} taps Interested on your profile, you two meet!`
                  : `Mutual 1:1 Rule: If both you and ${partnerFirst} tap Interested this week, you unlock a direct intro to meet.`}
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          {isMutualMatch ? (
            <TouchableOpacity
              onPress={() => void handleOpenMutualChat(item)}
              disabled={interestBusy}
              style={[styles.primaryActionBtn, { backgroundColor: '#22C55E' }]}
              activeOpacity={0.88}
            >
              <MessageSquare size={15} color="#000" />
              <Text style={styles.primaryActionBtnText}>Meet &amp; Message {partnerFirst}</Text>
            </TouchableOpacity>
          ) : partnerInterested ? (
            <TouchableOpacity
              onPress={() => void handleExpressInterest(item)}
              disabled={interestBusy}
              style={[styles.primaryActionBtn, { backgroundColor: HOME_GOLD, borderWidth: 1, borderColor: HOME_LINE }]}
              activeOpacity={0.88}
            >
              <Zap size={15} color="#000" />
              <Text style={styles.primaryActionBtnText}>
                {interestBusy ? 'Opening the door…' : DISCOVERY_VOICE.mutualCta(partnerFirst)}
              </Text>
            </TouchableOpacity>
          ) : viewerInterested ? (
            <View
              style={[
                styles.primaryActionBtn,
                {
                  backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB',
                },
              ]}
            >
              <CheckCircle2 size={15} color={textColor(isDark)} />
              <Text style={[styles.primaryActionBtnText, { color: textColor(isDark) }]}>
                {DISCOVERY_VOICE.waiting(partnerFirst)}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => void handleExpressInterest(item)}
              disabled={interestBusy}
              style={[styles.primaryActionBtn, { backgroundColor: HOME_GOLD, borderWidth: 1, borderColor: HOME_LINE }]}
              activeOpacity={0.88}
            >
              <UserCheck size={15} color="#000" />
              <Text style={styles.primaryActionBtnText}>
                {interestBusy ? 'Saying yes…' : DISCOVERY_VOICE.interestCta(partnerFirst)}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() =>
              navigation.navigate('Profile', {
                userId: item.uid,
                compatibilityScore: match.score,
                compatibilityReason: match.reason || '',
              })
            }
            style={[
              styles.secondaryActionBtn,
              {
                backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6',
                borderColor: HOME_LINE,
              },
            ]}
            activeOpacity={0.85}
          >
            <Text style={[styles.secondaryActionBtnText, { color: textColor(isDark) }]}>{DISCOVERY_VOICE.fullProfile}</Text>
          </TouchableOpacity>
        </View>

        {/* Dual Email Introduction Footer */}
        <View style={styles.emailFooterRow}>
          <Mail size={12} color={textColor(isDark, 'muted')} />
          <Text style={[styles.emailFooterText, { color: textColor(isDark, 'muted') }]}>
            {DISCOVERY_VOICE.emailed(partnerFirst)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}>
      {loading && people.length === 0 ? (
        <ActivityIndicator color={HOME_INK} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={[styles.heroCard, { backgroundColor: isDark ? COLORS.darkCard : '#FFF' }]}>
              <View style={styles.heroTop}>
                <Text style={[styles.heroOpener, { color: textColor(isDark) }]}>
                  {DISCOVERY_VOICE.opener(facts)}
                </Text>
                <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>
                  {DISCOVERY_VOICE.headline}
                </Text>
                <Text style={[styles.heroSub, { color: textColor(isDark, 'muted') }]}>
                  {DISCOVERY_VOICE.stakes(facts)}
                </Text>
              </View>

              {hubSponsor && (
                <TouchableOpacity
                  activeOpacity={0.88}
                  onPress={() => {
                    void recordCampaignClick(hubSponsor.id, user?.uid || '');
                    const url = hubSponsor.creative?.website || '';
                    if (url) Linking.openURL(url).catch(() => {});
                  }}
                  style={[styles.sponsorStrip, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFF' }]}
                >
                  <View style={styles.sponsorStripPill}>
                    <Text style={styles.sponsorStripPillText}>SPONSORED</Text>
                  </View>
                  {!!hubSponsor.creative?.logoUrl && (
                    <Image source={{ uri: ikAvatar(hubSponsor.creative.logoUrl) }} style={styles.sponsorStripLogo} resizeMode="cover" />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sponsorStripTitle, { color: textColor(isDark) }]} numberOfLines={1}>
                      {hubSponsor.creative?.productName || hubSponsor.creative?.title || 'Sponsored'}
                    </Text>
                    <Text style={[styles.sponsorStripSub, { color: textColor(isDark, 'muted') }]} numberOfLines={1}>
                      {hubSponsor.creative?.tagline || hubSponsor.creative?.description || ''}
                    </Text>
                  </View>
                  <Globe size={14} color={textColor(isDark, 'muted')} />
                </TouchableOpacity>
              )}

              {weeklyMatch ? (
                <>
                  <WeeklyMatchThinking
                    profile={me as any}
                    visible={weeklyReveal === 'thinking'}
                    onDone={finishWeeklyThinking}
                  />
                  {/* Nothing of the person is painted until the wait has
                      resolved, so there is no flash of them underneath it. */}
                  {weeklyReveal === 'idle' ? null : <WeeklyCofounderCard match={weeklyMatch} />}
                </>
              ) : (
                <View style={[styles.emptyCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : '#F9FAFB' }]}>
                  <Text style={[styles.emptyTitle, { color: textColor(isDark) }]}>{DISCOVERY_VOICE.emptyTitle}</Text>
                  <Text style={[styles.emptySub, { color: textColor(isDark, 'muted') }]}>
                    {DISCOVERY_VOICE.emptyBody}
                  </Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.emptyBtn}>
                    <Text style={styles.emptyBtnText}>{DISCOVERY_VOICE.emptyCta}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => void shareLinkupInvite()} style={{ marginTop: 12 }}>
                    <Text style={[styles.emptySub, { color: textColor(isDark, 'muted'), textAlign: 'center', fontWeight: '800' }]}>
                      Or bring the one person you already rate →
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollArea: { flex: 1 },
  heroCard: {
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  heroTop: {
    gap: 6,
  },
  heroOpener: {
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.1,
    lineHeight: 20,
    marginBottom: 2,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  heroSub: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  sponsorStrip: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.10)',
  },
  sponsorStripPill: { borderRadius: 999, backgroundColor: '#111217', paddingHorizontal: 9, paddingVertical: 5 },
  sponsorStripPillText: { color: '#FFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  sponsorStripTitle: { fontSize: 12, fontWeight: '900' },
  sponsorStripSub: { marginTop: 2, fontSize: 10, fontWeight: '800' },
  sponsorStripLogo: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.04)' },
  cofounderCard: {
    marginTop: 18,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  exclusiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  exclusivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
  },
  exclusivePillText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.6,
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
  },
  scoreBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.5,
  },
  mutualRuleSub: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  profileHeroBox: {
    marginTop: 14,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarRing: {
    position: 'relative',
    padding: 3,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FBE618',
  },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 20,
  },
  liveDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4ADE80',
    borderWidth: 2,
    borderColor: '#111827',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroName: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  handle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '800',
  },
  roleLine: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  heroMetaRow: {
    marginTop: 7,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bioSection: {
    marginTop: 14,
    paddingHorizontal: 4,
  },
  bioLabel: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  bioText: {
    marginTop: 5,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
  synergyBox: {
    marginTop: 14,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 10,
  },
  synergyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  synergyTitle: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
    flex: 1,
  },
  synergyBullet: {
    gap: 2,
  },
  synergyBulletKey: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  synergyBulletVal: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  exchangeGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  exchangeCol: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
  },
  exchangeLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  exchangeValue: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  sprintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingTop: 4,
  },
  sprintText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  tagChip: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  tagText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  mutualStatusBanner: {
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mutualStatusText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  actionRow: {
    marginTop: 14,
    gap: 10,
  },
  primaryActionBtn: {
    height: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  primaryActionBtnText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.2,
  },
  secondaryActionBtn: {
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryActionBtnText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  emailFooterRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148,163,184,0.15)',
  },
  emailFooterText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 14,
  },
  emptyCard: {
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
  },
  emptyTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  emptySub: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  emptyBtn: {
    height: 38,
    borderRadius: 12,
    backgroundColor: HOME_GOLD,
    borderWidth: 1,
    borderColor: HOME_LINE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  emptyBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    color: '#000',
  },
});

export default DiscoveryDashboardScreen;
