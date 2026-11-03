import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  BarChart3,
  Bold,
  BookOpen,
  Clock,
  Code,
  Copy,
  Crop,
  ExternalLink,
  Eye,
  Globe,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  PenSquare,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Share2,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { COLORS, liquidGlass, textColor } from '../theme/theme';
import { AppImage } from '../components/AppImage';
import VerifiedBadge from '../components/VerifiedBadge';
import BlogCoverCropModal from '../components/BlogCoverCropModal';
import { SponsoredCard, useSponsoredSlots } from '../components/SponsoredCard';
import { Campaign, interleaveSponsored, isSponsoredHiddenForViewer } from '../lib/campaigns';
import PaywallModal from '../components/PaywallModal';
import { notifyUser } from '../lib/notify';
import { ikAvatar, ikCard } from '../lib/ikImage';
import {
  BlogLink,
  CommunityBlog,
  DEFAULT_BLOG_CATEGORIES,
  RawCoverAsset,
  applyToolbarFormat,
  canonicalBlogSlug,
  cropAndUploadBlogCover,
  defaultCoverAlt,
  deleteCommunityBlog,
  estimateReadTimeMinutes,
  extractBlogIdFromSlug,
  extractMarkdownLink,
  fetchCommunityBlogById,
  fetchCommunityBlogs,
  parseBlogBlocks,
  pickRawBlogCoverImage,
  publishCommunityBlog,
  sanitizeBlogUrl,
  trackCommunityBlogEvent,
} from '../lib/blogs';
import type {
  BlogSelection,
  InlineSegment,
  ToolbarFormatAction,
} from '../../../shared/blog-format';

const GOLD_MEMBER_UID = 'FvxIfciyHMfQZbLwziZpseMNKxC3';
const BLOGS_FIRST_AD_AFTER = 1;
const BLOGS_AD_EVERY = 3;

function initials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'B'
  );
}

function formatDateLabel(dateStr: string, createdAt: number) {
  const ms = createdAt || (dateStr ? Date.parse(dateStr) : 0);
  if (!ms || !Number.isFinite(ms)) return 'Just now';
  const diffMins = Math.floor((Date.now() - ms) / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Toolbar / highlight-bar button that prevents browser mousedown focus steal so
 * highlighted words inside the Body <TextInput> stay selected when clicked.
 */
function FormatToolButton({
  onPress,
  style,
  accessibilityLabel,
  children,
}: {
  onPress: () => void;
  style?: any;
  accessibilityLabel: string;
  children: React.ReactNode;
}) {
  const webPreventFocus: any =
    Platform.OS === 'web'
      ? {
          onMouseDown: (e: any) => e?.preventDefault?.(),
        }
      : {};

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [style, pressed && { opacity: 0.78 }]}
      {...webPreventFocus}
    >
      {children}
    </Pressable>
  );
}

