import React, { useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Globe, Package } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, RADIUS, liquidGlass, textColor } from '../theme/theme';
import { ikAvatar } from '../lib/ikImage';
import {
  Campaign,
  fetchActiveCampaignsForPlacement,
  recordCampaignClick,
  recordCampaignImpression,
} from '../lib/campaigns';

type Props = {
  campaign: Campaign;
  viewerUid?: string;
};

/**
 * One sponsored card: logo, product name, and what it does underneath.
 *
 * Every colour here is derived from the theme. The Discover card used to
 * hardcode `#FFFFFF` for the title, which made the product name invisible in
 * light mode — do not reintroduce literal colours.
 */
export function SponsoredCard({ campaign, viewerUid }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const creative = campaign.creative;
  const name = creative?.productName || creative?.title || campaign.name || 'Sponsored';
  const blurb = creative?.tagline || creative?.description || '';
  const logo = creative?.logoUrl || '';
  const website = creative?.website || '';

  const open = () => {
    void recordCampaignClick(campaign.id, viewerUid || '');
    if (website) Linking.openURL(website).catch(() => {});
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={open}
      style={[styles.card, liquidGlass(isDark)]}
    >
      <View style={styles.pill}>
        <Text style={styles.pillText}>SPONSORED</Text>
      </View>

      <View style={styles.body}>
        <View style={[styles.logoTile, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(10,11,13,0.06)' }]}>
          {logo ? (
            <Image source={{ uri: ikAvatar(logo) }} style={styles.logo} resizeMode="cover" />
          ) : (
            <Package size={22} color={isDark ? '#FFFFFF' : COLORS.inkButton} />
          )}
        </View>

        <View style={styles.copy}>
          <Text style={[styles.name, { color: textColor(isDark) }]} numberOfLines={2}>
            {name}
          </Text>
          {!!blurb && (
            <Text style={[styles.blurb, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
              {blurb}
            </Text>
          )}
          {!!website && (
            <View style={styles.ctaRow}>
              <Globe size={12} color={COLORS.primaryStrong} />
              <Text style={[styles.cta, { color: COLORS.primaryStrong }]} numberOfLines={1}>
                {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Fetch and show ONE campaign for a placement.
 *
 * Renders nothing when there is no paid inventory (rather than substituting a
 * house ad), so an empty slot stays empty instead of advertising to people
 * who are already paying us.
 *
 * @param enabled pass `false` for PLUS members — they never see campaigns.
 */
export function SponsoredSlot({
  placement,
  viewerUid,
  enabled = true,
}: {
  placement: string;
  viewerUid?: string;
  enabled?: boolean;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    if (!enabled || !viewerUid) {
      setCampaign(null);
      return;
    }
    let cancelled = false;
    fetchActiveCampaignsForPlacement(placement, 1)
      .then((list) => {
        if (cancelled) return;
        const pick = list.find((entry) => entry.ownerId !== viewerUid && entry.creative) || null;
        setCampaign(pick);
        if (pick) void recordCampaignImpression(pick.id, viewerUid);
      })
      .catch(() => setCampaign(null));
    return () => {
      cancelled = true;
    };
  }, [placement, viewerUid, enabled]);

  if (!campaign) return null;
  return <SponsoredCard campaign={campaign} viewerUid={viewerUid} />;
}

/** Hook form, for screens that need to weave the card into their own data. */
export function useSponsoredSlot(placement: string, viewerUid?: string, enabled = true) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    if (!enabled || !viewerUid) {
      setCampaign(null);
      return;
    }
    let cancelled = false;
    fetchActiveCampaignsForPlacement(placement, 1)
      .then((list) => {
        if (cancelled) return;
        const pick = list.find((entry) => entry.ownerId !== viewerUid && entry.creative) || null;
        setCampaign(pick);
        if (pick) void recordCampaignImpression(pick.id, viewerUid);
      })
      .catch(() => setCampaign(null));
    return () => {
      cancelled = true;
    };
  }, [placement, viewerUid, enabled]);

  return campaign;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: 'rgba(128,128,128,0.14)',
  },
  pillText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
    color: '#8A8A93',
  },
  body: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  logoTile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: '100%', height: '100%' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  blurb: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cta: { flex: 1, fontSize: 10, fontWeight: '800' },
});
