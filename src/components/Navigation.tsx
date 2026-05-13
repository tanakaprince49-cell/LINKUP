import React from 'react';
import { motion } from 'framer-motion';
import { Home, Users, Bell, MessageSquare, User, Search, Settings, Zap, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onProfileClick: () => void;
  hidden?: boolean;
}

export const BottomNavigation: React.FC<NavigationProps> = ({ activeTab, setActiveTab, onProfileClick, hidden }) => {
  const [isScrolledDown, setIsScrolledDown] = React.useState(false);
  const lastScrollY = React.useRef(0);

  React.useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;

    const handleScroll = () => {
      const currentScrollY = main.scrollTop;
      if (currentScrollY > lastScrollY.current && currentScrollY > 50) {
        setIsScrolledDown(true);
      } else {
        setIsScrolledDown(false);
      }
      lastScrollY.current = currentScrollY;
    };

    main.addEventListener('scroll', handleScroll);
    return () => main.removeEventListener('scroll', handleScroll);
  }, []);

  const isActuallyHidden = hidden || isScrolledDown;

  const tabs = [
    { id: 'home', icon: Home, label: 'Feed' },
    { id: 'swipe', icon: Search, label: 'Swipe' },
    { id: 'matches', icon: Users, label: 'Matches' },
    { id: 'notifications', icon: Bell, label: 'Alerts' },
    { id: 'messages', icon: MessageSquare, label: 'Chat' },
  ];

  return (
    <motion.nav 
      initial={false}
      animate={{ y: isActuallyHidden ? 100 : 0, opacity: isActuallyHidden ? 0 : 1 }}
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 transition-all duration-300"
    >
      <div className="mx-auto max-w-md">
        <div className="liquid-card h-16 px-4 flex items-center justify-around border-white/5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="group relative flex flex-col items-center justify-center p-2 h-full flex-1 transition-all duration-300"
              >
                <div className={`relative z-10 flex flex-col items-center gap-1 transition-all duration-300 ${
                  isActive ? 'text-accent-yellow scale-110' : 'text-white/30 group-hover:text-white/60'
                }`}>
                  <Icon size={20} className={isActive ? 'drop-shadow-[0_0_8px_rgba(251,230,24,0.4)]' : ''} />
                  <span className={`text-[8px] font-black uppercase tracking-widest transition-all ${isActive ? 'opacity-100' : 'opacity-40'}`}>
                    {tab.label}
                  </span>
                </div>
                {isActive && (
                  <motion.div
                    layoutId="activeTabGlow"
                    className="absolute bottom-2 w-1 h-1 bg-accent-yellow rounded-full shadow-glow"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </motion.nav>
  );
};

export const Header: React.FC<{ onProfileClick: () => void; onPostClick: () => void; hidden?: boolean }> = ({ onProfileClick, onPostClick, hidden }) => {
  const { profile } = useAuth();
  const [isScrolledDown, setIsScrolledDown] = React.useState(false);
  const lastScrollY = React.useRef(0);

  React.useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;

    const handleScroll = () => {
      const currentScrollY = main.scrollTop;
      if (currentScrollY > lastScrollY.current && currentScrollY > 50) {
        setIsScrolledDown(true);
      } else {
        setIsScrolledDown(false);
      }
      lastScrollY.current = currentScrollY;
    };

    main.addEventListener('scroll', handleScroll);
    return () => main.removeEventListener('scroll', handleScroll);
  }, []);

  const isActuallyHidden = hidden || isScrolledDown;

  return (
    <motion.header 
      initial={false}
      animate={{ y: isActuallyHidden ? -100 : 0, opacity: isActuallyHidden ? 0 : 1 }}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 bg-white/80 dark:bg-[#050508]/80 backdrop-blur-3xl border-b border-black/5 dark:border-white/5 transition-all duration-300"
    >
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-yellow text-black shadow-glow">
            <Zap size={18} fill="currentColor" />
          </div>
          <h1 className="text-xl font-black font-display tracking-tighter text-black dark:text-white italic">
            LINK<span className="text-accent-yellow">UP</span>
          </h1>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <button 
          onClick={onPostClick}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-yellow text-black shadow-glow active:scale-95 transition-all"
        >
          <Plus size={20} className="font-bold" />
        </button>
        
        <div className="w-px h-6 bg-white/10 mx-1" />
        
        <button
          onClick={onProfileClick}
          className="relative h-9 w-9 overflow-hidden rounded-xl border border-white/10 p-0.5 shadow-lg active:scale-95 transition-all shrink-0 hover:border-accent-yellow/30"
        >
          {profile?.profilePic ? (
            <img src={profile.profilePic} alt="Profile" className="h-full w-full object-cover rounded-[10px]" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-900 rounded-[10px]">
              <User size={18} className="text-black/40 dark:text-white/40" />
            </div>
          )}
        </button>

        <button className="h-9 w-9 flex items-center justify-center rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors hover:border-accent-yellow/30">
          <Settings size={18} />
        </button>
      </div>
    </motion.header>
  );
};
