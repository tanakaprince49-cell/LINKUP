import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Loader2 } from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

interface CreatePostModalProps {
  onClose: () => void;
  onPostCreated: (post: any) => void;
}

const CreatePostModal: React.FC<CreatePostModalProps> = ({ onClose, onPostCreated }) => {
  const { user, profile } = useAuth();
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [postType, setPostType] = useState<'build' | 'launch' | 'achievement' | 'update'>('build');

  const handlePost = async () => {
    if (!content.trim() || !user) return;
    setIsPosting(true);
    try {
      const postData = {
        authorId: user.uid,
        content,
        type: postType,
        timestamp: serverTimestamp(),
        likesCount: 0,
        commentsCount: 0
      };
      const docRef = await addDoc(collection(db, 'posts'), postData);
      onPostCreated({ id: docRef.id, ...postData, timestamp: new Date() });
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'posts');
    } finally {
      setIsPosting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-lg overflow-hidden rounded-[2.5rem] bg-[#050508] border border-white/5 shadow-2xl"
      >
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-black font-display tracking-tight text-white italic uppercase">New <span className="text-accent-yellow">Signal</span></h2>
            <button onClick={onClose} className="p-2 rounded-xl bg-white/5 text-white/40 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="h-12 w-12 rounded-xl bg-zinc-800 border border-white/10 p-0.5 overflow-hidden shrink-0">
                {profile?.profilePic && <img src={profile.profilePic} className="w-full h-full object-cover rounded-lg" />}
              </div>
              <textarea 
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Broadcast your progress..."
                className="flex-1 bg-transparent text-xl font-bold outline-none placeholder:text-white/10 resize-none min-h-[120px] text-white/90"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(['build', 'launch', 'achievement', 'update'] as const).map(type => (
                <button 
                  key={type}
                  onClick={() => setPostType(type)}
                  className={`rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all border ${
                    postType === type 
                      ? 'bg-accent-yellow text-black border-accent-yellow shadow-glow' 
                      : 'bg-white/5 text-white/30 border-white/5 hover:text-white/60'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <button 
              disabled={!content.trim() || isPosting}
              onClick={handlePost}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-[1.5rem] bg-white text-black font-black uppercase tracking-widest text-xs shadow-2xl transition-all active:scale-95 disabled:opacity-20 hover:bg-accent-yellow hover:shadow-glow"
            >
              {isPosting ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              Push Signal to Network
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default CreatePostModal;
