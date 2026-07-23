import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  Image, 
  TouchableOpacity, 
  ActivityIndicator, 
  Dimensions, 
  TextInput, 
  ScrollView, 
  Animated,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  collection, 
  query, 
  onSnapshot, 
  doc, 
  updateDoc, 
  arrayUnion, 
  arrayRemove, 
  addDoc, 
  serverTimestamp, 
  orderBy, 
  limit, 
  deleteDoc,
  increment
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Post } from '../types';
import * as Icons from 'lucide-react-native';
import { generateFeedback } from '../lib/ai';
import { blurActiveElementOnWeb } from '../lib/webFocus';
import VerifiedBadge from '../components/VerifiedBadge';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';

const { width } = Dimensions.get('window');
const USE_NATIVE_ANIMATION_DRIVER = Platform.OS !== 'web';

const formatTimeAgo = (timestamp: any) => {
  if (!timestamp) return 'Just now';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  const diffInWeeks = Math.floor(diffInDays / 7);
  return `${diffInWeeks}w ago`;
};


// Safe Icon Helper
const SafeIcon = ({ name, size = 18, color = "#666", fill = "transparent", style }: any) => {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) return <View style={[{ width: size, height: size, backgroundColor: color + '20' }, style]} />;
  return <IconComponent size={size} color={color} fill={fill} style={style} />;
};

