import { FieldValue, Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  displayName: string;
  bio: string;
  profilePic: string;
  coverPhoto?: string;
  city: string;
  country: string;
  age: number;
  skills: string[];
  interests: string[];
  goals: string;
  experience: string; // 'beginner' | 'intermediate' | 'expert'
  personalityType: string;
  commitmentLevel: string; // 'fulltime' | 'parttime' | 'sideproject'
  industries: string[];
  ambition: string; // 'unicorn' | 'lifestyle' | 'impact'
  reputationScore: number;
  streakCount: number;
  onboarded: boolean;
  isVisible: boolean;
  isBot: boolean;
  lastActiveAt: Timestamp | FieldValue;
  createdAt: Timestamp | FieldValue;
  socialLinks: {
    github?: string;
    linkedin?: string;
    twitter?: string;
    portfolio?: string;
  };
  resume: StartupResume;
  badges: string[];
  projects: Project[];
}

export interface StartupResume {
  shippedProducts: string[];
  sideProjects: string[];
  startupAttempts: string[];
  hackathonWins: string[];
  buildStreaks: number;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  link?: string;
  status: 'idea' | 'mvp' | 'live';
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  type: 'build' | 'launch' | 'achievement' | 'update';
  timestamp: Timestamp | FieldValue;
  likesCount: number;
  commentsCount: number;
  likedBy: string[];
  mediaUrl?: string;
  powLink?: string; // Proof of Work link
}

export interface Match {
  id: string;
  userIds: string[];
  timestamp: Timestamp | FieldValue;
  lastMessage?: string;
  lastMessageTime?: Timestamp | FieldValue;
}

export interface Message {
  id: string;
  senderId: string;
  content: string;
  timestamp: Timestamp | FieldValue;
  type: 'text' | 'image' | 'pow';
}

export interface AppNotification {
  id: string;
  userId: string;
  type: 'like' | 'match' | 'view' | 'system';
  content: string;
  timestamp: Timestamp | FieldValue;
  isRead: boolean;
  fromId?: string;
}

export interface Block {
  id: string;
  blockedById: string;
  blockedUserId: string;
  timestamp: Timestamp | FieldValue;
}
