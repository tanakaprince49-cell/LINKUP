export interface Project {
  name: string;
  description: string;
  url?: string;
  role: string;
}

export interface StartupIdea {
  title: string;
  vision: string;
  stage: 'napkin' | 'prototype' | 'mvp' | 'scaling';
}

export interface StartupResume {
  shippedProducts: string[];
  sideProjects: string[];
  startupAttempts: string[];
  hackathonWins: string[];
  buildStreaks: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  bio: string;
  skills: string[];
  interests: string[];
  goals: string;
  country: string;
  city: string;
  age: number;
  experience: string;
  personalityType: string;
  commitmentLevel: string;
  industries: string[];
  profilePic?: string;
  coverPhoto?: string;
  achievements: string[];
  badges: string[];
  reputationScore: number;
  streakCount: number;
  lastActiveAt: any;
  createdAt: any;
  socialLinks: Record<string, string>;
  isVisible: boolean;
  isBot: boolean;
  // Enhanced Fields
  projects: Project[];
  portfolioLinks: string[];
  startupIdeas: StartupIdea[];
  resume: StartupResume;
  onboarded: boolean;
}

export interface Block {
  id: string;
  blockedById: string;
  blockedUserId: string;
  timestamp: any;
}

export interface Report {
  id: string;
  reportedById: string;
  reportedUserId: string;
  reason: string;
  details?: string;
  timestamp: any;
  status: 'pending' | 'reviewed' | 'resolved';
}

export interface Swipe {
  fromId: string;
  toId: string;
  type: 'like' | 'pass' | 'superconnect';
  timestamp: any;
}

export interface Match {
  id: string;
  userIds: string[];
  matchedAt: any;
  lastMessage?: string;
  lastMessageAt?: any;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: any;
  isRead: boolean;
}

export interface Post {
  id: string;
  authorId: string;
  type: 'build' | 'launch' | 'achievement' | 'update';
  content: string;
  mediaUrl?: string;
  likesCount: number;
  commentsCount: number;
  timestamp: any;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  fromId: string;
  content: string;
  isRead: boolean;
  timestamp: any;
}
