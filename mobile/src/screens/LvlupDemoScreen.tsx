import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowUpRight,
  BadgeCheck,
  Mail,
  MapPin,
  Search,
  TrendingUp,
} from 'lucide-react-native';
import { appBackground, COLORS, hairline, textColor } from '../theme/theme';
import { AppImage } from '../components/AppImage';
import BrandMark from '../components/BrandMark';
import { linkupWebBaseUrl } from '../lib/profileLinks';

const BRAND = '#FBE618';
const GOLD_SOFT = 'rgba(10, 11, 13, 0.72)';
const LVLUP_LOGO_URL = 'https://i.ibb.co/8n9cQx9j/download.webp';
const INK = '#0A0B0D';
const CONTACT_EMAIL = 'tanakaprince49@gmail.com';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.tana.linkup';
const THESIS_CHIPS = ['AI agents', 'SaaS', 'Fintech', 'Consumer', 'Climate', 'Dev tools'];

type LvlupPick = {
  uid: string;
  name: string;
  username?: string;
  verified?: boolean;
  headline?: string;
  location?: string;
  skills?: string[];
  image?: string;
  url: string;
  score: number;
  matched?: string[];
  brief: string;
  // Optional: CDN may serve pre-16.10.3 cached shapes without these — never crash on them.
  why?: { c: string; d: string }[];
  lane?: string;
  laneWhy?: string;
  programs?: { name: string; check: string; why: string }[];
};

type LvlupSearchResponse = {
  picks: LvlupPick[];
  totalEligible: number;
  scanned: number;
  terms: string[];
  engine?: string;
  generatedAt: string;
};

type LvlupCompanyFounder = {
  uid: string;
  name: string;
  role?: string;
  image?: string;
  url: string;
  score: number;
};
type LvlupCompany = {
  name: string;
  location?: string;
  founders: LvlupCompanyFounder[];
  founderCount: number;
  score: number;
  matched?: string[];
  brief: string;
  why: { c: string; d: string }[];
  programs: { name: string; check: string; why: string }[];
};
type LvlupCompaniesResponse = {
  companies: LvlupCompany[];
  totalCompanies: number;
  totalEligible: number;
  scanned: number;
  terms: string[];
  engine?: string;
  generatedAt: string;
};
type LvlupDigestResponse = {
  digest: boolean;
  week: string;
  thesis: string;
  picks: LvlupPick[];
  totalEligible: number;
  engine?: string;
  generatedAt: string;
};

function lvlupUrl(params: Record<string, string>) {
  const qs = new URLSearchParams({ mode: 'lvlup', ...params }).toString();
  return `${linkupWebBaseUrl()}/api/publicSeo?${qs}`;
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');
}

