import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Target, Briefcase, Zap, ChevronRight, Check, User, MapPin, Code } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

const steps = [
  {
    id: 'role',
    title: 'What is your current focus?',
    icon: Rocket,
    type: 'select',
    options: [
      { id: 'founder', label: 'Technical Founder', desc: 'Building the core product' },
      { id: 'growth', label: 'Growth/Marketing', desc: 'Scaling the user base' },
      { id: 'investor', label: 'Angel/VC', desc: 'Seeking the next unicorn' },
      { id: 'advisor', label: 'Advisor', desc: 'Expert guidance for startups' }
    ]
  },
  {
    id: 'ambition',
    title: 'What is your ambition level?',
    icon: Zap,
    type: 'select',
    options: [
      { id: 'unicorn', label: 'Unicorn or Bust', desc: 'Building a $1B+ company' },
      { id: 'lifestyle', label: 'Profitable Indie', desc: 'Sustainable, high-margin business' },
      { id: 'impact', label: 'Social Impact', desc: 'Solving world-scale problems' },
      { id: 'learn', label: 'Skill Acquisition', desc: 'Focused on growth and learning' }
    ]
  },
  {
    id: 'profile_basic',
    title: 'Set up your identity',
    icon: User,
    type: 'form',
    fields: [
      { id: 'displayName', label: 'Display Name', placeholder: 'Elon Musk', icon: User },
      { id: 'city', label: 'Location', placeholder: 'San Francisco, CA', icon: MapPin },
      { id: 'age', label: 'Age', placeholder: '25', icon: Target }
    ]
  },
  {
    id: 'bio',
    title: 'Tell us your story',
    icon: Briefcase,
    type: 'textarea',
    field: { id: 'bio', label: 'Founder Bio', placeholder: 'Serial entrepreneur building the future of...', icon: Briefcase }
  },
  {
    id: 'experience',
    title: 'What is your experience level?',
    icon: Target,
    type: 'select',
    options: [
      { id: 'serial', label: 'Serial Entrepreneur', desc: 'Multiple exits/attempts' },
      { id: 'first', label: 'First-time Founder', desc: 'Deep in the first build' },
      { id: 'senior', label: 'Senior IC', desc: 'Ex-big tech, now building' },
      { id: 'student', label: 'Hustling Student', desc: 'Early stage, high energy' }
    ]
  },
  {
    id: 'commitment',
    title: 'What is your commitment level?',
    icon: Zap,
    type: 'select',
    options: [
      { id: 'fulltime', label: 'Full-time', desc: '100% focused on building' },
      { id: 'parttime', label: 'Part-time', desc: 'Building alongside other work' },
      { id: 'weekend', label: 'Weekend Warrior', desc: 'Exploring ideas on the side' },
      { id: 'flexible', label: 'Flexible', desc: 'Ready to jump in for the right idea' }
    ]
  },
  {
    id: 'industries',
    title: 'Which industries excite you?',
    icon: Zap,
    type: 'select',
    options: [
      { id: 'ai', label: 'AI/ML', desc: 'Neural nets & LLMs' },
      { id: 'fintech', label: 'Fintech', desc: 'Payments & DeFi' },
      { id: 'health', label: 'HealthTech', desc: 'Bio & Wellness' },
      { id: 'saas', label: 'B2B SaaS', desc: 'Enterprise efficiency' }
    ]
  },
  {
    id: 'skills',
    title: 'What are your core skills?',
    icon: Code,
    type: 'input',
    field: { id: 'skills', label: 'Skills (comma separated)', placeholder: 'React, Node.js, Python, Sales', icon: Code }
  }
];

