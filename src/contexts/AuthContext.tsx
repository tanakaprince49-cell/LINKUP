import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Timeout fallback to prevent infinite loading state
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout);
      setUser(user);
      if (user) {
        // Fetch/Create profile
        const userDoc = doc(db, 'users', user.uid);
        try {
          const docSnap = await getDoc(userDoc);
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            if (data.onboarded === undefined) data.onboarded = false;
            setProfile(data);
          } else {
            // Create default profile
            const newProfile: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'New Builder',
              bio: '',
              skills: [],
              interests: [],
              goals: '',
              country: '',
              city: '',
              age: 20,
              experience: '',
              personalityType: '',
              commitmentLevel: '',
              industries: [],
              profilePic: user.photoURL || '',
              coverPhoto: '',
              achievements: [],
              badges: [],
              reputationScore: 0,
              streakCount: 0,
              lastActiveAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              socialLinks: {},
              isVisible: true,
              isBot: false,
              projects: [],
              portfolioLinks: [],
              startupIdeas: [],
              resume: {
                shippedProducts: [],
                sideProjects: [],
                startupAttempts: [],
                hackathonWins: [],
                buildStreaks: 0
              },
              onboarded: false
            };
            await setDoc(userDoc, newProfile);
            setProfile(newProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Sign in error:", error);
    }
  };

  const logOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, logOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
