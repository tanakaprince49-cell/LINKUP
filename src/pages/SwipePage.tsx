import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { collection, query, getDocs, where, addDoc, limit, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, Swipe, Block } from '../types';
import { X, Heart, Zap, RotateCcw, Info, MessageCircle, MapPin, Briefcase, Users, Shield, Flag, ShieldOff, Search } from 'lucide-react';
import { getMatchingExplanation } from '../lib/ai';
import ReportModal from '../components/ReportModal';
import BlockModal from '../components/BlockModal';
import { DEMO_PROFILES } from '../constants/demoData';

const SwipeCard = ({ 
  user, 
  onSwipe, 
  active,
  onShowReport,
  onShowBlock,
  onToggleNav
}: { 
  user: UserProfile, 
  onSwipe: (dir: 'left' | 'right' | 'super') => void, 
  active: boolean,
  onShowReport: () => void,
  onShowBlock: () => void,
  onToggleNav: (hide: boolean) => void
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-25, 25]);
  const opacity = useTransform(x, [-200, -150, 0, 150, 200], [0, 1, 1, 1, 0]);
  const heartOpacity = useTransform(x, [50, 150], [0, 1]);
  const crossOpacity = useTransform(x, [-50, -150], [0, 1]);

  const handleDragEnd = (_: any, info: any) => {
    if (isExpanded) return;
    if (info.offset.x > 100) onSwipe('right');
    else if (info.offset.x < -100) onSwipe('left');
  };

  const toggleExpand = () => {
    const newState = !isExpanded;
    setIsExpanded(newState);
    onToggleNav(newState);
  };

  return (
    <motion.div
      style={{ x, rotate, opacity, zIndex: active ? 10 : 0 }}
      drag={active && !isExpanded ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      animate={{ 
        height: isExpanded ? '100vh' : '100%',
        width: isExpanded ? '100vw' : '100%',
        top: isExpanded ? '-20vh' : '0', // Offset from container
        left: isExpanded ? '-50vw' : '0', // Rough mental model, but better use fixed/absolute
        borderRadius: isExpanded ? 0 : 40
      }}
      className={`absolute inset-0 transition-all duration-500 ${isExpanded ? 'fixed inset-0 z-[100] h-screen w-screen overflow-y-auto bg-white dark:bg-[#050508]' : 'cursor-grab active:cursor-grabbing'}`}
    >
      <div className={`relative h-full w-full overflow-hidden ${isExpanded ? '' : 'liquid-card border-black/5 dark:border-white/10 shadow-2xl'}`}>
        {/* User Image */}
        <div className={`${isExpanded ? 'h-[50vh]' : 'h-[70%]'} w-full bg-gradient-to-b from-white/10 to-transparent relative`}>
          {user.profilePic ? (
            <img src={user.profilePic} alt={user.displayName} className="h-full w-full object-cover transition duration-500 hover:scale-105 opacity-80" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-slate-800">
              <Users size={80} className="text-black/10 dark:text-white/20" />
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />

          {/* Swipe Indicators */}
          <div className="absolute top-6 left-6 flex gap-2">
            <span className="px-3 py-1 badge-glow rounded-full text-[10px] font-bold uppercase tracking-widest text-white">AI Top Pick</span>
          </div>

          {isExpanded && (
            <button 
              onClick={toggleExpand}
              className="absolute top-6 right-6 h-12 w-12 flex items-center justify-center rounded-2xl bg-black/5 dark:bg-black/40 backdrop-blur-xl border border-black/10 dark:border-white/10 text-black dark:text-white z-50"
            >
              <X size={24} />
            </button>
          )}

          {!isExpanded && (
            <div className="absolute top-6 right-6 flex flex-col gap-2">
               <button 
                 onClick={onShowBlock}
                 className="h-10 w-10 flex items-center justify-center rounded-xl bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 hover:text-red-500 transition-colors"
               >
                  <ShieldOff size={18} />
               </button>
               <button 
                 onClick={onShowReport}
                 className="h-10 w-10 flex items-center justify-center rounded-xl bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 hover:text-orange-500 transition-colors"
               >
                  <Flag size={18} />
               </button>
            </div>
          )}

          {!isExpanded && (
            <>
              <motion.div style={{ opacity: heartOpacity }} className="absolute top-20 right-10 rounded-xl border-4 border-accent-yellow px-4 py-2 rotate-12 bg-accent-yellow/10">
                <span className="text-4xl font-black text-accent-yellow uppercase">Connect</span>
              </motion.div>
              <motion.div style={{ opacity: crossOpacity }} className="absolute top-20 left-10 rounded-xl border-4 border-red-500 px-4 py-2 -rotate-12 bg-red-500/10">
                <span className="text-4xl font-black text-red-500 uppercase">Skip</span>
              </motion.div>
            </>
          )}
        </div>

        {/* User Info Overlay */}
        <div className={`${isExpanded ? 'p-8 bg-white dark:bg-[#050508]' : 'absolute bottom-0 left-0 right-0 h-[45%] bg-gradient-to-t from-black via-black/90 to-transparent p-6'}`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="px-2 py-0.5 rounded bg-accent-yellow/10 border border-accent-yellow/30 text-accent-yellow text-[9px] font-black uppercase tracking-widest">
                Match Score: 98%
              </div>
              {!isExpanded && (
                <button 
                  onClick={toggleExpand}
                  className="p-2 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-all"
                >
                  <Info size={20} />
                </button>
              )}
            </div>
            
            <div className="space-y-1">
              <h2 className={`${isExpanded ? 'text-4xl' : 'text-2xl'} font-black tracking-tight text-black dark:text-white uppercase italic`}>{user.displayName}, {user.age}</h2>
              <p className="text-black/60 dark:text-white/60 text-sm font-bold leading-relaxed">{isExpanded ? user.bio : `"${user.bio}"`}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {user.skills.map((skill, i) => (
                <span key={i} className="px-3 py-1.5 bg-black/5 dark:bg-white/5 rounded-xl text-[10px] font-black uppercase border border-black/5 dark:border-white/5 text-black/40 dark:text-white/40 tracking-widest">
                  {skill}
                </span>
              ))}
            </div>

            {isExpanded && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="space-y-8 pt-8 border-t border-black/5 dark:border-white/5"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-black/20 dark:text-white/20 tracking-tighter">Experience</span>
                    <p className="text-sm font-bold text-black dark:text-white">{user.experience}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-black uppercase text-black/20 dark:text-white/20 tracking-tighter">Commitment</span>
                    <p className="text-sm font-bold text-black dark:text-white">{user.commitmentLevel}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-black uppercase italic tracking-tighter text-black dark:text-white">Current <span className="text-accent-yellow">Projects</span></h3>
                  <div className="grid gap-3">
                    {user.projects.map((proj, i) => (
                      <div key={i} className="p-4 rounded-3xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-2">
                        <h4 className="font-black uppercase tracking-widest text-xs text-accent-yellow">{proj.name}</h4>
                        <p className="text-[11px] font-medium text-black/60 dark:text-white/60 leading-relaxed">{proj.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-4 pt-10 pb-28">
                    <button 
                        onClick={() => { toggleExpand(); onSwipe('left'); }}
                        className="flex-1 py-4 rounded-[2rem] border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 font-black uppercase tracking-widest text-[10px]"
                    >
                        Skip
                    </button>
                    <button 
                        onClick={() => { toggleExpand(); onSwipe('right'); }}
                        className="flex-1 py-4 rounded-[2rem] bg-accent-yellow text-black font-black uppercase tracking-widest text-[10px] shadow-glow"
                    >
                        Connect
                    </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default function SwipePage({ onToggleNav }: { onToggleNav: (hide: boolean) => void }) {
  const { user, profile } = useAuth();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<UserProfile[]>([]);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [showReport, setShowReport] = useState<string | null>(null);
  const [showBlock, setShowBlock] = useState<string | null>(null);
  const [searchProject, setSearchProject] = useState('');

  useEffect(() => {
    const fetchProfiles = async () => {
      if (!user) return;
      try {
        // Fetch blocks where I am the blocker
        const blocksOutQ = query(collection(db, 'blocks'), where('blockedById', '==', user.uid));
        const blocksOutSnap = await getDocs(blocksOutQ);
        const blockedByMe = blocksOutSnap.docs.map(doc => (doc.data() as Block).blockedUserId);

        // Fetch blocks where I am the one blocked
        const blocksInQ = query(collection(db, 'blocks'), where('blockedUserId', '==', user.uid));
        const blocksInSnap = await getDocs(blocksInQ);
        const blockedMe = blocksInSnap.docs.map(doc => (doc.data() as Block).blockedById);

        const allBlocks = [...new Set([...blockedByMe, ...blockedMe])];

        const q = query(collection(db, 'users'), where('uid', '!=', user.uid), limit(50));
        const querySnapshot = await getDocs(q);
        const data = querySnapshot.docs
          .map(doc => doc.data() as UserProfile)
          .filter(p => !allBlocks.includes(p.uid));
        
        // Merge with demo profiles if we have fewer than 10
        const combined = [...data, ...DEMO_PROFILES.filter(dp => !data.find(p => p.uid === dp.uid))];
        setProfiles(combined);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'blocks/users');
        // Fallback to demo profiles on error
        setProfiles(DEMO_PROFILES);
      } finally {
        setLoading(false);
      }
    };
    fetchProfiles();
  }, [user]);

  const handleSwipe = async (direction: 'left' | 'right' | 'super') => {
    if (profiles.length === 0) return;
    
    const targetUser = profiles[0];
    setHistory([targetUser, ...history]);
    setProfiles(profiles.slice(1));
    setExplanation(null);

    // AI Context call for the next profile if available
    if (profiles[1]) {
      getMatchingExplanation(profile, profiles[1]).then(setExplanation);
    }

    if (direction === 'left') return;

    // Record swipe in DB
    try {
      await addDoc(collection(db, 'swipes'), {
        fromId: user?.uid,
        toId: targetUser.uid,
        type: direction === 'right' ? 'like' : 'superconnect',
        timestamp: serverTimestamp()
      });

      // Simple match check logic (ideally would be handled by a cloud function or listener)
      // For this demo, we'll just check if they swiped on us
      const backSwipeQ = query(
        collection(db, 'swipes'), 
        where('fromId', '==', targetUser.uid), 
        where('toId', '==', user?.uid),
        where('type', 'in', ['like', 'superconnect'])
      );
      const backSwipeSnap = await getDocs(backSwipeQ);
      
      if (!backSwipeSnap.empty) {
        // MATCH!
        await addDoc(collection(db, 'matches'), {
          userIds: [user?.uid, targetUser.uid].sort(),
          matchedAt: serverTimestamp()
        });
        
        // Show match notification logic here
        console.log(`IT'S A MATCH WITH ${targetUser.displayName.toUpperCase()}!`);
      }

    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'swipes');
    }
  };

  const handleRewind = () => {
    if (history.length === 0) return;
    const last = history[0];
    setProfiles([last, ...profiles]);
    setHistory(history.slice(1));
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent-yellow border-t-transparent shadow-glow" />
    </div>
  );

  const filteredProfiles = profiles.filter(p => {
    if (!searchProject) return true;
    return p.projects.some(proj => 
      proj.name.toLowerCase().includes(searchProject.toLowerCase()) || 
      proj.description.toLowerCase().includes(searchProject.toLowerCase())
    );
  });

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      {/* Search Header */}
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xl font-black font-display tracking-tight uppercase italic text-black dark:text-white">Find<span className="text-accent-yellow">Partners</span></h2>
          <div className="px-3 py-1 rounded-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-[8px] font-black uppercase tracking-widest text-black/40 dark:text-white/40">
            {filteredProfiles.length} Builders Found
          </div>
        </div>
        <div className="relative group">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-black/20 dark:text-white/20 group-focus-within:text-accent-yellow transition-colors" />
          <input 
            type="text"
            placeholder="Search Project names or descriptions..."
            value={searchProject}
            onChange={(e) => setSearchProject(e.target.value)}
            className="w-full h-12 bg-zinc-100 dark:bg-zinc-900/40 backdrop-blur-xl border border-black/5 dark:border-white/5 rounded-2xl pl-12 pr-4 text-[10px] font-bold uppercase tracking-widest text-black dark:text-white placeholder:text-black/10 dark:placeholder:text-white/10 focus:border-accent-yellow/30 outline-none transition-all"
          />
        </div>
      </div>

      {/* Cards Container */}
      <div className="relative h-[55vh] w-full max-w-sm">
        <AnimatePresence>
          {filteredProfiles.length > 0 ? (
            filteredProfiles.slice(0, 2).reverse().map((p, i) => (
              <SwipeCard 
                key={p.uid} 
                user={p} 
                onSwipe={handleSwipe} 
                active={i === 1 || filteredProfiles.length === 1}
                onShowReport={() => setShowReport(p.uid)}
                onShowBlock={() => setShowBlock(p.uid)}
                onToggleNav={onToggleNav}
              />
            ))
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center rounded-[40px] border border-white/5 bg-white/5 backdrop-blur-md">
              <RotateCcw size={48} className="mb-4 text-white/20" />
              <p className="text-white/40">No more builders in your area</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showReport && (
          <ReportModal 
            targetUserId={showReport}
            targetUserName={profiles.find(p => p.uid === showReport)?.displayName || 'User'}
            onClose={() => setShowReport(null)} 
          />
        )}
        {showBlock && (
          <BlockModal 
            targetUserId={showBlock}
            targetUserName={profiles.find(p => p.uid === showBlock)?.displayName || 'User'}
            onClose={() => setShowBlock(null)}
            onBlockSuccess={() => {
              setProfiles(profiles.filter(p => p.uid !== showBlock));
              setShowBlock(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* AI Explanation Tooltip */}
      {explanation && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mx-auto max-w-xs rounded-2xl bg-zinc-100/80 dark:bg-zinc-900/80 p-4 border border-black/5 dark:border-accent-yellow/10 backdrop-blur-xl"
        >
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-accent-yellow" />
            <span className="text-[10px] font-black uppercase tracking-widest text-accent-yellow">Co-Pilot Note</span>
          </div>
          <p className="text-[11px] leading-relaxed text-black/60 dark:text-white/60 font-medium italic">"{explanation}"</p>
        </motion.div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-4 pb-32 md:pb-20 relative z-10">
        <button 
          onClick={handleRewind}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 transition-all active:scale-90 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <RotateCcw size={20} />
        </button>
        <button 
          onClick={() => handleSwipe('left')}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900 border border-black/10 dark:border-white/10 text-black/60 dark:text-white/60 transition-all active:scale-90 hover:text-black dark:hover:text-white"
        >
          <X size={28} strokeWidth={3} />
        </button>
        <button 
          onClick={() => handleSwipe('super')}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-yellow/10 border border-accent-yellow/20 text-accent-yellow transition-all active:scale-90 hover:bg-accent-yellow/20"
        >
          <Zap size={24} fill="currentColor" />
        </button>
        <button 
          onClick={() => handleSwipe('right')}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-yellow text-black shadow-glow transition-all active:scale-90"
        >
          <Heart size={36} fill="currentColor" strokeWidth={0} />
        </button>
      </div>
    </div>
  );
}
