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
  Linking,
  PanResponder,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { doc, getDoc, getDocsFromCache, onSnapshot, serverTimestamp, setDoc, collection, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { AppImage } from '../components/AppImage';
import { ikAvatar } from '../lib/ikImage';
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
import { hasLinkupPro, PRO_FEATURES } from '../lib/paywall';
import {
  Campaign,
  fetchActiveCampaignsForPlacement,
  recordCampaignClick,
  recordCampaignImpression,
  websiteDisplay,
} from '../lib/campaigns';
import { IS_LOW_END_ANDROID, MOBILE_LIST_IMAGE_LIMIT, MOBILE_SEARCH_RENDER_LIMIT, safeProfileImageUri, compactProfileForList } from '../lib/profilePerformance';
import { loadFromPublicProfiles, loadFromUsers, searchPublicProfiles } from '../lib/discoveryProfiles';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

// Search pulls a bigger page of lean publicProfiles docs than the swipe deck:
// they're ~1KB each with hosted-URL images, so 60 of them is a tiny download
// that makes search results far richer.
const SEARCH_POOL_LIMIT = 60;
// Tuned to reality: on ~1Mbps links a single Firestore read can legitimately
// take 20+ seconds. Short timeouts = guaranteed "no results". Patience wins.
const SEARCH_LOAD_TIMEOUT_MS = 28000;
// If the lean index is still sparse (backfill pending, young userbase), search
// tops the pool up from the capped legacy users query so it ALWAYS has people
// to match against. Once the index is full this never fires.
const SEARCH_MIN_POOL = 8;

// Module-level pool cache: revisiting Search renders the last pool INSTANTLY
// and refreshes silently in the background instead of showing a spinner every
// single time the tab gets focus.
let searchPoolCache: { userId: string; rows: UserProfile[] } | null = null;

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

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
  industry: string;
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
  const raw = (profile as any)?.username || profile?.displayName || 'builder';
  return `@${cleanUsername(String(raw)) || 'builder'}`;
};

