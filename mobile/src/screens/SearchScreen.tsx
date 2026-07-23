import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  PanResponder,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { UserProfile } from '../types';
import { Search, SlidersHorizontal, X, Star, MapPin, Briefcase, Clock } from 'lucide-react-native';
import { geminiToSearchFilters } from '../lib/gemini';
import { localCommonalityRank, rankCandidatesHybrid } from '../lib/matchmaking';
import { describeAIError, getLastAIDiagnostic } from '../lib/aiDiagnostics';
import VerifiedBadge from '../components/VerifiedBadge';
import { isDiscoverableProfile } from '../lib/discovery';
import { LINKUP_ROLE_LABELS, roleInfoFor } from '../lib/roles';
import PaywallModal from '../components/PaywallModal';
import { isAndroidProLocked, PRO_FEATURES } from '../lib/paywall';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';
import { IS_LOW_END_ANDROID, MOBILE_LIST_IMAGE_LIMIT, MOBILE_SEARCH_RENDER_LIMIT, safeProfileImageUri } from '../lib/profilePerformance';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

const normalize = (v: string) => v.trim().toLowerCase();
const LOOKING_FOR_FILTERS = ['Cofounder', 'Startup Team', 'Mentor', 'Internship', 'Freelance Work', 'Investment', ...LINKUP_ROLE_LABELS];
const STAGE_FILTERS = ['Idea', 'MVP', 'Early Users', 'Revenue', 'Scaling', 'Fundraising'];
const INDUSTRY_FILTERS = ['Automation', 'SaaS', 'Fintech', 'Healthtech', 'EdTech', 'Gaming', 'E-commerce', 'Crypto'];
const WEB_RESULT_RENDER_LIMIT = 40;
const NATIVE_RESULT_RENDER_LIMIT = MOBILE_SEARCH_RENDER_LIMIT;

type SavedSearchAlert = {
  id: string;
  label: string;
  queryText: string;
  location: string;
  skills: string;
  experience: string;
  industry: string;
  availability: string;
  timezone: string;
  lookingForRole: string;
  stageFilter: string;
  lookingForCofounder: boolean;
  verifiedOnly: boolean;
  activeWithin: 'any' | 'today' | 'week';
  minCompatibility: number;
  createdAt: number;
};

const includesAny = (haystack: string, needles: string[]) => {
  const h = normalize(haystack);
  return needles.some((n) => h.includes(normalize(n)));
};

const cleanUsername = (value: string) => value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

const profileHandle = (profile: Partial<UserProfile>) => {
  const raw = (profile as any).username || profile.displayName || 'builder';
  return `@${cleanUsername(String(raw)) || 'builder'}`;
};

const projectSearchText = (profile: Partial<UserProfile>) => {
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  return projects
    .map((project: any) => [project?.title, project?.description, project?.status].filter(Boolean).join(' '))
    .join(' ');
};

const buildMatchReason = (
  me: UserProfile | null | undefined,
  candidate: UserProfile,
  aiRankMap: Record<string, { score: number; reason: string }>,
  queryText: string
) => {
  const ai = aiRankMap[candidate.uid];
  if (ai?.reason) return ai.reason;

  const normalizeList = (value: unknown) =>
    Array.isArray(value) ? value.map((entry) => normalize(String(entry))).filter(Boolean) : [];
  const mySkills = normalizeList(me?.skills);
  const theirSkills = normalizeList(candidate.skills);
  const myIndustries = normalizeList((me as any)?.industries);
  const theirIndustries = normalizeList((candidate as any).industries);
  const sharedSkills = theirSkills.filter((skill) => mySkills.includes(skill));
  const sharedIndustries = theirIndustries.filter((industry) => myIndustries.includes(industry));
  const projectHit = queryText.trim() && includesAny(projectSearchText(candidate), [queryText]);
  const reasonParts = [
    sharedSkills.length ? `${sharedSkills.length} shared skill${sharedSkills.length === 1 ? '' : 's'}` : '',
    sharedIndustries.length ? `${sharedIndustries.length} shared startup interest${sharedIndustries.length === 1 ? '' : 's'}` : '',
    projectHit ? 'their project matches your search intent' : '',
    (candidate as any).availability ? `availability: ${(candidate as any).availability}` : '',
  ].filter(Boolean);

  return reasonParts.slice(0, 3).join(' / ') || 'Strong potential builder fit based on profile intent, skills, and availability.';
};

const lookingForNeedles = (option: string) => {
  const key = normalize(option);
  const aliases: Record<string, string[]> = {
    cto: ['CTO', 'technical cofounder', 'technical founder', 'tech lead', 'developer'],
    designer: ['designer', 'UI/UX', 'product designer'],
    marketer: ['marketer', 'marketing', 'growth', 'growth hacker'],
    developer: ['developer', 'engineer', 'frontend', 'backend', 'mobile developer'],
    investor: ['investor', 'investment', 'angel'],
    mentor: ['mentor', 'mentorship', 'advisor'],
    'startup team': ['startup team', 'team member', 'collaborator'],
  };
  return aliases[key] || [option];
};

