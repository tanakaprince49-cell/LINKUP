import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { onAuthStateChanged, User, signOut, signInWithEmailAndPassword, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// CONFIGURATION: Replace these when you are ready to launch to the App Store
const GOOGLE_CONFIG = {
  webClientId: '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com',
  androidClientId: '70946124449-of65t4a84qtq8llu58rf3g0g7lbgn534.apps.googleusercontent.com',
  iosClientId: '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com', // Placeholder
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [request, response, promptAsync] = Google.useAuthRequest({
    ...GOOGLE_CONFIG,
    responseType: 'id_token',
    redirectUri: 'https://auth.expo.io/@tanakaprince49-cell/linkup',
  });

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token, authentication } = response.params;
      const credential = GoogleAuthProvider.credential(id_token || authentication?.idToken);
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
              viewedBy: [],
              isStealthMode: false,
              hasExit: false,
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
    const finalRedirectUri = 'https://auth.expo.io/@tanakaprince49-cell/linkup';
    Alert.alert("DEBUG: Redirect URI", finalRedirectUri);
    console.log("Starting Google Auth flow...");
    console.log("Using Redirect URI:", finalRedirectUri);
    
    try {
      const result = await promptAsync();
      if (result.type === 'success') {
        const { id_token } = result.params;
        const credential = GoogleAuthProvider.credential(id_token);
        await signInWithCredential(auth, credential);
      } else if (result.type === 'error') {
        Alert.alert("Authentication Error", "Google Sign-In failed. Please try again.");
      }
    } catch (error: any) {
      console.error("Google Auth Error:", error);
      Alert.alert("Connection Error", "Could not reach Google. Check your internet connection.");
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const deleteAccount = async () => {
    if (!auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      // Delete Firestore document first
      await setDoc(doc(db, 'users', uid), { deleted: true }, { merge: true }); // Soft delete or just remove doc
      // In a real app, you'd trigger a cloud function to cleanup posts/matches
      await auth.currentUser.delete();
    } catch (error) {
      console.error("Delete account error:", error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, logout, deleteAccount }}>
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
