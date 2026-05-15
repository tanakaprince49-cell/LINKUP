import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { onAuthStateChanged, User, signOut, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

// Configure Google Sign-In with the WEB Client ID (Firebase requires this for credential exchange)
GoogleSignin.configure({
  webClientId: '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com',
});

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

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
    console.log("Starting Native Google Sign-In...");
    
    try {
      // Check if Google Play Services are available
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      
      // Sign in natively (no browser, no redirect URI!)
      const signInResult = await GoogleSignin.signIn();
      const idToken = signInResult?.data?.idToken;
      
      if (!idToken) {
        Alert.alert("Authentication Error", "Could not retrieve Google token. Please try again.");
        return;
      }
      
      // Exchange the native token for a Firebase credential
      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
      console.log("Firebase sign-in successful!");
    } catch (error: any) {
      console.error("Google Auth Error:", error);
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled — do nothing
      } else if (error.code === statusCodes.IN_PROGRESS) {
        Alert.alert("Please Wait", "Sign-in is already in progress.");
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert("Error", "Google Play Services are not available on this device.");
      } else {
        Alert.alert("Sign-In Error", error.message || "Something went wrong. Please try again.");
      }
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