const stageNeedles = (option: string) => {
  const key = normalize(option);
  const aliases: Record<string, string[]> = {
    mvp: ['MVP', 'building MVP'],
    'early users': ['early users', 'early traction', 'early customers'],
    revenue: ['revenue', 'revenue generating'],
  };
  return aliases[key] || [option];
};

export default function SearchScreen({ navigation, route }: any) {
  const { user, profile: me } = useAuth();
  const { theme } = useTheme();
  const isFocused = useIsFocused();
  const isDark = theme === 'dark';

  const [loading, setLoading] = useState(true);
  const [allProfiles, setAllProfiles] = useState<UserProfile[]>([]);
  const [queryText, setQueryText] = useState('');
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRankLoading, setAiRankLoading] = useState(false);
  const [aiRankMode, setAiRankMode] = useState(false);
  const [aiRankMap, setAiRankMap] = useState<Record<string, { score: number; reason: string }>>({});
  const [savedAlerts, setSavedAlerts] = useState<SavedSearchAlert[]>([]);
  const [savingAlert, setSavingAlert] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('');

  // Filters (simple + client-side for now)
  const [filterOpen, setFilterOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState(''); // comma-separated
  const [experience, setExperience] = useState(''); // free-text
  const [industry, setIndustry] = useState('');
  const [availability, setAvailability] = useState(''); // free-text
  const [timezone, setTimezone] = useState('');
  const [lookingForRole, setLookingForRole] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [lookingForCofounder, setLookingForCofounder] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [activeWithin, setActiveWithin] = useState<'any' | 'today' | 'week'>('any');
  const [minCompatibility, setMinCompatibility] = useState(0); // 0..100
  const routedSkill = String(route?.params?.skill || route?.params?.initialSkill || '').trim();
  const routedQuery = String(route?.params?.query || '').trim();
  const routedSearchToken = String(route?.params?.searchToken || '');
  const proLocked = isAndroidProLocked(me);
  const openPaywall = (feature: string) => setPaywallFeature(feature);

  const sliderWidth = 240;
  const knobX = useRef(0);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  const compatibilityMap = useMemo(() => {
    const ranked = localCommonalityRank(me, allProfiles, Math.max(allProfiles.length, 1));
    return ranked.reduce<Record<string, number>>((map, rank) => {
      map[rank.uid] = rank.score;
      return map;
    }, {});
  }, [allProfiles, me]);

  const computeCompatibility = useCallback(
    (p: UserProfile) => compatibilityMap[p.uid] ?? 0,
    [compatibilityMap]
  );

  const sliderResponder = useMemo(
    () =>
      Platform.OS === 'web'
        ? null
        : PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderMove: (_evt, gesture) => {
              const next = clamp(knobX.current + gesture.dx, 0, sliderWidth);
              const pct = Math.round((next / sliderWidth) * 100);
              setMinCompatibility(pct);
            },
            onPanResponderRelease: (_evt, gesture) => {
              const next = clamp(knobX.current + gesture.dx, 0, sliderWidth);
              knobX.current = next;
              const pct = Math.round((next / sliderWidth) * 100);
              setMinCompatibility(pct);
            },
          }),
    [sliderWidth]
  );
  const sliderPanHandlers = sliderResponder?.panHandlers || {};

  useEffect(() => {
    if (!user || !isFocused) return;
    setLoading(allProfiles.length === 0);
    const unsub = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (data) => {
        const nextProfiles = data.filter((p: any) => p.uid !== user.uid && isDiscoverableProfile(p));
        setAllProfiles((current) => (nextProfiles.length > 0 || current.length === 0 ? nextProfiles : current));
        setLoading(false);
      },
      onError: (err) => {
        console.error('Search users error:', err);
        setLoading(false);
      },
    });
    return () => unsub();
  }, [isFocused, user?.uid]);

  useEffect(() => {
    if (proLocked) setFilterOpen(false);
  }, [proLocked]);

  useEffect(() => {
    if (routedSkill) {
      setQueryText(routedQuery || routedSkill);
      setSkills(routedSkill);
      setFilterOpen(false);
      return;
    }

    if (routedQuery) {
      setQueryText(routedQuery);
      setFilterOpen(false);
    }
  }, [routedSkill, routedQuery, routedSearchToken]);

  useEffect(() => {
    if (!user?.uid) {
      setSavedAlerts([]);
      return;
    }
    if (!isFocused) return;
    if (IS_LOW_END_ANDROID) {
      getDoc(doc(db, 'userPrivate', user.uid))
        .then((snap) => {
          const alerts = snap.data()?.savedSearchAlerts;
          setSavedAlerts(Array.isArray(alerts) ? alerts.slice(0, 10) : []);
        })
        .catch((error) => {
          console.warn('Saved search alerts unavailable:', error);
        });
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'userPrivate', user.uid),
      (snap) => {
        const alerts = snap.data()?.savedSearchAlerts;
        setSavedAlerts(Array.isArray(alerts) ? alerts.slice(0, 25) : []);
      },
      (error) => {
        console.warn('Saved search alerts unavailable:', error);
      }
    );
    return () => unsub();
  }, [isFocused, user?.uid]);

  const filtered = useMemo(() => {
    const q = normalize(queryText);
    const skillList = skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    return allProfiles.filter((p) => {
      const name = p.displayName || '';
      const username = cleanUsername(String((p as any).username || ''));
      const handle = username ? `@${username}` : profileHandle(p);
      const queryWithoutAt = cleanUsername(q);
      const bio = p.bio || '';
      const city = p.city || '';
      const country = p.country || '';
      const occupation = (p as any).occupation || '';
      const userSkills = Array.isArray(p.skills) ? p.skills : [];
      const industries = Array.isArray((p as any).industries) ? (p as any).industries : [];
      const exp = (p as any).experience || '';
      const tz = (p as any).timezone || '';
      const avail = (p as any).availability || '';
      const interests = Array.isArray((p as any).interests) ? (p as any).interests : [];
      const goals = (p as any).goals || '';
      const lookingArr = Array.isArray((p as any).lookingFor) ? (p as any).lookingFor : [];
      const startupStage = (p as any).startupStage || '';
      const projectText = projectSearchText(p);
      const looking = !!(p as any).lookingForCofounder || lookingArr.map(normalize).includes('cofounder');
      const isVerified = !!(p as any).isVerified;
      const lastActiveAt = (p as any).lastActiveAt;
      const compatibility = computeCompatibility(p);

      if (q) {
        const nameNeedles = [q, queryWithoutAt].filter(Boolean);
        const textHit =
          includesAny(name, nameNeedles) ||
          (queryWithoutAt ? includesAny(username, [queryWithoutAt]) : false) ||
          includesAny(handle, [q]) ||
          includesAny(bio, [q]) ||
          includesAny(occupation, [q]) ||
          includesAny(`${city} ${country}`, [q]) ||
          userSkills.some((s) => includesAny(s, [q])) ||
          industries.some((s: string) => includesAny(s, [q])) ||
          interests.some((s: string) => includesAny(s, [q])) ||
          includesAny(goals, [q]) ||
          includesAny(projectText, [q]);
        if (!textHit) return false;
      }

      if (!proLocked && location.trim()) {
        const loc = normalize(location);
        if (!includesAny(`${city} ${country}`, [loc])) return false;
      }

      if (!proLocked && skillList.length > 0) {
        const ok = skillList.every((needle) =>
          userSkills.some((s) => includesAny(s, [needle]))
        );
        if (!ok) return false;
      }

      if (!proLocked && experience.trim()) {
        if (!includesAny(exp, [experience])) return false;
      }

      if (!proLocked && industry.trim()) {
        const ok = industries.some((s: string) => includesAny(s, [industry]));
        if (!ok) return false;
      }

      if (!proLocked && lookingForRole.trim()) {
        const needles = lookingForNeedles(lookingForRole);
        const roleHit =
          lookingArr.some((s: string) => includesAny(s, needles)) ||
          includesAny(occupation, needles) ||
          includesAny(goals, needles);
        if (!roleHit) return false;
      }

      if (!proLocked && stageFilter.trim()) {
        if (!includesAny(startupStage, stageNeedles(stageFilter))) return false;
      }

      if (!proLocked && availability.trim()) {
        if (!includesAny(avail, [availability])) return false;
      }

      if (!proLocked && timezone.trim()) {
        if (!includesAny(tz, [timezone])) return false;
      }

      if (!proLocked && lookingForCofounder && !looking) return false;

      if (!proLocked && verifiedOnly && !isVerified) return false;

      if (!proLocked && activeWithin !== 'any') {
        const date = lastActiveAt?.toDate ? lastActiveAt.toDate() : (lastActiveAt ? new Date(lastActiveAt) : null);
        if (!date) return false;
        const now = Date.now();
        const diffMs = now - date.getTime();
        const limitMs = activeWithin === 'today' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
        if (diffMs > limitMs) return false;
      }

      if (!proLocked && compatibility < minCompatibility) return false;

      return true;
    });
  }, [allProfiles, queryText, location, skills, experience, industry, availability, timezone, lookingForRole, stageFilter, lookingForCofounder, verifiedOnly, activeWithin, minCompatibility, computeCompatibility, proLocked]);

  const displayed = useMemo(() => {
    const turboBoost = (p: UserProfile) => ((p as any).turboConnect ? 1 : 0);
    if (proLocked || !aiRankMode) return [...filtered].sort((a, b) => turboBoost(b) - turboBoost(a));
    const withScores = filtered.map((p) => ({ p, s: aiRankMap[p.uid]?.score ?? -1 }));
    withScores.sort((a, b) => (b.s + turboBoost(b.p) * 8) - (a.s + turboBoost(a.p) * 8));
    return withScores.map((x) => x.p);
  }, [filtered, aiRankMode, aiRankMap, proLocked]);
  const resultRenderLimit = Platform.OS === 'web' ? WEB_RESULT_RENDER_LIMIT : NATIVE_RESULT_RENDER_LIMIT;
  const visibleResults = useMemo(() => displayed.slice(0, resultRenderLimit), [displayed, resultRenderLimit]);

  const runAiRanking = async () => {
    if (!user) return;
    if (proLocked) {
      openPaywall(PRO_FEATURES.compatibilityDetails);
      return;
    }
    const candidateIds = filtered.map((p) => p.uid).filter(Boolean).slice(0, 40);
    if (candidateIds.length === 0) return;

    setAiRankLoading(true);
    try {
      let ranked =
        Platform.OS === 'web'
          ? await rankCandidatesHybrid(me, filtered.filter((profile) => candidateIds.includes(profile.uid)), 20)
          : localCommonalityRank(me, filtered.filter((profile) => candidateIds.includes(profile.uid)), 20);
      if (!ranked.length) ranked = localCommonalityRank(me, filtered, 20);
      const nextMap: Record<string, { score: number; reason: string }> = {};
      ranked.forEach((r) => {
        nextMap[r.uid] = { score: r.score, reason: r.reason };
      });
      setAiRankMap(nextMap);
      setAiRankMode(true);
      const diagnostic = getLastAIDiagnostic();
      if (diagnostic && !diagnostic.ok && ranked.every((rank) => rank.cached)) {
        Alert.alert('Ranking Fallback', `${diagnostic.message}\n\nShowing best matches based on local skills/interests.`);
      }
    } catch (e: any) {
      console.error('ranking error:', e);
      const ranked = localCommonalityRank(me, filtered, 20);
      const nextMap: Record<string, { score: number; reason: string }> = {};
      ranked.forEach((r) => {
        nextMap[r.uid] = { score: r.score, reason: r.reason };
      });
      setAiRankMap(nextMap);
      setAiRankMode(true);
      const message = describeAIError(e);
      Alert.alert('Ranking Unavailable', `${message}\n\nShowing best matches based on common skills/interests.`);
    } finally {
      setAiRankLoading(false);
    }
  };

  const currentSearchAlert = (): SavedSearchAlert => ({
    id: `${Date.now()}`,
    label: aiQuery.trim() || queryText.trim() || lookingForRole || industry || 'Builder search',
    queryText,
    location,
    skills,
    experience,
    industry,
    availability,
    timezone,
    lookingForRole,
    stageFilter,
    lookingForCofounder,
    verifiedOnly,
    activeWithin,
    minCompatibility,
    createdAt: Date.now(),
  });

  const applySavedAlert = (alert: SavedSearchAlert) => {
    if (proLocked) {
      openPaywall(PRO_FEATURES.savedSearchAlerts);
      return;
    }
    setQueryText(alert.queryText || '');
    setLocation(alert.location || '');
    setSkills(alert.skills || '');
    setExperience(alert.experience || '');
    setIndustry(alert.industry || '');
    setAvailability(alert.availability || '');
    setTimezone(alert.timezone || '');
    setLookingForRole(alert.lookingForRole || '');
    setStageFilter(alert.stageFilter || '');
    setLookingForCofounder(!!alert.lookingForCofounder);
    setVerifiedOnly(!!alert.verifiedOnly);
    setActiveWithin(alert.activeWithin || 'any');
    setMinCompatibility(Number(alert.minCompatibility || 0));
    knobX.current = (Number(alert.minCompatibility || 0) / 100) * sliderWidth;
    setFilterOpen(true);
  };

  const saveSearchAlert = async () => {
    if (!user?.uid) return;
    if (proLocked) {
      openPaywall(PRO_FEATURES.savedSearchAlerts);
      return;
    }
    const hasSignal = [
      queryText,
      location,
      skills,
      experience,
      industry,
      availability,
      timezone,
      lookingForRole,
      stageFilter,
      aiQuery,
    ].some((value) => String(value || '').trim()) || lookingForCofounder || verifiedOnly || minCompatibility > 0;

    if (!hasSignal) {
      Alert.alert('Add a search first', 'Type what you are building or choose filters before saving an alert.');
      return;
    }

    setSavingAlert(true);
    try {
      const nextAlert = currentSearchAlert();
      const nextAlerts = [nextAlert, ...savedAlerts.filter((alert) => alert.label !== nextAlert.label)].slice(0, 10);
      await setDoc(
        doc(db, 'userPrivate', user.uid),
        {
          savedSearchAlerts: nextAlerts,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setSavedAlerts(nextAlerts);
      Alert.alert('Search alert saved', 'LINKUP will keep this high-signal search ready on mobile and web.');
    } catch (error) {
      console.error('Save search alert error:', error);
      Alert.alert('Could not save alert', 'Deploy the latest Firestore rules, then try again.');
    } finally {
      setSavingAlert(false);
    }
  };

  const clearFilters = () => {
    setLocation('');
    setSkills('');
    setExperience('');
    setIndustry('');
    setAvailability('');
    setTimezone('');
    setLookingForRole('');
    setStageFilter('');
    setLookingForCofounder(false);
    setVerifiedOnly(false);
    setActiveWithin('any');
    setMinCompatibility(0);
  };

  const applyAiQuery = async () => {
    if (!aiQuery.trim()) return;
    if (proLocked) {
      openPaywall(PRO_FEATURES.aiSearch);
      return;
    }
    setAiLoading(true);
    const previousDiagnosticAt = getLastAIDiagnostic()?.timestamp || 0;
    try {
      const r = await geminiToSearchFilters(aiQuery.trim());
      if (typeof r.query === 'string' && r.query.trim()) setQueryText(r.query.trim());
      if (typeof r.location === 'string') setLocation(r.location);
      if (Array.isArray(r.skills)) setSkills(r.skills.join(', '));
      if (typeof r.industry === 'string') setIndustry(r.industry);
      if (typeof r.experience === 'string') setExperience(r.experience);
      if (typeof r.availability === 'string') setAvailability(r.availability);
      if (typeof r.timezone === 'string') setTimezone(r.timezone);
      if (typeof r.lookingForCofounder === 'boolean') setLookingForCofounder(r.lookingForCofounder);
      setFilterOpen(true);
      const diagnostic = getLastAIDiagnostic();
      if (diagnostic && !diagnostic.ok && diagnostic.timestamp > previousDiagnosticAt) {
        Alert.alert('Search Fallback', `${diagnostic.message}\n\nI applied local keyword filters so search still works.`);
      }
    } catch (e: any) {
      console.error('Smart search error:', e);
      const message = describeAIError(e);
      Alert.alert('Search Error', message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.scene} pointerEvents="none">
        <View style={[styles.scenePane, styles.scenePaneA, { backgroundColor: isDark ? 'rgba(0,194,255,0.1)' : 'rgba(0,194,255,0.14)' }]} />
        <View style={[styles.scenePane, styles.scenePaneB, { backgroundColor: isDark ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.1)' }]} />
      </View>
      <ScrollView
        contentContainerStyle={styles.searchContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
      <View style={[styles.searchHero, liquidGlass(isDark)]}>
        <Text style={[styles.heroKicker, { color: COLORS.secondary }]}>BUILDER SEARCH</Text>
        <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>Find the missing person in your plan.</Text>
        <Text style={[styles.heroCopy, { color: textColor(isDark, 'secondary') }]}>
          Search handles, skills, projects, locations, and live intent. Then rank results by builder compatibility.
        </Text>
      </View>

      <View style={styles.header}>
        <View style={[styles.searchBar, liquidGlass(isDark, false)]}>
          <Search size={18} color="#666" />
          <TextInput
            placeholder="SEARCH BUILDERS..."
            placeholderTextColor="#666"
            style={[styles.searchInput, { color: isDark ? '#FFF' : '#000' }]}
            value={queryText}
            onChangeText={setQueryText}
          />
          {!!queryText && (
            <TouchableOpacity onPress={() => setQueryText('')} style={styles.clearBtn}>
              <X size={16} color="#888" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.filterBtn, liquidGlass(isDark, false)]}
          onPress={() => proLocked ? openPaywall(PRO_FEATURES.advancedSearch) : setFilterOpen((v) => !v)}
        >
          <SlidersHorizontal size={18} color={COLORS.secondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.aiRow}>
        <View style={[styles.aiBar, liquidGlass(isDark, false)]}>
          <Star size={18} color={COLORS.primary} />
          <TextInput
            placeholder='Try: "ML engineer in South Africa into fintech"'
            placeholderTextColor="#666"
            value={aiQuery}
            onChangeText={setAiQuery}
            style={[styles.aiInput, { color: isDark ? '#FFF' : '#000' }]}
            returnKeyType="search"
            onSubmitEditing={applyAiQuery}
          />
          <TouchableOpacity
            disabled={aiLoading || !aiQuery.trim()}
            onPress={applyAiQuery}
            style={[styles.aiGo, { opacity: aiLoading || !aiQuery.trim() ? 0.5 : 1 }]}
          >
            <Text style={styles.aiGoText}>{aiLoading ? '...' : 'GO'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchActionsRow}>
        <TouchableOpacity
          disabled={savingAlert}
          onPress={saveSearchAlert}
          style={[styles.saveAlertBtn, liquidGlass(isDark, false), { opacity: savingAlert ? 0.6 : 1 }]}
        >
          <Text style={[styles.saveAlertText, { color: textColor(isDark) }]}>
            {savingAlert ? 'SAVING...' : 'SAVE SEARCH ALERT'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={aiRankLoading || filtered.length === 0}
          onPress={runAiRanking}
          style={[styles.rankBtn, { opacity: aiRankLoading || filtered.length === 0 ? 0.6 : 1 }]}
        >
          <Text style={styles.rankBtnText}>{aiRankLoading ? 'RANKING...' : 'RANK'}</Text>
        </TouchableOpacity>
      </View>

      {savedAlerts.length > 0 && (
        <View style={styles.savedAlertsWrap}>
          <Text style={[styles.savedAlertsTitle, { color: isDark ? '#FFF' : '#000' }]}>SAVED SEARCH ALERTS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedAlertsScroller}>
            {savedAlerts.map((alert) => (
              <TouchableOpacity
                key={alert.id}
                onPress={() => applySavedAlert(alert)}
                style={[styles.savedAlertPill, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}
              >
                <Text style={[styles.savedAlertLabel, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                  {String(alert.label || 'Builder search').toUpperCase()}
                </Text>
                <Text style={styles.savedAlertMeta}>{displayed.length} possible matches</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {filterOpen && (
        <View style={[styles.filtersCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
          <View style={styles.filtersScrollContent}>
          <Text style={[styles.filtersTitle, { color: isDark ? '#FFF' : '#000' }]}>FILTERS</Text>

          <View style={styles.filterRow}>
            <TextInput
              placeholder="Location (city/country)"
              placeholderTextColor="#666"
              value={location}
              onChangeText={setLocation}
              style={[styles.filterInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
            />
            <TextInput
              placeholder="Timezone"
              placeholderTextColor="#666"
              value={timezone}
              onChangeText={setTimezone}
              style={[styles.filterInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
            />
          </View>

          <View style={styles.filterRow}>
            <TextInput
              placeholder="Skills (comma-separated)"
              placeholderTextColor="#666"
              value={skills}
              onChangeText={setSkills}
              style={[styles.filterInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
            />
            <TextInput
              placeholder="Industry"
              placeholderTextColor="#666"
              value={industry}
              onChangeText={setIndustry}
              style={[styles.filterInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
            />
          </View>

          <View style={styles.filterRow}>
            <TextInput
              placeholder="Experience (e.g. intermediate)"
              placeholderTextColor="#666"
              value={experience}
              onChangeText={setExperience}
              style={[styles.filterInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
            />
            <TextInput
              placeholder="Availability (e.g. evenings)"
              placeholderTextColor="#666"
              value={availability}
              onChangeText={setAvailability}
              style={[styles.filterInput, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', color: isDark ? '#FFF' : '#000' }]}
            />
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.filtersTitle, { color: isDark ? '#FFF' : '#000' }]}>LOOKING FOR...</Text>
            <View style={styles.wrapPills}>
              {LOOKING_FOR_FILTERS.map((option) => {
                const active = lookingForRole === option;
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setLookingForRole(active ? '' : option)}
                    style={[
                      styles.choicePill,
                      {
                        backgroundColor: active ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                        borderColor: active ? '#FBE618' : (isDark ? '#222226' : '#EEEEEE'),
                      },
                    ]}
                  >
                    <Text style={[styles.choicePillText, { color: active ? '#000' : (isDark ? '#FFF' : '#000') }]}>{option.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.filtersTitle, { color: isDark ? '#FFF' : '#000' }]}>STARTUP STAGE</Text>
            <View style={styles.wrapPills}>
              {STAGE_FILTERS.map((option) => {
                const active = stageFilter === option;
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setStageFilter(active ? '' : option)}
                    style={[
                      styles.choicePill,
                      {
                        backgroundColor: active ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                        borderColor: active ? '#FBE618' : (isDark ? '#222226' : '#EEEEEE'),
                      },
                    ]}
                  >
                    <Text style={[styles.choicePillText, { color: active ? '#000' : (isDark ? '#FFF' : '#000') }]}>{option.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.filtersTitle, { color: isDark ? '#FFF' : '#000' }]}>INDUSTRY QUICK PICKS</Text>
            <View style={styles.wrapPills}>
              {INDUSTRY_FILTERS.map((option) => {
                const active = normalize(industry) === normalize(option);
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => setIndustry(active ? '' : option)}
                    style={[
                      styles.choicePill,
                      {
                        backgroundColor: active ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                        borderColor: active ? '#FBE618' : (isDark ? '#222226' : '#EEEEEE'),
                      },
                    ]}
                  >
                    <Text style={[styles.choicePillText, { color: active ? '#000' : (isDark ? '#FFF' : '#000') }]}>{option.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.togglePill, { backgroundColor: lookingForCofounder ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'), borderColor: isDark ? '#222226' : '#EEEEEE' }]}
            onPress={() => setLookingForCofounder((v) => !v)}
          >
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: lookingForCofounder ? '#000' : (isDark ? '#FFF' : '#000') }}>
              LOOKING FOR COFOUNDER
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.togglePill, { backgroundColor: verifiedOnly ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'), borderColor: isDark ? '#222226' : '#EEEEEE' }]}
            onPress={() => setVerifiedOnly((v) => !v)}
          >
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: verifiedOnly ? '#000' : (isDark ? '#FFF' : '#000') }}>
              VERIFIED ONLY
            </Text>
          </TouchableOpacity>

          <View style={{ marginTop: 4 }}>
            <Text style={[styles.filtersTitle, { color: isDark ? '#FFF' : '#000' }]}>COMPATIBILITY {minCompatibility}%+</Text>
            <View style={styles.sliderRow}>
              <View style={[styles.sliderTrack, { backgroundColor: isDark ? '#16161A' : '#F8F8F8' }]}>
                <View style={[styles.sliderFill, { width: `${minCompatibility}%` }]} />
                <View
                  style={[styles.sliderKnob, { left: (minCompatibility / 100) * sliderWidth }]}
                  {...sliderPanHandlers}
                />
              </View>
            </View>
            {Platform.OS === 'web' && (
              <View style={styles.pillsRow}>
                {[0, 25, 50, 75].map((value) => (
                  <TouchableOpacity
                    key={value}
                    onPress={() => {
                      setMinCompatibility(value);
                      knobX.current = (value / 100) * sliderWidth;
                    }}
                    style={[
                      styles.smallPill,
                      {
                        backgroundColor: minCompatibility === value ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                        borderColor: isDark ? '#222226' : '#EEEEEE',
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1, color: minCompatibility === value ? '#000' : (isDark ? '#FFF' : '#000') }}>
                      {value}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          <View style={{ marginTop: 4 }}>
            <Text style={[styles.filtersTitle, { color: isDark ? '#FFF' : '#000' }]}>RECENTLY ACTIVE</Text>
            <View style={styles.pillsRow}>
              {(['any', 'today', 'week'] as const).map((k) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => setActiveWithin(k)}
                  style={[
                    styles.smallPill,
                    {
                      backgroundColor: activeWithin === k ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                      borderColor: isDark ? '#222226' : '#EEEEEE',
                    },
                  ]}
                >
                  <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1, color: activeWithin === k ? '#000' : (isDark ? '#FFF' : '#000') }}>
                    {k === 'any' ? 'ANY' : k === 'today' ? 'TODAY' : 'THIS WEEK'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ marginTop: 6 }}>
            <TouchableOpacity
              disabled={aiRankLoading || filtered.length === 0}
              onPress={runAiRanking}
              style={[
                styles.togglePill,
                {
                  backgroundColor: aiRankMode ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                  borderColor: isDark ? '#222226' : '#EEEEEE',
                  opacity: aiRankLoading || filtered.length === 0 ? 0.6 : 1,
                },
              ]}
            >
              <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: aiRankMode ? '#000' : (isDark ? '#FFF' : '#000') }}>
                {aiRankLoading ? 'RANKING...' : aiRankMode ? 'RANKING: ON' : 'RANK RESULTS'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.filterActions}>
            <TouchableOpacity onPress={clearFilters} style={[styles.smallBtn, { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={[styles.smallBtnText, { color: isDark ? '#FFF' : '#000' }]}>CLEAR</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFilterOpen(false)} style={[styles.smallBtn, { backgroundColor: '#FBE618' }]}>
              <Text style={[styles.smallBtnText, { color: '#FFF' }]}>DONE</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      )}

      {loading && allProfiles.length === 0 ? (
        <ActivityIndicator color="#FBE618" style={{ marginTop: 30 }} />
      ) : (
        <View style={styles.resultsList}>
          {visibleResults.map((item) => (
            <TouchableOpacity
              key={item.uid}
              style={[styles.resultCard, liquidGlass(isDark, false)]}
              onPress={() => {
                const score = aiRankMap[item.uid]?.score ?? computeCompatibility(item);
                navigation.navigate('Profile', {
                  userId: item.uid,
                  compatibilityScore: score,
                  compatibilityReason: buildMatchReason(me, item, aiRankMap, queryText),
                });
              }}
            >
              <Image
                source={{ uri: safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT) || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }}
                style={styles.resultAvatar}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Text style={[styles.resultName, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>
                      {item.displayName || 'Builder'}
                    </Text>
                    {!!(item as any).isVerified && <VerifiedBadge size={20} />}
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      const score = aiRankMap[item.uid]?.score ?? computeCompatibility(item);
                      Alert.alert('Why this match?', `${score}% compatibility\n\n${buildMatchReason(me, item, aiRankMap, queryText)}`);
                    }}
                    activeOpacity={0.8}
                    style={styles.compatPill}
                  >
                    <Text style={styles.compatText}>{`${aiRankMap[item.uid]?.score ?? computeCompatibility(item)}%`}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.resultHandle} numberOfLines={1}>{profileHandle(item)}</Text>
                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>{roleInfoFor((item as any).occupation).badge}</Text>
                </View>
                <View style={styles.metaRow}>
                  <MapPin size={12} color="#666" />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {[item.city, item.country].filter(Boolean).join(', ') || 'Remote'}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Briefcase size={12} color="#666" />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {(item as any).occupation || 'Builder'}
                  </Text>
                </View>
                <View style={styles.metaRow}>
                  <Clock size={12} color="#666" />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {(item as any).availability || 'Open'}
                  </Text>
                </View>
                <Text style={styles.whyLine} numberOfLines={2}>
                  {buildMatchReason(me, item, aiRankMap, queryText)}
                </Text>
                <Text style={styles.resultSkills} numberOfLines={1}>
                  {(item.skills || []).slice(0, 4).map((s) => String(s).toUpperCase()).join(' - ')}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          {displayed.length > visibleResults.length && (
            <View style={[styles.resultsLimitCard, { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' }]}>
              <Text style={styles.resultsLimitText}>
                Showing top {visibleResults.length} of {displayed.length}. Search or filter to narrow it down.
              </Text>
            </View>
          )}
          {displayed.length === 0 && (
            <View style={{ alignItems: 'center', marginTop: 60, gap: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', letterSpacing: 2, color: '#666' }}>NO RESULTS</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#666' }}>Try fewer filters.</Text>
            </View>
          )}
        </View>
      )}
      <PaywallModal
        visible={!!paywallFeature}
        feature={paywallFeature || PRO_FEATURES.advancedSearch}
        description="Basic Android search stays free. AI search, advanced filters, saved alerts, ranking, and detailed match reasons are LINKUP PLUS features."
        onClose={() => setPaywallFeature('')}
      />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scene: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  scenePane: {
    position: 'absolute',
    width: 280,
    height: 140,
    borderRadius: 36,
  },
  scenePaneA: {
    top: 76,
    right: -130,
    transform: [{ rotate: '-16deg' }],
  },
  scenePaneB: {
    top: 300,
    left: -120,
    transform: [{ rotate: '18deg' }],
  },
  searchContent: {
    paddingBottom: 180,
  },
  searchHero: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 20,
    borderRadius: 28,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  heroTitle: {
    marginTop: 10,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 34,
  },
  heroCopy: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  searchActionsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  saveAlertBtn: {
    flex: 1,
    height: 44,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveAlertText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  rankBtn: {
    width: 104,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#000',
  },
  savedAlertsWrap: {
    paddingTop: 14,
  },
  savedAlertsTitle: {
    paddingHorizontal: 16,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  savedAlertsScroller: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
  },
  savedAlertPill: {
    width: 190,
    padding: 12,
    borderRadius: 20,
  },
  savedAlertLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  savedAlertMeta: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '800',
    color: '#666',
  },
  resultsList: {
    padding: 16,
    paddingBottom: 20,
  },
  resultsLimitCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
  },
  resultsLimitText: {
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 15,
    color: '#666',
    fontWeight: '800',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  aiRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  aiBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  aiInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  aiGo: {
    width: 44,
    height: 34,
    borderRadius: 14,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiGoText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#000',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },
  clearBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtn: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersCard: {
    margin: 16,
    padding: 16,
    borderRadius: 24,
    gap: 10,
  },
  filtersScrollContent: {
    gap: 10,
    paddingBottom: 120,
  },
  filtersTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
  },
  filterInput: {
    flex: 1,
    height: 46,
    borderRadius: 16,
    paddingHorizontal: 14,
    fontSize: 12,
    fontWeight: '700',
  },
  filterSection: {
    gap: 8,
    marginTop: 4,
  },
  wrapPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choicePill: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choicePillText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  togglePill: {
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  filterActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 6,
  },
  smallBtn: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 12,
  },
  resultAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontStyle: 'italic',
    flexShrink: 1,
  },
  verifiedMiniBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  resultMeta: {
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
    marginTop: 2,
  },
  resultHandle: {
    fontSize: 10,
    color: '#FBE618',
    fontWeight: '900',
    marginTop: 2,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    marginTop: 5,
    borderRadius: 999,
    backgroundColor: '#FBE618',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  roleBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#000',
    letterSpacing: 0.8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  metaText: {
    flex: 1,
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
  },
  resultSkills: {
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
    marginTop: 4,
  },
  whyLine: {
    marginTop: 6,
    fontSize: 10,
    lineHeight: 15,
    color: '#666',
    fontWeight: '800',
  },
  compatPill: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compatText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    color: '#000',
  },
  sliderRow: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  sliderTrack: {
    width: 240,
    height: 12,
    borderRadius: 999,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#FBE618',
  },
  sliderKnob: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#FBE618',
    top: -7,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  smallPill: {
    flex: 1,
    height: 40,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
