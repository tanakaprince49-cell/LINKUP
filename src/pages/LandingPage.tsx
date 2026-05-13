import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { Rocket, Users, Zap, Shield, Loader2, AlertCircle } from 'lucide-react';

export default function LandingPage() {
  const { signIn } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      await signIn();
    } catch (err: any) {
      setError(err.message || "Authentication failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  console.log("LandingPage Render");

  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#050508] px-6 text-center font-sans border-t-2 border-accent-yellow/5">
      {/* Immersive Background */}
      <div className="absolute inset-0 z-0">
        <div className="bg-glow -top-[200px] -left-[100px] opacity-30" style={{ background: 'radial-gradient(circle, #FBE618 0%, transparent 70%)' }} />
        <div className="bg-glow -bottom-[200px] -right-[100px] opacity-20" style={{ background: 'radial-gradient(circle, #FBE618 0%, transparent 70%)' }} />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-5 pointer-events-none" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 space-y-8"
      >
        <div className="space-y-4">
          <motion.div
            animate={{ rotate: [0, 5, -5, 0] }}
            transition={{ repeat: Infinity, duration: 6, ease: "easeInOut" }}
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-[32px] bg-zinc-900 border border-accent-yellow/30 shadow-2xl"
          >
            <Zap size={48} className="text-accent-yellow drop-shadow-[0_0_10px_rgba(251,230,24,0.8)]" fill="currentColor" />
          </motion.div>
          <h1 className="text-7xl font-black tracking-tight text-white sm:text-9xl font-display uppercase italic">
            LINKUP<span className="text-accent-yellow text-xs align-top ml-1 tracking-[0.2em] font-black italic block sm:inline">Professional</span>
          </h1>
          <p className="mx-auto max-w-sm text-sm font-black text-white/30 tracking-[0.2em] uppercase">
            The elite network for co-founder acquisition.
          </p>
        </div>

        <div className="flex flex-col items-center gap-6 pt-4">
          <button
            onClick={handleSignIn}
            disabled={isLoggingIn}
            className="group relative flex items-center gap-3 rounded-2xl bg-accent-yellow px-12 py-5 text-sm font-black uppercase tracking-widest text-black transition-all hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(251,230,24,0.3)] disabled:opacity-50"
          >
            {isLoggingIn ? <Loader2 className="animate-spin" size={18} /> : "Authenticate"}
            {!isLoggingIn && <Zap className="transition-transform group-hover:rotate-12" size={18} fill="currentColor" />}
          </button>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest"
            >
              <AlertCircle size={14} />
              {error}
            </motion.div>
          )}
          
          <p className="text-[9px] font-bold text-white/10 uppercase tracking-widest">
            Identity verification via Google Required. Pop-ups must be enabled.
          </p>
          
          <div className="flex items-center gap-8 pt-12 text-white/10">
            <div className="flex flex-col items-center gap-1 group">
              <Users size={16} className="group-hover:text-accent-yellow transition-colors" />
              <span className="text-[8px] font-black uppercase tracking-[0.3em]">Network</span>
            </div>
            <div className="flex flex-col items-center gap-1 group">
              <Shield size={16} className="group-hover:text-accent-yellow transition-colors" />
              <span className="text-[8px] font-black uppercase tracking-[0.3em]">Verify</span>
            </div>
            <div className="flex flex-col items-center gap-1 group">
              <Zap size={16} className="group-hover:text-accent-yellow transition-colors" fill="currentColor" />
              <span className="text-[8px] font-black uppercase tracking-[0.3em]">AI Insight</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
