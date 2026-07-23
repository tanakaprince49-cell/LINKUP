import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, getDocs, orderBy, onSnapshot, addDoc, limit, doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Match, Message, UserProfile } from '../types';
import { MessageSquare, Send, ChevronLeft, User, ShieldAlert, Loader2, Flag, ShieldOff } from 'lucide-react';
import ReportModal from '../components/ReportModal';
import BlockModal from '../components/BlockModal';
import { DEMO_PROFILES } from '../constants/demoData';

const loadPartnerProfile = async (partnerId: string): Promise<UserProfile | null> => {
  const demoPartner = DEMO_PROFILES.find(p => p.uid === partnerId);
  if (demoPartner) {
    return demoPartner;
  }

  const publicSnap = await getDoc(doc(db, 'publicProfiles', partnerId)).catch(() => null);
  if (publicSnap?.exists()) {
    return { uid: publicSnap.id, ...(publicSnap.data() as UserProfile) };
  }

  const userSnap = await getDoc(doc(db, 'users', partnerId)).catch(() => null);
  if (userSnap?.exists()) {
    return { uid: userSnap.id, ...(userSnap.data() as UserProfile) };
  }

  return null;
};

const ChatWindow = ({ match, onClose }: { match: Match, onClose: () => void }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [partner, setPartner] = useState<UserProfile | null>(null);
  const [inputText, setInputText] = useState('');
  const [isBlocked, setIsBlocked] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const partnerId = match.userIds.find(id => id !== user?.uid);

  useEffect(() => {
    if (!partnerId) return;

    // Fetch partner info
    const fetchPartner = async () => {
      try {
        const nextPartner = await loadPartnerProfile(partnerId);
        if (nextPartner) setPartner(nextPartner);
      } catch (err) {
        console.error("Error fetching partner:", err);
      }
    };
    fetchPartner();

    // Check if blocked
    const checkBlocked = async () => {
      // Check if current user is blocked by partner or vice versa
      const q = query(
        collection(db, 'blocks'),
        where('blockedById', 'in', [user?.uid, partnerId]),
        where('blockedUserId', 'in', [user?.uid, partnerId])
      );
      const snap = await getDocs(q);
      setIsBlocked(!snap.empty);
    };
    checkBlocked();

    // Real-time messages
    const q = query(
      collection(db, 'matches', match.id, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs);
      setTimeout(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight), 100);
    }, (err) => {
      console.error("Messages fetch error:", err);
    });

    return () => unsubscribe();
  }, [match.id, partnerId, user?.uid]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isBlocked || !user) return;

    const text = inputText;
    setInputText('');

    try {
      await addDoc(collection(db, 'matches', match.id, 'messages'), {
        senderId: user.uid,
        text,
        timestamp: new Date(),
        isRead: false
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `matches/${match.id}/messages`);
    }
  };

  return (
    <motion.div 
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      className="fixed inset-0 z-[60] flex flex-col bg-black custom-scrollbar overflow-hidden"
    >
      {/* Background Decor */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
        <div className="bg-glow -top-20 -right-20 w-[400px] h-[400px]" />
      </div>

      {/* Chat Header */}
      <div className="relative z-10 flex items-center gap-4 bg-[#050508]/80 px-6 py-5 backdrop-blur-3xl border-b border-white/5">
        <button onClick={onClose} className="rounded-2xl p-3 bg-white/5 border border-white/10 hover:bg-white/10 transition-all active:scale-90">
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-2xl border border-accent-yellow/30 bg-white/5 p-0.5">
            <div className="h-full w-full rounded-[0.9rem] overflow-hidden">
              {partner?.profilePic ? (
                <img src={partner.profilePic} alt={partner.displayName} className="h-full w-full object-cover" />
              ) : (
                <User className="m-auto h-6 w-6 text-white/20" />
              )}
            </div>
          </div>
          <div>
            <h3 className="font-extrabold text-sm tracking-tight text-white uppercase italic">{partner?.displayName || 'Builder'}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-accent-yellow animate-pulse shadow-glow" />
              <span className="text-[8px] text-accent-yellow font-black uppercase tracking-widest">Active Link</span>
            </div>
          </div>
        </div>
        
        <div className="ml-auto flex items-center gap-2">
          <button 
            onClick={() => setShowBlock(true)} 
            className="rounded-2xl p-3 text-white/20 hover:text-red-500 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all"
            title="Block User"
          >
            <ShieldOff size={20} />
          </button>
          <button 
            onClick={() => setShowReport(true)} 
            className="rounded-2xl p-3 text-white/20 hover:text-orange-500 hover:bg-orange-500/10 border border-transparent hover:border-orange-500/20 transition-all"
            title="Report Content"
          >
            <Flag size={20} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar pt-10">
        {isBlocked && (
          <div className="mx-auto max-w-xs liquid-card p-6 border-red-500/20 text-center animate-pulse">
            <ShieldAlert size={32} className="mx-auto mb-3 text-red-500 opacity-50" />
            <p className="text-[10px] font-black text-red-500 uppercase tracking-widest leading-relaxed">Secure Channel Terminated<br/>Connectivity Restricted</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.senderId === user?.uid ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-[2rem] px-5 py-3 ${
              msg.senderId === user?.uid 
                ? 'bg-accent-yellow/10 text-white rounded-tr-none border border-accent-yellow/30 shadow-glow' 
                : 'bg-white/5 text-white rounded-tl-none border border-white/10 backdrop-blur-sm'
            }`}>
              <p className="text-sm font-medium leading-relaxed">{msg.text}</p>
              <div className="mt-2 flex items-center gap-2 opacity-30">
                <span className="text-[8px] font-bold uppercase tracking-tighter">{new Date(msg.timestamp?.toDate ? msg.timestamp.toDate() : msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {msg.senderId === user?.uid && <div className="h-1 w-1 rounded-full bg-accent-yellow" />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="relative z-10 bg-[#050508]/80 p-6 pb-10 backdrop-blur-3xl border-t border-white/5">
        <form onSubmit={handleSendMessage} className="relative flex items-center">
          <input
            type="text"
            disabled={isBlocked}
            placeholder={isBlocked ? "COMMUNICATIONS OFFLINE" : "Transmit signal..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="w-full rounded-[2rem] bg-white/5 border border-white/10 px-6 py-5 text-sm font-bold outline-none transition-all focus:border-accent-yellow/50 focus:bg-white/10 disabled:opacity-30 placeholder:uppercase placeholder:tracking-widest placeholder:text-white/20"
          />
          <button 
            type="submit"
            disabled={!inputText.trim() || isBlocked}
            className="absolute right-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-yellow text-black shadow-glow transition-all active:scale-90 disabled:opacity-20"
          >
            <Send size={20} />
          </button>
        </form>
      </div>

      <AnimatePresence>
        {showReport && (
          <ReportModal 
            targetUserId={partnerId || ''}
            targetUserName={partner?.displayName || 'User'}
            onClose={() => setShowReport(false)}
          />
        )}
        {showBlock && (
          <BlockModal 
            targetUserId={partnerId || ''}
            targetUserName={partner?.displayName || 'User'}
            onClose={() => setShowBlock(false)}
            onBlockSuccess={() => {
              setIsBlocked(true);
              setShowBlock(false);
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const ConversationRow = ({ match, onClick }: { match: Match, onClick: () => void }) => {
  const { user } = useAuth();
  const [partner, setPartner] = useState<UserProfile | null>(null);
  const partnerId = match.userIds.find(id => id !== user?.uid);

  useEffect(() => {
    if (!partnerId) return;
    const fetchPartner = async () => {
      try {
        const nextPartner = await loadPartnerProfile(partnerId);
        if (nextPartner) setPartner(nextPartner);
      } catch (err) {
        console.error("Error fetching partner:", err);
      }
    };
    fetchPartner();
  }, [partnerId]);

  return (
    <button 
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-3xl bg-white/5 p-4 transition-all hover:bg-white/10 border border-white/5"
    >
      <div className="h-14 w-14 overflow-hidden rounded-full border border-white/20 bg-white/5">
        {partner?.profilePic ? (
          <img src={partner.profilePic} alt={partner.displayName} className="h-full w-full object-cover" />
        ) : (
          <User className="m-auto h-6 w-6 text-white/20" />
        )}
      </div>
      <div className="flex-1 text-left min-w-0">
        <h3 className="font-bold text-white truncate">{partner?.displayName || 'Builder'}</h3>
        <p className="text-xs text-white/40 truncate">{match.lastMessage || 'Start a conversation'}</p>
      </div>
      {match.lastMessageAt && (
        <span className="text-[10px] text-white/20 font-bold uppercase">{new Date(match.lastMessageAt?.toDate ? match.lastMessageAt.toDate() : match.lastMessageAt).toLocaleDateString()}</span>
      )}
    </button>
  );
};

export default function MessagesPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChat, setActiveChat] = useState<Match | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'matches'), where('userIds', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Match));
      setMatches(mData);
      setLoading(false);
    }, (err) => {
      console.error("Matches fetch error:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="animate-spin text-accent-yellow" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-2xl font-black uppercase tracking-tighter italic">CHATS<span className="text-accent-yellow">LIVE</span></h2>
        <span className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-black text-accent-yellow border border-accent-yellow/20">PRIVATE</span>
      </div>

      <div className="space-y-3">
        {matches.length > 0 ? (
          matches.map(m => (
            <ConversationRow 
              key={m.id} 
              match={m} 
              onClick={() => setActiveChat(m)} 
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 opacity-20">
            <MessageSquare size={48} className="mb-4" />
            <p className="text-sm font-bold uppercase tracking-widest text-center">No active chats<br/>Match with someone to start building</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {activeChat && (
          <ChatWindow match={activeChat} onClose={() => setActiveChat(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
