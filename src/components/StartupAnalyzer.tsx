import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { analyzeStartupIdea } from '../lib/gemini';
import { Rocket, Brain, BarChart3, TrendingUp, DollarSign, X, Loader2, ShieldAlert } from 'lucide-react';

export default function StartupAnalyzerModal({ onClose }: { onClose: () => void }) {
  const [idea, setIdea] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!idea.trim()) return;
    setLoading(true);
    const analysis = await analyzeStartupIdea(idea);
    setResult(analysis);
    setLoading(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="relative w-full max-w-lg rounded-[2.5rem] bg-zinc-900 border border-white/10 p-8 shadow-2xl"
      >
        <button onClick={onClose} className="absolute right-6 top-6 text-white/40 hover:text-white">
          <X size={24} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <Brain className="text-accent-yellow" size={32} />
          <h2 className="text-2xl font-black italic tracking-tighter uppercase">AI <span className="text-accent-yellow">ANALYZER</span></h2>
        </div>

        {!result ? (
          <div className="space-y-6">
            <p className="text-xs font-bold text-white/40 uppercase tracking-widest">Submit your startup concept for an elite AI risk evaluation.</p>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="The world's first decentralized..."
              className="w-full rounded-2xl bg-white/5 border border-white/10 p-4 text-sm font-medium outline-none h-32 transition-all focus:border-accent-yellow/50"
            />
            <button
              disabled={!idea.trim() || loading}
              onClick={handleAnalyze}
              className="w-full brand-button flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Rocket size={20} />}
              {loading ? 'CALCULATING...' : 'GENERATE ANALYSIS'}
            </button>
          </div>
        ) : (
          <div className="space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 mb-2 text-blue-400">
                  <BarChart3 size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Market</span>
                </div>
                <p className="text-xs text-white/70 leading-relaxed">{result.marketPotential}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 mb-2 text-green-400">
                  <TrendingUp size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Scalability</span>
                </div>
                <p className="text-xs text-white/70 leading-relaxed">{result.scalability}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 mb-2 text-yellow-400">
                  <DollarSign size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Monetization</span>
                </div>
                <p className="text-xs text-white/70 leading-relaxed">{result.monetization}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-4 border border-white/5">
                <div className="flex items-center gap-2 mb-2 text-red-400">
                  <ShieldAlert size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Competition</span>
                </div>
                <p className="text-xs text-white/70 leading-relaxed">{result.competition}</p>
              </div>
            </div>
            <div className="rounded-2xl bg-accent-yellow/10 p-5 border border-accent-yellow/20">
              <p className="text-[10px] font-black uppercase tracking-widest text-accent-yellow mb-2">Executive Summary</p>
              <p className="text-sm italic text-white/80 leading-relaxed">"{result.summary}"</p>
            </div>
            <button
              onClick={() => setResult(null)}
              className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-white/20 hover:text-white transition-colors"
            >
              Analyze another idea
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