const CommentModal = ({ visible, onClose, post, user, profile, isDark }: any) => {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const q = query(collection(db, 'posts', post.id, 'comments'), orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.warn('Comments unavailable:', err);
        setComments([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [visible]);

  const handlePostComment = async () => {
    if (!newComment.trim() || !user) return;
    const text = newComment;
    setNewComment('');
    try {
      if (replyingTo) {
        // Post as a reply to a comment
        await addDoc(collection(db, 'posts', post.id, 'comments', replyingTo.id, 'replies'), {
          userId: user.uid,
          userName: profile?.displayName || user.displayName || 'Builder',
          userPic: profile?.profilePic || '',
          content: text,
          timestamp: serverTimestamp(),
          likes: [],
        });
        
        if (replyingTo.userId !== user.uid) {
          await addDoc(collection(db, 'notifications'), {
            userId: replyingTo.userId,
            fromId: user.uid,
            fromName: profile?.displayName || 'Someone',
            fromPic: profile?.profilePic || '',
            type: 'comment',
            content: 'replied to your comment.',
            isRead: false,
            timestamp: serverTimestamp()
          });
        }
        setReplyingTo(null);
      } else {
        await addDoc(collection(db, 'posts', post.id, 'comments'), {
          userId: user.uid,
          userName: profile?.displayName || user.displayName || 'Builder',
          userPic: profile?.profilePic || '',
          content: text,
          timestamp: serverTimestamp(),
          likes: [],
        });
        await updateDoc(doc(db, 'posts', post.id), { commentsCount: increment(1) });
      }
    } catch (e) { console.error(e); }
  };

  const handleLikeComment = async (item: any, currentLikes: string[]) => {
    if (!user) return;
    const commentId = item.id;
    const commentRef = doc(db, 'posts', post.id, 'comments', commentId);
    const alreadyLiked = currentLikes?.includes(user.uid);
    await updateDoc(commentRef, {
      likes: alreadyLiked ? arrayRemove(user.uid) : arrayUnion(user.uid)
    });
    
    if (!alreadyLiked && item.userId !== user.uid) {
      await addDoc(collection(db, 'notifications'), {
        userId: item.userId,
        fromId: user.uid,
        fromName: profile?.displayName || 'Someone',
        fromPic: profile?.profilePic || '',
        type: 'like',
        content: 'liked your comment.',
        isRead: false,
        timestamp: serverTimestamp()
      });
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteDoc(doc(db, 'posts', post.id, 'comments', commentId));
      await updateDoc(doc(db, 'posts', post.id), { commentsCount: increment(-1) });
    } catch (e) { console.error(e); }
  };

  const RepliesSection = ({ commentId }: { commentId: string }) => {
    const [replies, setReplies] = useState<any[]>([]);
    useEffect(() => {
      const q = query(collection(db, 'posts', post.id, 'comments', commentId, 'replies'), orderBy('timestamp', 'asc'));
      return onSnapshot(
        q,
        snap => setReplies(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => {
          console.warn('Replies unavailable:', err);
          setReplies([]);
        }
      );
    }, [commentId]);
    if (replies.length === 0) return null;
    return (
      <View style={{ marginLeft: 44, marginTop: 4 }}>
        {replies.map(reply => (
          <View key={reply.id} style={[styles.commentItem, { marginBottom: 4 }]}>
            <Image source={{ uri: reply.userPic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={[styles.commentAvatar, { width: 28, height: 28 }]} />
            <View style={styles.commentBody}>
              <Text style={[styles.commentUser, { color: textColor(isDark), fontSize: 11 }]}>{reply.userName}</Text>
              <Text style={[styles.commentText, { color: textColor(isDark, 'secondary'), fontSize: 12 }]}>{reply.content}</Text>
            </View>
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <SafeAreaView style={[styles.modalContent, appBackground(isDark)]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: textColor(isDark) }]}>COMMENTS</Text>
            <TouchableOpacity
              onPress={() => {
                blurActiveElementOnWeb();
                onClose();
              }}
              style={styles.closeBtn}
            >
              <SafeIcon name="X" size={24} color={textColor(isDark)} />
            </TouchableOpacity>
          </View>

          {loading ? <ActivityIndicator color="#666" style={{ flex: 1 }} /> : (
            <FlatList
              data={comments}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <View style={{ marginBottom: 8 }}>
                  <View style={styles.commentItem}>
                    <Image source={{ uri: item.userPic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={styles.commentAvatar} />
                    <View style={styles.commentBody}>
                      <View style={styles.commentHeader}>
                        <Text style={[styles.commentUser, { color: textColor(isDark) }]}>{item.userName}</Text>
                        {item.userId === user?.uid && (
                          <TouchableOpacity onPress={() => handleDeleteComment(item.id)}>
                            <SafeIcon name="Trash2" size={14} color="#FF4444" />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={[styles.commentText, { color: textColor(isDark, 'secondary') }]}>{item.content}</Text>
                      <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                        <TouchableOpacity 
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                          onPress={() => handleLikeComment(item, item.likes || [])}
                        >
                          <SafeIcon 
                            name="Heart" size={13} 
                            color={item.likes?.includes(user?.uid) ? '#EF4444' : '#888'}
                            fill={item.likes?.includes(user?.uid) ? '#EF4444' : 'transparent'}
                          />
                          <Text style={{ fontSize: 11, color: '#888' }}>{item.likes?.length || 0}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setReplyingTo(item)}>
                          <Text style={{ fontSize: 11, color: '#888', fontWeight: '600' }}>Reply</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                  <RepliesSection commentId={item.id} />
                </View>
              )}
              contentContainerStyle={{ padding: 20 }}
            />
          )}

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            {replyingTo && (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, gap: 8 }}>
                <Text style={{ fontSize: 12, color: '#888' }}>Replying to <Text style={{ fontWeight: '700', color: textColor(isDark) }}>{replyingTo.userName}</Text></Text>
                <TouchableOpacity onPress={() => setReplyingTo(null)}>
                  <SafeIcon name="X" size={14} color="#888" />
                </TouchableOpacity>
              </View>
            )}
            <View style={[styles.commentInputRow, { borderTopColor: isDark ? COLORS.darkBorder : COLORS.lightBorder }]}>
              <TextInput
                style={[styles.commentInput, liquidGlass(isDark, false), { color: textColor(isDark) }]}
                placeholder={replyingTo ? `Reply to ${replyingTo.userName}...` : "Write a comment..."}
                placeholderTextColor="#666"
                value={newComment}
                onChangeText={setNewComment}
              />
              <TouchableOpacity style={styles.sendBtn} onPress={handlePostComment}>
                <SafeIcon name="Send" size={20} color="#000" />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const PostCard = ({ post, navigation }: { post: Post, navigation: any }) => {
  const { user, profile } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const isLiked = post.likedBy?.includes(user?.uid || '');
  const [showComments, setShowComments] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const viewerRef = useRef<FlatList>(null);
  
  const likeScale = useRef(new Animated.Value(1)).current;
  const commentScale = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: USE_NATIVE_ANIMATION_DRIVER }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: USE_NATIVE_ANIMATION_DRIVER })
    ]).start();

    if (user && !post.viewedBy?.includes(user.uid)) {
      updateDoc(doc(db, 'posts', post.id), {
        viewsCount: increment(1),
        viewedBy: arrayUnion(user.uid)
      });
    }
  }, [user]);

  const handleLike = async () => {
    if (!user) return;
    Animated.sequence([
      Animated.timing(likeScale, { toValue: 1.4, duration: 100, useNativeDriver: USE_NATIVE_ANIMATION_DRIVER }),
      Animated.spring(likeScale, { toValue: 1, friction: 3, useNativeDriver: USE_NATIVE_ANIMATION_DRIVER })
    ]).start();
    const postRef = doc(db, 'posts', post.id);
    if (isLiked) {
      await updateDoc(postRef, { likesCount: increment(-1), likedBy: arrayRemove(user.uid) });
    } else {
      await updateDoc(postRef, { likesCount: increment(1), likedBy: arrayUnion(user.uid) });
      if (post.authorId !== user.uid) {
        await addDoc(collection(db, 'notifications'), {
          userId: post.authorId,
          fromId: user.uid,
          fromName: profile?.displayName || 'Someone',
          fromPic: profile?.profilePic || '',
          type: 'like',
          content: 'liked your post.',
          isRead: false,
          timestamp: serverTimestamp()
        });
      }
    }
  };

  const handleDelete = () => {
    Alert.alert("Delete Post", "Are you sure you want to delete this post?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { await deleteDoc(doc(db, 'posts', post.id)); }}
    ]);
  };
  const openMediaViewer = (index: number) => {
    blurActiveElementOnWeb();
    setViewerIndex(index);
    setViewerOpen(true);
    setTimeout(() => viewerRef.current?.scrollToIndex({ index, animated: false }), 0);
  };
  const closeMediaViewer = () => {
    blurActiveElementOnWeb();
    setViewerOpen(false);
  };
  const openComments = () => {
    blurActiveElementOnWeb();
    setShowComments(true);
  };
  const closeComments = () => {
    blurActiveElementOnWeb();
    setShowComments(false);
  };

  return (
    <Animated.View style={[
      styles.card, 
      liquidGlass(isDark),
      {
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }]
      }
    ]}>
      <Modal visible={viewerOpen} animationType="fade" transparent onRequestClose={closeMediaViewer}>
        <View style={styles.viewerOverlay}>
          <SafeAreaView style={styles.viewerTopBar}>
            <TouchableOpacity onPress={closeMediaViewer} style={styles.viewerCloseBtn}>
              <SafeIcon name="X" size={28} color="#FFF" />
            </TouchableOpacity>
          </SafeAreaView>

          <FlatList
            ref={viewerRef}
            data={post.media || []}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={viewerIndex}
            getItemLayout={(_d, index) => ({ length: width, offset: width * index, index })}
            keyExtractor={(uri, idx) => `${idx}-${uri}`}
            onScrollToIndexFailed={() => {}}
            renderItem={({ item }) => (
              <View style={{ width, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                <Image source={{ uri: item }} style={styles.viewerImage} resizeMode="contain" />
              </View>
            )}
          />
        </View>
      </Modal>

      <CommentModal 
        visible={showComments} 
        onClose={closeComments} 
        post={post} 
        user={user} 
        profile={profile} 
        isDark={isDark} 
      />
      
      <View style={styles.cardHeader}>
        <TouchableOpacity style={styles.authorRow} onPress={() => navigation.navigate('Profile', { userId: post.authorId })}>
          <Image source={{ uri: post.authorPic || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' }} style={styles.authorAvatarImg} />
          <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={[styles.authorName, { color: textColor(isDark) }]}>{post.authorName}</Text>
            {!!(post as any).authorVerified && (
              <VerifiedBadge size={18} />
            )}
          </View>
          <Text style={styles.postTime}>{formatTimeAgo(post.timestamp)}</Text>
          </View>
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          <View style={styles.viewBadge}>
            <SafeIcon name="Eye" size={12} color="#666" />
            <Text style={styles.viewVal}>{post.viewsCount || 0}</Text>
          </View>
          {post.authorId === user?.uid && (
            <TouchableOpacity onPress={handleDelete} style={styles.deleteBtn}>
              <SafeIcon name="Trash2" size={18} color="#FF4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={[styles.postContent, { color: textColor(isDark, 'secondary') }]}>
        {post.content}
      </Text>

      {post.media && post.media.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaScroll}>
          {post.media.map((uri, i) => (
            <TouchableOpacity
              key={i}
              activeOpacity={0.9}
              onPress={() => openMediaViewer(i)}
            >
              <Image source={{ uri }} style={styles.postImage} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={styles.cardFooter}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleLike}>
          <Animated.View style={{ transform: [{ scale: likeScale }] }}>
            <SafeIcon name="Heart" size={18} color={isLiked ? '#EF4444' : '#666'} fill={isLiked ? '#EF4444' : 'transparent'} />
          </Animated.View>
          <Text style={[styles.actionVal, { color: isLiked ? '#EF4444' : '#666' }]}>{post.likesCount || 0}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.actionBtn} 
          onPress={() => {
            Animated.sequence([
              Animated.timing(commentScale, { toValue: 1.2, duration: 100, useNativeDriver: USE_NATIVE_ANIMATION_DRIVER }),
              Animated.spring(commentScale, { toValue: 1, friction: 3, useNativeDriver: USE_NATIVE_ANIMATION_DRIVER })
            ]).start();
            openComments();
          }}
        >
          <Animated.View style={{ transform: [{ scale: commentScale }] }}>
            <SafeIcon name="MessageSquare" size={18} color="#666" />
          </Animated.View>
          <Text style={styles.actionVal}>{post.commentsCount || 0}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.actionBtn}>
          <SafeIcon name="Share2" size={18} color="#666" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

export default function FeedScreen({ navigation }: any) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPosts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post)));
        setLoading(false);
      },
      (err) => {
        console.warn('Feed unavailable:', err);
        setPosts([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={COLORS.primary} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} navigation={navigation} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <SafeIcon name="Rocket" size={48} color="#222" />
            <Text style={styles.emptyText}>THE FEED IS QUIET...</Text>
            <Text style={styles.emptySub}>START THE FIRST MOMENT</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  viewerOverlay: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewerTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  viewerCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#11111180',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: width,
    height: '100%',
  },
  card: {
    padding: 20,
    borderRadius: 24,
    marginBottom: 16,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  authorAvatarImg: {
    width: 44,
    height: 44,
    borderRadius: 15,
  },
  authorName: {
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontStyle: 'italic',
  },
  postTime: {
    fontSize: 9,
    color: '#666',
    fontWeight: '900',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  viewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8F8F810',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  viewVal: {
    fontSize: 10,
    color: '#666',
    fontWeight: '900',
  },
  deleteBtn: {
    padding: 4,
  },
  postContent: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    marginBottom: 16,
  },
  mediaScroll: {
    marginBottom: 16,
  },
  postImage: {
    width: width * 0.7,
    height: 200,
    borderRadius: 20,
    marginRight: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 24,
    borderTopWidth: 1,
    borderTopColor: '#1A1A1F10',
    paddingTop: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionVal: {
    fontSize: 12,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '80%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1F10',
  },
  modalTitle: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  closeBtn: {
    padding: 4,
  },
  commentItem: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 12,
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
  },
  commentBody: {
    flex: 1,
    backgroundColor: '#F8F8F805',
    padding: 12,
    borderRadius: 16,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  commentUser: {
    fontSize: 12,
    fontWeight: '900',
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
  },
  commentInputRow: {
    flexDirection: 'row',
    padding: 20,
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
  },
  commentInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 100,
    gap: 16,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#444',
    letterSpacing: 2,
  },
  emptySub: {
    fontSize: 10,
    color: '#222',
    fontWeight: '900',
  }
});
