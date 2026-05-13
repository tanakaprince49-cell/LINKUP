import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { X, AlertTriangle, ShieldAlert, Flag, CheckCircle2 } from 'lucide-react';

interface ReportModalProps {
  onClose: () => void;
  targetUserId: string;
  targetUserName: string;
}

export default function ReportModal({ onClose, targetUserId, targetUserName }: ReportModalProps) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const reasons = [
    'Inappropriate Content',
    'Harassment or Bullying',
    'Spam or Scams',
    'Fake Profile',
    'Other'
  ];

  const handleSubmit = async () => {
    if (!reason || !user) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'reports'), {
        reportedById: user.uid,
        reportedUserId: targetUserId,
        reason,
        details,
        timestamp: serverTimestamp(),
        status: 'pending'
      });
      setSubmitted(true);
      setTimeout(onClose, 2000);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'reports');
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
        className="relative w-full max-w-sm rounded-[2.5rem] bg-zinc-900 border border-white/10 p-8 shadow-2xl"
      >
        <button onClick={onClose} className="absolute right-6 top-6 text-white/40 hover:text-white transition-colors">
          <X size={24} />
        </button>

        {!submitted ? (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-red-500/10 text-red-500 shadow-glow">
                <Flag size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black uppercase tracking-tighter text-white">Report <span className="text-red-500">Builder</span></h2>
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{targetUserName}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/20 ml-2">Reason</p>
                <div className="grid grid-cols-1 gap-2">
                  {reasons.map((r) => (
                    <button
                      key={r}
                      onClick={() => setReason(r)}
                      className={`w-full text-left p-4 rounded-2xl text-xs font-bold transition-all border ${
                        reason === r ? 'bg-red-500/10 border-red-500/50 text-red-500' : 'bg-white/5 border-white/5 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/20 ml-2">Context (Optional)</p>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Provide more details..."
                  className="w-full rounded-2xl bg-white/5 border border-white/10 p-4 text-xs font-medium outline-none h-24 focus:border-red-500/30 transition-all"
                />
              </div>
            </div>

            <button
              disabled={!reason || loading}
              onClick={handleSubmit}
              className="w-full py-4 rounded-2xl bg-red-600 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(239,68,68,0.3)] active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? 'Transmitting...' : 'File Report'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="h-20 w-20 flex items-center justify-center rounded-full bg-green-500/10 text-green-500"
            >
              <CheckCircle2 size={48} />
            </motion.div>
            <div>
              <h3 className="text-xl font-black uppercase tracking-tighter text-white">Report Received</h3>
              <p className="text-xs text-white/40 mt-2">Safety protocols initiated. We will review this submission immediately.</p>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
