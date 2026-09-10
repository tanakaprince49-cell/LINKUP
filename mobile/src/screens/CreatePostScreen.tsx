import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, ImagePlus, Rocket, X } from 'lucide-react-native';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db } from '../lib/firebase';
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  increment,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { uploadCampaignLogoToImageKit, uploadImageToImageKit } from '../lib/imagekitUpload';
import { storedProfileImageUri } from '../lib/profilePerformance';
import { hasLinkupPro, getCurrentWeekKey } from '../lib/paywall';
import { normalizeWebsite } from '../lib/campaigns';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import PaywallModal from '../components/PaywallModal';

/** A post carries at most 3 extra photos; the logo is its own square image. */
const MAX_POST_MEDIA = 3;
/** Posting budget: free = 1 startup a week, PLUS = 10 a week. */
const WEEKLY_POST_LIMITS = { free: 1, plus: 10 };

export default function CreatePostScreen({ navigation }: any) {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isPlus = hasLinkupPro(profile);
  const limit = isPlus ? WEEKLY_POST_LIMITS.plus : WEEKLY_POST_LIMITS.free;

  const [startupName, setStartupName] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [media, setMedia] = useState<string[]>([]);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [loadingLimit, setLoadingLimit] = useState(true);
  const [weeklyUsed, setWeeklyUsed] = useState(0);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Count this member's startups posted this week. `authorWeek` is a single
  // equality query (uid::weekKey), so no composite index is required.
  useEffect(() => {
    if (!user?.uid) { setLoadingLimit(false); return; }
    let cancelled = false;
    (async () => {
      const week = getCurrentWeekKey();
      const q = query(collection(db, 'posts'), where('authorWeek', '==', `${user.uid}::${week}`));
      const snap = await getDocs(q).catch(() => null);
      if (cancelled) return;
      setWeeklyUsed(snap ? snap.size : 0);
      setLoadingLimit(false);
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  const pickLogo = async () => {
    if (uploadingLogo) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload your logo.');
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
      Alert.alert('Upload failed', 'Could not read that image. Try another one.');
      return;
    }
    setUploadingLogo(true);
    const hosted = await uploadCampaignLogoToImageKit(user?.uid || 'anonymous', `data:image/jpeg;base64,${asset.base64}`);
    setUploadingLogo(false);
    if (!hosted) {
      Alert.alert('Upload failed', 'The logo did not reach the CDN. Check your connection and try again.');
      return;
    }
    setLogoUrl(hosted);
  };

  const pickPhotos = async () => {
    if (media.length >= MAX_POST_MEDIA) {
      Alert.alert('Limit reached', `Max ${MAX_POST_MEDIA} photos per startup.`);
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'We need access to your photos to add them.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.3,
      base64: true,
    });
    if (result.canceled) return;
    const newMedia = result.assets.map((asset) =>
      asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri
    );
    setMedia((prev) => {
      const room = MAX_POST_MEDIA - prev.length;
      if (room <= 0) {
        Alert.alert('Limit reached', `Max ${MAX_POST_MEDIA} photos per startup.`);
        return prev;
      }
      const added = newMedia.slice(0, room);
      if (added.length < newMedia.length) {
        Alert.alert('Limit reached', `Max ${MAX_POST_MEDIA} photos per startup.`);
      }
      return [...prev, ...added];
    });
  };

  const canSubmit =
    startupName.trim().length >= 2 &&
    tagline.trim().length >= 8 &&
    normalizeWebsite(website).length > 8 &&
    !isPosting &&
    weeklyUsed < limit;

  const handlePost = async () => {
    if (!user || isPosting) return;
    if (weeklyUsed >= limit) {
      setPaywallOpen(true);
      return;
    }
    if (startupName.trim().length < 2) {
      Alert.alert('Almost there', 'Add your startup name.');
      return;
    }
    if (tagline.trim().length < 8) {
      Alert.alert('Almost there', 'Add a one-line description (a few words at least).');
      return;
    }
    const cleanWebsite = normalizeWebsite(website);
    if (!cleanWebsite) {
      Alert.alert('Almost there', 'Add the website link.');
      return;
    }

    setIsPosting(true);
    try {
      // HARD RULE: base64 never enters Firestore. Every image is pushed to the
      // ImageKit CDN first; failed uploads are dropped, the post still goes up.
      const stamp = Date.now();
      const hostedMedia = (
        await Promise.all(
          (media || []).map(async (item, index) => {
            if (typeof item !== 'string') return null;
            if (/^https?:\/\//i.test(item)) return item;
            if (item.startsWith('data:image')) {
              return uploadImageToImageKit(user.uid, item, {
                folder: '/linkup-posts',
                fileName: `${user.uid}-${stamp}-${index}.jpg`,
              });
            }
            return null;
          })
        )
      ).filter(Boolean) as string[];

      const week = getCurrentWeekKey();
      await addDoc(collection(db, 'posts'), {
        authorId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Builder',
        authorPic: storedProfileImageUri((profile as any)?.profilePicUrl || profile?.profilePic),
        authorVerified: !!profile?.isVerified,
        content: startupName.trim(),
        type: 'startup',
        startupName: startupName.trim().slice(0, 60),
        logoUrl: logoUrl.trim(),
        website: cleanWebsite,
        tagline: tagline.trim().slice(0, 90),
        description: description.trim().slice(0, 500),
        media: hostedMedia,
        weekKey: week,
        authorWeek: `${user.uid}::${week}`,
        timestamp: serverTimestamp(),
        likesCount: 0,
        dislikesCount: 0,
        commentsCount: 0,
        viewsCount: 0,
        likedBy: [],
        dislikedBy: [],
        viewedBy: [],
      });

      await updateDoc(doc(db, 'users', user.uid), {
        reputationScore: increment(10),
        lastActiveAt: serverTimestamp(),
      });

      navigation.goBack();
    } catch (err) {
      console.error('Failed to post:', err);
      Alert.alert('Error', 'Failed to upload media or post the startup.');
      setIsPosting(false);
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

  const remaining = Math.max(0, limit - weeklyUsed);

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[styles.headerBtn, { backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec }]}>
          <ChevronLeft size={22} color={textColor(isDark)} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>New Startup</Text>
          <Text style={styles.headerSub}>List your startup for founders</Text>
        </View>
        <TouchableOpacity
          onPress={handlePost}
          disabled={!canSubmit && !(weeklyUsed >= limit)}
          style={[styles.postBtn, { backgroundColor: COLORS.primary, opacity: canSubmit ? 1 : 0.4 }]}
        >
          {isPosting ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.postBtnText}>Post</Text>}
        </TouchableOpacity>
      </View>

      {loadingLimit ? (
        <View style={styles.center}>
          <ActivityIndicator color={textColor(isDark, 'muted')} />
        </View>
      ) : weeklyUsed >= limit ? (
        <View style={styles.limitWrap}>
          <Rocket size={44} color={textColor(isDark, 'secondary')} />
          <Text style={[styles.limitTitle, { color: textColor(isDark) }]}>
            {isPlus ? 'Weekly limit reached' : 'You have posted this week'}
          </Text>
          <Text style={[styles.limitSub, { color: textColor(isDark, 'secondary') }]}>
            {isPlus
              ? `PLUS allows ${WEEKLY_POST_LIMITS.plus} startups a week - come back next week for more.`
              : `The free plan allows ${WEEKLY_POST_LIMITS.free} startup a week. PLUS members can post ${WEEKLY_POST_LIMITS.plus} a week.`}
          </Text>
          {!isPlus && (
            <TouchableOpacity style={styles.upgradeBtn} onPress={() => setPaywallOpen(true)}>
              <Text style={styles.upgradeBtnText}>Go PLUS — $19.99/mo</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={[styles.backBtnText, { color: textColor(isDark, 'secondary') }]}>Back to Startups</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Section 1 — the startup */}
            <View style={styles.sectionHeader}>
              <View style={[styles.stepDot, { backgroundColor: COLORS.primary }]}>
                <Text style={styles.stepDotText}>1</Text>
              </View>
              <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>Your startup</Text>
            </View>

            {renderField('STARTUP NAME', startupName, setStartupName, 'e.g. InvoiceMate', { maxLength: 60 })}

            <Text style={[styles.label, { color: textColor(isDark, 'muted') }]}>LOGO</Text>
            <TouchableOpacity
              style={[styles.logoWrap, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}
              onPress={pickLogo}
              activeOpacity={0.8}
            >
              {uploadingLogo ? (
                <ActivityIndicator color={textColor(isDark, 'secondary')} />
              ) : logoUrl ? (
                <>
                  <Image source={{ uri: logoUrl }} style={styles.logoImg} />
                  <View style={styles.logoChangeBadge}>
                    <Text style={styles.logoChangeText}>Change</Text>
                  </View>
                </>
              ) : (
                <View style={styles.logoPlaceholder}>
                  <ImagePlus size={22} color={textColor(isDark, 'secondary')} />
                  <Text style={[styles.logoPlaceholderText, { color: textColor(isDark, 'secondary') }]}>Add logo</Text>
                </View>
              )}
            </TouchableOpacity>

            {renderField('WEBSITE', website, setWebsite, 'yourstartup.com', { maxLength: 120, keyboardType: 'url' })}
            {renderField('ONE-LINE DESCRIPTION', tagline, setTagline, 'One line that sells it — e.g. Invoices paid 2× faster', {
              maxLength: 90,
              hint: 'This is the headline under your startup name.',
            })}
            {renderField('FULL DESCRIPTION', description, setDescription, 'What does it do, who is it for?', {
              multiline: true,
              maxLength: 500,
            })}

            {/* Section 2 — photos */}
            <View style={styles.sectionHeader}>
              <View style={[styles.stepDot, { backgroundColor: COLORS.primary }]}>
                <Text style={styles.stepDotText}>2</Text>
              </View>
              <Text style={[styles.sectionTitle, { color: textColor(isDark) }]}>Photos (optional)</Text>
            </View>

            <View style={styles.mediaGrid}>
              {media.map((uri, i) => (
                <View key={i} style={styles.mediaItem}>
                  <Image source={{ uri }} style={styles.mediaImg} />
                  <TouchableOpacity style={styles.removeMedia} onPress={() => setMedia((prev) => prev.filter((_, idx) => idx !== i))}>
                    <X size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {media.length < MAX_POST_MEDIA && (
                <TouchableOpacity style={[styles.addMedia, liquidGlass(isDark), { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]} onPress={pickPhotos}>
                  <ImagePlus size={22} color={textColor(isDark, 'secondary')} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.hint, { color: textColor(isDark, 'muted') }]}>
              {media.length}/{MAX_POST_MEDIA} photos — screenshots, team, or the product.
            </Text>

            {/* Weekly budget */}
            <View style={[styles.budgetBar, liquidGlass(isDark)]}>
              <Text style={[styles.budgetText, { color: textColor(isDark, 'secondary') }]}>
                {isPlus ? 'PLUS' : 'Free plan'} · {weeklyUsed} of {limit} {limit === 1 ? 'startup' : 'startups'} posted this week
              </Text>
              {!isPlus && (
                <TouchableOpacity onPress={() => setPaywallOpen(true)}>
                  <Text style={styles.budgetUpgrade}>Go PLUS</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        feature="Startup posts"
        description={
          isPlus
            ? 'You have posted all 10 startups for this week. It resets next week.'
            : 'The free plan allows 1 startup a week. Upgrade to LINKUP PLUS — $19.99/month or $149.99/year — and post up to 10 startups a week.'
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
  },
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(17, 24, 39,0.19)',
  },
  headerTitle: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  headerSub: { fontSize: 11, color: '#888', fontWeight: '600', marginTop: 1 },
  postBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 14 },
  postBtnText: { fontWeight: '900', fontSize: 12, color: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 120 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 16 },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepDotText: { color: '#000', fontWeight: '900', fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  label: { fontSize: 11, fontWeight: '900', letterSpacing: 1, marginBottom: 6, marginTop: 14 },
  input: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontWeight: '500',
    borderWidth: 1,
  },
  inputMultiline: { minHeight: 110, paddingTop: 13 },
  hint: { fontSize: 11, marginTop: 6, fontWeight: '500' },
  logoWrap: {
    width: 96,
    height: 96,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  logoImg: { width: '100%', height: '100%' },
  logoChangeBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 3,
  },
  logoChangeText: { color: '#FFF', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  logoPlaceholder: { alignItems: 'center', gap: 6 },
  logoPlaceholderText: { fontSize: 11, fontWeight: '700' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  mediaItem: { position: 'relative' },
  mediaImg: { width: 96, height: 96, borderRadius: 16 },
  removeMedia: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMedia: {
    width: 96,
    height: 96,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  budgetBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginTop: 26,
  },
  budgetText: { fontSize: 12, fontWeight: '700' },
  budgetUpgrade: { fontSize: 12, fontWeight: '900', color: COLORS.primaryStrong },
  limitWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  limitTitle: { fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
  limitSub: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  upgradeBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14, marginTop: 6 },
  upgradeBtnText: { color: '#000', fontWeight: '900', fontSize: 13 },
  backBtn: { padding: 10, marginTop: 4 },
  backBtnText: { fontSize: 13, fontWeight: '700' },
});
