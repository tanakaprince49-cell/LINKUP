import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { collection, query, where, orderBy, onSnapshot, updateDoc, doc, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { AppNotification } from '../types';
import { Bell, Heart, Users, MessageCircle, Star, Sparkles, Loader2 } from 'lucide-react';

const NotificationRow = ({ notification }: { notification: AppNotification }) => {
  const getIcon = () => {
    switch (notification.type) {
      case 'like': return <Heart size={16} className="text-red-500" fill="currentColor" />;
      case 'match': return <Users size={16} className="text-green-500" />;
      case 'message': return <MessageCircle size={16} className="text-blue-500" />;
      case 'ai_pick': return <Sparkles size={16} className="text-orange-500" />;
      default: return <Bell size={16} className="text-white/40" />;
    }
  };

  return (
    <motion.div 
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className={`liquid-card p-5 transition-all border-white/5 ${
        notification.isRead ? 'opacity-40 grayscale-[0.5]' : 'border-accent-yellow/20 ring-1 ring-accent-yellow/10'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
          notification.isRead ? 'bg-white/5' : 'bg-accent-yellow/10 text-accent-yellow shadow-glow'
        }`}>
          {getIcon()}
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-bold text-white/90 tracking-tight leading-snug">{notification.content}</p>
          <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-white/20">
            {new Date(notification.timestamp?.toDate ? notification.timestamp.toDate() : notification.timestamp).toLocaleDateString()}
          </span>
        </div>
        {!notification.isRead && (
          <div className="mt-2 h-2 w-2 rounded-full bg-accent-yellow shadow-glow animate-pulse" />
        )}
      </div>
    </motion.div>
  );
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'notifications'), 
      where('userId', '==', user.uid), 
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AppNotification));
      setNotifications(data);
      setLoading(false);
    }, (err) => {
      console.error("Notifications fetch error:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.isRead);
    for (const n of unread) {
      try {
        await updateDoc(doc(db, 'notifications', n.id), { isRead: true });
      } catch (err) {
        console.error("Mark read err:", err);
      }
    }
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="animate-spin text-accent-yellow" />
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between px-2">
        <h2 className="text-4xl font-black font-display italic tracking-tight uppercase">Alerts<span className="text-accent-yellow">Live</span></h2>
        <button 
          onClick={markAllRead}
          className="px-4 py-2 glass-pill text-[10px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-colors border-white/5"
        >
          Flush All
        </button>
      </div>

      <div className="space-y-4">
        {notifications.length > 0 ? (
          notifications.map(n => <NotificationRow key={n.id} notification={n} />)
        ) : (
          <div className="flex flex-col items-center justify-center py-20 liquid-card border-dashed border-white/10">
            <Bell size={48} className="mb-4 text-white/5" />
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20">Frequency Clean</p>
          </div>
        )}
      </div>
    </div>
  );
}