export default function LvlupDemoScreen() {
  // Demo page is always LINKUP white + gold, whatever the viewer's theme.
  const isDark = false;
  const ink = textColor(isDark);
  const sub = isDark ? COLORS.darkTextSecondary : COLORS.lightTextSecondary;
  const muted = isDark ? COLORS.darkTextMuted : COLORS.lightTextMuted;
  const card = isDark ? COLORS.darkCard : COLORS.lightCard;
  const line = hairline(isDark);

  const [thesis, setThesis] = useState('');
  const [activeThesis, setActiveThesis] = useState('');
  const [results, setResults] = useState<LvlupSearchResponse | null>(null);
  const [companies, setCompanies] = useState<LvlupCompaniesResponse | null>(null);
  const [view, setView] = useState<'builders' | 'companies'>('builders');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [digest, setDigest] = useState<LvlupDigestResponse | null>(null);
  const [digestError, setDigestError] = useState(false);

  const search = useCallback(async (q: string, v: 'builders' | 'companies' = 'builders') => {
    const query = q.trim();
    setActiveThesis(q);
    setSearching(true);
    setSearchError(false);
    try {
      const params: Record<string, string> = query ? { q: query.slice(0, 60), limit: '6' } : { limit: '6' };
      if (v === 'companies') params.view = 'companies';
      const res = await fetch(lvlupUrl(params));
      if (!res.ok) throw new Error(`lvlup search ${res.status}`);
      if (v === 'companies') setCompanies((await res.json()) as LvlupCompaniesResponse);
      else setResults((await res.json()) as LvlupSearchResponse);
    } catch {
      setSearchError(true);
      if (v === 'companies') setCompanies(null);
      else setResults(null);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Weekly-digest preview loads on mount with the default thesis.
      try {
        const res = await fetch(lvlupUrl({ digest: '1', limit: '5' }));
        if (!res.ok) throw new Error(`lvlup digest ${res.status}`);
        if (!cancelled) setDigest((await res.json()) as LvlupDigestResponse);
      } catch {
        if (!cancelled) setDigestError(true);
      }
      // Default search: top generalist builders, no thesis entered yet.
      if (!cancelled) await search('');
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);

  const activeResp = view === 'builders' ? results : companies;
  const activePicks = activeResp ? ('picks' in activeResp ? activeResp.picks : activeResp.companies) : null;
  const activeTerms = activeResp?.terms ?? [];
  const activeTotal = activeResp?.totalEligible ?? 0;
  const noun = view === 'builders' ? 'builders' : 'companies';
  const searchHits = (activePicks ?? []).filter(item => ((item as LvlupPick).matched?.length ?? 0) > 0);
  const emptyIndex = activePicks !== null && !searching && activePicks.length === 0 && activeTotal === 0;
  const noMatch = activePicks !== null && !searching && activeTerms.length > 0 && searchHits.length === 0;

  const openMail = (subject: string, body: string) => {
    const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    void Linking.openURL(url);
  };

  const renderPick = (pick: LvlupPick, compact = false) => {
    const why = Array.isArray(pick.why) ? pick.why : [];
    const programs = Array.isArray(pick.programs) ? pick.programs : [];
    return (
    <View key={pick.uid} style={[styles.pick, { backgroundColor: card, borderColor: line }]}>
      <View style={styles.pickTop}>
        {pick.image ? (
          <AppImage uri={pick.image} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: BRAND }]}>
            <Text style={styles.avatarInitials}>{initials(pick.name)}</Text>
          </View>
        )}
        <View style={styles.pickHead}>
          <View style={styles.nameRow}>
            <Text style={[styles.pickName, { color: ink }]} numberOfLines={1}>
              {pick.name}
            </Text>
            {pick.verified ? <BadgeCheck size={16} color={isDark ? BRAND : '#0A0B0D'} /> : null}
          </View>
          {pick.headline ? (
            <Text style={[styles.pickHeadline, { color: sub }]} numberOfLines={compact ? 1 : 2}>
              {pick.headline}
            </Text>
          ) : null}
          {pick.location ? (
            <View style={styles.locationRow}>
              <MapPin size={12} color={muted} />
              <Text style={[styles.pickLocation, { color: muted }]} numberOfLines={1}>
                {pick.location}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.scoreWrap}>
          <View style={styles.scorePill}>
            <Text style={styles.scoreText}>{pick.score}</Text>
          </View>
          <View style={[styles.scoreTrack, { backgroundColor: line }]}>
            <View style={[styles.scoreFill, { width: `${Math.max(4, Math.min(100, pick.score))}%` }]} />
          </View>
        </View>
      </View>
      {!compact && pick.lane ? (
        <View style={styles.laneRow}>
          <View style={styles.lanePill}>
            <Text style={styles.laneText}>{pick.lane}</Text>
          </View>
          <Text style={[styles.laneWhy, { color: muted }]}>{pick.laneWhy}</Text>
        </View>
      ) : null}
      <Text style={[styles.brief, { color: sub }]}>{pick.brief}</Text>
      {!compact && why.length > 0 ? (
        <View style={styles.whyBlock}>
          <Text style={[styles.whyTitle, { color: ink }]}>Why Linky surfaced {pick.name.split(' ')[0]}</Text>
          {why.map(w => (
            <View key={w.c} style={styles.whyRow}>
              <Text style={[styles.whyDot, { color: sub }]}>•</Text>
              <Text style={[styles.whyText, { color: sub }]}>
                <Text style={styles.whyC}>{w.c}: </Text>
                {w.d}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {!compact && programs.length > 0 ? (
        <View style={styles.whyBlock}>
          <Text style={[styles.whyTitle, { color: ink }]}>Where {pick.name.split(' ')[0]} fits at LvlUp</Text>
          {programs.map(pr => (
            <View key={pr.name} style={styles.progRow}>
              <View style={styles.progPill}>
                <Text style={styles.progName}>{pr.name}</Text>
              </View>
              <Text style={[styles.progWhy, { color: sub }]} numberOfLines={2}>
                {pr.check} · {pr.why}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {!compact && pick.skills && pick.skills.length > 0 ? (
        <Text style={[styles.skills, { color: muted }]} numberOfLines={1}>
          {pick.skills.join(' · ')}
        </Text>
      ) : null}
      <TouchableOpacity
        style={styles.profileLink}
        onPress={() => void Linking.openURL(pick.url)}
        accessibilityRole="link">
        <Text style={styles.profileLinkText}>View public profile</Text>
        <ArrowUpRight size={14} color={isDark ? BRAND : '#0A0B0D'} />
      </TouchableOpacity>
    </View>
    );
  };

  const renderCompany = (co: LvlupCompany) => {
    const why = Array.isArray(co.why) ? co.why : [];
    const programs = Array.isArray(co.programs) ? co.programs : [];
    return (
    <View key={co.name} style={[styles.pick, { backgroundColor: card, borderColor: line }]}>
      <View style={styles.pickTop}>
        <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: BRAND }]}>
          <Text style={styles.avatarInitials}>{initials(co.name)}</Text>
        </View>
        <View style={styles.pickHead}>
          <Text style={[styles.pickName, { color: ink }]} numberOfLines={1}>
            {co.name}
          </Text>
          <Text style={[styles.pickHeadline, { color: sub }]} numberOfLines={1}>
            {co.founderCount} founder{co.founderCount > 1 ? 's' : ''} on LINKUP
            {co.location ? ` · ${co.location}` : ''}
          </Text>
        </View>
        <View style={styles.scoreWrap}>
          <View style={styles.scorePill}>
            <Text style={styles.scoreText}>{co.score}</Text>
          </View>
          <View style={[styles.scoreTrack, { backgroundColor: line }]}>
            <View style={[styles.scoreFill, { width: `${Math.max(4, Math.min(100, co.score))}%` }]} />
          </View>
        </View>
      </View>
      {co.founders.map(f => (
        <TouchableOpacity
          key={f.uid}
          style={styles.founderRow}
          onPress={() => void Linking.openURL(f.url)}
          accessibilityRole="link">
          {f.image ? (
            <AppImage uri={f.image} style={styles.founderAvatar} />
          ) : (
            <View style={[styles.founderAvatar, styles.avatarFallback, { backgroundColor: BRAND }]}>
              <Text style={styles.founderInitials}>{initials(f.name)}</Text>
            </View>
          )}
          <View style={styles.founderInfo}>
            <Text style={[styles.founderName, { color: ink }]} numberOfLines={1}>
              {f.name}
            </Text>
            {f.role ? (
              <Text style={[styles.founderRole, { color: muted }]} numberOfLines={1}>
                {f.role}
              </Text>
            ) : null}
          </View>
          <ArrowUpRight size={14} color={isDark ? BRAND : '#0A0B0D'} />
        </TouchableOpacity>
      ))}
      <Text style={[styles.brief, { color: sub }]}>{co.brief}</Text>
      {why.length > 0 ? (
        <View style={styles.whyBlock}>
          <Text style={[styles.whyTitle, { color: ink }]}>Why Linky surfaced {co.name}</Text>
          {why.map(w => (
            <View key={w.c} style={styles.whyRow}>
              <Text style={[styles.whyDot, { color: sub }]}>•</Text>
              <Text style={[styles.whyText, { color: sub }]}>
                <Text style={styles.whyC}>{w.c}: </Text>
                {w.d}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {programs.length > 0 ? (
        <View style={styles.whyBlock}>
          <Text style={[styles.whyTitle, { color: ink }]}>Where {co.name} fits at LvlUp</Text>
          {programs.map(pr => (
            <View key={pr.name} style={styles.progRow}>
              <View style={styles.progPill}>
                <Text style={styles.progName}>{pr.name}</Text>
              </View>
              <Text style={[styles.progWhy, { color: sub }]} numberOfLines={2}>
                {pr.check} · {pr.why}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, appBackground(isDark)]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.page}>
          {/* HERO — the gold arena (Builder League rule): brand colour carries it, no black band. */}
          <View style={styles.hero}>
            <View style={styles.logoRow} accessibilityLabel="LINKUP and LvlUp Ventures">
              <BrandMark size={44} />
              <Text style={styles.logoX}>×</Text>
              <AppImage uri={LVLUP_LOGO_URL} style={styles.lvlupBadge} contentFit="cover" />
              <Text style={styles.logoText}>LINKUP × LVLUP VENTURES</Text>
            </View>
            <Text style={styles.heroTitle}>Deal flow, before the pitch deck.</Text>
            <Text style={styles.heroSub}>
              LvlUp screens 25,000+ applications a year. Linky pre-filters the builder index to
              your thesis first — and every pick ships with its receipts. No login, no theatre.
            </Text>
          </View>

          {/* THESIS SEARCH */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Search size={18} color={isDark ? BRAND : INK} />
              <Text style={[styles.sectionTitle, { color: ink }]}>Ask Linky for founders</Text>
            </View>
            <Text style={[styles.sectionSub, { color: sub }]}>
              Describe the builder you want to meet. Linky matches skills, projects, bios and
              locations across the index — then explains every pick.
            </Text>
            <View style={styles.viewToggle}>
              {(['builders', 'companies'] as const).map(v => (
                <TouchableOpacity
                  key={v}
                  style={[styles.viewTab, { borderColor: line }, view === v && { backgroundColor: INK, borderColor: INK }]}
                  onPress={() => {
                    if (v !== view) {
                      setView(v);
                      void search(thesis, v);
                    }
                  }}
                  accessibilityRole="button">
                  <Text style={[styles.viewTabText, { color: view === v ? BRAND : sub }]}>
                    {v === 'builders' ? 'Builders' : 'Companies'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={[styles.searchBox, { backgroundColor: card, borderColor: line }]}>
              <TextInput
                style={[styles.input, { color: ink }]}
                placeholder="e.g. fintech founder in Harare building payments"
                placeholderTextColor={muted}
                value={thesis}
                onChangeText={setThesis}
                onSubmitEditing={() => void search(thesis, view)}
                returnKeyType="search"
                maxLength={60}
                accessibilityLabel="Investment thesis"
              />
              <TouchableOpacity
                style={styles.askButton}
                onPress={() => void search(thesis, view)}
                disabled={searching}
                accessibilityRole="button">
                {searching ? (
                  <ActivityIndicator size="small" color={INK} />
                ) : (
                  <Text style={styles.askText}>Ask Linky</Text>
                )}
              </TouchableOpacity>
            </View>
            <View style={styles.chips}>
              {THESIS_CHIPS.map(chip => {
                const active = activeThesis.trim().toLowerCase() === chip.toLowerCase();
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[
                      styles.chip,
                      { borderColor: active ? BRAND : line, backgroundColor: active ? BRAND : 'transparent' },
                    ]}
                    onPress={() => {
                      setThesis(chip);
                      void search(chip, view);
                    }}
                    accessibilityRole="button">
                    <Text style={[styles.chipText, { color: active ? INK : sub }]}>{chip}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {searchError ? (
              <View style={[styles.notice, { backgroundColor: card, borderColor: line }]}>
                <Text style={[styles.noticeTitle, { color: ink }]}>Linky&apos;s desk is momentarily busy.</Text>
                <Text style={[styles.noticeBody, { color: sub }]}>
                  The builder index didn&apos;t answer in time. Your thesis is safe — try again.
                </Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => void search(activeThesis, view)}
                  accessibilityRole="button">
                  <Text style={styles.retryText}>Retry search</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {activeResp && !searching ? (
              <View style={styles.resultsMeta}>
                <TrendingUp size={13} color={muted} />
                <Text style={[styles.resultsMetaText, { color: muted }]}>
                  {activeTerms.length > 0
                    ? `Ranked for “${activeTerms.join(' · ')}” · `
                    : `Top ${noun} · `}
                  {view === 'companies' ? `${(activeResp as LvlupCompaniesResponse).totalCompanies} companies · ` : ''}
                  {activeTotal} builders indexed · updated{' '}
                  {new Date(activeResp.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {activeResp.engine === 'linky-ai' ? ' · Live Linky AI' : ''}
                </Text>
              </View>
            ) : null}
            {emptyIndex ? (
              <View style={[styles.notice, { backgroundColor: card, borderColor: line }]}>
                <Text style={[styles.noticeTitle, { color: ink }]}>{noun === 'builders' ? 'The builder index came back empty.' : 'No companies came back.'}</Text>
                <Text style={[styles.noticeBody, { color: sub }]}>
                  {noun === 'builders' ? 'No public profiles were returned. Check your connection and try again.' : 'None of the ranked founders list a venture. Check your connection and try again.'}
                </Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => void search(activeThesis, view)}
                  accessibilityRole="button">
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : noMatch ? (
              <View style={[styles.notice, { backgroundColor: card, borderColor: line }]}>
                <Text style={[styles.noticeTitle, { color: ink }]}>No {noun} match this thesis yet.</Text>
                <Text style={[styles.noticeBody, { color: sub }]}>
                  Nothing in the index matches “{activeThesis.trim()}” right now. Try broader terms
                  or one of the thesis chips above.
                </Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => {
                    setThesis('');
                    void search('', view);
                  }}
                  accessibilityRole="button">
                  <Text style={styles.retryText}>Browse top {noun}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              (view === 'builders' ? results?.picks.map(pick => renderPick(pick)) : companies?.companies.map(co => renderCompany(co)))
            )}
          </View>

          {/* WEEKLY DIGEST */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Mail size={18} color={isDark ? BRAND : INK} />
              <Text style={[styles.sectionTitle, { color: ink }]}>The LvlUp weekly digest</Text>
            </View>
            <Text style={[styles.sectionSub, { color: sub }]}>
              Talent is global and early capital still is not. Every Monday: the five builders who
              moved the most — new projects, new skills, new momentum — matched to your thesis.
              Here&apos;s this week&apos;s edition, generated live from the index.
            </Text>
            {digest ? (
              <View style={[styles.digestCard, { backgroundColor: card, borderColor: line }]}>
                <Text style={[styles.digestWeek, { color: muted }]}>{digest.week}</Text>
                <Text style={[styles.digestThesis, { color: ink }]}>Thesis: {digest.thesis}</Text>
                {digest.picks.slice(0, 3).map(pick => (
                  <View key={pick.uid} style={[styles.digestRow, { borderTopColor: line }]}>
                    <View style={styles.digestScore}>
                      <Text style={styles.digestScoreText}>{pick.score}</Text>
                    </View>
                    <View style={styles.digestInfo}>
                      <Text style={[styles.digestName, { color: ink }]} numberOfLines={1}>
                        {pick.name}{pick.lane ? ` · ${pick.lane}` : ''}
                        {pick.location ? ` · ${pick.location}` : ''}
                      </Text>
                      <Text style={[styles.digestBrief, { color: sub }]} numberOfLines={2}>
                        {pick.brief}
                      </Text>
                    </View>
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.subscribeButton}
                  onPress={() =>
                    openMail(
                      'LvlUp × LINKUP — send me the weekly digest',
                      'Hi Tanaka,\n\nSend LvlUp Ventures the LINKUP builder digest every Monday.\n\nOur thesis: \n\n— LvlUp Ventures',
                    )
                  }
                  accessibilityRole="button">
                  <Mail size={15} color={INK} />
                  <Text style={styles.subscribeText}>Get this digest every Monday</Text>
                </TouchableOpacity>
              </View>
            ) : digestError ? (
              <View style={[styles.notice, { backgroundColor: card, borderColor: line }]}>
                <Text style={[styles.noticeBody, { color: sub }]}>
                  This week&apos;s digest is still printing. Pull to retry in a moment.
                </Text>
              </View>
            ) : (
              <ActivityIndicator size="large" color={isDark ? BRAND : INK} style={styles.loader} />
            )}
          </View>

          {/* ONBOARDING */}
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <BadgeCheck size={18} color={isDark ? BRAND : INK} />
              <Text style={[styles.sectionTitle, { color: ink }]}>From thesis to intro in 3 steps</Text>
            </View>
            {[
              {
                n: '1',
                title: 'Share your thesis',
                body: "Sectors, stages, geographies, check size. One call — we encode it into Linky's matching model.",
              },
              {
                n: '2',
                title: 'Linky ranks the builders',
                body: "Every public profile scored against your thesis and LvlUp's first-check filters — thesis fit, shipping velocity, founder focus.",
              },
              {
                n: '3',
                title: 'Warm intros, founders opted in',
                body: 'Builders choose to be discoverable. You meet founders who already want the conversation.',
              },
            ].map(step => (
              <View key={step.n} style={[styles.step, { backgroundColor: card, borderColor: line }]}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{step.n}</Text>
                </View>
                <View style={styles.stepBody}>
                  <Text style={[styles.stepTitle, { color: ink }]}>{step.title}</Text>
                  <Text style={[styles.stepText, { color: sub }]}>{step.body}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* CTA */}
          <View style={styles.cta}>
            <Text style={styles.ctaTitle}>Bring us your thesis. Leave with a shortlist.</Text>
            <Text style={styles.ctaSub}>
              30 minutes with the founder. We run your thesis live and you keep the shortlist either way.
            </Text>
            <TouchableOpacity
              style={styles.ctaButton}
              onPress={() =>
                openMail(
                  'LvlUp × LINKUP — thesis call',
                  'Hi Tanaka,\n\nLvlUp Ventures would like to book the thesis call.\n\nOur thesis: \nTimes that work: \n\n— LvlUp Ventures',
                )
              }
              accessibilityRole="button">
              <Text style={styles.ctaButtonText}>Book the thesis call</Text>
              <ArrowUpRight size={16} color={BRAND} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void Linking.openURL(PLAY_STORE_URL)} accessibilityRole="link">
              <Text style={styles.storeLink}>Get LINKUP on Google Play ↗</Text>
            </TouchableOpacity>
            <Text style={styles.footnote}>Built by builders · Harare, Zimbabwe · linkupbuild.com</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  page: { width: '100%', maxWidth: 760, padding: 16, gap: 20 },
  hero: { backgroundColor: BRAND, borderRadius: 20, padding: 24, gap: 12 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoX: { color: INK, fontWeight: '900', fontSize: 22 },
  lvlupBadge: { width: 62, height: 55, borderRadius: 12 },
  logoText: { flex: 1, flexShrink: 1, color: INK, fontWeight: '800', fontSize: 13, letterSpacing: 1.5 },
  heroTitle: { color: INK, fontSize: 34, fontWeight: '900', lineHeight: 40 },
  heroSub: { color: GOLD_SOFT, fontSize: 15, lineHeight: 22 },
  section: { gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  sectionSub: { fontSize: 14, lineHeight: 20 },
  searchBox: { borderWidth: 1, borderRadius: 14, padding: 8, gap: 8 },
  input: { fontSize: 15, paddingHorizontal: 10, paddingVertical: 10 },
  askButton: {
    backgroundColor: BRAND,
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  askText: { color: INK, fontWeight: '800', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontWeight: '700' },
  resultsMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultsMetaText: { fontSize: 12 },
  pick: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  pickTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { color: INK, fontWeight: '900', fontSize: 18 },
  pickHead: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pickName: { fontSize: 16, fontWeight: '800', flexShrink: 1 },
  pickHeadline: { fontSize: 13, lineHeight: 18 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pickLocation: { fontSize: 12 },
  scoreWrap: { width: 64, gap: 6, alignItems: 'flex-end' },
  scorePill: {
    backgroundColor: BRAND,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  scoreText: { color: INK, fontWeight: '900', fontSize: 14 },
  scoreTrack: { height: 4, width: '100%', borderRadius: 2, overflow: 'hidden' },
  scoreFill: { height: '100%', backgroundColor: BRAND, borderRadius: 2 },
  laneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lanePill: { backgroundColor: BRAND, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  laneText: { color: INK, fontWeight: '900', fontSize: 12 },
  laneWhy: { fontSize: 12, flex: 1, flexShrink: 1 },
  whyBlock: { gap: 6, marginTop: 2 },
  whyTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 0.4 },
  whyRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  whyDot: { fontSize: 13, fontWeight: '900' },
  whyText: { fontSize: 13, lineHeight: 19, flex: 1, flexShrink: 1 },
  whyC: { fontWeight: '800' },
  progRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  progPill: { backgroundColor: BRAND, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  progName: { color: INK, fontWeight: '800', fontSize: 12 },
  progWhy: { fontSize: 12, lineHeight: 17, flex: 1, flexShrink: 1 },
  viewToggle: { flexDirection: 'row', gap: 8 },
  viewTab: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  viewTabText: { fontSize: 14, fontWeight: '800' },
  founderRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6 },
  founderAvatar: { width: 36, height: 36, borderRadius: 18 },
  founderInitials: { color: INK, fontWeight: '900', fontSize: 14 },
  founderInfo: { flex: 1, gap: 1 },
  founderName: { fontSize: 14, fontWeight: '800' },
  founderRole: { fontSize: 12 },
  brief: { fontSize: 14, lineHeight: 21 },
  skills: { fontSize: 12 },
  profileLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  profileLinkText: { fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  notice: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  noticeTitle: { fontSize: 15, fontWeight: '800' },
  noticeBody: { fontSize: 14, lineHeight: 20 },
  retryButton: { backgroundColor: INK, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  retryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  digestCard: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  digestWeek: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  digestThesis: { fontSize: 16, fontWeight: '800' },
  digestRow: { flexDirection: 'row', gap: 12, borderTopWidth: 1, paddingTop: 12, alignItems: 'flex-start' },
  digestScore: {
    backgroundColor: BRAND,
    borderRadius: 10,
    minWidth: 44,
    paddingVertical: 8,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  digestScoreText: { color: INK, fontWeight: '900', fontSize: 15 },
  digestInfo: { flex: 1, gap: 3 },
  digestName: { fontSize: 14, fontWeight: '800' },
  digestBrief: { fontSize: 13, lineHeight: 18 },
  subscribeButton: {
    backgroundColor: BRAND,
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  subscribeText: { color: INK, fontWeight: '800', fontSize: 14 },
  loader: { paddingVertical: 24 },
  step: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    backgroundColor: BRAND,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: INK, fontWeight: '900', fontSize: 15 },
  stepBody: { flex: 1, gap: 3 },
  stepTitle: { fontSize: 15, fontWeight: '800' },
  stepText: { fontSize: 13, lineHeight: 19 },
  cta: { backgroundColor: BRAND, borderRadius: 20, padding: 24, gap: 12, alignItems: 'center' },
  ctaTitle: { color: INK, fontSize: 22, fontWeight: '900', textAlign: 'center', lineHeight: 28 },
  ctaSub: { color: GOLD_SOFT, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  ctaButton: {
    backgroundColor: INK,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  ctaButtonText: { color: BRAND, fontWeight: '900', fontSize: 16 },
  storeLink: { color: INK, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  footnote: { color: GOLD_SOFT, fontSize: 12, marginTop: 4 },
});