function RichSegments({
  segments,
  isDark,
  baseStyle,
  onLinkPress,
}: {
  segments: InlineSegment[];
  isDark: boolean;
  baseStyle?: any;
  onLinkPress?: (url: string, label: string) => void;
}) {
  return (
    <Text style={baseStyle}>
      {segments.map((seg, idx) => {
        const decoration =
          seg.underline && seg.strike
            ? ('underline line-through' as const)
            : seg.underline
              ? ('underline' as const)
              : seg.strike
                ? ('line-through' as const)
                : undefined;

        const fontStyle = [
          seg.bold ? { fontWeight: '800' as const } : null,
          seg.italic ? { fontStyle: 'italic' as const } : null,
          decoration ? { textDecorationLine: decoration } : null,
          seg.highlight
            ? {
                backgroundColor: isDark ? 'rgba(251, 230, 24, 0.28)' : '#FEF08A',
                color: isDark ? '#FEF9C3' : '#0A0B0D',
              }
            : null,
          seg.code
            ? {
                fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                backgroundColor: isDark ? '#262B36' : '#ECEAE2',
                fontSize: 14,
              }
            : null,
        ];

        if (seg.type === 'link') {
          return (
            <Text
              key={idx}
              onPress={() => {
                onLinkPress?.(seg.url, seg.text);
                void Linking.openURL(seg.url).catch(() => {});
              }}
              accessibilityRole="link"
              style={[
                ...fontStyle,
                {
                  color: isDark ? '#FBE618' : '#0A58CA',
                  textDecorationLine: seg.strike ? 'underline line-through' : 'underline',
                  fontWeight: seg.bold ? '900' : '700',
                },
              ]}
            >
              {seg.text}
            </Text>
          );
        }
        return (
          <Text key={idx} style={fontStyle}>
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

function BlogRichBody({
  body,
  isDark,
  onLinkPress,
}: {
  body: string;
  isDark: boolean;
  onLinkPress?: (url: string, label: string) => void;
}) {
  const blocks = useMemo(() => parseBlogBlocks(body), [body]);
  const ink = textColor(isDark);
  const secondary = textColor(isDark, 'secondary');

  return (
    <View style={{ gap: 16 }}>
      {blocks.map((block, index) => {
        if (block.type === 'divider') {
          return (
            <View
              key={index}
              style={{
                height: 1,
                backgroundColor: isDark ? '#2E333E' : '#DEDBD2',
                marginVertical: 6,
              }}
            />
          );
        }
        if (block.type === 'codeblock') {
          return (
            <View
              key={index}
              style={[
                styles.readerCodeBlock,
                {
                  backgroundColor: isDark ? '#11141B' : '#181B22',
                  borderColor: isDark ? '#2C313D' : '#2C313D',
                },
              ]}
            >
              <Text style={styles.readerCodeBlockText}>{block.code}</Text>
            </View>
          );
        }
        if (block.type === 'h1') {
          return (
            <RichSegments
              key={index}
              segments={block.segments}
              isDark={isDark}
              baseStyle={[styles.readerH1, { color: ink }]}
              onLinkPress={onLinkPress}
            />
          );
        }
        if (block.type === 'h2') {
          return (
            <RichSegments
              key={index}
              segments={block.segments}
              isDark={isDark}
              baseStyle={[styles.readerH2, { color: ink }]}
              onLinkPress={onLinkPress}
            />
          );
        }
        if (block.type === 'h3') {
          return (
            <RichSegments
              key={index}
              segments={block.segments}
              isDark={isDark}
              baseStyle={[styles.readerH3, { color: ink }]}
              onLinkPress={onLinkPress}
            />
          );
        }
        if (block.type === 'quote') {
          return (
            <View
              key={index}
              style={[
                styles.readerQuote,
                {
                  backgroundColor: isDark ? 'rgba(251, 230, 24, 0.08)' : '#FAF8EB',
                  borderLeftColor: '#FBE618',
                },
              ]}
            >
              <RichSegments
                segments={block.segments}
                isDark={isDark}
                baseStyle={[styles.readerQuoteText, { color: ink }]}
                onLinkPress={onLinkPress}
              />
            </View>
          );
        }
        if (block.type === 'list') {
          return (
            <View key={index} style={{ gap: 8, paddingLeft: 4 }}>
              {block.items.map((itemSegs, itemIdx) => (
                <View key={itemIdx} style={styles.readerListItem}>
                  <Text style={[styles.readerBullet, { color: '#D4A000' }]}>•</Text>
                  <View style={{ flex: 1 }}>
                    <RichSegments
                      segments={itemSegs}
                      isDark={isDark}
                      baseStyle={[styles.readerParagraph, { color: secondary }]}
                      onLinkPress={onLinkPress}
                    />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        if (block.type === 'ordered') {
          return (
            <View key={index} style={{ gap: 8, paddingLeft: 4 }}>
              {block.items.map((itemSegs, itemIdx) => (
                <View key={itemIdx} style={styles.readerListItem}>
                  <Text style={[styles.readerOrderedNum, { color: '#D4A000' }]}>
                    {itemIdx + 1}.
                  </Text>
                  <View style={{ flex: 1 }}>
                    <RichSegments
                      segments={itemSegs}
                      isDark={isDark}
                      baseStyle={[styles.readerParagraph, { color: secondary }]}
                      onLinkPress={onLinkPress}
                    />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return (
          <RichSegments
            key={index}
            segments={block.segments}
            isDark={isDark}
            baseStyle={[styles.readerParagraph, { color: secondary }]}
            onLinkPress={onLinkPress}
          />
        );
      })}
    </View>
  );
}

function AuthorRow({
  authorId,
  authorName,
  authorHeadline,
  authorAvatar,
  authorVerified,
  authorIsGold,
  isDark,
  large = false,
  onPressProfile,
}: {
  authorId: string;
  authorName: string;
  authorHeadline?: string;
  authorAvatar?: string;
  authorVerified: boolean;
  authorIsGold?: boolean;
  isDark: boolean;
  large?: boolean;
  onPressProfile?: () => void;
}) {
  const ink = textColor(isDark);
  const muted = textColor(isDark, 'muted');
  const avatarSize = large ? 48 : 36;
  const tickColor = authorIsGold ? '#D4A000' : '#0A84FF';

  return (
    <TouchableOpacity
      activeOpacity={onPressProfile ? 0.8 : 1}
      disabled={!onPressProfile || !authorId}
      onPress={onPressProfile}
      style={styles.authorRow}
      accessibilityRole={onPressProfile ? 'button' : undefined}
    >
      {authorAvatar ? (
        <AppImage
          uri={ikAvatar(authorAvatar)}
          contentFit="cover"
          style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
        />
      ) : (
        <View
          style={[
            styles.avatarFallback,
            { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
          ]}
        >
          <Text style={[styles.avatarInitials, { fontSize: large ? 17 : 13 }]}>
            {initials(authorName)}
          </Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.authorNameLine}>
          <Text
            style={[styles.authorName, { color: ink, fontSize: large ? 16 : 14 }]}
            numberOfLines={1}
          >
            {authorName}
          </Text>
          {authorVerified ? (
            <>
              <VerifiedBadge
                size={large ? 19 : 16}
                color={tickColor}
                accessibilityLabel="Verified Author"
              />
              <View
                style={[
                  styles.verifiedAuthorPill,
                  {
                    backgroundColor: isDark ? 'rgba(10, 132, 255, 0.16)' : '#EFF6FF',
                    borderColor: authorIsGold ? '#D4A000' : '#93C5FD',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.verifiedAuthorText,
                    { color: authorIsGold ? '#9A6B00' : isDark ? '#93C5FD' : '#1D4ED8' },
                  ]}
                >
                  Verified Author
                </Text>
              </View>
            </>
          ) : null}
        </View>
        {authorHeadline ? (
          <Text style={{ fontSize: 12, color: muted }} numberOfLines={1}>
            {authorHeadline}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function BlogsScreen() {
  const navigation = useNavigation<any>();
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const isDark = theme === 'dark';
  const ink = textColor(isDark);
  const sub = textColor(isDark, 'secondary');
  const muted = textColor(isDark, 'muted');

  const [blogs, setBlogs] = useState<CommunityBlog[]>([]);
  const [defaultCategories, setDefaultCategories] = useState<string[]>(DEFAULT_BLOG_CATEGORIES);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // View modes: 'feed' | 'compose' | 'reader'
  const [screenMode, setScreenMode] = useState<'feed' | 'compose' | 'reader'>('feed');
  const [composeTab, setComposeTab] = useState<'edit' | 'preview'>('edit');
  const [activeBlog, setActiveBlog] = useState<CommunityBlog | null>(null);

  // Composer state + Cover Cropper + Cover Image SEO state
  const [title, setTitle] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [coverAlt, setCoverAlt] = useState('');
  const [showCoverUrlBox, setShowCoverUrlBox] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [pendingCoverAsset, setPendingCoverAsset] = useState<RawCoverAsset | null>(null);
  const [lastRawCoverAsset, setLastRawCoverAsset] = useState<RawCoverAsset | null>(null);

  const [readTimeInput, setReadTimeInput] = useState('3');
  const [readTimeTouched, setReadTimeTouched] = useState(false);
  const [chosenCategories, setChosenCategories] = useState<string[]>(['Startups']);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [localCustomCategories, setLocalCustomCategories] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [selection, setSelection] = useState<BlogSelection>({ start: 0, end: 0 });

  const bodyRef = useRef('');
  bodyRef.current = body;
  const bodyInputRef = useRef<TextInput | null>(null);
  const linkUrlInputRef = useRef<TextInput | null>(null);
  const lastActiveSelectionRef = useRef<BlogSelection>({ start: 0, end: 0 });
  const lockedLinkRangeRef = useRef<BlogSelection>({ start: 0, end: 0 });

  // Inline "Insert Link" popover state
  const [showInlineLinkBox, setShowInlineLinkBox] = useState(false);
  const [inlineLinkWords, setInlineLinkWords] = useState('');
  const [inlineLinkUrl, setInlineLinkUrl] = useState('');

  // Standalone links state
  const [links, setLinks] = useState<BlogLink[]>([]);
  const [extLinkLabel, setExtLinkLabel] = useState('');
  const [extLinkUrl, setExtLinkUrl] = useState('');

  const [publishing, setPublishing] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [composeError, setComposeError] = useState('');

  const viewerIsVerified = Boolean(
    (user?.uid && user.uid === GOLD_MEMBER_UID) ||
      (profile as any)?.isVerified === true ||
      (profile as any)?.isPro === true ||
      (profile as any)?.subscriptionStatus === 'active'
  );
  const viewerIsGold = Boolean(user?.uid && user.uid === GOLD_MEMBER_UID);
  const viewerName =
    (profile as any)?.displayName ||
    (profile as any)?.fullName ||
    (profile as any)?.name ||
    user?.displayName ||
    'You';
  const viewerAvatar =
    (profile as any)?.profilePicUrl ||
    (profile as any)?.photoURL ||
    (profile as any)?.profilePic ||
    user?.photoURL ||
    '';
  const viewerHeadline = (profile as any)?.occupation || (profile as any)?.company || '';

  const adsHidden = isSponsoredHiddenForViewer(profile, {
    email: user?.email,
    isAdmin: (profile as any)?.isAdmin,
  });

  const updateEditorSelection = useCallback((nextSel: BlogSelection) => {
    const clean = {
      start: Math.max(0, Number(nextSel?.start) || 0),
      end: Math.max(0, Number(nextSel?.end) || 0),
    };
    lastActiveSelectionRef.current = clean;
    setSelection((prev) =>
      prev.start === clean.start && prev.end === clean.end ? prev : clean
    );
  }, []);

  /**
   * Read live DOM selectionStart/selectionEnd on Web when available so double-clicks
   * and mouse-drag highlights are captured with zero lag before toolbar actions run.
   */
  const readCurrentSelection = useCallback((): BlogSelection => {
    if (Platform.OS === 'web') {
      const el: any = bodyInputRef.current;
      const doc: any = (globalThis as any).document;
      if (
        el &&
        typeof el.selectionStart === 'number' &&
        typeof el.selectionEnd === 'number' &&
        (!doc || doc.activeElement === el)
      ) {
        const domSel = { start: el.selectionStart, end: el.selectionEnd };
        lastActiveSelectionRef.current = domSel;
        return domSel;
      }
    }
    return lastActiveSelectionRef.current;
  }, []);

  const restoreEditorSelection = useCallback(
    (nextSel: BlogSelection) => {
      updateEditorSelection(nextSel);
      setTimeout(() => {
        const el: any = bodyInputRef.current;
        if (!el) return;
        try {
          el.focus?.();
          if (Platform.OS === 'web' && typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(nextSel.start, nextSel.end);
          } else if (typeof el.setNativeProps === 'function') {
            el.setNativeProps({ selection: nextSel });
          }
        } catch {
          // Ignore platform focus race
        }
      }, 25);
    },
    [updateEditorSelection]
  );

  // Sync mouse-drag / double-click / touch-handle word selection on Web <textarea>
  useEffect(() => {
    if (Platform.OS !== 'web' || screenMode !== 'compose' || composeTab !== 'edit') return;
    const el: any = bodyInputRef.current;
    const doc: any = (globalThis as any).document;
    if (!el || typeof el.addEventListener !== 'function') return;

    const syncFromDom = () => {
      if (doc && doc.activeElement !== el) return;
      if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
        updateEditorSelection({ start: el.selectionStart, end: el.selectionEnd });
      }
    };

    el.addEventListener('select', syncFromDom);
    el.addEventListener('mouseup', syncFromDom);
    el.addEventListener('keyup', syncFromDom);
    el.addEventListener('touchend', syncFromDom);
    return () => {
      el.removeEventListener('select', syncFromDom);
      el.removeEventListener('mouseup', syncFromDom);
      el.removeEventListener('keyup', syncFromDom);
      el.removeEventListener('touchend', syncFromDom);
    };
  }, [screenMode, composeTab, updateEditorSelection]);

  const loadBlogs = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchCommunityBlogs();
      setBlogs(data.blogs);
      setDefaultCategories(data.defaultCategories);
      setCustomCategories(data.customCategories);
    } catch (e: any) {
      notifyUser('Could not load blogs', e?.message || 'Please pull to refresh.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadBlogs();
  }, [loadBlogs, user?.uid]);

  const openBlogReader = useCallback(
    (blog: CommunityBlog, fromCard = false) => {
      setActiveBlog(blog);
      setScreenMode('reader');
      if (fromCard) {
        void trackCommunityBlogEvent(blog.id, 'card_click');
      }
      void trackCommunityBlogEvent(blog.id, 'view');
      const isAuthorOrAdmin = Boolean(
        user?.uid &&
          (user.uid === blog.authorId ||
            user.uid === GOLD_MEMBER_UID ||
            (profile as any)?.isAdmin)
      );
      if (isAuthorOrAdmin) {
        void fetchCommunityBlogById(blog.id).then((fresh) => {
          if (!fresh) return;
          setActiveBlog((curr) => (curr?.id === fresh.id ? fresh : curr));
          setBlogs((prev) => prev.map((b) => (b.id === fresh.id ? fresh : b)));
        });
      }
    },
    [user?.uid, profile]
  );

  // Support ?blog=<id|slug> deep-links from Google-indexed SSR pages
  const handledDeepLinkRef = useRef(false);
  useEffect(() => {
    if (handledDeepLinkRef.current || Platform.OS !== 'web') return;
    const loc = (globalThis as any).window?.location;
    if (!loc?.search) return;
    const param = new URLSearchParams(loc.search).get('blog') || '';
    const targetId = extractBlogIdFromSlug(param);
    if (!targetId) return;
    const found = blogs.find((b) => b.id === targetId);
    if (found) {
      handledDeepLinkRef.current = true;
      openBlogReader(found, false);
      return;
    }
    if (!loading) {
      handledDeepLinkRef.current = true;
      void fetchCommunityBlogById(targetId).then((fetched) => {
        if (fetched) openBlogReader(fetched, false);
      });
    }
  }, [blogs, loading, openBlogReader]);

  const copyCanonicalBlogUrl = useCallback(async (blog: CommunityBlog) => {
    const url =
      blog.seoUrl ||
      `https://www.linkupbuild.com/app/blogs/${encodeURIComponent(
        canonicalBlogSlug(blog.title, blog.id)
      )}`;
    try {
      await Clipboard.setStringAsync(url);
      notifyUser('SEO link copied', 'Google-indexed blog link copied to clipboard.');
    } catch {
      notifyUser('Blog link', url);
    }
  }, []);

  const allFilterCategories = useMemo(() => {
    const merged = ['All', ...defaultCategories];
    const lower = new Set(merged.map((c) => c.toLowerCase()));
    for (const c of [...customCategories, ...localCustomCategories]) {
      if (c && !lower.has(c.toLowerCase())) {
        lower.add(c.toLowerCase());
        merged.push(c);
      }
    }
    return merged;
  }, [defaultCategories, customCategories, localCustomCategories]);

  const allSelectableCategories = useMemo(
    () => allFilterCategories.filter((c) => c !== 'All'),
    [allFilterCategories]
  );

  const filteredBlogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return blogs.filter((b) => {
      const catOk =
        selectedCategory === 'All' ||
        b.categories.some((c) => c.toLowerCase() === selectedCategory.toLowerCase());
      if (!catOk) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.excerpt.toLowerCase().includes(q) ||
        b.authorName.toLowerCase().includes(q) ||
        b.categories.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [blogs, selectedCategory, searchQuery]);

  const adSlotCount = filteredBlogs.length
    ? 1 + Math.floor(Math.max(0, filteredBlogs.length - BLOGS_FIRST_AD_AFTER) / BLOGS_AD_EVERY)
    : 0;
  const sponsoredAds = useSponsoredSlots('news', user?.uid, adSlotCount, !adsHidden);

  type FeedItem =
    | { kind: 'row'; row: CommunityBlog }
    | { kind: 'ad'; ad: Campaign | null; slot: number };

  const feedData = useMemo<FeedItem[]>(() => {
    if (adsHidden || !adSlotCount) return filteredBlogs.map((row) => ({ kind: 'row', row }));
    const ads: Array<Campaign | null> = sponsoredAds.length
      ? sponsoredAds
      : Array.from({ length: adSlotCount }, () => null);
    return interleaveSponsored(filteredBlogs, ads, BLOGS_AD_EVERY, BLOGS_FIRST_AD_AFTER);
  }, [filteredBlogs, sponsoredAds, adsHidden, adSlotCount]);

  const resetComposer = () => {
    setTitle('');
    setCoverImage('');
    setCoverAlt('');
    setShowCoverUrlBox(false);
    setPendingCoverAsset(null);
    setLastRawCoverAsset(null);
    setCropModalOpen(false);
    setReadTimeInput('3');
    setReadTimeTouched(false);
    setChosenCategories(['Startups']);
    setNewCategoryInput('');
    setBody('');
    updateEditorSelection({ start: 0, end: 0 });
    lockedLinkRangeRef.current = { start: 0, end: 0 };
    setShowInlineLinkBox(false);
    setInlineLinkWords('');
    setInlineLinkUrl('');
    setLinks([]);
    setExtLinkLabel('');
    setExtLinkUrl('');
    setComposeError('');
    setComposeTab('edit');
  };

  const openComposer = () => {
    if (!user?.uid) {
      notifyUser('Sign in required', 'Sign in to LINKUP to write and publish a blog.');
      return;
    }
    setComposeError('');
    setComposeTab('edit');
    setScreenMode('compose');
  };

  const onChangeBody = (nextBody: string) => {
    setBody(nextBody);
    if (!readTimeTouched) {
      setReadTimeInput(String(estimateReadTimeMinutes(nextBody)));
    }
  };

  const triggerToolbar = (action: Exclude<ToolbarFormatAction, 'link'>) => {
    const activeSel = readCurrentSelection();
    const res = applyToolbarFormat(bodyRef.current, activeSel, action);
    onChangeBody(res.text);
    restoreEditorSelection(res.selection);
  };

  const openLinkInWordsBox = () => {
    const activeSel = readCurrentSelection();
    lockedLinkRangeRef.current = activeSel;
    const rawSlice = bodyRef.current.slice(activeSel.start, activeSel.end);
    const existingLink = extractMarkdownLink(rawSlice);
    if (existingLink) {
      setInlineLinkWords(existingLink.label);
      setInlineLinkUrl(existingLink.url);
    } else {
      setInlineLinkWords(rawSlice.trim());
      setInlineLinkUrl('');
    }
    setComposeError('');
    setShowInlineLinkBox(true);
    setTimeout(() => {
      linkUrlInputRef.current?.focus?.();
    }, 45);
  };

  const insertLinkInWords = () => {
    const safe = sanitizeBlogUrl(inlineLinkUrl);
    if (!safe) {
      setComposeError('Enter a valid URL (for example https://linkupbuild.com).');
      return;
    }
    const targetRange = lockedLinkRangeRef.current;
    const fallbackSelected = bodyRef.current.slice(targetRange.start, targetRange.end).trim();
    const res = applyToolbarFormat(bodyRef.current, targetRange, 'link', {
      label: inlineLinkWords.trim() || fallbackSelected || 'link',
      url: safe,
    });
    onChangeBody(res.text);
    setShowInlineLinkBox(false);
    setInlineLinkWords('');
    setInlineLinkUrl('');
    setComposeError('');
    restoreEditorSelection(res.selection);
  };

  const addStandaloneLink = () => {
    const safe = sanitizeBlogUrl(extLinkUrl);
    if (!safe) {
      setComposeError('Enter a valid HTTPS link before adding.');
      return;
    }
    const label = extLinkLabel.trim() || safe.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
    setLinks((prev) => [...prev.slice(0, 7), { label, url: safe }]);
    setExtLinkLabel('');
    setExtLinkUrl('');
    setComposeError('');
  };

  const toggleCategory = (cat: string) => {
    setChosenCategories((prev) => {
      const exists = prev.some((c) => c.toLowerCase() === cat.toLowerCase());
      if (exists) {
        return prev.length > 1 ? prev.filter((c) => c.toLowerCase() !== cat.toLowerCase()) : prev;
      }
      if (prev.length >= 6) return prev;
      return [...prev, cat];
    });
  };

  const addCustomCategory = () => {
    const cleaned = newCategoryInput.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!cleaned) return;
    if (!allSelectableCategories.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      setLocalCustomCategories((prev) => [...prev, cleaned]);
    }
    setChosenCategories((prev) => {
      if (prev.some((c) => c.toLowerCase() === cleaned.toLowerCase())) return prev;
      return [...prev.slice(0, 5), cleaned];
    });
    setNewCategoryInput('');
  };

  // Step 1: Pick image -> open user-controlled interactive Crop Modal
  const handlePickCoverForCrop = async () => {
    if (!user?.uid || uploadingCover) return;
    setComposeError('');
    try {
      const picked = await pickRawBlogCoverImage();
      if (picked) {
        setPendingCoverAsset(picked);
        setCropModalOpen(true);
      }
    } catch (e: any) {
      setComposeError(e?.message || 'Could not select cover image.');
    }
  };

  // Re-open Crop Modal for the already selected image so user can re-adjust anytime
  const handleReCropExistingCover = () => {
    if (!lastRawCoverAsset || uploadingCover) return;
    setPendingCoverAsset(lastRawCoverAsset);
    setCropModalOpen(true);
  };

  // Step 2: Apply user's pan/zoom/fit crop -> upload 1280x720 16:9 image to ImageKit
  const handleConfirmCoverCrop = async (cropParams: {
    mode: 'fill' | 'fit';
    stageW: number;
    stageH: number;
    zoom: number;
    panX: number;
    panY: number;
  }) => {
    if (!user?.uid || !pendingCoverAsset || uploadingCover) return;
    setUploadingCover(true);
    setComposeError('');
    try {
      const uploaded = await cropAndUploadBlogCover(user.uid, pendingCoverAsset, cropParams);
      setCoverImage(uploaded);
      setLastRawCoverAsset(pendingCoverAsset);
      setPendingCoverAsset(null);
      setCropModalOpen(false);
      setShowCoverUrlBox(false);
    } catch (e: any) {
      setComposeError(e?.message || 'Could not upload cropped cover image.');
    } finally {
      setUploadingCover(false);
    }
  };

  const handlePublish = async () => {
    if (publishing) return;
    setComposeError('');
    if (title.trim().length < 4) {
      setComposeError('Give your blog a title of at least 4 characters.');
      return;
    }
    if (body.trim().length < 15) {
      setComposeError('Write at least 15 characters in the body of your blog.');
      return;
    }
    if (coverImage.trim() && !sanitizeBlogUrl(coverImage.trim())) {
      setComposeError('Enter a valid HTTPS cover image URL or upload a photo.');
      return;
    }
    const mins = Math.max(1, Math.min(60, Number(readTimeInput) || estimateReadTimeMinutes(body)));
    setPublishing(true);
    try {
      const created = await publishCommunityBlog({
        title: title.trim(),
        body: body.trim(),
        coverImage: coverImage.trim(),
        coverAlt: coverAlt.trim(),
        readTimeMinutes: mins,
        categories: chosenCategories,
        links,
      });
      setBlogs((prev) => [created, ...prev.filter((b) => b.id !== created.id)]);
      resetComposer();
      setActiveBlog(created);
      setScreenMode('reader');
      notifyUser(
        'Blog published & indexed',
        'Your blog is live on LINKUP and ready for Google Search, Google News & Google Images.'
      );
    } catch (e: any) {
      setComposeError(e?.message || 'Could not publish blog.');
    } finally {
      setPublishing(false);
    }
  };

  const confirmDelete = (blog: CommunityBlog) => {
    const runDelete = async () => {
      setDeletingId(blog.id);
      try {
        await deleteCommunityBlog(blog.id);
        setBlogs((prev) => prev.filter((b) => b.id !== blog.id));
        if (activeBlog?.id === blog.id) {
          setActiveBlog(null);
          setScreenMode('feed');
        }
        notifyUser('Blog deleted', 'Your blog was removed.');
      } catch (e: any) {
        notifyUser('Delete failed', e?.message || 'Could not delete blog.');
      } finally {
        setDeletingId('');
      }
    };

    if (Platform.OS === 'web') {
      if ((globalThis as any).confirm?.(`Delete "${blog.title}" permanently?`)) {
        void runDelete();
      }
    } else {
      Alert.alert('Delete blog', `Permanently delete "${blog.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void runDelete() },
      ]);
    }
  };

  // ============================================================================
  // READER VIEW — Full Article with 16:9 Cover + Profile Pic + Verified Author
  // ============================================================================
  if (screenMode === 'reader' && activeBlog) {
    const canDelete = Boolean(
      user?.uid &&
        (user.uid === activeBlog.authorId ||
          user.uid === GOLD_MEMBER_UID ||
          (profile as any)?.isAdmin)
    );
    const canonicalSeoUrl =
      activeBlog.seoUrl ||
      `https://www.linkupbuild.com/app/blogs/${encodeURIComponent(
        canonicalBlogSlug(activeBlog.title, activeBlog.id)
      )}`;
    const stats = activeBlog.authorStats || {
      views: 0,
      uniqueViews: 0,
      cardClicks: 0,
      linkClicks: 0,
      totalClicks: 0,
      linkBreakdown: [],
    };
    const handleReaderLinkPress = (url: string, label: string) => {
      void trackCommunityBlogEvent(activeBlog.id, 'link_click', { url, label });
    };

    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}
      >
        <View
          style={[
            styles.topActionHeader,
            { borderBottomColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
          ]}
        >
          <TouchableOpacity
            onPress={() => {
              setActiveBlog(null);
              setScreenMode('feed');
            }}
            style={styles.backBtn}
            accessibilityRole="button"
          >
            <ArrowLeft size={18} color={ink} />
            <Text style={{ fontWeight: '800', fontSize: 14, color: ink }}>All Blogs</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={() => void copyCanonicalBlogUrl(activeBlog)}
              style={styles.secondarySmallBtn}
              accessibilityRole="button"
              accessibilityLabel="Copy Google SEO blog link"
            >
              <Share2 size={14} color="#0A0B0D" />
              <Text style={styles.secondarySmallBtnText}>Share Link</Text>
            </TouchableOpacity>

            {canDelete ? (
              <TouchableOpacity
                onPress={() => confirmDelete(activeBlog)}
                disabled={deletingId === activeBlog.id}
                style={styles.deleteBtn}
                accessibilityRole="button"
              >
                <Trash2 size={15} color="#DC2626" />
                <Text style={styles.deleteBtnText}>
                  {deletingId === activeBlog.id ? 'Deleting…' : 'Delete Blog'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.articleContainer}>
          {activeBlog.coverImage ? (
            <View style={styles.coverFrame16x9}>
              <AppImage
                uri={ikCard(activeBlog.coverImage)}
                style={styles.coverImageFill}
                contentFit="cover"
                accessibilityLabel={
                  activeBlog.coverAlt ||
                  defaultCoverAlt(activeBlog.title, activeBlog.authorName, activeBlog.categories)
                }
              />
            </View>
          ) : null}

          <View style={styles.metaRow}>
            {activeBlog.categories.map((cat) => (
              <View key={cat} style={styles.catBadge}>
                <Text style={styles.catBadgeText}>{cat}</Text>
              </View>
            ))}
            <View style={styles.readTimePill}>
              <Clock size={13} color={sub} />
              <Text style={[styles.readTimeText, { color: sub }]}>
                {activeBlog.readTimeMinutes} min read
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: muted }}>
              {formatDateLabel(activeBlog.publishedAt, activeBlog.createdAt)}
            </Text>
          </View>

          <Text style={[styles.readerTitle, { color: ink }]}>{activeBlog.title}</Text>

          <View
            style={[
              styles.authorCardBox,
              {
                backgroundColor: isDark ? '#171A21' : '#F8F7F2',
                borderColor: isDark ? '#2E323B' : '#E5E2D9',
              },
            ]}
          >
            <AuthorRow
              authorId={activeBlog.authorId}
              authorName={activeBlog.authorName}
              authorHeadline={activeBlog.authorHeadline}
              authorAvatar={activeBlog.authorAvatar}
              authorVerified={activeBlog.authorVerified}
              authorIsGold={activeBlog.authorIsGold}
              isDark={isDark}
              large
              onPressProfile={() => navigation.navigate('Profile', { userId: activeBlog.authorId })}
            />
          </View>

          {/* Author-Only Views, Clicks & Google SEO Dashboard */}
          {canDelete ? (
            <View
              style={[
                styles.authorAnalyticsPanel,
                {
                  backgroundColor: isDark ? '#151923' : '#FAF8EE',
                  borderColor: isDark ? '#3B4252' : '#E6DD9C',
                },
              ]}
            >
              <View style={styles.authorAnalyticsHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <BarChart3 size={16} color={isDark ? '#FBE618' : '#854D0E'} />
                  <Text style={{ fontWeight: '900', fontSize: 14, color: ink }}>
                    Author Analytics (Visible only to you)
                  </Text>
                </View>
                <View style={styles.googleIndexedPill}>
                  <Globe size={12} color="#166534" />
                  <Text style={styles.googleIndexedPillText}>Google Search & News Indexed</Text>
                </View>
              </View>

              <View style={styles.statsGrid}>
                <View
                  style={[
                    styles.statTile,
                    { backgroundColor: isDark ? '#1E2330' : '#FFFFFF', borderColor: isDark ? '#2F3646' : '#E5E2D6' },
                  ]}
                >
                  <Text style={[styles.statTileValue, { color: ink }]}>{stats.views}</Text>
                  <Text style={[styles.statTileLabel, { color: sub }]}>Blog Views</Text>
                </View>
                <View
                  style={[
                    styles.statTile,
                    { backgroundColor: isDark ? '#1E2330' : '#FFFFFF', borderColor: isDark ? '#2F3646' : '#E5E2D6' },
                  ]}
                >
                  <Text style={[styles.statTileValue, { color: ink }]}>{stats.uniqueViews}</Text>
                  <Text style={[styles.statTileLabel, { color: sub }]}>Unique Readers</Text>
                </View>
                <View
                  style={[
                    styles.statTile,
                    { backgroundColor: isDark ? '#1E2330' : '#FFFFFF', borderColor: isDark ? '#2F3646' : '#E5E2D6' },
                  ]}
                >
                  <Text style={[styles.statTileValue, { color: ink }]}>{stats.totalClicks}</Text>
                  <Text style={[styles.statTileLabel, { color: sub }]}>Total Clicks</Text>
                </View>
                <View
                  style={[
                    styles.statTile,
                    { backgroundColor: isDark ? '#1E2330' : '#FFFFFF', borderColor: isDark ? '#2F3646' : '#E5E2D6' },
                  ]}
                >
                  <Text style={[styles.statTileValue, { color: ink }]}>{stats.linkClicks}</Text>
                  <Text style={[styles.statTileLabel, { color: sub }]}>Link Clicks</Text>
                </View>
              </View>

              {stats.linkBreakdown.length > 0 ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: sub }}>
                    Clicked Links Inside Your Blog
                  </Text>
                  {stats.linkBreakdown.slice(0, 6).map((item, i) => (
                    <View
                      key={`${item.url}-${i}`}
                      style={[
                        styles.linkStatRow,
                        { backgroundColor: isDark ? '#1E2330' : '#FFFFFF' },
                      ]}
                    >
                      <Link2 size={13} color={isDark ? '#FBE618' : '#0A58CA'} />
                      <Text
                        style={{ flex: 1, fontSize: 12, fontWeight: '700', color: ink }}
                        numberOfLines={1}
                      >
                        {item.label || item.url}
                      </Text>
                      <Text style={{ fontSize: 12, fontWeight: '900', color: isDark ? '#FBE618' : '#854D0E' }}>
                        {item.clicks} {item.clicks === 1 ? 'click' : 'clicks'}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View
                style={[
                  styles.seoUrlRow,
                  {
                    backgroundColor: isDark ? '#1E2330' : '#FFFFFF',
                    borderColor: isDark ? '#2F3646' : '#E5E2D6',
                  },
                ]}
              >
                <Globe size={14} color={muted} />
                <Text style={{ flex: 1, fontSize: 12, color: sub }} numberOfLines={1}>
                  {canonicalSeoUrl}
                </Text>
                <TouchableOpacity
                  onPress={() => void copyCanonicalBlogUrl(activeBlog)}
                  style={styles.copySeoBtn}
                  accessibilityRole="button"
                >
                  <Copy size={12} color="#0A0B0D" />
                  <Text style={{ fontSize: 11, fontWeight: '900', color: '#0A0B0D' }}>
                    Copy SEO URL
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void Linking.openURL(canonicalSeoUrl).catch(() => {})}
                  style={styles.openSeoIconBtn}
                  accessibilityRole="link"
                  accessibilityLabel="Open public Google-indexed blog page"
                >
                  <ExternalLink size={13} color={ink} />
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <BlogRichBody
            body={activeBlog.body}
            isDark={isDark}
            onLinkPress={handleReaderLinkPress}
          />

          {activeBlog.links.length > 0 ? (
            <View
              style={[
                styles.linksSection,
                {
                  backgroundColor: isDark ? '#171A21' : '#F8F7F2',
                  borderColor: isDark ? '#2E323B' : '#E5E2D9',
                },
              ]}
            >
              <Text style={{ fontWeight: '900', fontSize: 14, color: ink }}>
                Referenced Links
              </Text>
              {activeBlog.links.map((lnk, idx) => (
                <TouchableOpacity
                  key={`${lnk.url}-${idx}`}
                  onPress={() => {
                    handleReaderLinkPress(lnk.url, lnk.label);
                    void Linking.openURL(lnk.url).catch(() => {});
                  }}
                  style={styles.attachedLinkRow}
                  accessibilityRole="link"
                >
                  <Link2 size={15} color={isDark ? '#FBE618' : '#0A58CA'} />
                  <Text
                    style={{
                      flex: 1,
                      fontWeight: '700',
                      fontSize: 14,
                      color: isDark ? '#FBE618' : '#0A58CA',
                      textDecorationLine: 'underline',
                    }}
                    numberOfLines={1}
                  >
                    {lnk.label}
                  </Text>
                  <ExternalLink size={14} color={muted} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ============================================================================
  // COMPOSER VIEW — User Cover Cropper + Highlight Word -> Insert Link & Formats
  // ============================================================================
  if (screenMode === 'compose') {
    const previewReadMins = Math.max(
      1,
      Math.min(60, Number(readTimeInput) || estimateReadTimeMinutes(body))
    );
    const cardBg = isDark ? '#171A21' : '#FFFFFF';
    const borderCol = isDark ? '#323640' : '#DDDAD1';
    const inputBg = isDark ? '#222630' : '#F4F3EE';

    const rawHighlighted =
      selection.end > selection.start ? body.slice(selection.start, selection.end) : '';
    const trimmedHighlighted = rawHighlighted.trim();
    const hasWordHighlighted = trimmedHighlighted.length > 0;
    const highlightedPreview =
      trimmedHighlighted.length > 36
        ? `${trimmedHighlighted.slice(0, 35)}…`
        : trimmedHighlighted;

    const webBodyKeyboardShortcuts: any =
      Platform.OS === 'web'
        ? {
            onKeyDown: (e: any) => {
              const mod = e?.metaKey || e?.ctrlKey;
              if (!mod) return;
              const k = String(e.key || '').toLowerCase();
              if (k === 'k') {
                e.preventDefault?.();
                openLinkInWordsBox();
              } else if (k === 'b') {
                e.preventDefault?.();
                triggerToolbar('bold');
              } else if (k === 'i') {
                e.preventDefault?.();
                triggerToolbar('italic');
              } else if (k === 'u') {
                e.preventDefault?.();
                triggerToolbar('underline');
              }
            },
          }
        : {};

    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}
      >
        <View style={[styles.topActionHeader, { borderBottomColor: borderCol }]}>
          <TouchableOpacity
            onPress={() => setScreenMode('feed')}
            style={styles.backBtn}
            accessibilityRole="button"
          >
            <ArrowLeft size={18} color={ink} />
            <Text style={{ fontWeight: '800', fontSize: 14, color: ink }}>Back to Blogs</Text>
          </TouchableOpacity>

          <View style={styles.modeSwitchWrap}>
            <TouchableOpacity
              onPress={() => setComposeTab('edit')}
              style={[styles.modeSwitchBtn, composeTab === 'edit' && styles.modeSwitchActive]}
              accessibilityRole="button"
            >
              <PenSquare size={14} color={composeTab === 'edit' ? '#0A0B0D' : muted} />
              <Text
                style={{
                  fontWeight: '800',
                  fontSize: 13,
                  color: composeTab === 'edit' ? '#0A0B0D' : muted,
                }}
              >
                Write
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setComposeTab('preview')}
              style={[styles.modeSwitchBtn, composeTab === 'preview' && styles.modeSwitchActive]}
              accessibilityRole="button"
            >
              <Eye size={14} color={composeTab === 'preview' ? '#0A0B0D' : muted} />
              <Text
                style={{
                  fontWeight: '800',
                  fontSize: 13,
                  color: composeTab === 'preview' ? '#0A0B0D' : muted,
                }}
              >
                Preview
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.articleContainer}
          keyboardShouldPersistTaps="always"
        >
          {composeError ? (
            <View style={styles.errorBanner}>
              <Text style={{ color: '#9F1239', fontWeight: '700', fontSize: 13 }}>
                {composeError}
              </Text>
            </View>
          ) : null}

          {composeTab === 'edit' ? (
            <View style={{ gap: 16 }}>
              {/* 1. Cover Page with User Interactive 16:9 Cropper */}
              <View style={[styles.editorCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                <Text style={[styles.fieldLabel, { color: ink }]}>Cover Page (Optional · 16:9)</Text>
                <Text style={{ fontSize: 12, color: muted }}>
                  Upload any photo and crop, drag, zoom, or fit the full picture yourself so it displays cleanly across phones and desktops.
                </Text>

                {coverImage && sanitizeBlogUrl(coverImage) ? (
                  <View style={{ gap: 10 }}>
                    <View style={styles.coverFrame16x9}>
                      <AppImage
                        uri={ikCard(sanitizeBlogUrl(coverImage))}
                        style={styles.coverImageFill}
                        contentFit="cover"
                      />
                    </View>
                    <View style={styles.rowWrap}>
                      {lastRawCoverAsset ? (
                        <TouchableOpacity
                          onPress={handleReCropExistingCover}
                          disabled={uploadingCover}
                          style={styles.goldActionBtn}
                          accessibilityRole="button"
                        >
                          <Crop size={15} color="#0A0B0D" />
                          <Text style={styles.goldActionBtnText}>Adjust / Re-Crop Cover</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        onPress={() => {
                          setCoverImage('');
                          setLastRawCoverAsset(null);
                        }}
                        style={styles.secondarySmallBtn}
                      >
                        <Text style={styles.secondarySmallBtnText}>Remove Cover Page</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                <View style={styles.rowWrap}>
                  <TouchableOpacity
                    onPress={() => void handlePickCoverForCrop()}
                    disabled={uploadingCover}
                    style={styles.goldActionBtn}
                    accessibilityRole="button"
                  >
                    <ImagePlus size={16} color="#0A0B0D" />
                    <Text style={styles.goldActionBtnText}>
                      {uploadingCover
                        ? 'Uploading Cropped Cover…'
                        : coverImage
                          ? 'Choose & Crop Another Photo'
                          : 'Upload & Crop Cover Image'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setShowCoverUrlBox((v) => !v)}
                    style={styles.secondarySmallBtn}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondarySmallBtnText}>
                      {showCoverUrlBox ? 'Hide URL Input' : 'Paste Cover Image URL'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {showCoverUrlBox ? (
                  <TextInput
                    value={coverImage}
                    onChangeText={(v) => {
                      setCoverImage(v);
                      setLastRawCoverAsset(null);
                    }}
                    placeholder="https://images.example.com/cover.jpg"
                    placeholderTextColor={muted}
                    autoCapitalize="none"
                    style={[
                      styles.textInput,
                      { backgroundColor: inputBg, color: ink, borderColor: borderCol },
                    ]}
                  />
                ) : null}

                {coverImage ? (
                  <View style={{ gap: 5, marginTop: 4 }}>
                    <Text style={[styles.fieldLabel, { color: ink, fontSize: 13 }]}>
                      Cover Picture SEO Description / Alt Text (Google Images & Google News)
                    </Text>
                    <TextInput
                      value={coverAlt}
                      onChangeText={setCoverAlt}
                      maxLength={180}
                      placeholder={defaultCoverAlt(title || 'Your blog', viewerName, chosenCategories)}
                      placeholderTextColor={muted}
                      style={[
                        styles.textInput,
                        { backgroundColor: inputBg, color: ink, borderColor: borderCol, fontSize: 13 },
                      ]}
                    />
                    <Text style={{ fontSize: 11, color: muted }}>
                      Helps your blog cover photo rank in Google Images & Google News Top Stories (auto-generated if left blank).
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* 2. Title & Read Time */}
              <View style={[styles.editorCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                <Text style={[styles.fieldLabel, { color: ink }]}>Blog Title</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  maxLength={140}
                  placeholder="Write a clear, compelling title…"
                  placeholderTextColor={muted}
                  style={[
                    styles.textInput,
                    {
                      backgroundColor: inputBg,
                      color: ink,
                      borderColor: borderCol,
                      fontSize: 17,
                      fontWeight: '700',
                    },
                  ]}
                />

                <View style={[styles.rowWrap, { justifyContent: 'space-between', marginTop: 6 }]}>
                  <View style={{ flex: 1, minWidth: 160 }}>
                    <Text style={[styles.fieldLabel, { color: ink }]}>Read Time (minutes)</Text>
                    <TextInput
                      value={readTimeInput}
                      onChangeText={(v) => {
                        setReadTimeTouched(true);
                        setReadTimeInput(v.replace(/[^0-9]/g, '').slice(0, 2));
                      }}
                      keyboardType="number-pad"
                      placeholder="5"
                      placeholderTextColor={muted}
                      style={[
                        styles.textInput,
                        { backgroundColor: inputBg, color: ink, borderColor: borderCol },
                      ]}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setReadTimeTouched(false);
                      setReadTimeInput(String(estimateReadTimeMinutes(body)));
                    }}
                    style={[
                      styles.secondarySmallBtn,
                      { alignSelf: 'flex-end', height: 46, justifyContent: 'center' },
                    ]}
                  >
                    <Text style={styles.secondarySmallBtnText}>Auto-Calculate Read Time</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 3. Default + Custom Categories */}
              <View style={[styles.editorCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                <Text style={[styles.fieldLabel, { color: ink }]}>
                  Categories (Pick defaults or add your own)
                </Text>
                <View style={styles.rowWrap}>
                  {allSelectableCategories.map((cat) => {
                    const active = chosenCategories.some(
                      (c) => c.toLowerCase() === cat.toLowerCase()
                    );
                    return (
                      <TouchableOpacity
                        key={cat}
                        onPress={() => toggleCategory(cat)}
                        style={[styles.catSelectChip, active && styles.catSelectChipActive]}
                        accessibilityRole="button"
                      >
                        <Text
                          style={{
                            fontWeight: '700',
                            fontSize: 13,
                            color: '#0A0B0D',
                          }}
                        >
                          {active ? `✓ ${cat}` : cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.rowWrap}>
                  <TextInput
                    value={newCategoryInput}
                    onChangeText={setNewCategoryInput}
                    maxLength={32}
                    placeholder="Add your own category (e.g. Fintech, Climate)…"
                    placeholderTextColor={muted}
                    onSubmitEditing={addCustomCategory}
                    style={[
                      styles.textInput,
                      {
                        flex: 1,
                        minWidth: 190,
                        backgroundColor: inputBg,
                        color: ink,
                        borderColor: borderCol,
                      },
                    ]}
                  />
                  <TouchableOpacity
                    onPress={addCustomCategory}
                    style={styles.goldActionBtn}
                    accessibilityRole="button"
                  >
                    <Plus size={16} color="#0A0B0D" />
                    <Text style={styles.goldActionBtnText}>Add Category</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 4. Body of the Blog + Selection Menu + Rich Formatting Toolbar */}
              <View style={[styles.editorCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                <Text style={[styles.fieldLabel, { color: ink }]}>Body of the Blog</Text>
                <Text style={{ fontSize: 12, color: muted }}>
                  Highlight any word or sentence below to insert a clickable link directly on that word or apply rich text formatting.
                </Text>

                {/* Persistent Rich Formatting Toolbar */}
                <View style={[styles.toolbar, { backgroundColor: inputBg, borderColor: borderCol }]}>
                  <FormatToolButton
                    onPress={openLinkInWordsBox}
                    style={[styles.toolBtn, styles.toolBtnHighlight]}
                    accessibilityLabel="Insert Link"
                  >
                    <Link2 size={15} color="#0A0B0D" />
                    <Text style={[styles.toolBtnLabel, { color: '#0A0B0D', fontWeight: '900' }]}>
                      Insert Link
                    </Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('bold')}
                    style={styles.toolBtn}
                    accessibilityLabel="Bold"
                  >
                    <Bold size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink, fontWeight: '900' }]}>B</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('italic')}
                    style={styles.toolBtn}
                    accessibilityLabel="Italic"
                  >
                    <Italic size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink, fontStyle: 'italic' }]}>
                      I
                    </Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('underline')}
                    style={styles.toolBtn}
                    accessibilityLabel="Underline"
                  >
                    <Underline size={15} color={ink} />
                    <Text
                      style={[
                        styles.toolBtnLabel,
                        { color: ink, textDecorationLine: 'underline' },
                      ]}
                    >
                      U
                    </Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('strike')}
                    style={styles.toolBtn}
                    accessibilityLabel="Strikethrough"
                  >
                    <Strikethrough size={15} color={ink} />
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('highlight')}
                    style={styles.toolBtn}
                    accessibilityLabel="Highlight text"
                  >
                    <Highlighter size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink }]}>Highlight</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('h1')}
                    style={styles.toolBtn}
                    accessibilityLabel="Heading 1"
                  >
                    <Text style={[styles.toolBtnLabel, { color: ink, fontWeight: '900' }]}>H1</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('h2')}
                    style={styles.toolBtn}
                    accessibilityLabel="Heading 2"
                  >
                    <Text style={[styles.toolBtnLabel, { color: ink, fontWeight: '900' }]}>H2</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('h3')}
                    style={styles.toolBtn}
                    accessibilityLabel="Heading 3"
                  >
                    <Text style={[styles.toolBtnLabel, { color: ink, fontWeight: '900' }]}>H3</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('quote')}
                    style={styles.toolBtn}
                    accessibilityLabel="Blockquote"
                  >
                    <Quote size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink }]}>Quote</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('list')}
                    style={styles.toolBtn}
                    accessibilityLabel="Bulleted list"
                  >
                    <List size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink }]}>Bullets</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('ordered')}
                    style={styles.toolBtn}
                    accessibilityLabel="Numbered list"
                  >
                    <ListOrdered size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink }]}>1. List</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('code')}
                    style={styles.toolBtn}
                    accessibilityLabel="Inline code"
                  >
                    <Code size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink }]}>Code</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('codeblock')}
                    style={styles.toolBtn}
                    accessibilityLabel="Code block"
                  >
                    <Text style={[styles.toolBtnLabel, { color: ink }]}>{'{ } Block'}</Text>
                  </FormatToolButton>

                  <FormatToolButton
                    onPress={() => triggerToolbar('divider')}
                    style={styles.toolBtn}
                    accessibilityLabel="Divider line"
                  >
                    <Minus size={15} color={ink} />
                    <Text style={[styles.toolBtnLabel, { color: ink }]}>Divider</Text>
                  </FormatToolButton>
                </View>

                {/* Contextual Selection Bar — appears automatically when any word is highlighted */}
                {hasWordHighlighted && !showInlineLinkBox ? (
                  <View style={styles.selectionFloatingBar}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                      <Text style={styles.selectionBarBadge} numberOfLines={1}>
                        Selected: “{highlightedPreview}”
                      </Text>
                    </View>
                    <View style={styles.selectionBarActions}>
                      <FormatToolButton
                        onPress={openLinkInWordsBox}
                        style={styles.selectionLinkCta}
                        accessibilityLabel="Insert link on highlighted word"
                      >
                        <Link2 size={14} color="#0A0B0D" />
                        <Text style={styles.selectionLinkCtaText}>Insert Link</Text>
                      </FormatToolButton>

                      <FormatToolButton
                        onPress={() => triggerToolbar('bold')}
                        style={styles.selectionQuickBtn}
                        accessibilityLabel="Bold highlighted word"
                      >
                        <Text style={styles.selectionQuickBtnText}>B</Text>
                      </FormatToolButton>

                      <FormatToolButton
                        onPress={() => triggerToolbar('italic')}
                        style={styles.selectionQuickBtn}
                        accessibilityLabel="Italicize highlighted word"
                      >
                        <Text style={[styles.selectionQuickBtnText, { fontStyle: 'italic' }]}>
                          I
                        </Text>
                      </FormatToolButton>

                      <FormatToolButton
                        onPress={() => triggerToolbar('underline')}
                        style={styles.selectionQuickBtn}
                        accessibilityLabel="Underline highlighted word"
                      >
                        <Text
                          style={[
                            styles.selectionQuickBtnText,
                            { textDecorationLine: 'underline' },
                          ]}
                        >
                          U
                        </Text>
                      </FormatToolButton>

                      <FormatToolButton
                        onPress={() => triggerToolbar('highlight')}
                        style={styles.selectionQuickBtn}
                        accessibilityLabel="Highlight selected word"
                      >
                        <Highlighter size={13} color="#F9FAFB" />
                      </FormatToolButton>

                      <FormatToolButton
                        onPress={() => triggerToolbar('h2')}
                        style={styles.selectionQuickBtn}
                        accessibilityLabel="Turn into H2 heading"
                      >
                        <Text style={styles.selectionQuickBtnText}>H2</Text>
                      </FormatToolButton>

                      <FormatToolButton
                        onPress={() => triggerToolbar('quote')}
                        style={styles.selectionQuickBtn}
                        accessibilityLabel="Quote selected text"
                      >
                        <Quote size={13} color="#F9FAFB" />
                      </FormatToolButton>
                    </View>
                  </View>
                ) : null}

                {/* Insert Link Popover — locks onto the exact highlighted word range */}
                {showInlineLinkBox ? (
                  <View
                    style={[
                      styles.inlineLinkCard,
                      {
                        backgroundColor: isDark ? '#1E2330' : '#FFFDF2',
                        borderColor: '#FBE618',
                      },
                    ]}
                  >
                    <View style={[styles.rowWrap, { justifyContent: 'space-between' }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Link2 size={15} color={ink} />
                        <Text style={{ fontWeight: '900', fontSize: 13, color: ink }}>
                          {lockedLinkRangeRef.current.end > lockedLinkRangeRef.current.start
                            ? 'Turn Highlighted Text Into a Link'
                            : 'Insert Clickable Link in Text'}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => setShowInlineLinkBox(false)}>
                        <X size={16} color={muted} />
                      </TouchableOpacity>
                    </View>

                    <TextInput
                      value={inlineLinkWords}
                      onChangeText={setInlineLinkWords}
                      placeholder="Clickable words (e.g. our live launch)"
                      placeholderTextColor={muted}
                      style={[
                        styles.textInput,
                        { backgroundColor: cardBg, color: ink, borderColor: borderCol },
                      ]}
                    />
                    <TextInput
                      ref={linkUrlInputRef}
                      value={inlineLinkUrl}
                      onChangeText={setInlineLinkUrl}
                      onSubmitEditing={insertLinkInWords}
                      placeholder="Paste or type URL (e.g. https://linkupbuild.com)"
                      placeholderTextColor={muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      returnKeyType="done"
                      style={[
                        styles.textInput,
                        { backgroundColor: cardBg, color: ink, borderColor: borderCol },
                      ]}
                    />
                    <View style={styles.rowWrap}>
                      <TouchableOpacity onPress={insertLinkInWords} style={styles.goldActionBtn}>
                        <Link2 size={15} color="#0A0B0D" />
                        <Text style={styles.goldActionBtnText}>Insert Link</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setShowInlineLinkBox(false)}
                        style={styles.secondarySmallBtn}
                      >
                        <Text style={styles.secondarySmallBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                <TextInput
                  ref={bodyInputRef}
                  value={body}
                  onChangeText={onChangeBody}
                  onSelectionChange={(e) => updateEditorSelection(e.nativeEvent.selection)}
                  multiline
                  placeholder="Write your blog here… Highlight any word and click Insert Link (or Ctrl+K) to turn that word into a clickable link."
                  placeholderTextColor={muted}
                  style={[
                    styles.bodyInput,
                    { backgroundColor: inputBg, color: ink, borderColor: borderCol },
                  ]}
                  {...webBodyKeyboardShortcuts}
                />
              </View>

              {/* 5. Standalone Resource Links */}
              <View style={[styles.editorCard, { backgroundColor: cardBg, borderColor: borderCol }]}>
                <Text style={[styles.fieldLabel, { color: ink }]}>Attached Links (Optional)</Text>
                {links.map((lnk, idx) => (
                  <View key={`${lnk.url}-${idx}`} style={styles.attachedLinkRow}>
                    <Link2 size={14} color={ink} />
                    <Text
                      style={{ flex: 1, fontSize: 13, fontWeight: '700', color: ink }}
                      numberOfLines={1}
                    >
                      {lnk.label} — {lnk.url}
                    </Text>
                    <TouchableOpacity
                      onPress={() => setLinks((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <X size={16} color="#DC2626" />
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.rowWrap}>
                  <TextInput
                    value={extLinkLabel}
                    onChangeText={setExtLinkLabel}
                    placeholder="Link label (e.g. Product Website)"
                    placeholderTextColor={muted}
                    style={[
                      styles.textInput,
                      {
                        flex: 1,
                        minWidth: 140,
                        backgroundColor: inputBg,
                        color: ink,
                        borderColor: borderCol,
                      },
                    ]}
                  />
                  <TextInput
                    value={extLinkUrl}
                    onChangeText={setExtLinkUrl}
                    placeholder="https://…"
                    placeholderTextColor={muted}
                    autoCapitalize="none"
                    style={[
                      styles.textInput,
                      {
                        flex: 1,
                        minWidth: 160,
                        backgroundColor: inputBg,
                        color: ink,
                        borderColor: borderCol,
                      },
                    ]}
                  />
                  <TouchableOpacity onPress={addStandaloneLink} style={styles.secondarySmallBtn}>
                    <Text style={styles.secondarySmallBtnText}>+ Add Link</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Composer Actions */}
              <View style={styles.rowWrap}>
                <TouchableOpacity
                  onPress={() => setComposeTab('preview')}
                  style={[styles.secondaryLargeBtn, { flex: 1 }]}
                  accessibilityRole="button"
                >
                  <Eye size={17} color="#0A0B0D" />
                  <Text style={styles.secondaryLargeBtnText}>Preview Before Publishing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void handlePublish()}
                  disabled={publishing}
                  style={[styles.publishBtn, { flex: 1 }, publishing && { opacity: 0.6 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.publishBtnText}>
                    {publishing ? 'Publishing…' : 'Publish Blog'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            /* PREVIEW BEFORE PUBLISHING MODE */
            <View style={{ gap: 18 }}>
              <View style={styles.previewNotice}>
                <Eye size={16} color="#9A6B00" />
                <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: '#78350F' }}>
                  Article Preview — This is how everyone on LINKUP will see your blog once published.
                </Text>
              </View>

              {coverImage && sanitizeBlogUrl(coverImage) ? (
                <View style={styles.coverFrame16x9}>
                  <AppImage
                    uri={ikCard(sanitizeBlogUrl(coverImage))}
                    style={styles.coverImageFill}
                    contentFit="cover"
                  />
                </View>
              ) : null}

              <View style={styles.metaRow}>
                {chosenCategories.map((cat) => (
                  <View key={cat} style={styles.catBadge}>
                    <Text style={styles.catBadgeText}>{cat}</Text>
                  </View>
                ))}
                <View style={styles.readTimePill}>
                  <Clock size={13} color={sub} />
                  <Text style={[styles.readTimeText, { color: sub }]}>
                    {previewReadMins} min read
                  </Text>
                </View>
              </View>

              <Text style={[styles.readerTitle, { color: ink }]}>
                {title.trim() || 'Untitled Blog Post'}
              </Text>

              <View
                style={[styles.authorCardBox, { backgroundColor: cardBg, borderColor: borderCol }]}
              >
                <AuthorRow
                  authorId={user?.uid || ''}
                  authorName={viewerName}
                  authorHeadline={viewerHeadline}
                  authorAvatar={viewerAvatar}
                  authorVerified={viewerIsVerified}
                  authorIsGold={viewerIsGold}
                  isDark={isDark}
                  large
                />
              </View>

              {body.trim() ? (
                <BlogRichBody body={body} isDark={isDark} />
              ) : (
                <Text style={{ fontSize: 15, color: muted, fontStyle: 'italic' }}>
                  Your formatted blog body will appear here…
                </Text>
              )}

              {links.length > 0 ? (
                <View
                  style={[styles.linksSection, { backgroundColor: cardBg, borderColor: borderCol }]}
                >
                  <Text style={{ fontWeight: '900', fontSize: 14, color: ink }}>
                    Referenced Links
                  </Text>
                  {links.map((lnk, idx) => (
                    <TouchableOpacity
                      key={`${lnk.url}-${idx}`}
                      onPress={() => void Linking.openURL(lnk.url).catch(() => {})}
                      style={styles.attachedLinkRow}
                    >
                      <Link2 size={15} color={isDark ? '#FBE618' : '#0A58CA'} />
                      <Text
                        style={{
                          flex: 1,
                          fontWeight: '700',
                          fontSize: 14,
                          color: isDark ? '#FBE618' : '#0A58CA',
                          textDecorationLine: 'underline',
                        }}
                      >
                        {lnk.label}
                      </Text>
                      <ExternalLink size={14} color={muted} />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              <View style={styles.rowWrap}>
                <TouchableOpacity
                  onPress={() => setComposeTab('edit')}
                  style={[styles.secondaryLargeBtn, { flex: 1 }]}
                  accessibilityRole="button"
                >
                  <PenSquare size={16} color="#0A0B0D" />
                  <Text style={styles.secondaryLargeBtnText}>Continue Editing</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void handlePublish()}
                  disabled={publishing}
                  style={[styles.publishBtn, { flex: 1 }, publishing && { opacity: 0.6 }]}
                  accessibilityRole="button"
                >
                  <Text style={styles.publishBtnText}>
                    {publishing ? 'Publishing…' : 'Publish Blog Now'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>

        <BlogCoverCropModal
          visible={cropModalOpen}
          asset={pendingCoverAsset}
          saving={uploadingCover}
          isDark={isDark}
          onCancel={() => {
            if (uploadingCover) return;
            setCropModalOpen(false);
            setPendingCoverAsset(null);
          }}
          onConfirm={(params) => void handleConfirmCoverCrop(params)}
        />
      </SafeAreaView>
    );
  }

  // ============================================================================
  // PUBLIC BLOGS FEED VIEW — Seen by everyone
  // ============================================================================
  const renderBlogCard = (blog: CommunityBlog) => {
    const isOwner = Boolean(
      user?.uid &&
        (user.uid === blog.authorId ||
          user.uid === GOLD_MEMBER_UID ||
          (profile as any)?.isAdmin)
    );
    const ownerStats = isOwner ? blog.authorStats : undefined;
    return (
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => openBlogReader(blog, true)}
        style={[styles.card, liquidGlass(isDark)]}
        accessibilityRole="button"
      >
        {blog.coverImage ? (
          <View style={styles.cardCoverFrame16x9}>
            <AppImage
              uri={ikCard(blog.coverImage)}
              style={styles.coverImageFill}
              contentFit="cover"
              accessibilityLabel={
                blog.coverAlt || defaultCoverAlt(blog.title, blog.authorName, blog.categories)
              }
            />
          </View>
        ) : null}

        <View style={styles.cardBody}>
          <View style={styles.metaRow}>
            {blog.categories.slice(0, 3).map((cat) => (
              <View key={cat} style={styles.catBadge}>
                <Text style={styles.catBadgeText}>{cat}</Text>
              </View>
            ))}
            <View style={styles.readTimePill}>
              <Clock size={12} color={muted} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: muted }}>
                {blog.readTimeMinutes} min read
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: muted, marginLeft: 'auto' }}>
              {formatDateLabel(blog.publishedAt, blog.createdAt)}
            </Text>
          </View>

          <Text style={[styles.cardTitle, { color: ink }]} numberOfLines={2}>
            {blog.title}
          </Text>

          {blog.excerpt ? (
            <Text style={[styles.cardExcerpt, { color: sub }]} numberOfLines={3}>
              {blog.excerpt}
            </Text>
          ) : null}

          {/* Author-Only Views & Clicks Pill Bar on Feed Card */}
          {isOwner && ownerStats ? (
            <View
              style={[
                styles.cardAuthorStatsBar,
                {
                  backgroundColor: isDark ? 'rgba(251, 230, 24, 0.10)' : '#FAF7E6',
                  borderColor: isDark ? 'rgba(251, 230, 24, 0.28)' : '#EAE09B',
                },
              ]}
            >
              <View style={styles.cardStatMetric}>
                <Eye size={13} color={isDark ? '#FBE618' : '#854D0E'} />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '800',
                    color: isDark ? '#FEF9C3' : '#171918',
                  }}
                >
                  {ownerStats.views} {ownerStats.views === 1 ? 'view' : 'views'}
                </Text>
              </View>
              <View style={styles.cardStatMetric}>
                <MousePointerClick size={13} color={isDark ? '#FBE618' : '#854D0E'} />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '800',
                    color: isDark ? '#FEF9C3' : '#171918',
                  }}
                >
                  {ownerStats.totalClicks} {ownerStats.totalClicks === 1 ? 'click' : 'clicks'}
                </Text>
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: muted, marginLeft: 'auto' }}>
                Only you see this
              </Text>
            </View>
          ) : null}

          <View style={[styles.cardFooter, { borderTopColor: isDark ? '#2A2E37' : '#ECEAE2' }]}>
            <View style={{ flex: 1 }}>
              <AuthorRow
                authorId={blog.authorId}
                authorName={blog.authorName}
                authorAvatar={blog.authorAvatar}
                authorVerified={blog.authorVerified}
                authorIsGold={blog.authorIsGold}
                isDark={isDark}
                onPressProfile={() => navigation.navigate('Profile', { userId: blog.authorId })}
              />
            </View>

            {isOwner ? (
              <TouchableOpacity
                onPress={() => confirmDelete(blog)}
                disabled={deletingId === blog.id}
                style={styles.cardDeleteIconBtn}
                accessibilityRole="button"
                accessibilityLabel="Delete blog"
              >
                <Trash2 size={16} color="#DC2626" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderFeedItem = ({ item }: { item: FeedItem }) => {
    if (item.kind === 'ad') {
      return item.ad ? <SponsoredCard campaign={item.ad} viewerUid={user?.uid} /> : null;
    }
    return renderBlogCard(item.row);
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg }]}
    >
      <View style={styles.feedTopControls}>
        <View style={styles.headerBannerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.feedHeading, { color: ink }]}>Community Blogs</Text>
            <Text style={{ fontSize: 13, color: sub }}>
              Essays, playbooks, and lessons written by builders on LINKUP.
            </Text>
          </View>
          <TouchableOpacity
            onPress={openComposer}
            style={styles.writeCtaBtn}
            accessibilityRole="button"
          >
            <PenSquare size={16} color="#0A0B0D" />
            <Text style={styles.writeCtaText}>Write Blog</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: isDark ? '#1A1D24' : '#F2F1EC',
              borderColor: isDark ? '#2E323C' : '#E2DFD5',
            },
          ]}
        >
          <Search size={16} color={muted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search blogs by topic, title, or author…"
            placeholderTextColor={muted}
            style={[styles.searchInput, { color: ink }]}
          />
          <TouchableOpacity onPress={() => void loadBlogs(true)} disabled={refreshing}>
            <RefreshCw size={16} color={COLORS.primaryStrong} />
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          {allFilterCategories.map((cat) => {
            const active = selectedCategory.toLowerCase() === cat.toLowerCase();
            return (
              <TouchableOpacity
                key={cat}
                onPress={() => setSelectedCategory(cat)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active
                      ? COLORS.primary
                      : isDark
                        ? '#1E222B'
                        : '#ECEAE2',
                  },
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: active ? '#0A0B0D' : sub,
                  }}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primaryStrong} style={{ marginTop: 72 }} />
      ) : (
        <FlatList
          data={feedData}
          keyExtractor={(item, idx) =>
            item.kind === 'ad' ? `ad-${item.slot}-${item.ad?.id || idx}` : item.row.id
          }
          renderItem={renderFeedItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadBlogs(true)}
              tintColor={COLORS.primaryStrong}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <BookOpen size={36} color={muted} />
              <Text style={[styles.emptyTitle, { color: ink }]}>
                {selectedCategory === 'All' && !searchQuery.trim()
                  ? 'Be the first to publish a blog on LINKUP'
                  : 'No blogs match this filter yet'}
              </Text>
              <Text style={{ fontSize: 14, color: sub, textAlign: 'center', lineHeight: 20 }}>
                Share what you are building, engineering deep-dives, or founder lessons with the community.
              </Text>
              <TouchableOpacity onPress={openComposer} style={styles.writeCtaBtn}>
                <PenSquare size={16} color="#0A0B0D" />
                <Text style={styles.writeCtaText}>Write the First Blog</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  feedTopControls: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 10,
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
  },
  headerBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  feedHeading: {
    fontSize: 22,
    fontWeight: '900',
  },
  writeCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FBE618',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 999,
  },
  writeCtaText: {
    fontWeight: '900',
    fontSize: 13,
    color: '#0A0B0D',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: 42,
  },
  filterContent: {
    gap: 8,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 16,
    maxWidth: 860,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  cardCoverFrame16x9: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#111318',
    overflow: 'hidden',
  },
  coverFrame16x9: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 18,
    backgroundColor: '#111318',
    overflow: 'hidden',
  },
  coverImageFill: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    padding: 16,
    gap: 10,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  catBadge: {
    backgroundColor: '#FBE618',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  catBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0A0B0D',
  },
  readTimePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  readTimeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 25,
  },
  cardExcerpt: {
    fontSize: 14,
    lineHeight: 21,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 12,
    marginTop: 2,
    borderTopWidth: 1,
  },
  cardDeleteIconBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarFallback: {
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontWeight: '900',
    color: '#0A0B0D',
  },
  authorNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  authorName: {
    fontWeight: '800',
  },
  verifiedAuthorPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  verifiedAuthorText: {
    fontSize: 11,
    fontWeight: '800',
  },
  emptyBox: {
    paddingVertical: 56,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  topActionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
  },
  deleteBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B91C1C',
  },
  articleContainer: {
    padding: 18,
    paddingBottom: 48,
    gap: 16,
    maxWidth: 780,
    width: '100%',
    alignSelf: 'center',
  },
  readerTitle: {
    fontSize: 28,
    lineHeight: 35,
    fontWeight: '900',
  },
  authorCardBox: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  readerH1: {
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '900',
    marginTop: 10,
  },
  readerH2: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '900',
    marginTop: 8,
  },
  readerH3: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '800',
    marginTop: 6,
  },
  readerParagraph: {
    fontSize: 16,
    lineHeight: 26,
  },
  readerQuote: {
    borderLeftWidth: 4,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  readerQuoteText: {
    fontSize: 16,
    lineHeight: 25,
    fontStyle: 'italic',
  },
  readerCodeBlock: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  readerCodeBlockText: {
    color: '#F3F4F6',
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  readerListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  readerBullet: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '900',
  },
  readerOrderedNum: {
    fontSize: 15,
    lineHeight: 26,
    fontWeight: '900',
    minWidth: 20,
  },
  linksSection: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    marginTop: 8,
  },
  attachedLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  modeSwitchWrap: {
    flexDirection: 'row',
    backgroundColor: '#E8E6DE',
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  modeSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  modeSwitchActive: {
    backgroundColor: '#FBE618',
  },
  editorCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
    minHeight: 45,
  },
  bodyInput: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    minHeight: 240,
    fontSize: 15,
    lineHeight: 23,
    textAlignVertical: 'top',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  goldActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FBE618',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
  },
  goldActionBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0A0B0D',
  },
  secondarySmallBtn: {
    backgroundColor: '#E8E6DE',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
  },
  secondarySmallBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0A0B0D',
  },
  catSelectChip: {
    backgroundColor: '#E8E6DE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  catSelectChipActive: {
    backgroundColor: '#FBE618',
    borderWidth: 1,
    borderColor: '#B7A400',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: 'rgba(128,128,128,0.14)',
  },
  toolBtnHighlight: {
    backgroundColor: '#FBE618',
  },
  toolBtnLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  selectionFloatingBar: {
    backgroundColor: '#11141C',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#FBE618',
  },
  selectionBarBadge: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '700',
  },
  selectionBarActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  selectionLinkCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FBE618',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
  },
  selectionLinkCtaText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0A0B0D',
  },
  selectionQuickBtn: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#252A38',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionQuickBtnText: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '800',
  },
  inlineLinkCard: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 13,
    gap: 9,
  },
  secondaryLargeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#E8E6DE',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  secondaryLargeBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0A0B0D',
  },
  publishBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBE618',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  publishBtnText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0A0B0D',
  },
  previewNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
  },
  errorBanner: {
    backgroundColor: '#FFE4E6',
    borderRadius: 12,
    padding: 12,
  },
  authorAnalyticsPanel: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  authorAnalyticsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  googleIndexedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  googleIndexedPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statTile: {
    flex: 1,
    minWidth: 110,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  statTileValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  statTileLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  linkStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
  },
  seoUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  copySeoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FBE618',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  openSeoIconBtn: {
    padding: 4,
  },
  cardAuthorStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 2,
  },
  cardStatMetric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});
