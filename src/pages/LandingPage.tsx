import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { Rocket, Users, Zap, Shield, Loader2, AlertCircle, Brain } from 'lucide-react';

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
    <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-hidden theme-bg px-6 text-center font-sans border-t-2 border-accent-yellow/5 transition-colors">
      {/* Immersive Background */}
      <div className="absolute inset-0 z-0">
        <div className="bg-glow -top-[200px] -left-[100px] opacity-30" style={{ background: 'radial-gradient(circle, #FBE618 0%, transparent 70%)' }} />
        <div className="bg-glow -bottom-[200px] -right-[100px] opacity-20" style={{ background: 'radial-gradient(circle, #FBE618 0%, transparent 70%)' }} />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-5 pointer-events-none" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="relative z-10 w-full max-w-4xl space-y-12"
      >
        <div className="space-y-6">
          <motion.div
            animate={{ 
              boxShadow: ["0 0 20px rgba(251,230,24,0.1)", "0 0 50px rgba(251,230,24,0.3)", "0 0 20px rgba(251,230,24,0.1)"]
            }}
            transition={{ repeat: Infinity, duration: 4 }}
            className="mx-auto flex h-32 w-32 items-center justify-center rounded-[40px] bg-zinc-900 border border-accent-yellow/30"
          >
            <Zap size={64} className="text-accent-yellow drop-shadow-glow" fill="currentColor" />
          </motion.div>
          
          <div className="space-y-2">
            <h1 className="text-8xl font-black tracking-tighter text-black dark:text-white sm:text-[10rem] font-display uppercase italic leading-[0.8] mb-4">
              LINK<span className="text-accent-yellow">UP</span>
            </h1>
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-12 bg-black/10 dark:bg-white/10" />
              <p className="text-[11px] font-black text-black/40 dark:text-white/40 tracking-[0.5em] uppercase italic">
                The Elite Co-Founder Acquisition Network
              </p>
              <div className="h-px w-12 bg-black/10 dark:bg-white/10" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto py-8">
           {[
             { icon: Users, title: "CURATED NETWORK", desc: "Vetted founders only." },
             { icon: Brain, title: "AI MATCHMAKING", desc: "Proprietary synergy analysis." },
             { icon: Zap, title: "FAST CONNECTIONS", desc: "Skip the noise, build faster." }
           ].map((item, i) => (
             <div key={i} className="liquid-card space-y-3 p-6 rounded-[32px] border-white/10">
                <item.icon size={20} className="mx-auto text-accent-yellow" />
                <h3 className="text-[10px] font-black uppercase tracking-widest text-black dark:text-white">{item.title}</h3>
                <p className="text-[10px] font-bold text-black/40 dark:text-white/40 uppercase tracking-widest">{item.desc}</p>
            onClick={handleSignIn}
            disabled={isLoggingIn}
            className="brand-button group relative flex items-center gap-4 px-14 py-5 disabled:opacity-50"
          >
            {isLoggingIn ? <Loader2 className="animate-spin" size={20} /> : "Initialize Identity"}
            {!isLoggingIn && <ChevronRight className="transition-transform group-hover:translate-x-1" size={20} />}
          </button>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest"
            >
              <AlertCircle size={14} />
              {error}
            </motion.div>
          )}
          
          <div className="flex items-center gap-4 pt-12">
            <p className="text-[9px] font-black text-black/20 dark:text-white/20 uppercase tracking-[0.4em]">
              V1.1.0 // SECURE PROTOCOL // CLOUD INFRASTRUCTURE
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
