import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { builderCall } from '../lib/builder';
import { notifyUser } from '../lib/notify';
import { textColor } from '../theme/theme';

type Props = {
  navigation: any;
  isDark: boolean;
  mode?: 'full' | 'spliceOnly';
  onRefreshWorkspace?: () => void;
};

export default function VentureEnginePanel({ navigation, isDark, mode = 'full', onRefreshWorkspace }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<any>(null);
  const [repoInput, setRepoInput] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [manifestInput, setManifestInput] = useState('');
  const [showManifestBox, setShowManifestBox] = useState(false);
  const [showWebhookBox, setShowWebhookBox] = useState(false);
  const [spliced, setSpliced] = useState<any[]>([]);
  const [ventureName, setVentureName] = useState('');

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

          {showWebhookBox ? (
            <View style={[styles.subPanel, { backgroundColor: softBg }]}>
              <Text style={{ fontWeight: '800', fontSize: 13, color: ink }}>
                Zero-Login Builder League Webhook (GitHub & Cursor)
              </Text>
              <Text style={{ fontSize: 12, lineHeight: 18, color: sub }}>
                Add this Payload URL in GitHub → Settings → Webhooks (Push events) or drop the 1-line hook into .git/hooks/post-push. Every daily commit automatically logs +10 Builder League points. Stop shipping code and your streak breaks naturally.
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => void copyText('GitHub Webhook URL', status.webhookUrl)}
                  style={styles.goldBtn}
                >
                  <Text style={styles.goldBtnText}>Copy GitHub Webhook URL</Text>
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
            <View style={[styles.subPanel, { backgroundColor: softBg }]}>
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
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#9A6B00' }}>
                Missing Co-Founder Puzzle Pieces: {(diag.missingRoles || []).join(' · ')}
              </Text>
              <Text style={{ fontSize: 12, color: sub }}>
                Shipping Rhythm: {diag.codingStyle?.peakWindowUtc || 'Flexible Async'}
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
});