const projectSearchText = (profile: Partial<UserProfile>) => {
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
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
  const [serverHits, setServerHits] = useState<UserProfile[]>([]);
  const [serverSearching, setServerSearching] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [aiQuery, setAiQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRankLoading, setAiRankLoading] = useState(false);
  const [aiRankMode, setAiRankMode] = useState(false);
  const [aiRankMap, setAiRankMap] = useState<Record<string, { score: number; reason: string }>>({});
  const [savedAlerts, setSavedAlerts] = useState<SavedSearchAlert[]>([]);
  const [savingAlert, setSavingAlert] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState('');
  // Advanced search is LINKUP PLUS: industry/stage/verified/compatibility
  // filters, saved search alerts, and AI search/ranking. Free keeps plain
  // text, location, skills and looking-for.
  const isPro = hasLinkupPro(me);
  // Sponsored search slot: single campaign pinned above results for free
  // members; PLUS members never see campaigns.
  const [searchSponsor, setSearchSponsor] = useState<Campaign | null>(null);
  useEffect(() => {
    if (isPro || !user?.uid) {
      setSearchSponsor(null);
      return;
    }
    let cancelled = false;
    fetchActiveCampaignsForPlacement('search', 1).then((campaigns) => {
      if (cancelled) return;
      const pick = campaigns.find((campaign) => campaign.ownerId !== user.uid) || null;
      setSearchSponsor(pick);
      if (pick) void recordCampaignImpression(pick.id, user.uid);
    });
    return () => {
      cancelled = true;
    };
  }, [isPro, user?.uid]);
  const guardAdvancedSearch = () => {
    if (isPro) return true;
    openPaywall('Advanced Search Filters');
    return false;
  };

  // Filters (simple + client-side for now)
  const [filterOpen, setFilterOpen] = useState(false);
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState(''); // comma-separated
  const [industry, setIndustry] = useState('');
  const [lookingForRole, setLookingForRole] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [lookingForCofounder, setLookingForCofounder] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [hasPhotoOnly, setHasPhotoOnly] = useState(false);
  const [activeWithin, setActiveWithin] = useState<'any' | 'today' | 'week'>('any');
  const [minCompatibility, setMinCompatibility] = useState(0); // 0..100
  const routedSkill = String(route?.params?.skill || route?.params?.initialSkill || '').trim();
  const routedQuery = String(route?.params?.query || '').trim();
  const routedSearchToken = String(route?.params?.searchToken || '');
  const openPaywall = (feature: string) => setPaywallFeature(feature);

  // Idle mode: NO profiles are loaded until the user actually asks for them.
  // Zero reads while browsing filters/thinking — the pool (and Firestore
  // bandwidth + battery) is only spent the moment there's real search intent.
  const hasSearchIntent = useMemo(
    () =>
      !!(
        queryText.trim() ||
        location.trim() ||
        skills.trim() ||
        industry.trim() ||
        lookingForRole.trim() ||
        stageFilter ||
        lookingForCofounder ||
        verifiedOnly ||
        hasPhotoOnly ||
        activeWithin !== 'any' ||
        minCompatibility > 0
      ),
    [
      queryText,
      location,
      skills,
      industry,
      lookingForRole,
      stageFilter,
      lookingForCofounder,
      verifiedOnly,
      hasPhotoOnly,
      activeWithin,
      minCompatibility,
    ]
  );

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
    if (!hasSearchIntent) {
      // Idle: don't touch Firestore at all — nothing loads until they search.
      setLoading(false);
      return;
    }
    let cancelled = false;

    // Instant paint from cache; the network refresh below swaps in fresh rows
    // silently. Only a cold cache shows the spinner at all.
    const cachedRows = searchPoolCache && searchPoolCache.userId === user.uid ? searchPoolCache.rows : [];
    if (cachedRows.length) {
      setAllProfiles(cachedRows);
      setLoading(false);
    } else {
      setLoading(true);
    }

    // Lane 0: Firestore DISK cache — after the first successful load, every
    // cold start of Search paints instantly at 0 bars; the network refresh
    // below swaps in fresh rows silently.
    if (!cachedRows.length) {
      void getDocsFromCache(query(collection(db, 'publicProfiles'), limit(SEARCH_POOL_LIMIT)))
        .then((snap) => {
          if (cancelled || snap.empty) return;
          const rows = snap.docs
            .map((d) => compactProfileForList({ uid: d.id, ...(d.data() as any) }))
            .filter((p: any) => p?.uid && p.uid !== user.uid);
          if (rows.length) {
            setAllProfiles(rows);
            setLoading(false);
          }
        })
        .catch(() => {});
    }

    const load = async () => {
      try {
        const list = await withTimeout(
          loadFromPublicProfiles(user.uid, SEARCH_POOL_LIMIT),
          SEARCH_LOAD_TIMEOUT_MS
        );
        if (cancelled) return;
        let rows = list && list.length ? list : null;
        if (!rows || rows.length < SEARCH_MIN_POOL) {
          // Index still sparse — bridge with the capped legacy query so the
          // user always gets results. Merge, dedupe by uid.
          const fallbackRows = await withTimeout(loadFromUsers(user.uid), 6000);
          if (cancelled) return;
          if (fallbackRows?.length) {
            rows = rows
              ? [...rows, ...fallbackRows.filter((f: any) => !rows!.some((r: any) => r.uid === f.uid))]
              : fallbackRows;
          }
        }
        if (rows && rows.length > 0) {
          setAllProfiles(rows);
          searchPoolCache = { userId: user.uid, rows };
        }
      } catch (error) {
        console.error('SearchScreen load error:', error);
      }
      if (!cancelled) setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [isFocused, user?.uid, hasSearchIntent]);

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
    // Any new search/filter input invalidates the previous AI ranking —
    // otherwise fresh results get sorted by scores computed for an OLD query.
    setAiRankMode(false);
    setAiRankMap({});
  }, [queryText, location, skills, industry, lookingForRole, stageFilter, lookingForCofounder, verifiedOnly, activeWithin]);

  useEffect(() => {
    // Server-side person search: when there's real text in the box, ask
    // Firestore directly (debounced). ANY user in the database is findable by
    // name or @handle — not just whoever happens to be in the local pool.
    const needle = queryText.trim();
    if (!needle) {
      setServerHits([]);
      setServerSearching(false);
      return;
    }
    let cancelled = false;
    setServerSearching(true);
    const timer = setTimeout(async () => {
      if (!user?.uid) {
        setServerSearching(false);
        return;
      }
      const hits = await withTimeout(searchPublicProfiles(needle), SEARCH_LOAD_TIMEOUT_MS).catch(() => null);
      if (cancelled) return;
      setServerHits(hits || []);
      setServerSearching(false);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryText, user?.uid]);

  // Server hits land first, then the local pool — deduped, pool widgets like
  // filters/ranking still apply to everyone.
  const combined = useMemo(() => {
    const merged = [...serverHits];
    const seen = new Set(serverHits.map((p) => p.uid));
    allProfiles.forEach((p) => {
      if (p?.uid && !seen.has(p.uid)) merged.push(p);
    });
    return merged;
  }, [serverHits, allProfiles]);

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

    return combined.filter((p) => {
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
      const interests = Array.isArray((p as any).interests) ? (p as any).interests : [];
      const goals = (p as any).goals || '';
      const lookingArr = Array.isArray((p as any).lookingFor) ? (p as any).lookingFor : [];
      const startupStage = (p as any)?.startupStage || '';
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

      if (location.trim()) {
        const loc = normalize(location);
        if (!includesAny(`${city} ${country}`, [loc])) return false;
      }

      if (skillList.length > 0) {
        // OR-match: a builder with ANY of the searched skills is a candidate.
        // The old AND-match ("every") needed all of them, so searching
        // "React, Python" excluded someone who only knows React — brutal on a
        // growing userbase. Ranking (compat score) handles ordering.
        const ok = skillList.some((needle) =>
          userSkills.some((s) => includesAny(s, [needle]))
        );
        if (!ok) return false;
      }

      if (isPro && industry.trim()) {
        const ok = industries.some((s: string) => includesAny(s, [industry]));
        if (!ok) return false;
      }

      if (lookingForRole.trim()) {
        const needles = lookingForNeedles(lookingForRole);
        const roleHit =
          lookingArr.some((s: string) => includesAny(s, needles)) ||
          includesAny(occupation, needles) ||
          includesAny(goals, needles);
        if (!roleHit) return false;
      }

      if (isPro && stageFilter.trim()) {
        if (!includesAny(startupStage, stageNeedles(stageFilter))) return false;
      }

      if (lookingForCofounder && !looking) return false;

      if (isPro && verifiedOnly && !isVerified) return false;

      if (hasPhotoOnly) {
        const pic = String((p as any).profilePic || '').trim();
        if (!pic) return false;
      }

      if (activeWithin !== 'any') {
        const date = lastActiveAt?.toDate ? lastActiveAt.toDate() : (lastActiveAt ? new Date(lastActiveAt) : null);
        if (!date) return false;
        const now = Date.now();
        const diffMs = now - date.getTime();
        const limitMs = activeWithin === 'today' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
        if (diffMs > limitMs) return false;
      }

      if (isPro && compatibility < minCompatibility) return false;

      return true;
    });
  }, [combined, queryText, location, skills, industry, lookingForRole, stageFilter, lookingForCofounder, verifiedOnly, hasPhotoOnly, activeWithin, minCompatibility, computeCompatibility, isPro]);

  const displayed = useMemo(() => {
    const turboBoost = (p: UserProfile) => ((p as any).turboConnect ? 1 : 0);
    if (!aiRankMode) return [...filtered].sort((a, b) => turboBoost(b) - turboBoost(a));
    const withScores = filtered.map((p) => ({ p, s: aiRankMap[p.uid]?.score ?? -1 }));
    withScores.sort((a, b) => (b.s + turboBoost(b.p) * 8) - (a.s + turboBoost(a.p) * 8));
    return withScores.map((x) => x.p);
  }, [filtered, aiRankMode, aiRankMap]);
  const resultRenderLimit = Platform.OS === 'web' ? WEB_RESULT_RENDER_LIMIT : NATIVE_RESULT_RENDER_LIMIT;
  const visibleResults = useMemo(() => displayed.slice(0, resultRenderLimit), [displayed, resultRenderLimit]);

  const runAiRanking = async () => {
    if (!user) return;
    if (!isPro) {
      openPaywall('AI Search & Ranking');
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
    industry,
    lookingForRole,
    stageFilter,
    lookingForCofounder,
    verifiedOnly,
    activeWithin,
    minCompatibility,
    createdAt: Date.now(),
  });

  const applySavedAlert = (alert: SavedSearchAlert) => {
    setQueryText(alert.queryText || '');
    setLocation(alert.location || '');
    setSkills(alert.skills || '');
    setIndustry(alert.industry || '');
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
    if (!isPro) {
      openPaywall('Saved Search Alerts');
      return;
    }
    const hasSignal = [
      queryText,
      location,
      skills,
      industry,
      lookingForRole,
      stageFilter,
      aiQuery,
    ].some((value) => String(value || '').trim()) || lookingForCofounder || verifiedOnly || hasPhotoOnly || minCompatibility > 0;

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
    setIndustry('');
    setLookingForRole('');
    setStageFilter('');
    setLookingForCofounder(false);
    setVerifiedOnly(false);
    setHasPhotoOnly(false);
    setActiveWithin('any');
    setMinCompatibility(0);
    knobX.current = 0; // reset the gesture origin too, or the next drag JUMPS
  };

  const applyAiQuery = async () => {
    if (!aiQuery.trim()) return;
    if (!isPro) {
      openPaywall('AI Search & Ranking');
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
      <ScrollView
        contentContainerStyle={styles.searchContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
      <View style={[styles.searchHero, liquidGlass(isDark)]}>
        <Text style={[styles.heroKicker, { color: COLORS.secondary }]}>Search</Text>
        <Text style={[styles.heroTitle, { color: textColor(isDark) }]}>Find the missing person in your plan.</Text>
        <Text style={[styles.heroCopy, { color: textColor(isDark, 'secondary') }]}>
          Search handles, skills, projects, locations, and live intent. Then rank results by builder compatibility.
        </Text>
      </View>

      <View style={styles.header}>
        <View style={[styles.searchBar, liquidGlass(isDark, false)]}>
          <Search size={18} color="#666" />
          <TextInput
            placeholder="Search builders"
            placeholderTextColor="#666"
            style={[styles.searchInput, { color: textColor(isDark) }]}
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
          onPress={() => setFilterOpen((v) => !v)}
        >
          <SlidersHorizontal size={18} color={COLORS.secondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.aiRow}>
        <View style={[styles.aiBar, liquidGlass(isDark, false)]}>
          <Star size={18} color={COLORS.primaryStrong} />
          <TextInput
            placeholder='Try: "ML engineer in South Africa into fintech"'
            placeholderTextColor="#666"
            value={aiQuery}
            onChangeText={setAiQuery}
            style={[styles.aiInput, { color: textColor(isDark) }]}
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
            {savingAlert ? 'Saving…' : 'Save search alert'}
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

      {isPro && savedAlerts.length > 0 && (
        <View style={styles.savedAlertsWrap}>
          <Text style={[styles.savedAlertsTitle, { color: textColor(isDark) }]}>Saved search alerts</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedAlertsScroller}>
            {savedAlerts.map((alert) => (
              <TouchableOpacity
                key={alert.id}
                onPress={() => applySavedAlert(alert)}
                style={[styles.savedAlertPill, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              >
                <Text style={[styles.savedAlertLabel, { color: textColor(isDark) }]} numberOfLines={1}>
                  {String(alert.label || 'Builder search').toUpperCase()}
                </Text>
                <Text style={styles.savedAlertMeta}>{displayed.length} possible matches</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {filterOpen && (
        <View style={[styles.filtersCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
          <View style={styles.filtersScrollContent}>
          <Text style={[styles.filtersTitle, { color: textColor(isDark) }]}>FILTERS</Text>

          <View style={styles.filterRow}>
            <TextInput
              placeholder="Location (city/country)"
              placeholderTextColor="#666"
              value={location}
              onChangeText={setLocation}
              style={[styles.filterInput, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, color: textColor(isDark) }]}
            />
            <TextInput
              placeholder={isPro ? 'Industry' : 'Industry — LINKUP PLUS'}
              placeholderTextColor="#666"
              value={industry}
              onChangeText={(value) => { if (guardAdvancedSearch()) setIndustry(value); }}
              style={[styles.filterInput, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, color: textColor(isDark) }]}
            />
          </View>

          <View style={styles.filterRow}>
            <TextInput
              placeholder="Skills (comma-separated)"
              placeholderTextColor="#666"
              value={skills}
              onChangeText={setSkills}
              style={[styles.filterInput, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, color: textColor(isDark) }]}
            />
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.filtersTitle, { color: textColor(isDark) }]}>LOOKING FOR...</Text>
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
                        backgroundColor: active ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec),
                        borderColor: active ? COLORS.primary : (isDark ? COLORS.darkBorder : COLORS.lightBorder),
                      },
                    ]}
                  >
                    <Text style={[styles.choicePillText, { color: active ? '#000' : (textColor(isDark)) }]}>{option.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.filtersTitle, { color: textColor(isDark) }]}>STARTUP STAGE</Text>
            <View style={styles.wrapPills}>
              {STAGE_FILTERS.map((option) => {
                const active = stageFilter === option;
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => { if (guardAdvancedSearch()) setStageFilter(active ? '' : option); }}
                    style={[
                      styles.choicePill,
                      {
                        backgroundColor: active ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec),
                        borderColor: active ? COLORS.primary : (isDark ? COLORS.darkBorder : COLORS.lightBorder),
                      },
                    ]}
                  >
                    <Text style={[styles.choicePillText, { color: active ? '#000' : (textColor(isDark)) }]}>{option.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.filterSection}>
            <Text style={[styles.filtersTitle, { color: textColor(isDark) }]}>INDUSTRY QUICK PICKS</Text>
            <View style={styles.wrapPills}>
              {INDUSTRY_FILTERS.map((option) => {
                const active = normalize(industry) === normalize(option);
                return (
                  <TouchableOpacity
                    key={option}
                    onPress={() => { if (guardAdvancedSearch()) setIndustry(active ? '' : option); }}
                    style={[
                      styles.choicePill,
                      {
                        backgroundColor: active ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec),
                        borderColor: active ? COLORS.primary : (isDark ? COLORS.darkBorder : COLORS.lightBorder),
                      },
                    ]}
                  >
                    <Text style={[styles.choicePillText, { color: active ? '#000' : (textColor(isDark)) }]}>{option.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.togglePill, { backgroundColor: lookingForCofounder ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
            onPress={() => setLookingForCofounder((v) => !v)}
          >
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: lookingForCofounder ? '#000' : (textColor(isDark)) }}>
              LOOKING FOR COFOUNDER
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.togglePill, { backgroundColor: verifiedOnly ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
            onPress={() => { if (guardAdvancedSearch()) setVerifiedOnly((v) => !v); }}
          >
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: verifiedOnly ? '#000' : (textColor(isDark)) }}>
              VERIFIED ONLY{isPro ? '' : ' · PLUS'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.togglePill, { backgroundColor: hasPhotoOnly ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
            onPress={() => setHasPhotoOnly((v) => !v)}
          >
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: hasPhotoOnly ? '#000' : (textColor(isDark)) }}>
              HAS PHOTO
            </Text>
          </TouchableOpacity>

          {!isPro ? (
            <TouchableOpacity
              style={[styles.togglePill, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder, marginTop: 4 }]}
              onPress={() => openPaywall('Advanced Search Filters')}
            >
              <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: textColor(isDark) }}>
                COMPATIBILITY FILTER · PLUS
              </Text>
            </TouchableOpacity>
          ) : (
          <View style={{ marginTop: 4 }}>
            <Text style={[styles.filtersTitle, { color: textColor(isDark) }]}>COMPATIBILITY {minCompatibility}%+</Text>
            <View style={styles.sliderRow}>
              <View style={[styles.sliderTrack, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
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
                        backgroundColor: minCompatibility === value ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec),
                        borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
                      },
                    ]}
                  >
                    <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1, color: minCompatibility === value ? '#000' : (textColor(isDark)) }}>
                      {value}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          )}

          <View style={{ marginTop: 4 }}>
            <Text style={[styles.filtersTitle, { color: textColor(isDark) }]}>RECENTLY ACTIVE</Text>
            <View style={styles.pillsRow}>
              {(['any', 'today', 'week'] as const).map((k) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => setActiveWithin(k)}
                    style={[
                      styles.smallPill,
                      {
                        backgroundColor: activeWithin === k ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec),
                        borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
                      },
                    ]}
                >
                  <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1, color: activeWithin === k ? '#000' : (textColor(isDark)) }}>
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
                  backgroundColor: aiRankMode ? COLORS.primary : (isDark ? COLORS.darkBgSec : COLORS.lightBgSec),
                  borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
                  opacity: aiRankLoading || filtered.length === 0 ? 0.6 : 1,
                },
              ]}
            >
              <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1, color: aiRankMode ? '#000' : (textColor(isDark)) }}>
                {aiRankLoading ? 'RANKING...' : aiRankMode ? 'RANKING: ON' : 'RANK RESULTS'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.filterActions}>
            <TouchableOpacity onPress={clearFilters} style={[styles.smallBtn, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <Text style={[styles.smallBtnText, { color: textColor(isDark) }]}>CLEAR</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFilterOpen(false)} style={[styles.smallBtn, { backgroundColor: COLORS.primary }]}>
              <Text style={[styles.smallBtnText, { color: '#000' }]}>DONE</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      )}

      {!hasSearchIntent ? (
        <View style={styles.idleWrap}>
          <View style={[styles.idleIconTile, { backgroundColor: COLORS.primary }]}>
            <Search size={26} color="#000" />
          </View>
          <Text style={[styles.idleTitle, { color: textColor(isDark) }]}>Search anyone on LINKUP</Text>
          <Text style={[styles.idleCopy, { color: textColor(isDark, 'secondary') }]}>
            Nothing loads until you ask — type a name, skill, city, or role and the builders you're looking for appear instantly. Zero waiting, zero wasted data.
          </Text>
          <View style={styles.idleChipsRow}>
            {['CTO', 'Designer', 'Fintech', 'Harare', 'Investor'].map((suggestion) => (
              <TouchableOpacity
                key={suggestion}
                onPress={() => setQueryText(suggestion)}
                style={[styles.idleChip, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec, borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              >
                <Text style={[styles.idleChipText, { color: textColor(isDark) }]}>{suggestion.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.idleHint}>try the AI bar above: "ML engineer in South Africa into fintech"</Text>
        </View>
      ) : (loading || serverSearching) && combined.length === 0 ? (
        <ActivityIndicator color={COLORS.primaryStrong} style={{ marginTop: 30 }} />
      ) : (
        <View style={styles.resultsList}>
          {searchSponsor && (
            <TouchableOpacity
              activeOpacity={0.88}
              style={[styles.sponsorRow, liquidGlass(isDark, false), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              onPress={() => {
                void recordCampaignClick(searchSponsor.id, user?.uid || '');
                const url = searchSponsor.creative?.website || '';
                if (url) Linking.openURL(url).catch(() => {});
              }}
            >
              <View style={styles.sponsorPill}>
                <Text style={styles.sponsorPillText}>SPONSORED</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sponsorTitle, { color: textColor(isDark) }]} numberOfLines={1}>
                  {searchSponsor.creative?.productName || searchSponsor.creative?.title || 'Sponsored'}
                </Text>
                <Text style={[styles.sponsorSub, { color: textColor(isDark, 'secondary') }]} numberOfLines={1}>
                  {searchSponsor.creative?.tagline || searchSponsor.creative?.description || ''}
                </Text>
                {!!searchSponsor.creative?.website && (
                  <Text style={styles.sponsorUrl} numberOfLines={1}>{websiteDisplay(searchSponsor.creative.website)}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          {visibleResults.map((item) => (
            <TouchableOpacity
              key={item.uid}
              style={[styles.resultCard, liquidGlass(isDark, false)]}
              onPress={() => {
                const score = aiRankMap[item.uid]?.score ?? computeCompatibility(item);
                navigation.navigate('Profile', {
                  userId: item.uid,
                  profileData: item,
                  compatibilityScore: score,
                  compatibilityReason: buildMatchReason(me, item, aiRankMap, queryText),
                });
              }}
            >
              <AppImage
                uri={ikAvatar(safeProfileImageUri(item.profilePic, MOBILE_LIST_IMAGE_LIMIT)) || 'https://ui-avatars.com/api/?name=+&background=E5E7EB&color=9CA3AF&size=256'}
                style={styles.resultAvatar}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <Text style={[styles.resultName, { color: textColor(isDark) }]} numberOfLines={1}>
                      {item.displayName || 'Builder'}
                    </Text>
                    {!!(item as any).isVerified && <VerifiedBadge size={20} />}
                  </View>
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
            <View style={[styles.resultsLimitCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <Text style={styles.resultsLimitText}>
                Showing top {visibleResults.length} of {displayed.length}. Search or filter to narrow it down.
              </Text>
            </View>
          )}
          {displayed.length === 0 && (
            <View style={{ alignItems: 'center', marginTop: 60, gap: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', letterSpacing: -0.2, color: '#666' }}>NO RESULTS</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#666' }}>Try fewer filters.</Text>
            </View>
          )}
        </View>
      )}
      <PaywallModal
        visible={!!paywallFeature}
        feature={paywallFeature || PRO_FEATURES.startupAnalyzer}
        description="Warm intro, verified badge, startup analyzer, and Linky AI are paid. Everything else is free."
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
    borderRadius: 16,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: -0.2,
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
    borderRadius: 16,
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
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: '#000',
  },
  savedAlertsWrap: {
    paddingTop: 14,
  },
  savedAlertsTitle: {
    paddingHorizontal: 16,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  savedAlertsScroller: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
  },
  savedAlertPill: {
    width: 190,
    padding: 12,
    borderRadius: 16,
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
  resultsList: {    padding: 16,
    paddingBottom: 20,
  },
  sponsorRow: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  sponsorPill: {
    borderRadius: 999,
    backgroundColor: '#111217',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sponsorPillText: { color: '#FFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  sponsorTitle: { fontSize: 13, fontWeight: '900' },
  sponsorSub: { marginTop: 2, fontSize: 10, fontWeight: '800' },
  sponsorUrl: { marginTop: 3, fontSize: 10, fontWeight: '900', color: '#8A7900' },
  idleWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 40,
    gap: 12,
  },
  idleIconTile: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleTitle: {
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  idleCopy: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
  idleChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  idleChip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleChipText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  idleHint: {
    marginTop: 8,
    fontSize: 10,
    fontWeight: '800',
    color: '#777',
    textAlign: 'center',
  },
  resultsLimitCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    backgroundColor: COLORS.lightCard,
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
    borderRadius: 16,
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
    backgroundColor: COLORS.primary,
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
    borderRadius: 16,
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
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filtersCard: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    gap: 10,
  },
  filtersScrollContent: {
    gap: 10,
    paddingBottom: 120,
  },
  filtersTitle: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: -0.2,
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
    letterSpacing: -0.2,
    textTransform: 'uppercase',
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
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
    flexShrink: 1,
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
  resultMeta: {
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
    marginTop: 2,
  },
  resultHandle: {
    fontSize: 10,
    color: COLORS.primaryStrong,
    fontWeight: '900',
    marginTop: 2,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    marginTop: 5,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
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
    backgroundColor: COLORS.primary,
  },
  sliderKnob: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: COLORS.lightBorderActive,
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
