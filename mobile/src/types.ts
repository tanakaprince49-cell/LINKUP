import { FieldValue, Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  displayName: string;
  username?: string;
  profileLink?: string;
  bio: string;
  profilePic: string;
  photos?: string[];
  coverPhoto?: string;
  occupation?: string;
  company?: string;
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
  founderScore?: number;
  reputationMetrics?: {
    reliability?: number; // 0-100
    responseRate?: number; // 0-100
    collaboration?: number; // 0-100
    consistency?: number; // 0-100
    completion?: number; // 0-100
  };
  aiMatchInsights?: string;
  networkingIntent?: string; // e.g. "Serious Builder"
  onboarded: boolean;
  isVisible: boolean;
  turboConnect?: boolean;
  settings?: {
    publicDiscovery?: boolean;
    stealthMode?: boolean;
    turboConnect?: boolean;
    hideOnlineStatus?: boolean;
    darkMode?: boolean;
  };
  isBot: boolean;
  isOnline?: boolean;
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
  startupIdeas?: StartupIdea[];
  viewedBy: string[];
  isStealthMode: boolean; // For private discovery
  hideOnlineStatus?: boolean;
  hasExit: boolean; // Verified serial founder
  vibeMedia?: string; // Base64 audio/video intro
  isVerified?: boolean;
  verificationProgram?: string;
  verifiedAt?: Timestamp | FieldValue;
  verifiedBy?: string;
  isPro?: boolean;
  plan?: string;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
  proUnlockedAt?: Timestamp | FieldValue | string;
  subscriptionUpdatedAt?: Timestamp | FieldValue | string;
  availability?: string; // e.g. "Available now", "Weekends"
  timezone?: string; // e.g. "UTC+2"
  languages?: string[];
  lookingFor?: string[]; // e.g. ["Cofounder", "Hiring"]
  startupStage?: string; // e.g. "Idea", "MVP"
  fundingStage?: string; // e.g. "Bootstrapped", "Raised"
  workStyle?: string; // e.g. "Fast-paced"
  education?: string; // e.g. "Student", "PhD"
  remoteOnly?: boolean;
  willingToRelocate?: boolean;
  teamSizePreference?: string; // e.g. "Solo Founder"
  circles?: string[];
  personalityAnswers?: Record<string, string>;
  roleAnswers?: Record<string, string | string[]>;
  shipLogs?: { id: string; text: string; link?: string; createdAt: string }[];
  shipCount?: number;
  lastShippedAt?: string;
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

export interface StartupIdea {
  id: string;
  title: string;
  description: string;
  stage?: string;
  lookingFor?: string[];
  tags?: string[];
  createdAt?: Timestamp | FieldValue;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorPic?: string;
  authorVerified?: boolean;
  content: string;
  type: 'build' | 'launch' | 'achievement' | 'update';
  timestamp: Timestamp | FieldValue;
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  likedBy: string[];
  viewedBy: string[];
  media?: string[];
  powLink?: string;
}

export interface Match {
  id: string;
  userIds: string[];
  participants?: Record<string, boolean>;
  timestamp: Timestamp | FieldValue;
  lastMessage?: string;
  lastMessageTime?: Timestamp | FieldValue;
  pinnedBy?: string[];
  archivedBy?: string[];
  importantBy?: string[];
  deletedBy?: string[];
  confidentialBy?: string[];
  mutedUntilBy?: Record<string, any>;
}

export interface Message {
  id: string;
  senderId: string;
  content: string;
  timestamp: Timestamp | FieldValue;
  type: 'text' | 'image' | 'video' | 'pow';
  mediaUrl?: string;
  mediaName?: string;
  mediaType?: string;
  mediaSize?: number;
  replyToMessageId?: string;
  replyToSenderId?: string;
  replyToText?: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  type:
    | 'like'
    | 'match'
    | 'view'
    | 'system'
    | 'message'
    | 'comment'
    | 'connection_request'
    | 'connection_approved'
    | 'connection_rejected'
    | 'game_challenge'
    | 'campaign_review'
    | 'campaign_approved'
    | 'campaign_rejected';
  content: string;
  timestamp: Timestamp | FieldValue;
  isRead: boolean;
  fromId?: string;
  fromName?: string;
  fromPic?: string;
  matchId?: string;
  requestId?: string;
  campaignId?: string;
  note?: string;
  gameType?: string;
}

export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorPic: string;
  mediaUrl?: string;
  type: 'image' | 'text';
  content?: string;
  viewers: string[];
  likes: string[];
  expiresAt: Timestamp | FieldValue;
  createdAt: Timestamp | FieldValue;
}

export interface Block {
  id: string;
  blockedById: string;
  blockedUserId: string;
  timestamp: Timestamp | FieldValue;
}

export type MissionType = 'swipe' | 'like' | 'connect' | 'view_profile' | 'message' | 'daily_login';

export interface DailyMission {
  id: string;
  type: MissionType;
  label: string;
  target: number;
  progress: number;
  completed: boolean;
  points: number;
}

export interface Achievement {
  id: string;
  label: string;
  description: string;
  icon: string;
  unlockedAt?: string;
  progress: number;
  target: number;
}

export interface WeeklyStats {
  weekStart: string;
  swipes: number;
  likes: number;
  connections: number;
  messages: number;
  profileViews: number;
  pointsEarned: number;
}

export interface GamificationState {
  streakCount: number;
  longestStreak: number;
  lastActiveDate: string;
  sparkPoints: number;
  totalEarned: number;
  missions: DailyMission[];
  missionsDate: string;
  achievements: Achievement[];
  weeklyStats: WeeklyStats;
  lastWeeklyReportDate: string;
}
