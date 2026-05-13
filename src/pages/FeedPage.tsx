import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { collection, query, getDocs, where, addDoc, limit, serverTimestamp, doc, onSnapshot, getDoc, updateDoc, increment, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, Swipe, Block, Post, Match } from '../types';
import { X, Heart, Zap, RotateCcw, Info, MessageCircle, MapPin, Briefcase, Users, Shield, Flag, ShieldOff, Search, Award, Lightbulb, Trash2, Send, Share2, Plus, Brain, ChevronLeft, ShieldAlert, Loader2, ChevronRight, User, Star, Settings, Rocket } from 'lucide-react';
import { getMatchingExplanation } from '../lib/gemini';
import ReportModal from '../components/ReportModal';
import BlockModal from '../components/BlockModal';
import { DEMO_PROFILES, DEMO_POSTS } from '../constants/demoData';
import { generateAIComment } from '../lib/gemini';
import StartupAnalyzerModal from '../components/StartupAnalyzer';

const PostCard = ({ post, onDelete }: { post: Post, onDelete?: (id: string) => void }) => {
  const { user } = useAuth();
  const [author, setAuthor] = useState<UserProfile | null>(null);
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [isLiking, setIsLiking] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [localPost, setLocalPost] = useState(post);

  useEffect(() => {
    // Real-time listener for this specific post for likes/comments counts
    if (post.id.startsWith('demo-')) return;
    
    const unsub = onSnapshot(doc(db, 'posts', post.id), (doc) => {
      if (doc.exists()) {
        setLocalPost({ id: doc.id, ...doc.data() } as Post);
      }
    });
    return () => unsub();
  }, [post.id]);

  useEffect(() => {
    const fetchAuthor = async () => {
      // Check if it's a demo author first
      const demoAuthor = DEMO_PROFILES.find(p => p.uid === post.authorId);
      if (demoAuthor) {
        setAuthor(demoAuthor);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'users', post.authorId));
        if (snap.exists()) setAuthor(snap.data() as UserProfile);
      } catch (err) {
        console.error("Error fetching author:", err);
      }
    };
    fetchAuthor();
  }, [post.authorId]);

  const handleAiFeedback = async () => {
    const feedback = await generateAIComment(post.content);
    setAiComment(feedback);
  };

  const handleLike = async () => {
    if (post.id.startsWith('demo-')) return;
    setIsLiking(true);
    try {
      await updateDoc(doc(db, 'posts', post.id), { likesCount: increment(1) });
    } finally {
      setIsLiking(false);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Explode this signal? This cannot be undone.")) {
      try {
        await deleteDoc(doc(db, 'posts', post.id));
        onDelete?.(post.id);
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  const handleComment = async () => {
    if (!commentText.trim() || post.id.startsWith('demo-')) return;
    try {
      await updateDoc(doc(db, 'posts', post.id), { commentsCount: increment(1) });
      setCommentText('');
    } catch (err) {
      console.error("Comment error:", err);
    }
  };

  const getIcon = () => {
    switch (post.type) {
      case 'launch': return <Rocket size={18} className="text-accent-yellow" />;
      case 'achievement': return <Award size={18} className="text-accent-yellow" />;
      case 'build': return <Lightbulb size={18} className="text-accent-yellow" />;
      default: return <MessageCircle size={18} className="text-white/40" />;
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="mb-8 liquid-card border-white/5 overflow-hidden group hover:border-white/10 transition-colors"
    >
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 overflow-hidden rounded-xl bg-zinc-800 border border-white/5 p-0.5">
            {author?.profilePic ? (
              <img src={author.profilePic} alt={author.displayName} className="h-full w-full object-cover rounded-lg" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-slate-800 rounded-lg">
                <User size={20} className="text-white/20" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <h3 className="text-base font-black uppercase tracking-tight text-white group-hover:text-accent-yellow transition-colors leading-none">
              {author?.displayName || 'Builder'}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest leading-none">
                {author?.city} • {new Date(localPost.timestamp?.toDate ? localPost.timestamp.toDate() : localPost.timestamp).toLocaleDateString()}
              </span>
              <div className="w-0.5 h-0.5 rounded-full bg-white/20" />
              <div className="flex items-center gap-1">
                {getIcon()}
                <span className="text-[9px] font-black uppercase text-white/40 tracking-widest leading-none">{localPost.type}</span>
              </div>
            </div>
          </div>
          
          {user?.uid === localPost.authorId && (
            <button 
              onClick={handleDelete}
              className="p-2 rounded-lg bg-white/5 text-white/20 hover:bg-red-500/10 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        <div className="space-y-6">
          <p className="text-sm font-medium leading-relaxed text-white/80 whitespace-pre-wrap">{localPost.content}</p>
          
          {localPost.mediaUrl && (
            <div className="overflow-hidden rounded-2xl border border-white/5">
              <img src={localPost.mediaUrl} alt="Post content" className="w-full object-cover max-h-[300px]" />
            </div>
          )}

          <div className="flex items-center justify-between pt-6 border-t border-white/5 pb-2">
            <div className="flex items-center gap-6">
              <button onClick={handleLike} className={`flex items-center gap-2 group/btn transition-all ${isLiking ? 'text-accent-yellow scale-110' : 'text-white/30 hover:text-accent-yellow'}`}>
                <div className="p-2 rounded-lg bg-white/5 group-hover/btn:bg-accent-yellow/10 transition-colors">
                  <Heart size={16} fill={localPost.likesCount > 0 ? "currentColor" : "none"} className={localPost.likesCount > 0 ? "text-accent-yellow shadow-glow" : ""} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">{localPost.likesCount}</span>
              </button>
              <button 
                onClick={() => setShowComments(!showComments)}
                className={`flex items-center gap-2 group/btn transition-all ${showComments ? 'text-white' : 'text-white/30 hover:text-white'}`}
              >
                <div className="p-2 rounded-lg bg-white/5 group-hover/btn:bg-white/10 transition-colors">
                  <MessageCircle size={16} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">{localPost.commentsCount}</span>
              </button>
            </div>
            <button onClick={handleAiFeedback} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-yellow/10 text-[9px] font-black uppercase tracking-widest text-accent-yellow border border-accent-yellow/20 hover:bg-accent-yellow/20 transition-all">
              <Brain size={14} className={aiComment ? "animate-pulse" : ""} />
              CO-PILOT
            </button>
          </div>

          <AnimatePresence>
            {aiComment && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-2 rounded-xl bg-accent-yellow/5 p-4 border border-accent-yellow/10 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 p-2 opacity-5">
                  <Brain size={32} className="text-accent-yellow" />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1 h-1 rounded-full bg-accent-yellow shadow-glow" />
                  <span className="text-[8px] font-black uppercase text-accent-yellow tracking-widest">Co-Pilot Briefing</span>
                </div>
                <p className="text-xs font-bold italic text-white/60 leading-relaxed italic">"{aiComment}"</p>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showComments && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mt-4 pt-4 border-t border-white/5"
              >
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                    <User size={14} className="text-white/20" />
                  </div>
                  <div className="flex-1 relative">
                    <input 
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleComment()}
                      placeholder="Add a comment..."
                      className="w-full h-8 bg-white/5 rounded-lg pl-3 pr-10 text-[10px] text-white/80 placeholder:text-white/10 focus:bg-white/10 transition-all border border-transparent focus:border-white/5 outline-none"
                    />
                    <button 
                      onClick={handleComment}
                      disabled={!commentText.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-yellow disabled:opacity-20"
                    >
                      <Send size={14} />
                    </button>
                  </div>
                </div>
                {localPost.id.startsWith('demo-') && (
                  <p className="mt-2 text-[8px] font-bold text-white/20 uppercase tracking-widest text-center italic">Comments are disabled for signals from antiquity</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

// DEMO_POSTS and DEMO_PROFILES are now imported from ../constants/demoData

export default function FeedPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAnalyzer, setShowAnalyzer] = useState(false);

  useEffect(() => {
    const fetchPosts = async () => {
      if (!user) return;
      try {
        // Fetch blocks where I am the blocker
        const blocksOutQ = query(collection(db, 'blocks'), where('blockedById', '==', user.uid));
        const blocksOutSnap = await getDocs(blocksOutQ);
        const blockedByMe = blocksOutSnap.docs.map(doc => doc.data().blockedUserId);

        // Fetch blocks where I am the one blocked
        const blocksInQ = query(collection(db, 'blocks'), where('blockedUserId', '==', user.uid));
        const blocksInSnap = await getDocs(blocksInQ);
        const blockedMe = blocksInSnap.docs.map(doc => doc.data().blockedById);

        const allBlocks = [...new Set([...blockedByMe, ...blockedMe])];

        const q = query(collection(db, 'posts'), limit(50));
        const snap = await getDocs(q);
        const data = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Post))
          .filter(post => !allBlocks.includes(post.authorId));
        
        // Use demo posts if empty
        setPosts(data.length > 0 ? data : DEMO_POSTS);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'blocks/posts');
        setPosts(DEMO_POSTS);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [user]);

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="animate-spin text-accent-yellow shadow-glow rounded-full" size={32} />
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Feed */}
      <div className="space-y-4 pb-20">
        <div className="flex items-center justify-between mb-4 px-2">
          <h2 className="text-2xl font-black font-display tracking-tight uppercase italic">Founder<span className="text-accent-yellow">Feed</span></h2>
          <button 
            onClick={() => setShowAnalyzer(true)}
            className="flex items-center gap-2 rounded-xl bg-accent-yellow/10 px-4 py-2 text-[8px] font-black uppercase tracking-widest text-accent-yellow border border-accent-yellow/20 hover:bg-accent-yellow/20 transition-all shadow-glow"
          >
            <Brain size={14} className="animate-pulse" />
            ANALYZE
          </button>
        </div>

        <div className="grid gap-6">
          {posts.map(post => (
            <div key={post.id} className="transition-all hover:translate-x-1 duration-300">
               <PostCard post={post} onDelete={(id) => setPosts(prev => prev.filter(p => p.id !== id))} />
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {showAnalyzer && <StartupAnalyzerModal onClose={() => setShowAnalyzer(false)} />}
      </AnimatePresence>
    </div>
  );
}
