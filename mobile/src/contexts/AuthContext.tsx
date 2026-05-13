import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signOut, signInWithEmailAndPassword, signInAnonymously, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// CONFIGURATION: Replace these when you are ready to launch to the App Store
const GOOGLE_CONFIG = {
  iosClientId: 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com',
  androidClientId: 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com',
  webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [request, response, promptAsync] = Google.useAuthRequest(GOOGLE_CONFIG);

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      signInWithCredential(auth, credential);
    }
  }, [response]);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (authenticatedUser) => {
      setUser(authenticatedUser);
      
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (authenticatedUser) {
        const userDocRef = doc(db, 'users', authenticatedUser.uid);
        
        unsubscribeProfile = onSnapshot(userDocRef, async (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);
            setLoading(false);
          } else {
            const newProfile: UserProfile = {
              uid: authenticatedUser.uid,
              displayName: authenticatedUser.displayName || 'New Builder',
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
              profilePic: authenticatedUser.photoURL || '',
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
            await setDoc(userDocRef, newProfile);
            setProfile(newProfile);
            setLoading(false);
          }
        }, (error) => {
          console.error("Profile listener error:", error);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const signInWithGoogle = async () => {
    console.log("Authenticating...");
    
    // Check if client IDs are still placeholders
    const isPlaceholder = GOOGLE_CONFIG.iosClientId.includes('YOUR_IOS_CLIENT_ID');
    
    if (isPlaceholder) {
      console.log("Using Developer Preview Mode (Anonymous)...");
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Auth failed:", error);
      }
      return;
    }

    try {
      await promptAsync();
    } catch (error) {
      console.log("Google Auth failed, falling back to Anonymous:", error);
      await signInAnonymously(auth);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, logout }}>
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
