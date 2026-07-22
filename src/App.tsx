/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BottomNavigation, Header } from './components/Navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

// Pages - We'll build these next
import FeedPage from './pages/FeedPage';
import SwipePage from './pages/SwipePage';
import MatchPage from './pages/MatchPage';
import NotificationsPage from './pages/NotificationsPage';
import MessagesPage from './pages/MessagesPage';
import ProfilePage from './pages/ProfilePage';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import CreatePostModal from './components/CreatePostModal';
import { Post } from './types';

const PageWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    className="h-full w-full"
  >
    {children}
  </motion.div>
);

function AppContent() {
  const { user, profile, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('home');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPostModalOpen, setIsPostModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isNavHidden, setIsNavHidden] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-white dark:bg-black gap-4 transition-colors">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent-yellow border-t-transparent shadow-glow" />
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-accent-yellow animate-pulse italic">Establishing Link...</p>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  if (profile && !profile.onboarded) {
    return <OnboardingPage />;
  }

  const renderPage = () => {
    switch (activeTab) {
      case 'home': return <FeedPage key={refreshKey} />;
      case 'swipe': return <SwipePage onToggleNav={(hide) => setIsNavHidden(hide)} />;
      case 'matches': return <MatchPage />;
      case 'notifications': return <NotificationsPage />;
      case 'messages': return <MessagesPage />;
      default: return <FeedPage />;
    }
  };

  return (
    <div className="relative h-screen w-full overflow-hidden theme-bg text-black dark:text-white font-sans transition-colors liquid-shell">
      {/* Background Atmosphere - Immersive UI Style */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="bg-glow -top-[220px] -left-[120px] opacity-60" />
        <div className="bg-glow -bottom-[220px] -right-[120px] opacity-40" style={{ background: 'radial-gradient(circle, #FBE618 0%, transparent 70%)' }} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,230,24,0.08),_transparent_45%),radial-gradient(circle_at_bottom_right,_rgba(251,230,24,0.06),_transparent_40%)] opacity-70" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <Header 
          onProfileClick={() => setIsProfileOpen(true)} 
          onPostClick={() => setIsPostModalOpen(true)} 
          hidden={isNavHidden}
        />
        
        <main className="flex-1 overflow-y-auto px-4 pb-20 pt-16 custom-scrollbar max-w-2xl mx-auto w-full">
          <AnimatePresence mode="wait">
            <PageWrapper key={activeTab}>
              {renderPage()}
            </PageWrapper>
          </AnimatePresence>
        </main>

        <BottomNavigation 
          activeTab={activeTab} 
          setActiveTab={setActiveTab} 
          onProfileClick={() => setIsProfileOpen(true)} 
          hidden={isNavHidden}
        />
      </div>

      {/* Profile Sidebar/Modal */}
      <AnimatePresence>
        {isProfileOpen && (
          <ProfilePage onClose={() => setIsProfileOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isPostModalOpen && (
          <CreatePostModal 
            onClose={() => setIsPostModalOpen(false)} 
            onPostCreated={() => setRefreshKey(prev => prev + 1)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
