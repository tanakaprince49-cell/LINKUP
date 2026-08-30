import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Globe,
  ImagePlus,
  LayoutGrid,
  Lightbulb,
  Megaphone,
  Package,
  Search,
  Send,
  Sparkles,
  X as XIcon,
  Zap,
} from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { displayNameFor } from '../lib/discovery';
import { notifyUser } from '../lib/notify';
import { uploadCampaignLogoToImageKit } from '../lib/imagekitUpload';
import { ikAvatar } from '../lib/ikImage';
import {
  CAMPAIGN_INDUSTRY_OPTIONS,
  CAMPAIGN_PLACEMENT_OPTIONS,
  Campaign,
  createCampaign,
  normalizeWebsite,
  updateCampaignCreative,
  websiteDisplay,
} from '../lib/campaigns';

const toggleValue = (values: string[], value: string) =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

const PLACEMENT_ICONS: Record<string, any> = {
  ideas: Lightbulb,
  search: Search,
  hub: LayoutGrid,
  linky: Sparkles,
  discover: Zap,
};

export default function CreateCampaignScreen({ navigation, route }: any) {
  const { user, profile: myProfile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const editCampaign: Campaign | null = route?.params?.editCampaign || null;
  const isEditing = !!editCampaign && editCampaign.status === 'pending_review';

  const [name, setName] = useState(editCampaign?.name || '');
  const [productName, setProductName] = useState(editCampaign?.creative?.productName || editCampaign?.creative?.title || '');
  const [tagline, setTagline] = useState(editCampaign?.creative?.tagline || editCampaign?.creative?.description || '');
  const [description, setDescription] = useState(editCampaign?.creative?.source === 'product' ? editCampaign?.creative?.description || '' : '');
  const [website, setWebsite] = useState(editCampaign?.creative?.website || '');
  const [category, setCategory] = useState<string[]>(
    editCampaign?.creative?.category?.length ? editCampaign.creative.category : editCampaign?.industries || []
  );
  const [placements, setPlacements] = useState<string[]>(editCampaign?.placements?.length ? editCampaign.placements : ['ideas']);
  const [logoUrl, setLogoUrl] = useState(editCampaign?.creative?.logoUrl || '');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const cleanWebsite = normalizeWebsite(website);
  const canSubmit =
    name.trim().length >= 3 &&
    productName.trim().length >= 2 &&
    tagline.trim().length >= 8 &&
    cleanWebsite.length > 8 &&
    placements.length > 0 &&
    !submitting;

  const openWebsitePreview = () => {
    if (cleanWebsite) Linking.openURL(cleanWebsite).catch(() => {});
  };

  const pickLogo = async () => {
    if (uploadingLogo) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      notifyUser('Permission needed', 'Allow photo access to upload your logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      notifyUser('Upload failed', 'Could not read that image. Try another one.');
      return;
    }
    setUploadingLogo(true);
    const hosted = await uploadCampaignLogoToImageKit(
      user?.uid || 'anonymous',
      `data:image/jpeg;base64,${asset.base64}`
    );
    setUploadingLogo(false);
    if (!hosted) {
      notifyUser('Upload failed', 'The logo did not reach the CDN. Check your connection and try again.');
      return;
    }
    setLogoUrl(hosted);
  };

  const submit = async () => {
    if (!user?.uid) {
      notifyUser('Sign in required', 'Please sign in before launching a campaign.');
      return;
    }
    if (!canSubmit) {
      notifyUser(
        'Almost there',
        'Add a campaign name, product name, a one-line tagline, the product website, and at least one placement.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const creativePayload = {
        source: 'product' as const,
        productName: productName.trim().slice(0, 60),
        tagline: tagline.trim().slice(0, 90),
        description: description.trim().slice(0, 500),
        website: cleanWebsite,
        logoUrl: logoUrl.trim(),
        category,
      };
      if (isEditing && editCampaign) {
        await updateCampaignCreative(editCampaign.id, {
          name: name.trim(),
          creative: creativePayload,
          industries: category,
          placements,
        });
        notifyUser('Changes saved ✔', 'Your campaign stays in the review queue with the updated creative.');
        navigation.goBack();
        return;
      }
      await createCampaign({
        ownerId: user.uid,
        ownerName: displayNameFor(myProfile || user),
        ownerPic: (myProfile as any)?.profilePic || user.photoURL || '',
        ownerOccupation: (myProfile as any)?.occupation || '',
        ownerCity: (myProfile as any)?.city || '',
        ownerCountry: (myProfile as any)?.country || '',
        ownerVerified: !!(myProfile as any)?.isVerified,
        name: name.trim(),
        creative: creativePayload,
        industries: category,
        placements,
      });
      notifyUser('Campaign submitted 🎉', 'Our team reviews every campaign by hand — yours goes live within 24 hours.');
      navigation.goBack();
    } catch (error: any) {
      notifyUser('Could not submit', error?.message || 'Please deploy the latest Firestore rules and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    opts: { multiline?: boolean; maxLength?: number; keyboardType?: any; hint?: string } = {}
  ) => (
    <View>
      <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={isDark ? '#55545E' : '#9CA3AF'}
        maxLength={opts.maxLength || 90}
        multiline={!!opts.multiline}
        keyboardType={opts.keyboardType || 'default'}
        autoCapitalize={opts.keyboardType === 'url' ? 'none' : 'sentences'}
        textAlignVertical={opts.multiline ? 'top' : 'center'}
        style={[
          styles.input,
          liquidGlass(isDark),
          opts.multiline && styles.inputMultiline,
          { color: textColor(isDark), borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
        ]}
      />
      {opts.hint ? <Text style={[styles.hint, { color: textColor(isDark, 'muted') }]}>{opts.hint}</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.headerBtn, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>{isEditing ? 'Edit Campaign' : 'New Campaign'}</Text>
          <Text style={styles.headerSub}>{isEditing ? 'Update while in review' : 'Advertise your product to founders'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Section 1 — identity */}
          <View style={styles.sectionHeader}>
            <View style={[styles.stepDot, { backgroundColor: COLORS.primary }]}>
              <Text style={styles.stepDotText}>1</Text>
            </View>
            <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>Your product</Text>
          </View>

          {renderField('CAMPAIGN NAME (PRIVATE)', name, setName, 'e.g. Launch week push', { maxLength: 60 })}
          {renderField('PRODUCT NAME', productName, setProductName, 'e.g. InvoiceMate', { maxLength: 60 })}
          {renderField('TAGLINE', tagline, setTagline, 'One line that sells it — e.g. Invoices paid 2× faster', {
            maxLength: 90,
            hint: 'This is the big text on your sponsored card.',
          })}
          {renderField('DESCRIPTION (OPTIONAL)', description, setDescription, 'What does it do, who is it for?', {
            multiline: true,
            maxLength: 500,
          })}
          {renderField('WEBSITE', website, setWebsite, 'yourproduct.com', {
            maxLength: 120,
            keyboardType: 'url',
          })}
          {cleanWebsite.length > 8 && (
            <TouchableOpacity onPress={openWebsitePreview} style={styles.linkPreview} activeOpacity={0.8}>
              <Globe size={14} color={COLORS.primaryStrong} />
              <Text style={[styles.linkPreviewText, { color: COLORS.primaryStrong }]}>{websiteDisplay(cleanWebsite)}</Text>
              <ExternalLink size={12} color={COLORS.primaryStrong} />
            </TouchableOpacity>
          )}

          <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>LOGO (OPTIONAL)</Text>
          <View style={styles.logoRow}>
            <TouchableOpacity
              onPress={pickLogo}
              disabled={uploadingLogo}
              activeOpacity={0.85}
              style={[
                styles.logoTile,
                liquidGlass(isDark),
                { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
              ]}
            >
              {uploadingLogo ? (
                <ActivityIndicator color={COLORS.primaryStrong} />
              ) : logoUrl ? (
                <Image source={{ uri: ikAvatar(logoUrl) }} style={styles.logoImage} resizeMode="cover" />
              ) : (
                <ImagePlus size={22} color={COLORS.primaryStrong} />
              )}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[styles.logoTitle, { color: textColor(isDark) }]}>
                {logoUrl ? 'Logo ready' : 'Add your logo'}
              </Text>
              <Text style={[styles.logoHint, { color: textColor(isDark, 'muted') }]}>
                {logoUrl
                  ? 'It appears on every sponsored card, search row and Linky mention.'
                  : 'Square works best. Without one we show a plain package icon.'}
              </Text>
              {logoUrl ? (
                <TouchableOpacity onPress={() => setLogoUrl('')} style={styles.logoRemove} activeOpacity={0.8}>
                  <XIcon size={11} color="#DC2626" />
                  <Text style={styles.logoRemoveText}>Remove logo</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>CATEGORY (UP TO 3)</Text>
          <View style={styles.chipRow}>
            {CAMPAIGN_INDUSTRY_OPTIONS.map((option) => {
              const active = category.includes(option);
              return (
                <TouchableOpacity
                  key={option}
                  onPress={() => {
                    if (!active && category.length >= 3) return;
                    setCategory((current) => toggleValue(current, option));
                  }}
                  style={[
                    styles.chip,
                    { backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard, borderColor: isDark ? COLORS.darkBorder : '#E5E7EB' },
                    active && styles.chipActive,
                  ]}
                >
                  <Text style={[styles.chipText, { color: textColor(isDark, 'secondary') }, active && styles.chipTextActive]}>{option}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Section 2 — placements */}
          <View style={styles.sectionHeader}>
            <View style={[styles.stepDot, { backgroundColor: COLORS.primary }]}>
              <Text style={styles.stepDotText}>2</Text>
            </View>
            <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>Where it shows</Text>
          </View>

          {CAMPAIGN_PLACEMENT_OPTIONS.map((option) => {
            const active = placements.includes(option.id);
            const Icon = PLACEMENT_ICONS[option.id] || Megaphone;
            return (
              <TouchableOpacity
                key={option.id}
                activeOpacity={option.available ? 0.85 : 1}
                disabled={!option.available}
                onPress={() => setPlacements((current) => toggleValue(current, option.id))}
                style={[
                  styles.placementRow,
                  liquidGlass(isDark),
                  { borderColor: active ? COLORS.primary : isDark ? COLORS.darkBorder : COLORS.lightBorder },
                  active && { borderWidth: 2 },
                  !option.available && { opacity: 0.5 },
                ]}
              >
                <View style={[styles.placementIcon, { backgroundColor: active ? COLORS.primary : isDark ? 'rgba(223,251,63,0.12)' : COLORS.primaryGlow }]}>
                  <Icon size={16} color={active ? COLORS.lightTextPrimary : COLORS.primaryStrong} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.placementLabel, { color: textColor(isDark) }]}>{option.label}</Text>
                  <Text style={[styles.placementDesc, { color: textColor(isDark, 'secondary') }]} numberOfLines={2}>
                    {option.desc}
                  </Text>
                </View>
                {option.available ? (
                  active ? (
                    <CheckCircle2 size={18} color={COLORS.primaryStrong} />
                  ) : (
                    <View style={[styles.checkGhost, { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]} />
                  )
                ) : (
                  <Text style={styles.soonBadge}>SOON</Text>
                )}
              </TouchableOpacity>
            );
          })}
          <Text style={[styles.hint, { color: textColor(isDark, 'muted') }]}>
            Sponsored placements are always labeled and PLUS members never see them.
          </Text>

          {/* Live preview */}
          <View style={styles.sectionHeader}>
            <View style={[styles.stepDot, { backgroundColor: COLORS.primary }]}>
              <Text style={styles.stepDotText}>3</Text>
            </View>
            <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>Preview</Text>
          </View>
          <View style={[styles.previewCard, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
            <View style={styles.previewHeader}>
              <View style={[styles.previewIcon, { backgroundColor: logoUrl ? 'rgba(0,0,0,0.04)' : COLORS.primary }]}>
                {logoUrl ? (
                  <Image source={{ uri: ikAvatar(logoUrl) }} style={styles.previewLogo} resizeMode="cover" />
                ) : (
                  <Package size={18} color={COLORS.lightTextPrimary} />
                )}
              </View>
              <View style={styles.sponsoredPill}>
                <Text style={styles.sponsoredPillText}>SPONSORED</Text>
              </View>
            </View>
            <Text style={[styles.previewTitle, { color: textColor(isDark) }]} numberOfLines={2}>
              {productName.trim() || 'Your Product'}
            </Text>
            <Text style={[styles.previewTagline, { color: textColor(isDark, 'secondary') }]} numberOfLines={3}>
              {tagline.trim() || 'Your one-line pitch shows up here, exactly as founders will read it.'}
            </Text>
            <View style={styles.previewCta}>
              <Globe size={13} color="#000" />
              <Text style={styles.previewCtaText}>{cleanWebsite.length > 8 ? websiteDisplay(cleanWebsite) : 'yourproduct.com'}</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={submit}
            disabled={!canSubmit}
            activeOpacity={0.86}
            style={[styles.submitBtn, { backgroundColor: COLORS.primary }, !canSubmit && styles.submitBtnDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={COLORS.lightTextPrimary} />
            ) : (
              <>
                <Send size={15} color={COLORS.lightTextPrimary} />
                <Text style={[styles.submitText, { color: COLORS.lightTextPrimary }]}>{isEditing ? 'SAVE CHANGES' : 'SUBMIT FOR REVIEW'}</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  headerBtn: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: 4 },
  headerSub: { marginTop: 4, color: '#666', fontSize: 10, fontWeight: '900' },
  scroll: { padding: 16, paddingTop: 6, paddingBottom: 48 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22, marginBottom: 12 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepDotText: { color: '#000', fontSize: 12, fontWeight: '900' },
  sectionTitle: { fontSize: 17, fontWeight: '900', letterSpacing: 0.4 },
  label: { marginTop: 14, marginBottom: 8, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 15,
    fontWeight: '800',
  },
  inputMultiline: { minHeight: 110, paddingTop: 14, lineHeight: 22 },
  hint: { marginTop: 8, fontSize: 10, fontWeight: '800', lineHeight: 15 },
  linkPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  linkPreviewText: { fontSize: 12, fontWeight: '900', textDecorationLine: 'underline' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipActive: { borderColor: COLORS.lightBorderActive, backgroundColor: COLORS.primary },
  chipText: { fontSize: 11, fontWeight: '900' },
  chipTextActive: { color: '#000' },
  placementRow: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  placementIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  placementLabel: { fontSize: 13, fontWeight: '900' },
  placementDesc: { marginTop: 2, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  checkGhost: { width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  soonBadge: { fontSize: 9, fontWeight: '900', letterSpacing: 1, color: '#8A7900' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logoTile: {
    width: 74,
    height: 74,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: { width: '100%', height: '100%' },
  logoTitle: { fontSize: 14, fontWeight: '900' },
  logoHint: { marginTop: 4, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  logoRemove: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  logoRemoveText: { color: '#DC2626', fontSize: 10, fontWeight: '900' },
  previewLogo: { width: '100%', height: '100%', borderRadius: 15 },
  previewCard: { borderWidth: 1, borderRadius: 24, padding: 18, gap: 10 },
  previewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sponsoredPill: { borderRadius: 999, backgroundColor: '#111217', paddingHorizontal: 12, paddingVertical: 6 },
  sponsoredPillText: { color: '#FFF', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  previewTitle: { marginTop: 6, fontSize: 24, lineHeight: 30, fontWeight: '900', textTransform: 'uppercase' },
  previewTagline: { fontSize: 14, lineHeight: 21, fontWeight: '700' },
  previewCta: {
    marginTop: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  previewCtaText: { color: '#000', fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },
  submitBtn: {
    marginTop: 22,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  submitBtnDisabled: { opacity: 0.55 },
  submitText: { fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
  unusedIcon: { opacity: 0 },
});
