import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, SafeAreaView, ActivityIndicator, Dimensions, TextInput, Modal, ScrollView } from 'react-native';
import { collection, query, getDocs, where, limit, onSnapshot, doc, updateDoc, arrayUnion, arrayRemove, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Post, UserProfile } from '../types';
import { Heart, MessageSquare, Share2, Rocket, Shield, Send, X, Code, Zap } from 'lucide-react-native';
import { generateFeedback } from '../lib/ai';

const PostCard = ({ post }: { post: Post }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [isLiked, setIsLiked] = useState(post.likedBy?.includes(user?.uid || ''));
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState<any[]>([]);

  useEffect(() => {
    if (showComments) {
      const q = query(collection(db, `posts/${post.id}/comments`), orderBy('timestamp', 'asc'));
      const unsub = onSnapshot(q, (snap) => {
        setComments(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => unsub();
    }
  }, [showComments, post.id]);

  const handleLike = async () => {
    if (!user) return;
    const postRef = doc(db, 'posts', post.id);
    if (isLiked) {
      await updateDoc(postRef, {
        likesCount: post.likesCount - 1,
        likedBy: arrayRemove(user.uid)
      });
      setIsLiked(false);
    } else {
      await updateDoc(postRef, {
        likesCount: post.likesCount + 1,
        likedBy: arrayUnion(user.uid)
      });
      setIsLiked(true);
      
      // Notify the author if it's not their own post
      if (post.authorId !== user.uid) {
        await addDoc(collection(db, 'notifications'), {
          userId: post.authorId,
          fromId: user.uid,
          type: 'like',
          content: `${user.displayName || 'Someone'} liked your build update!`,
          isRead: false,
          timestamp: serverTimestamp()
        });
      }
    }
  };

  const handleAiAnalyze = async () => {
    setAiFeedback("Analyzing Proof of Work...");
    const feedback = await generateFeedback(post.content);
    setAiFeedback(feedback);
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !user) return;
    await addDoc(collection(db, `posts/${post.id}/comments`), {
      authorId: user.uid,
      authorName: user.displayName || 'Builder',
      content: newComment,
      timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, 'posts', post.id), {
      commentsCount: (post.commentsCount || 0) + 1
    });
    
    // Notify the author if it's not their own post
    if (post.authorId !== user.uid) {
      await addDoc(collection(db, 'notifications'), {
        userId: post.authorId,
        fromId: user.uid,
        type: 'system',
        content: `${user.displayName || 'Someone'} commented on your post.`,
        isRead: false,
        timestamp: serverTimestamp()
      });
    }
    
    setNewComment('');
  };

  return (
    <View style={[styles.card, { backgroundColor: isDark ? '#1E1E1E' : '#FFFFFF', borderColor: isDark ? '#333333' : '#EEEEEE' }]}>
      <View style={styles.cardHeader}>
        <View style={styles.authorInfo}>
          <Text style={[styles.authorName, { color: isDark ? '#FFFFFF' : '#000000' }]}>{post.authorName}</Text>
          <Text style={styles.timestamp}>12m ago</Text>
        </View>
        <TouchableOpacity style={styles.verifyBadge} onPress={handleAiAnalyze}>
          <Shield size={14} color="#FBE618" />
          <Text style={styles.verifyText}>AI VERIFY PoW</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.content, { color: isDark ? '#FFFFFF90' : '#333333' }]}>{post.content}</Text>

      {aiFeedback && (
        <View style={styles.aiBox}>
          <Zap size={14} color="#FBE618" style={{ marginTop: 2 }} />
          <Text style={styles.aiText}>{aiFeedback}</Text>
        </View>
      )}

      <View style={styles.cardFooter}>
        <TouchableOpacity style={styles.footerAction} onPress={handleLike}>
          <Heart size={20} color={isLiked ? '#FBE618' : (isDark ? '#444444' : '#CCCCCC')} fill={isLiked ? '#FBE618' : 'transparent'} />
          <Text style={[styles.actionCount, { color: isDark ? '#444444' : '#999999' }]}>{post.likesCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerAction} onPress={() => setShowComments(!showComments)}>
          <MessageSquare size={20} color={isDark ? '#444444' : '#CCCCCC'} />
          <Text style={[styles.actionCount, { color: isDark ? '#444444' : '#999999' }]}>{post.commentsCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerAction}>
          <Share2 size={20} color={isDark ? '#444444' : '#CCCCCC'} />
        </TouchableOpacity>
      </View>

      {showComments && (
        <View style={styles.commentsSection}>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.commentItem}>
              <Text style={[styles.commentAuthor, { color: isDark ? '#FFFFFF' : '#000000' }]}>{comment.authorName}</Text>
              <Text style={[styles.commentContent, { color: isDark ? '#AAAAAA' : '#666666' }]}>{comment.content}</Text>
            </View>
          ))}
          <View style={styles.commentInputRow}>
            <TextInput
              value={newComment}
              onChangeText={setNewComment}
              placeholder="Add a founder insight..."
              placeholderTextColor={isDark ? '#444444' : '#CCCCCC'}
              style={[styles.commentInput, { color: isDark ? '#FFFFFF' : '#000000', backgroundColor: isDark ? '#050508' : '#F8F8F8' }]}
            />
            <TouchableOpacity onPress={handleAddComment}>
              <Send size={20} color="#FBE618" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

export default function FeedScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPosting, setIsPosting] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'posts'), orderBy('timestamp', 'desc'), limit(20));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
      setPosts(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#121212' : '#FFFFFF' }]}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFFFFF' : '#000000' }]}>
          Founder<Text style={{ color: '#FBE618' }}>Feed</Text>
        </Text>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loading ? <ActivityIndicator color="#FBE618" style={{ marginTop: 50 }} /> : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 30, // Increased
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    textTransform: 'uppercase',
  },
  postTrigger: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FBE618',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  listContent: {
    padding: 20,
    paddingBottom: 100,
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
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  authorInfo: {
    flex: 1,
  },
  authorName: {
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontStyle: 'italic',
  },
  timestamp: {
    fontSize: 10,
    color: '#666666',
    marginTop: 2,
    fontWeight: '700',
  },
  verifyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FBE61815',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  verifyText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FBE618',
  },
  content: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: 16,
  },
  aiBox: {
    flexDirection: 'row',
    backgroundColor: '#FBE61810',
    padding: 12,
    borderRadius: 16,
    gap: 10,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#FBE618',
  },
  aiText: {
    flex: 1,
    fontSize: 12,
    color: '#FBE618',
    fontWeight: '700',
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 20,
  },
  footerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  commentsSection: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#222222',
  },
  commentItem: {
    marginBottom: 12,
  },
  commentAuthor: {
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 2,
  },
  commentContent: {
    fontSize: 13,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  commentInput: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
  },
  postButton: {
    color: '#FBE618',
    fontWeight: '900',
    fontSize: 14,
  },
  modalInput: {
    flex: 1,
    padding: 20,
    fontSize: 18,
    textAlignVertical: 'top',
  },
  powTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 20,
    backgroundColor: '#FBE61810',
    margin: 20,
    borderRadius: 20,
  },
  powTipText: {
    color: '#FBE618',
    fontSize: 12,
    fontWeight: '700',
  },
});
