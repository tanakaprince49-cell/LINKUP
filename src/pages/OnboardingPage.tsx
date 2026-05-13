import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Target, Briefcase, Zap, ChevronRight, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

const steps = [
  {
    id: 'role',
    title: 'What is your current focus?',
    icon: Rocket,
    options: [
      { id: 'founder', label: 'Technical Founder', desc: 'Building the core product' },
      { id: 'growth', label: 'Growth/Marketing', desc: 'Scaling the user base' },
      { id: 'investor', label: 'Angel/VC', desc: 'Seeking the next unicorn' },
      { id: 'advisor', label: 'Advisor', desc: 'Expert guidance for startups' }
    ]
  },
  {
    id: 'experience',
    title: 'What is your experience level?',
    icon: Target,
    options: [
      { id: 'serial', label: 'Serial Entrepreneur', desc: 'Multiple exits/attempts' },
      { id: 'first', label: 'First-time Founder', desc: 'Deep in the first build' },
      { id: 'senior', label: 'Senior IC', desc: 'Ex-big tech, now building' },
      { id: 'student', label: 'Hustling Student', desc: 'Early stage, high energy' }
    ]
  },
  {
    id: 'industries',
    title: 'Which industries excite you?',
    icon: Zap,
    options: [
      { id: 'ai', label: 'AI/ML', desc: 'Neural nets & LLMs' },
      { id: 'fintech', label: 'Fintech', desc: 'Payments & DeFi' },
      { id: 'health', label: 'HealthTech', desc: 'Bio & Wellness' },
      { id: 'saas', label: 'B2B SaaS', desc: 'Enterprise efficiency' }
    ]
  }
];

export default function OnboardingPage() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [isFinishing, setIsFinishing] = useState(false);

  const handleSelect = (stepId: string, optionId: string) => {
    setSelections(prev => ({ ...prev, [stepId]: optionId }));
    if (currentStep < steps.length - 1) {
      setTimeout(() => setCurrentStep(prev => prev + 1), 300);
    }
  };

  const handleFinish = async () => {
    if (!user) return;
    setIsFinishing(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        onboarded: true,
        experience: selections.experience,
        industries: [selections.industries],
        commitmentLevel: 'Full-time' // Default for onboarding
      });
      window.location.reload(); // Refresh to trigger app state change
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsFinishing(false);
    }
  };

  const step = steps[currentStep];

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-[#050508] px-6 py-20 overflow-hidden">
      {/* Glows */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[20%] right-[-10%] w-[500px] h-[500px] bg-accent-yellow/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[10%] left-[-10%] w-[400px] h-[400px] bg-white/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        {/* Progress bar */}
        <div className="mb-12 flex gap-2 h-1 px-4">
          {steps.map((_, i) => (
            <div 
              key={i} 
              className={`flex-1 rounded-full transition-all duration-500 ${
                i <= currentStep ? 'bg-accent-yellow shadow-glow' : 'bg-white/10'
              }`} 
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="space-y-4 px-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-yellow/10 border border-accent-yellow/20 text-accent-yellow">
                <step.icon size={24} />
              </div>
              <h1 className="text-4xl font-black tracking-tight text-white font-display italic uppercase leading-none">
                {step.title}
              </h1>
            </div>

            <div className="grid gap-3">
              {step.options.map((option) => {
                const isSelected = selections[step.id] === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelect(step.id, option.id)}
                    className={`group relative flex flex-col items-start p-6 rounded-[2rem] border transition-all duration-300 text-left ${
                      isSelected 
                        ? 'bg-accent-yellow border-accent-yellow shadow-glow' 
                        : 'bg-zinc-900/40 border-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between mb-1">
                      <span className={`text-sm font-black uppercase tracking-widest ${isSelected ? 'text-black' : 'text-white'}`}>
                        {option.label}
                      </span>
                      {isSelected && <Check size={16} className="text-black" />}
                    </div>
                    <span className={`text-xs font-medium ${isSelected ? 'text-black/60' : 'text-white/40'}`}>
                      {option.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {currentStep === steps.length - 1 && selections[step.id] && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12 px-2"
          >
            <button
              onClick={handleFinish}
              disabled={isFinishing}
              className="w-full h-16 flex items-center justify-center gap-3 rounded-[2rem] bg-white text-black font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl hover:bg-accent-yellow hover:shadow-glow transition-all active:scale-95 disabled:opacity-50"
            >
              {isFinishing ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-black border-t-transparent" />
              ) : (
                <>
                  Connect To Network
                  <ChevronRight size={18} />
                </>
              )}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