export default function OnboardingPage() {
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isFinishing, setIsFinishing] = useState(false);

  const handleSelect = (stepId: string, optionId: string) => {
    setFormData(prev => ({ ...prev, [stepId]: optionId }));
    if (currentStep < steps.length - 1) {
      setTimeout(() => setCurrentStep(prev => prev + 1), 300);
    }
  };

  const handleInputChange = (fieldId: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleFinish = async () => {
    if (!user) return;
    setIsFinishing(true);
    try {
      const skillsArray = formData.skills ? formData.skills.split(',').map((s: string) => s.trim()) : [];
      await updateDoc(doc(db, 'users', user.uid), {
        onboarded: true,
        displayName: formData.displayName || user.displayName,
        city: formData.city || 'Unknown',
        age: parseInt(formData.age) || 20,
        bio: formData.bio || '',
        experience: formData.experience || 'first',
        ambition: formData.ambition || 'unicorn',
        industries: [formData.industries || 'ai'],
        skills: skillsArray,
        commitmentLevel: formData.commitment || 'fulltime'
      });
      window.location.reload();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsFinishing(false);
    }
  };

  const step = steps[currentStep];

  const isStepValid = () => {
    if (step.type === 'select') return !!formData[step.id];
    if (step.type === 'form') return step.fields?.every(f => !!formData[f.id]);
    if (step.type === 'textarea') return !!formData[step.field.id];
    if (step.type === 'input') return !!formData[step.field.id];
    return false;
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-white dark:bg-[#050508] px-6 py-20 overflow-hidden transition-colors">
      {/* Glows */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[20%] right-[-10%] w-[500px] h-[500px] bg-accent-yellow/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[10%] left-[-10%] w-[400px] h-[400px] bg-black/5 dark:bg-white/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        {/* Progress bar */}
        <div className="mb-12 flex gap-2 h-1 px-4">
          {steps.map((_, i) => (
            <div 
              key={i} 
              className={`flex-1 rounded-full transition-all duration-500 ${
                i <= currentStep ? 'bg-accent-yellow shadow-glow' : 'bg-black/10 dark:bg-white/10'
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
              <h1 className="text-4xl font-black tracking-tight text-black dark:text-white font-display italic uppercase leading-none">
                {step.title}
              </h1>
            </div>

            <div className="grid gap-3">
              {step.type === 'select' && step.options?.map((option) => {
                const isSelected = formData[step.id] === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelect(step.id, option.id)}
                    className={`group relative flex flex-col items-start p-6 rounded-[2rem] border transition-all duration-300 text-left ${
                      isSelected 
                        ? 'bg-accent-yellow border-accent-yellow shadow-glow' 
                        : 'bg-zinc-100 dark:bg-zinc-900/40 border-black/5 dark:border-white/5 hover:border-black/20 dark:hover:border-white/20'
                    }`}
                  >
                    <div className="flex w-full items-center justify-between mb-1">
                      <span className={`text-sm font-black uppercase tracking-widest ${isSelected ? 'text-black' : 'text-black dark:text-white'}`}>
                        {option.label}
                      </span>
                      {isSelected && <Check size={16} className="text-black" />}
                    </div>
                    <span className={`text-xs font-medium ${isSelected ? 'text-black/60' : 'text-black/40 dark:text-white/40'}`}>
                      {option.desc}
                    </span>
                  </button>
                );
              })}

              {step.type === 'form' && step.fields?.map((field) => (
                <div key={field.id} className="space-y-2">
                  <div className="relative group">
                    <field.icon size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-black/20 dark:text-white/20 group-focus-within:text-accent-yellow transition-colors" />
                    <input
                      type="text"
                      placeholder={field.placeholder}
                      value={formData[field.id] || ''}
                      onChange={(e) => handleInputChange(field.id, e.target.value)}
                      className="w-full h-16 bg-zinc-100 dark:bg-zinc-900/40 border border-black/5 dark:border-white/5 rounded-[2rem] pl-14 pr-6 text-sm font-bold text-black dark:text-white placeholder:text-black/20 dark:placeholder:text-white/10 focus:border-accent-yellow/30 outline-none transition-all"
                    />
                  </div>
                </div>
              ))}

              {step.type === 'textarea' && (
                <textarea
                  placeholder={step.field.placeholder}
                  value={formData[step.field.id] || ''}
                  onChange={(e) => handleInputChange(step.field.id, e.target.value)}
                  className="w-full h-48 bg-zinc-100 dark:bg-zinc-900/40 border border-black/5 dark:border-white/5 rounded-[2rem] p-8 text-sm font-bold text-black dark:text-white placeholder:text-black/20 dark:placeholder:text-white/10 focus:border-accent-yellow/30 outline-none transition-all resize-none"
                />
              )}

              {step.type === 'input' && (
                <div className="relative group">
                  <step.field.icon size={16} className="absolute left-6 top-1/2 -translate-y-1/2 text-black/20 dark:text-white/20 group-focus-within:text-accent-yellow transition-colors" />
                  <input
                    type="text"
                    placeholder={step.field.placeholder}
                    value={formData[step.field.id] || ''}
                    onChange={(e) => handleInputChange(step.field.id, e.target.value)}
                    className="w-full h-16 bg-zinc-100 dark:bg-zinc-900/40 border border-black/5 dark:border-white/5 rounded-[2rem] pl-14 pr-6 text-sm font-bold text-black dark:text-white placeholder:text-black/20 dark:placeholder:text-white/10 focus:border-accent-yellow/30 outline-none transition-all"
                  />
                </div>
              )}
            </div>

            {step.type !== 'select' && (
              <button
                disabled={!isStepValid()}
                onClick={handleNext}
                className="w-full h-16 flex items-center justify-center gap-3 rounded-[2rem] bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.2em] text-[10px] shadow-2xl hover:bg-accent-yellow hover:text-black transition-all active:scale-95 disabled:opacity-20"
              >
                Next Step
                <ChevronRight size={18} />
              </button>
            )}
          </motion.div>
        </AnimatePresence>

        {currentStep === steps.length - 1 && isStepValid() && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12 px-2"
          >
            <button
              onClick={handleFinish}
              disabled={isFinishing}
              className="w-full h-16 flex items-center justify-center gap-3 rounded-[2rem] bg-accent-yellow text-black font-black uppercase tracking-[0.2em] text-[10px] shadow-glow hover:scale-[1.02] transition-all active:scale-95 disabled:opacity-50"
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
