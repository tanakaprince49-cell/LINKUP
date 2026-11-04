import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../contexts/AuthContext';
import { builderCall } from '../lib/builder';
import {
  registerForPushNotificationsAsync,
  registerForWebNotificationsAsync,
} from '../lib/notifications';
import { notifyUser } from '../lib/notify';
import { textColor } from '../theme/theme';

type Props = {
  navigation: any;
  isDark: boolean;
  mode?: 'full' | 'spliceOnly';
  onRefreshWorkspace?: () => void;
};

function formatCommitTime(iso = ''): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diffMins = Math.floor((Date.now() - ms) / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 14) return `${diffDays}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function VentureEnginePanel({ navigation, isDark, mode = 'full', onRefreshWorkspace }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<any>(null);
  const [repoInput, setRepoInput] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [manifestInput, setManifestInput] = useState('');
  const [showManifestBox, setShowManifestBox] = useState(false);
  const [showWebhookBox, setShowWebhookBox] = useState(false);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [pushReady, setPushReady] = useState<boolean>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      return window.Notification.permission === 'granted';
    }
    return false;
  });
  const [spliced, setSpliced] = useState<any[]>([]);
  const [ventureName, setVentureName] = useState('');
  const autoBackfilledRef = React.useRef(false);

  const enableCommitAlerts = async () => {
    if (!user?.uid) return;
    try {
      if (Platform.OS === 'web') {
        const perm = await registerForWebNotificationsAsync(user.uid);
        if (perm === 'granted' || (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted')) {
          setPushReady(true);
          notifyUser('Commit Push Alerts Enabled', 'Linky will send a push notification every time a commit is recorded.');
        } else {
          notifyUser('In-App Alerts Active', 'Allow browser notifications in site settings to also get desktop/mobile push alerts.');
        }
      } else {
        await registerForPushNotificationsAsync(user.uid);
        setPushReady(true);
        notifyUser('Commit Push Alerts Enabled', 'Linky will notify your phone whenever a commit is recorded.');
      }
    } catch {
      notifyUser('In-App Alerts Active', 'Linky will always deliver commit alerts to your LINKUP Alerts inbox.');
    }
  };

  const ink = textColor(isDark);
  const sub = textColor(isDark, 'secondary');
  const cardBg = isDark ? '#171A21' : '#FFFFFF';
  const cardBorder = isDark ? '#383A42' : '#DDDAD1';
  const softBg = isDark ? '#20242E' : '#F7F6F0';

  const load = useCallback(async () => {
    try {
      const s = await builderCall('ventureStatus');
      setStatus(s);
      if (s?.githubRepo && !repoInput) setRepoInput(s.githubRepo);
      if (s?.githubHandle && !handleInput) setHandleInput(s.githubHandle);
    } catch {
      // Gracefully stay quiet in isolated offline harnesses that don't mock ventureStatus
    } finally {
      setLoading(false);
    }
  }, [handleInput, repoInput]);

  useEffect(() => {
    void load();
  }, [load]);

  // Backfill inspected commits automatically once for repos connected before commit history display shipped
  useEffect(() => {
    if (autoBackfilledRef.current || mode !== 'full' || !status) return;
    const hasConnectedTarget = Boolean(status.githubRepo || status.githubHandle);
    const existingList = Array.isArray(status.inspectedCommits)
      ? status.inspectedCommits
      : Array.isArray(status.codeDiagnosis?.inspectedCommits)
        ? status.codeDiagnosis.inspectedCommits
        : [];
    if (hasConnectedTarget && existingList.length === 0) {
      autoBackfilledRef.current = true;
      void builderCall('ventureSyncGithub', {})
        .then((res) => {
          if (res) setStatus(res);
        })
        .catch(() => {});
    }
  }, [status, mode]);

  const runOp = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message || 'Action could not complete.');
    } finally {
      setBusy('');
    }
  };

  const connectRepo = () =>
    runOp('scan', async () => {
      const res = await builderCall('ventureConnectGithub', {
        githubRepo: repoInput.trim(),
        githubHandle: handleInput.trim(),
        manifestJson: manifestInput.trim(),
      });
      setStatus(res);
      const pts = res?.autoLeagueSync?.leaguePointsAdded || 0;
      notifyUser(
        'Codebase analyzed by Linky',
        pts > 0
          ? `Verified today's GitHub push and automatically added +${pts} Builder League points.`
          : 'Project stack, coding rhythm, and co-founder skill gaps updated.'
      );
      onRefreshWorkspace?.();
    });

  const syncCommits = () =>
    runOp('sync', async () => {
      const res = await builderCall('ventureSyncGithub', {});
      setStatus(res);
      const pts = res?.autoLeagueSync?.leaguePointsAdded || 0;
      notifyUser(
        pts > 0 ? `+${pts} League points auto-credited` : 'GitHub synced',
        pts > 0
          ? 'Your latest commit advanced your Builder League standing automatically.'
          : `Verified commits: ${res?.verifiedCommitCount || 0}. Push code today to advance your streak.`
      );
      onRefreshWorkspace?.();
    });

  const runSplice = () =>
    runOp('splice', async () => {
      const res = await builderCall('ventureSplice', { limit: 5 });
      setSpliced(res?.matches || []);
      if (res?.diagnosis && status) {
        setStatus({ ...status, codeDiagnosis: res.diagnosis });
      }
    });

  const provisionSquad = (partnerUid?: string) =>
    runOp('provision', async () => {
      const res = await builderCall('ventureProvision', {
        partnerUid: partnerUid || '',
        ventureName: ventureName.trim(),
      });
      await load();
      onRefreshWorkspace?.();
      if (res?.launchpad) {
        notifyUser(
          'Day-1 Venture Workplace Live',
          `${res.launchpad.name} room and hosted launchpad (${res.launchpad.reservedDomain}) are ready.`
        );
      }
    });

  const copyText = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    notifyUser('Copied', `${label} copied to clipboard.`);
  };

  if (loading && !status) return null;
  if (!status) return null;

  const diag = status.codeDiagnosis;
  const inspectedCommits: any[] =
    Array.isArray(status.inspectedCommits) && status.inspectedCommits.length > 0
      ? status.inspectedCommits
      : Array.isArray(diag?.inspectedCommits)
        ? diag.inspectedCommits
        : [];
  const visibleCommits = showAllCommits ? inspectedCommits : inspectedCommits.slice(0, 5);
  const recent14dCount =
    typeof diag?.commitsLast14d === 'number' && diag.commitsLast14d > 0
      ? diag.commitsLast14d
      : inspectedCommits.filter((c) => c?.in14dWindow).length;
  const offers: any[] = Array.isArray(status.vcOffers) ? status.vcOffers : [];
  const launchpads: any[] = Array.isArray(status.launchpads) ? status.launchpads : [];

  return (
    <View style={{ gap: 14 }}>
      {/* Incoming VC Smart-Contract / SAFE Offer Flash Banner */}
      {offers.length > 0 && mode === 'full' && (
        <View style={[styles.vcBanner, { backgroundColor: isDark ? '#27220B' : '#FFFBEB' }]}>
          <Text style={styles.vcEyebrow}>AUTOMATED VENTURE BRIDGE · LIVE INVESTMENT OFFER</Text>
          {offers.slice(0, 2).map((o) => (
            <View key={o.offerId} style={{ gap: 6, paddingTop: 4 }}>
              <Text style={[styles.vcTitle, { color: ink }]}>
                ${Number(o.checkUsd || 50000).toLocaleString('en-US')} SAFE Offer Intent from {o.firmName}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 19, color: sub }}>
                Partner {o.partnerName} ({o.partnerEmail}) triggered a fast-track ${Number(o.checkUsd || 50000).toLocaleString('en-US')} check review for {o.squadName} at a ${Number(o.valuationCapUsd || 5000000).toLocaleString('en-US')} valuation cap.
              </Text>
              <Text style={styles.hashBadge}>Bridge Receipt Hash: {o.contractHash}</Text>
              <View style={styles.row}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => void Linking.openURL(`mailto:${o.partnerEmail}?subject=${encodeURIComponent(`Accepting ${o.firmName} $${Number(o.checkUsd || 50000).toLocaleString('en-US')} SAFE Review — ${o.squadName}`)}`)}
                  style={styles.goldBtn}
                >
                  <Text style={styles.goldBtnText}>Accept Intro & Counter-Sign Review</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => void copyText('Bridge receipt hash', o.contractHash)}
                  style={styles.secBtn}
                >
                  <Text style={styles.secBtnText}>Copy Contract Hash</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Pillar 1 & 2: Linky Quiet Codebase Manager + Passive GitHub Auto-Rank */}
      {mode === 'full' && (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <View style={styles.badgeRow}>
            <View style={styles.pillGold}>
              <Text style={styles.pillGoldText}>AUTOMATED VENTURE ENGINE</Text>
            </View>
            {status.githubVerified ? (
              <View style={styles.pillVerified}>
                <Text style={styles.pillVerifiedText}>GITHUB VERIFIED · {status.verifiedCommitCount || 0} COMMITS</Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.title, { color: ink }]}>
            Linky Codebase Manager & Passive GitHub League
          </Text>
          <Text style={[styles.body, { color: sub }]}>
            Connect your GitHub repo or Cursor manifest. Linky inspects your stack and file structure without reading private source code, figures out the exact co-founder role you are missing, and raises your Builder League rank automatically whenever you commit code.
          </Text>

          {error ? (
            <View style={styles.errBox}>
              <Text style={{ color: '#9F1239', fontSize: 13, fontWeight: '700' }}>{error}</Text>
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <TextInput
              value={repoInput}
              onChangeText={setRepoInput}
              placeholder="GitHub repository (e.g. owner/repo or https://github.com/owner/repo)"
              placeholderTextColor="#7A7E85"
              autoCapitalize="none"
              style={styles.input}
            />
            <TextInput
              value={handleInput}
              onChangeText={setHandleInput}
              placeholder="GitHub username (optional, e.g. @tanakaprince49-cell)"
              placeholderTextColor="#7A7E85"
              autoCapitalize="none"
              style={styles.input}
            />
            {showManifestBox ? (
              <TextInput
                value={manifestInput}
                onChangeText={setManifestInput}
                placeholder="Paste package.json, requirements.txt, or root folder filenames for private local Cursor projects..."
                placeholderTextColor="#7A7E85"
                multiline
                style={[styles.input, { minHeight: 88, textAlignVertical: 'top' }]}
              />
            ) : null}
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={!!busy}
              onPress={() => void connectRepo()}
              style={[styles.goldBtn, !!busy && { opacity: 0.55 }]}
            >
              <Text style={styles.goldBtnText}>
                {busy === 'scan' ? 'Scanning Codebase…' : 'Scan Codebase & Connect Auto-Ship'}
              </Text>
            </TouchableOpacity>
            {status.githubRepo || status.githubHandle ? (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() => void syncCommits()}
                style={[styles.secBtn, !!busy && { opacity: 0.55 }]}
              >
                <Text style={styles.secBtnText}>
                  {busy === 'sync' ? 'Syncing…' : 'Sync GitHub Commits'}
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setShowManifestBox((v) => !v)}
              style={styles.secBtn}
            >
              <Text style={styles.secBtnText}>
                {showManifestBox ? 'Hide Local Manifest' : 'Paste Cursor / package.json'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setShowWebhookBox((v) => !v)}
              style={styles.secBtn}
            >
              <Text style={styles.secBtnText}>
                {showWebhookBox ? 'Hide Passive Webhook' : 'Passive GitHub / Cursor Webhook'}
              </Text>
            </TouchableOpacity>
          </View>

          {status.autoWatchActive || status.githubRepo || status.githubHandle ? (
            <View
              style={[
                styles.autoWatchBanner,
                {
                  backgroundColor: isDark ? '#12261E' : '#ECFDF5',
                  borderColor: isDark ? '#1E5B41' : '#86EFAC',
                },
              ]}
            >
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <View style={[styles.row, { gap: 6 }]}>
                  <View style={styles.pillVerified}>
                    <Text style={styles.pillVerifiedText}>AUTO-RECORDING ON</Text>
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? '#A7F3D0' : '#065F46' }}>
                    {status.githubRepo || `@${String(status.githubHandle).replace(/^@/, '')}`}
                  </Text>
                </View>
                {status.lastAutoCheckedAt ? (
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#6EE7B7' : '#047857' }}>
                    Checked {formatCommitTime(new Date(Number(status.lastAutoCheckedAt)).toISOString())}
                  </Text>
                ) : null}
              </View>
              <Text style={{ fontSize: 12, lineHeight: 18, color: isDark ? '#D1FAE5' : '#065F46' }}>
                Linky watches your GitHub automatically in the background. Whenever you commit & push code, Linky records the commit here, credits Builder League, and sends you a notification without you needing to open LINKUP.
              </Text>
              {!pushReady ? (
                <View style={[styles.row, { marginTop: 2 }]}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void enableCommitAlerts()}
                    style={{
                      backgroundColor: '#FBE618',
                      paddingHorizontal: 11,
                      paddingVertical: 6,
                      borderRadius: 10,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '900', color: '#0A0B0D' }}>
                      Enable Push Alerts When Commits Record
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={{ fontSize: 11, fontWeight: '800', color: isDark ? '#6EE7B7' : '#047857' }}>
                  Instant Commit Notifications Active (In-App Inbox + Push)
                </Text>
              )}
            </View>
          ) : null}

          {showWebhookBox ? (
            <View style={[styles.subPanel, { backgroundColor: softBg }]}>
              <Text style={{ fontWeight: '800', fontSize: 13, color: ink }}>
                Instant Real-Time Push & Local Git Hook (Optional · Cloud Auto-Watch Already Active)
              </Text>
              <Text style={{ fontSize: 12, lineHeight: 18, color: sub }}>
                Linky already sweeps your public GitHub commits automatically in the background. For sub-second instant recording (or private/offline local commits before git push), add the GitHub Webhook or paste the 1-line local post-commit installer in your project terminal.
              </Text>
              <View style={styles.row}>
                {status.autoInstallHookCmd ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void copyText('1-line local auto-commit installer', status.autoInstallHookCmd)}
                    style={styles.goldBtn}
                  >
                    <Text style={styles.goldBtnText}>Copy 1-Line Auto-Commit Installer</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => void copyText('GitHub Webhook URL', status.webhookUrl)}
                  style={status.autoInstallHookCmd ? styles.secBtn : styles.goldBtn}
                >
                  <Text style={status.autoInstallHookCmd ? styles.secBtnText : styles.goldBtnText}>
                    Copy GitHub Webhook URL
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => void copyText('GitHub Webhook Secret', status.webhookSecret)}
                  style={styles.secBtn}
                >
                  <Text style={styles.secBtnText}>Copy HMAC Secret</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => void copyText('Cursor / Git post-push hook', status.cursorHook)}
                  style={styles.secBtn}
                >
                  <Text style={styles.secBtnText}>Copy Cursor Git Hook</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {diag ? (
            <View style={[styles.subPanel, { backgroundColor: softBg, borderColor: cardBorder }]}>
              <Text style={{ fontWeight: '900', fontSize: 13, color: ink }}>
                Linky Quiet Manager Diagnosis · {diag.codingStyle?.cadence || 'Builder'}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 20, color: sub }}>{diag.linkyManagerMemo}</Text>
              {Array.isArray(diag.detectedStack) && diag.detectedStack.length > 0 ? (
                <View style={styles.row}>
                  {diag.detectedStack.map((st: string) => (
                    <View key={st} style={styles.stackChip}>
                      <Text style={styles.stackChipText}>{st}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? '#FBE618' : '#9A6B00' }}>
                Missing Co-Founder Puzzle Pieces: {(diag.missingRoles || []).join(' · ')}
              </Text>
              <Text style={{ fontSize: 12, color: sub }}>
                Shipping Rhythm: {diag.codingStyle?.peakWindowUtc || 'Flexible Async'}
              </Text>
            </View>
          ) : null}

          {/* Commits Linky Looked At (from GitHub Codebase Scan + Passive GitHub/Cursor Webhook) */}
          {inspectedCommits.length > 0 ? (
            <View style={[styles.subPanel, { backgroundColor: softBg, borderColor: cardBorder }]}>
              <View style={[styles.row, { justifyContent: 'space-between' }]}>
                <Text style={{ fontWeight: '900', fontSize: 13, color: ink }}>
                  Commits Linky Looked At ({inspectedCommits.length})
                </Text>
                {recent14dCount > 0 ? (
                  <View style={styles.commitWindowPill}>
                    <Text style={styles.commitWindowPillText}>
                      {recent14dCount} in last 14 days
                    </Text>
                  </View>
                ) : null}
              </View>

              <View style={{ gap: 8, marginTop: 2 }}>
                {visibleCommits.map((commit: any, idx: number) => {
                  const shortSha = String(commit?.shortSha || commit?.sha || 'HEAD').slice(0, 7);
                  const timeLabel = formatCommitTime(commit?.timestamp || '');
                  const commitUrl = typeof commit?.url === 'string' && commit.url.startsWith('https://') ? commit.url : '';
                  const isWebhook = commit?.source === 'passive_webhook';
                  const isAutoWatcher = commit?.source === 'auto_watcher';

                  return (
                    <View
                      key={`${commit?.sha || shortSha}-${idx}`}
                      style={[
                        styles.commitRow,
                        {
                          backgroundColor: isDark ? '#161922' : '#FFFFFF',
                          borderColor: isDark ? '#2E3340' : '#E3E0D6',
                        },
                      ]}
                    >
                      <View style={[styles.row, { justifyContent: 'space-between' }]}>
                        <View style={[styles.row, { gap: 6 }]}>
                          {commitUrl ? (
                            <TouchableOpacity
                              accessibilityRole="link"
                              onPress={() => void Linking.openURL(commitUrl).catch(() => {})}
                              style={styles.shaPill}
                            >
                              <Text style={styles.shaPillText}>{shortSha} ↗</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              accessibilityRole="button"
                              onPress={() => void copyText('Commit SHA', String(commit?.sha || shortSha))}
                              style={styles.shaPill}
                            >
                              <Text style={styles.shaPillText}>{shortSha}</Text>
                            </TouchableOpacity>
                          )}

                          <View
                            style={[
                              styles.commitSourceBadge,
                              isWebhook
                                ? styles.commitSourceWebhook
                                : isAutoWatcher
                                  ? styles.commitSourceAuto
                                  : styles.commitSourceScan,
                            ]}
                          >
                            <Text
                              style={[
                                styles.commitSourceBadgeText,
                                {
                                  color: isWebhook
                                    ? '#075985'
                                    : isAutoWatcher
                                      ? '#065F46'
                                      : '#374151',
                                },
                              ]}
                            >
                              {isWebhook
                                ? 'Passive Webhook'
                                : isAutoWatcher
                                  ? 'Auto-Recorded'
                                  : 'Codebase Scan'}
                            </Text>
                          </View>

                          {commit?.leagueCredited ? (
                            <View style={styles.pillVerified}>
                              <Text style={styles.pillVerifiedText}>+10 LEAGUE</Text>
                            </View>
                          ) : null}
                        </View>

                        {timeLabel ? (
                          <Text style={{ fontSize: 11, fontWeight: '700', color: sub }}>
                            {timeLabel}
                          </Text>
                        ) : null}
                      </View>

                      <Text
                        style={{ fontSize: 13, fontWeight: '800', lineHeight: 18, color: ink }}
                        numberOfLines={2}
                      >
                        {commit?.message || 'Verified Git commit'}
                      </Text>

                      <View style={[styles.row, { justifyContent: 'space-between' }]}>
                        <Text style={{ fontSize: 11, color: sub }} numberOfLines={1}>
                          {[
                            commit?.repo || status.githubRepo || '',
                            commit?.author ? `by @${String(commit.author).replace(/^@/, '')}` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>

                        {commitUrl ? (
                          <TouchableOpacity
                            accessibilityRole="link"
                            onPress={() => void Linking.openURL(commitUrl).catch(() => {})}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '800',
                                color: isDark ? '#FBE618' : '#0A58CA',
                              }}
                            >
                              Open commit ↗
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>

              {inspectedCommits.length > 5 ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setShowAllCommits((v) => !v)}
                  style={[styles.secBtn, { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12 }]}
                >
                  <Text style={[styles.secBtnText, { fontSize: 12 }]}>
                    {showAllCommits
                      ? 'Show fewer commits'
                      : `Show all ${inspectedCommits.length} commits Linky looked at`}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : diag ? (
            <View style={[styles.subPanel, { backgroundColor: softBg, borderColor: cardBorder }]}>
              <Text style={{ fontWeight: '800', fontSize: 12, color: ink }}>
                Commits Linky Looked At (0)
              </Text>
              <Text style={{ fontSize: 12, lineHeight: 18, color: sub }}>
                Enter your public GitHub repository (owner/repo) or @username above and tap Scan Codebase — or push with the Passive GitHub / Cursor Webhook — so Linky can list every commit he inspected here.
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Pillar 3 & 4: Algorithmic Splicing Engine + Instant Day-1 Workplace Provisioning */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
        <Text style={[styles.title, { color: ink }]}>
          Algorithmic Co-Founder Splicing & Day-1 Workplace Factory
        </Text>
        <Text style={[styles.body, { color: sub }]}>
          Matches your diagnosed codebase gaps, shipping speed, and timezone against verified builders — and automatically spins up your shared Venture Room, reserved Launchpad domain, and Day-1 project scaffold the second you lock a squad.
        </Text>

        {busy ? <ActivityIndicator color="#D4A000" /> : null}

        <TextInput
          value={ventureName}
          onChangeText={setVentureName}
          placeholder="Optional venture codename (e.g. PayFlow AI)"
          placeholderTextColor="#7A7E85"
          style={styles.input}
        />

        <View style={styles.row}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() => void runSplice()}
            style={[styles.goldBtn, !!busy && { opacity: 0.55 }]}
          >
            <Text style={styles.goldBtnText}>Find Puzzle-Piece Co-Founders</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!!busy}
            onPress={() => void provisionSquad()}
            style={[styles.secBtn, !!busy && { opacity: 0.55 }]}
          >
            <Text style={styles.secBtnText}>Auto-Lock #1 Match & Provision Workplace</Text>
          </TouchableOpacity>
        </View>

        {spliced.length > 0 ? (
          <View style={{ gap: 10 }}>
            {spliced.map((m) => (
              <View key={m.uid} style={[styles.subPanel, { backgroundColor: softBg }]}>
                <View style={[styles.row, { justifyContent: 'space-between' }]}>
                  <Text style={{ fontWeight: '900', fontSize: 15, color: ink }}>
                    {m.name} · {m.fillsRole}
                  </Text>
                  <View style={styles.pillGold}>
                    <Text style={styles.pillGoldText}>{m.puzzleScore}% PUZZLE FIT</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, lineHeight: 19, color: sub }}>{m.whyPuzzleFit}</Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={!!busy}
                    onPress={() => void provisionSquad(m.uid)}
                    style={styles.goldBtn}
                  >
                    <Text style={styles.goldBtnText}>Lock Squad & Provision Workplace</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('Profile', { userId: m.uid })}
                    style={styles.secBtn}
                  >
                    <Text style={styles.secBtnText}>View Profile</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {launchpads.length > 0 ? (
          <View style={{ gap: 10, paddingTop: 4 }}>
            <Text style={{ fontWeight: '900', fontSize: 14, color: ink }}>
              Active Day-1 Venture Workplaces ({launchpads.length})
            </Text>
            {launchpads.map((lp) => (
              <View key={lp.slug} style={[styles.subPanel, { backgroundColor: softBg }]}>
                <View style={[styles.row, { justifyContent: 'space-between' }]}>
                  <Text style={{ fontWeight: '900', fontSize: 15, color: ink }}>{lp.name}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#9A6B00' }}>
                    {lp.reservedDomain}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, lineHeight: 19, color: sub }}>{lp.thesis}</Text>
                {(lp.founders || []).map((f: any) => (
                  <Text key={f.uid} style={{ fontSize: 12, fontWeight: '700', color: ink }}>
                    • {f.name}: {f.lane}
                  </Text>
                ))}
                <Text style={{ fontSize: 12, color: sub }}>
                  Provisioned Scaffold: {(lp.starterFiles || []).join(' · ')}
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('GroupChat', { groupId: lp.roomId, title: `${lp.name} · Venture Room` })}
                    style={styles.goldBtn}
                  >
                    <Text style={styles.goldBtnText}>Open Shared Venture Room</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => void Linking.openURL(lp.launchpadUrl)}
                    style={styles.secBtn}
                  >
                    <Text style={styles.secBtnText}>Open Live Hosted Launchpad</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 20,
    gap: 12,
  },
  vcBanner: {
    borderWidth: 2,
    borderColor: '#D4A000',
    borderRadius: 22,
    padding: 18,
    gap: 8,
  },
  vcEyebrow: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: '#9A6B00',
  },
  vcTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  hashBadge: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#6B7280',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  pillGold: {
    backgroundColor: '#FBE618',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillGoldText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#0A0B0D',
  },
  pillVerified: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillVerifiedText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
  },
  input: {
    backgroundColor: '#F1F0EC',
    color: '#0A0B0D',
    borderColor: '#DDDAD1',
    borderWidth: 1,
    borderRadius: 13,
    padding: 12,
    minHeight: 46,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  goldBtn: {
    backgroundColor: '#FBE618',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  goldBtnText: {
    fontWeight: '800',
    fontSize: 13,
    color: '#0A0B0D',
  },
  secBtn: {
    backgroundColor: '#E8E6DE',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secBtnText: {
    fontWeight: '800',
    fontSize: 13,
    color: '#0A0B0D',
  },
  subPanel: {
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#DDDAD1',
  },
  stackChip: {
    backgroundColor: '#E8E6DE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  stackChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0A0B0D',
  },
  errBox: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FFE4E6',
  },
  commitRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    gap: 5,
  },
  shaPill: {
    backgroundColor: '#FBE618',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  shaPillText: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    color: '#0A0B0D',
  },
  commitWindowPill: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  commitWindowPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
  },
  autoWatchBanner: {
    borderRadius: 14,
    padding: 12,
    gap: 5,
    borderWidth: 1,
  },
  commitSourceBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
  },
  commitSourceScan: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },
  commitSourceWebhook: {
    backgroundColor: '#E0F2FE',
    borderColor: '#7DD3FC',
  },
  commitSourceAuto: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  commitSourceBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
