import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { User, X, Camera, MapPin, Globe, Briefcase, Award, Settings, LogOut, Trash2, ShieldCheck, Plus, Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const safeDisplayNameForSave = (value: unknown) => {
  const name = String(value || '').trim();
  return name && name !== 'New Builder' ? name.slice(0, 100) : 'LINKUP Builder';
};

const cleanUsername = (value: unknown) =>
  String(value || '')
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);

export default function ProfilePage({ onClose }: { onClose: () => void }) {
  const { profile, logOut } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [localProfile, setLocalProfile] = useState(profile);
  const [editedProfile, setEditedProfile] = useState(profile);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'settings'>('info');
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (!profile) return;
    setLocalProfile(profile);
    setEditedProfile(profile);
  }, [profile]);

  const handleSave = async () => {
    if (!localProfile || !editedProfile || isSaving) return;
    const displayName = safeDisplayNameForSave(editedProfile.displayName || localProfile.displayName);
    const username = cleanUsername((editedProfile as any).username || displayName) || `builder${localProfile.uid.slice(0, 5)}`;
    const nextProfile = {
      ...localProfile,
      ...editedProfile,
      uid: localProfile.uid,
      displayName,
      username,
      bio: String(editedProfile.bio || '').slice(0, 2000),
    };

    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'users', localProfile.uid),
        {
          uid: localProfile.uid,
          displayName,
          username,
          bio: nextProfile.bio,
        },
        { merge: true }
      );
      setLocalProfile(nextProfile);
      setEditedProfile(nextProfile);
      setIsEditing(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${localProfile.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  const visibleProfile = localProfile || profile;

  if (!visibleProfile) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex flex-col bg-white/90 dark:bg-[#050508]/90 backdrop-blur-2xl overflow-hidden transition-colors"
    >
      {/* Background Decor */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-[50vh] bg-gradient-to-b from-accent-yellow/5 to-transparent" />
      </div>

      {/* Header Overlay */}
      <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-black/5 dark:border-white/5">
        <div className="flex bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/10 dark:border-white/10">
          <button 
            onClick={() => setActiveTab('info')}
            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'info' ? 'bg-accent-yellow text-black' : 'text-white/40 hover:text-white'}`}
          >
            Profile
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'settings' ? 'bg-accent-yellow text-black' : 'text-white/40 hover:text-white'}`}
          >
            Settings
          </button>
        </div>
        <button 
          onClick={onClose}
          className="h-10 w-10 flex items-center justify-center rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black dark:text-white transition-all active:scale-95 hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'info' ? (
          <div className="space-y-0 pb-20">
            {/* Native Profile Header Section */}
            <div className="relative">
              {/* Cover Photo */}
              <div className="relative h-48 md:h-64 w-full bg-slate-900 overflow-hidden">
                {visibleProfile.coverPhoto ? (
                  <img src={visibleProfile.coverPhoto} className="w-full h-full object-cover opacity-60" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-zinc-900 to-black relative">
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle, #FBE618 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
                  </div>
                )}
                {isEditing && (
                  <button className="absolute bottom-4 right-4 h-10 w-10 flex items-center justify-center rounded-xl bg-black/50 backdrop-blur border border-white/20 text-white hover:bg-black/70 transition-all">
                    <Camera size={18} />
                  </button>
                )}
              </div>

              {/* Profile Avatar Overlay */}
              <div className="px-6 -mt-10 md:-mt-12 flex flex-col md:flex-row md:items-end gap-6">
                <div className="relative">
                  <div className="h-24 w-24 md:h-32 md:w-32 rounded-[2rem] border-[4px] border-[#050508] bg-slate-800 overflow-hidden shadow-2xl relative z-20">
                    {visibleProfile.profilePic ? (
                      <img src={visibleProfile.profilePic} className="w-full h-full object-cover" />
                    ) : (
                      <User size={48} className="m-auto h-full w-full p-6 text-white/20" />
                    )}
                  </div>
                  {isEditing && (
                    <button className="absolute bottom-1 right-1 z-30 h-8 w-8 flex items-center justify-center rounded-lg bg-accent-yellow text-black shadow-glow">
                      <Camera size={14} />
                    </button>
                  )}
                </div>

                <div className="flex-1 mb-2">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-4xl md:text-5xl font-black font-display tracking-tight text-white italic uppercase">{visibleProfile.displayName}</h2>
                      <p className="text-sm font-bold text-accent-yellow/80 uppercase tracking-widest mt-1">Founding Member - {visibleProfile.city || 'Global'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Sidebar Info */}
              <div className="md:col-span-1 space-y-6">
                <section className="liquid-card p-6 border-white/5 space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/30">Network Presence</h4>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-xs font-medium text-white/60">
                      <MapPin size={14} className="text-accent-yellow" />
                      <span>{visibleProfile.city}, {visibleProfile.country}</span>
                    </div>
                    {(isEditing ? editedProfile?.portfolioLinks : visibleProfile.portfolioLinks)?.map((link, i) => (
                      <a key={i} href={link} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-xs font-medium text-accent-yellow hover:underline">
                        <Globe size={14} />
                        <span className="truncate">{link}</span>
                      </a>
                    ))}
                  </div>
                </section>

                <section className="liquid-card p-6 border-white/5 space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/30">Stack</h4>
                  <div className="flex flex-wrap gap-2">
                    {(isEditing ? editedProfile?.skills : visibleProfile.skills)?.map((skill, i) => (
                      <span key={i} className="rounded-lg bg-white/5 px-3 py-1.5 text-[10px] font-bold text-white/80 border border-white/10">
                        {skill}
                      </span>
                    ))}
                  </div>
                </section>
              </div>

              {/* Main Info */}
              <div className="md:col-span-2 space-y-8">
                <section className="liquid-card p-8 border-white/5 space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-accent-yellow">Executive Summary</h4>
                  {isEditing ? (
                    <textarea 
                      value={editedProfile?.bio}
                      onChange={(e) => setEditedProfile({ ...editedProfile!, bio: e.target.value })}
                      className="w-full rounded-2xl bg-white/5 border border-white/10 p-4 text-sm font-medium outline-none h-32 focus:border-accent-yellow/50"
                    />
                  ) : (
                    <p className="text-lg font-medium leading-relaxed text-white/80 italic">"{visibleProfile.bio || 'Building the future.'}"</p>
                  )}
                </section>

                {/* Ideas Feed-style */}
                <section className="space-y-4">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/30 ml-4">Venture Concepts</h4>
                  <div className="grid grid-cols-1 gap-4">
                    {(isEditing ? editedProfile?.startupIdeas : visibleProfile.startupIdeas)?.map((idea, i) => (
                      <div key={i} className="liquid-card p-6 border-white/5 group hover:border-white/10 transition-all">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-lg font-black uppercase tracking-tighter italic">{idea.title}</p>
                          <span className="px-3 py-1 rounded-full bg-accent-yellow/10 text-[8px] font-black uppercase tracking-widest text-accent-yellow border border-accent-yellow/20">
                            {idea.stage}
                          </span>
                        </div>
                        <p className="text-sm text-white/50 leading-relaxed">{idea.vision}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="liquid-card p-8 border-white/5 space-y-8">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/30">Verified Resume</h4>
                    <ShieldCheck size={18} className="text-accent-yellow opacity-30" />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Milestones</p>
                      <div className="space-y-3">
                        {(isEditing ? editedProfile?.resume?.shippedProducts : visibleProfile.resume?.shippedProducts)?.map((p, i) => (
                          <div key={i} className="text-xs font-bold text-white/80 flex items-start gap-3">
                            <div className="mt-1 h-3 w-3 rounded-full border-2 border-accent-yellow shrink-0" />
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/20">Venture Velocity</p>
                      <div className="flex items-center gap-4">
                        <div className="p-4 rounded-2xl bg-accent-yellow/10 border border-accent-yellow/20">
                          <Zap size={24} className="text-accent-yellow" />
                        </div>
                        <div>
                          <span className="text-4xl font-black text-white tracking-tighter">{(isEditing ? editedProfile?.resume?.buildStreaks : visibleProfile.resume?.buildStreaks) || 0}</span>
                          <span className="text-[10px] font-bold text-white/20 ml-2 uppercase tracking-widest">Day Streak</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="pt-4">
                  {isEditing ? (
                    <div className="flex gap-4">
                      <button onClick={handleSave} disabled={isSaving} className="flex-1 brand-button disabled:opacity-60">{isSaving ? 'Publishing...' : 'Publish Updates'}</button>
                      <button onClick={() => { setEditedProfile(visibleProfile); setIsEditing(false); }} className="px-8 rounded-2xl bg-white/5 border border-white/10 font-bold uppercase text-[10px] tracking-widest active:scale-95 text-white/40">Discard</button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <button 
                        onClick={() => { setEditedProfile(visibleProfile); setIsEditing(true); }}
                        className="w-full brand-button"
                      >
                        EDIT FOUNDER PROFILE
                      </button>
                      <button onClick={logOut} className="w-full rounded-2xl bg-red-500/10 border border-red-500/20 py-4 font-black uppercase tracking-widest text-red-500 hover:bg-red-500/20 transition-all text-xs">Log Out</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-xl mx-auto space-y-8 p-6">
            <h3 className="text-4xl font-black font-display italic tracking-tight text-white uppercase">Control<span className="text-accent-yellow">Center</span></h3>
            
            <div className="space-y-4">
              <h4 className="text-[9px] font-black uppercase tracking-[0.3em] text-black/20 dark:text-white/20 ml-2">Preferences</h4>
              <div className="bg-zinc-100 dark:bg-zinc-900 border border-black/5 dark:border-white/5 divide-y divide-black/5 dark:divide-white/5 rounded-3xl overflow-hidden">
                <div 
                  onClick={toggleTheme}
                  className="flex items-center justify-between p-6 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-accent-yellow/10 text-accent-yellow">
                      {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest leading-none text-black dark:text-white">Dark Mode</p>
                      <p className="text-[9px] text-black/30 dark:text-white/30 font-medium mt-1">Adjust app appearance</p>
                    </div>
                  </div>
                  <div className={`h-6 w-12 rounded-full p-1 transition-all ${theme === 'dark' ? 'bg-accent-yellow shadow-glow' : 'bg-black/10'}`}>
                    <div className={`h-4 w-4 rounded-full bg-white dark:bg-black transition-all ${theme === 'dark' ? 'ml-auto' : 'ml-0'}`} />
                  </div>
                </div>
                <div className="flex items-center justify-between p-6 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-accent-yellow/10 text-accent-yellow">
                      <Globe size={20} />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest leading-none text-black dark:text-white">Public Discovery</p>
                      <p className="text-[9px] text-black/30 dark:text-white/30 font-medium mt-1">Show me in the founder pool</p>
                    </div>
                  </div>
                  <div className="h-6 w-12 rounded-full bg-accent-yellow p-1 shadow-glow transition-all">
                    <div className="h-4 w-4 rounded-full bg-black ml-auto" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-6 group transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/5 text-white/20">
                      <Zap size={20} fill="currentColor" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest leading-none">Turbo Connect</p>
                      <p className="text-[9px] text-white/30 font-medium mt-1">Prioritize my product updates</p>
                    </div>
                  </div>
                  <div className="h-6 w-12 rounded-full bg-white/5 p-1 border border-white/10 transition-all">
                    <div className="h-4 w-4 rounded-full bg-white/10" />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/20 ml-4">Account Persistence</h4>
              <div className="space-y-4">
                <button 
                  onClick={logOut}
                  className="w-full flex items-center justify-between p-8 rounded-[2.5rem] bg-white/5 border border-white/10 hover:bg-white/10 transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white/5 text-white/60">
                      <LogOut size={24} />
                    </div>
                    <div>
                      <p className="text-sm font-black uppercase tracking-widest text-white">Log Out</p>
                      <p className="text-[10px] text-white/40 font-medium tracking-tight">End session securely</p>
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center border border-white/5 text-white/20 group-hover:text-white transition-colors">-&gt;</div>
                </button>
                <button className="w-full flex items-center gap-4 p-8 rounded-[2.5rem] bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-all text-left">
                  <div className="h-12 w-12 flex items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
                    <Trash2 size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase tracking-widest text-red-500">Delete Account</p>
                    <p className="text-[10px] text-red-500/40 font-medium">Irreversible destruction of manifest</p>
                  </div>
                </button>
              </div>
            </div>

            <div className="pt-10 text-center">
              <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.8em]">LINKUP v1.1.00 - IMMERSIVE</p>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
