import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { X, ShieldOff, AlertCircle } from 'lucide-react';

interface BlockModalProps {
  onClose: () => void;
  targetUserId: string;
  targetUserName: string;
  onBlockSuccess: () => void;
}

export default function BlockModal({ onClose, targetUserId, targetUserName, onBlockSuccess }: BlockModalProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleBlock = async () => {
    if (!user) return;
    setLoading(true);
    try {
      // 1. Add block record
      await addDoc(collection(db, 'blocks'), {
        blockedById: user.uid,
        blockedUserId: targetUserId,
        timestamp: serverTimestamp()
      });

      // 2. Add notification for the blocked user (as requested: "You have been blocked")
      await addDoc(collection(db, 'notifications'), {
        userId: targetUserId,
        type: 'block_info',
        fromId: user.uid,
        content: 'You have been blocked by a builder.',
        isRead: false,
        timestamp: serverTimestamp()
      });

      onBlockSuccess();
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'blocks');
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="relative w-full max-w-sm rounded-[2.5rem] bg-zinc-900 border border-white/10 p-8 shadow-2xl overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-red-600" />
        
        <button onClick={onClose} className="absolute right-6 top-6 text-white/40 hover:text-white transition-colors">
          <X size={24} />
        </button>

        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
              <ShieldOff size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tighter text-white">Sever <span className="text-red-500">Connection</span></h2>
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{targetUserName}</p>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/10 space-y-2">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle size={14} />
              <p className="text-[10px] font-black uppercase tracking-widest">Protocol Warning</p>
            </div>
            <p className="text-xs font-medium text-white/60 leading-relaxed">
              Blocking this user will hide their profile from your feed and permanently disable messaging. They will be notified of the disconnect.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={handleBlock}
              disabled={loading}
              className="w-full py-4 rounded-2xl bg-red-600 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? 'Processing Disconnect...' : 'Confirm Block'}
            </button>
            <button
              onClick={onClose}
              className="w-full py-4 rounded-2xl bg-white/5 text-white/40 text-[10px] font-black uppercase tracking-[0.2em] hover:text-white transition-all"
            >
              Abort Protocol
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
