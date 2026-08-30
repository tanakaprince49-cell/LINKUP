import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { collection, query, where, getDocs, getDoc, doc, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Match, UserProfile } from '../types';
import { Users, Zap, MessageCircle, ChevronRight, User, Star, Trash2 } from 'lucide-react';
import { DEMO_PROFILES } from '../constants/demoData';

import { deleteDoc } from 'firebase/firestore';
const MatchCard = ({ match, onUnmatch }: { match: Match, onUnmatch: (id: string) => void }) => {
  const { user } = useAuth();
  const [partner, setPartner] = useState<UserProfile | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const partnerId = match.userIds.find(id => id !== user?.uid);

  const handleUnmatch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Sever this connection?")) {
      setIsRemoving(true);
      try {
        await deleteDoc(doc(db, 'matches', match.id));
        onUnmatch(match.id);
      } catch (err) {
        console.error("Unmatch error:", err);
      } finally {
        setIsRemoving(false);
      }
    }
  };

  useEffect(() => {
    const fetchPartner = async () => {
      if (!partnerId) return;

      // Check demo profiles
      const demoPartner = DEMO_PROFILES.find(p => p.uid === partnerId);
      if (demoPartner) {
        setPartner(demoPartner);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'users', partnerId));
        if (snap.exists()) setPartner(snap.data() as UserProfile);
      } catch (err) {
        console.error("Error fetching partner:", err);
      }
    };
    fetchPartner();
  }, [partnerId]);

  return (
    <motion.div 
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="flex items-center gap-4 rounded-3xl bg-white/5 p-4 backdrop-blur-xl border border-white/10"
    >
      <div className="h-14 w-14 overflow-hidden rounded-full border border-white/20 bg-white/5">
        {partner?.profilePic ? (
          <img src={partner.profilePic} alt={partner.displayName} className="h-full w-full object-cover" />
        ) : (
          <User className="m-auto h-6 w-6 text-white/20" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-white truncate">{partner?.displayName || 'Builder'}</h3>
        <p className="text-xs text-white/40 truncate">{partner?.bio || 'Ready to collaborate'}</p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1 rounded-full bg-accent-yellow/10 px-2 py-0.5 border border-accent-yellow/20">
          <Star size={10} className="text-accent-yellow" fill="currentColor" />
          <span className="text-[10px] font-bold text-accent-yellow uppercase tracking-tighter">Pro Match</span>
        </div>
        <button 
          onClick={handleUnmatch}
          disabled={isRemoving}
          className="text-white/10 hover:text-red-500 transition-colors p-2"
        >
          <Trash2 size={16} />
        </button>
        <button className="text-white/20 hover:text-white transition-colors p-2">
          <MessageCircle size={18} />
        </button>
      </div>
    </motion.div>
  );
};

export default function MatchPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [recommendations, setRecommendations] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.uid) return;
      try {
        const mQ = query(collection(db, 'matches'), where('userIds', 'array-contains', user.uid));
        const mSnap = await getDocs(mQ);
        const mData = mSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Match));
        setMatches(mData);

        // Fetch AI recommendations (simplified for demo)
        const rQ = query(collection(db, 'users'), where('uid', '!=', user.uid), limit(3));
        const rSnap = await getDocs(rQ);
        setRecommendations(rSnap.docs.map(doc => doc.data() as UserProfile));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'matches/users');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  if (loading) return null;

  return (
    <div className="space-y-8">
      {/* AI Recommendations */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 px-2">
          <Zap size={18} className="text-accent-yellow" fill="currentColor" />
          <h2 className="text-xl font-black uppercase tracking-tighter italic text-white/40">Elite <span className="text-accent-yellow">Picks</span></h2>
          <span className="rounded-md bg-white/5 px-2 py-0.5 text-[8px] font-black text-white/20 uppercase border border-white/5">Verified AI</span>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar snap-x">
          {recommendations.map((rec) => (
            <motion.div 
              key={rec.uid}
              className="relative flex h-60 w-44 flex-shrink-0 flex-col overflow-hidden rounded-[2rem] bg-zinc-900 border border-white/5 snap-start"
            >
              {rec.profilePic ? (
                <img src={rec.profilePic} alt={rec.displayName} className="absolute inset-0 h-full w-full object-cover opacity-60" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-white/5 opacity-10">
                  <User size={64} />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent p-4">
                <h4 className="font-black text-white text-xs uppercase tracking-tight">{rec.displayName}</h4>
                <p className="text-[9px] text-accent-yellow font-bold mb-3 truncate uppercase tracking-widest">{rec.skills?.[0] || 'Visionary'}</p>
                <div className="flex items-center gap-1 rounded-lg bg-accent-yellow px-2 py-1 w-fit">
                  <Star size={8} className="text-black" fill="currentColor" />
                  <span className="text-[8px] font-black text-black uppercase tracking-widest">Connect</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Your Matches */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-white/40" />
            <h2 className="text-xl font-black uppercase tracking-tighter">ACTIVE <span className="text-white/40">MATCHES</span></h2>
          </div>
          <span className="text-xs font-bold text-white/20">{matches.length} Total</span>
        </div>

        <div className="space-y-3">
          {matches.length > 0 ? (
            matches.map(m => <MatchCard key={m.id} match={m} onUnmatch={(id) => setMatches(prev => prev.filter(match => match.id !== id))} />)
          ) : (
            <div className="flex flex-col items-center justify-center py-10 rounded-[2.5rem] border border-white/5 bg-white/5">
              <Users size={40} className="mb-2 text-white/10" />
              <p className="text-xs text-white/20 uppercase tracking-widest font-bold">No matches yet. Keep swiping!</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
