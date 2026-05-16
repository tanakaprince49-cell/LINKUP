import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert, AppState, NativeModules } from 'react-native';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
} from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';

const GOOGLE_WEB_CLIENT_ID =
  '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com';

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

  // Native Google Sign-In requires a dev client / prebuild / real APK.
  // Expo Go does not include `RNGoogleSignin`, so we guard usage at runtime.
  const hasNativeGoogleSignin = !!(NativeModules as any)?.RNGoogleSignin;

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (authenticatedUser) => {
      setUser(authenticatedUser);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!authenticatedUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, 'users', authenticatedUser.uid);
      unsubscribeProfile = onSnapshot(
        userDocRef,
        async (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            if (authenticatedUser.email === 'tanakaprince49@gmail.com' && !data.isVerified) {
              await updateDoc(userDocRef, { isVerified: true });
              data.isVerified = true;
            }
            setProfile(data);
            setLoading(false);
            return;
          }

          // Keep the initial profile permissive to avoid blocking auth on schema drift.
          const newProfile: any = {
            uid: authenticatedUser.uid,
            displayName: authenticatedUser.displayName || 'New Builder',
            bio: '',
            profilePic: authenticatedUser.photoURL || '',
            country: '',
            city: '',
            age: 20,
            skills: [],
            interests: [],
            goals: '',
            experience: '',
            personalityType: '',
            commitmentLevel: '',
            industries: [],
            ambition: '',
            reputationScore: 0,
            streakCount: 0,
            onboarded: false,
            isVisible: true,
            isBot: false,
            isOnline: true,
            lastActiveAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            socialLinks: {},
            resume: {
              shippedProducts: [],
              sideProjects: [],
              startupAttempts: [],
              hackathonWins: [],
              buildStreaks: 0,
            },
            badges: [],
            projects: [],
            viewedBy: [],
            isStealthMode: false,
            hasExit: false,
            isVerified: authenticatedUser.email === 'tanakaprince49@gmail.com',
            followers: [],
            following: [],
          };

          await setDoc(userDocRef, newProfile);
          setProfile(newProfile as UserProfile);
          setLoading(false);
        },
        (error) => {
          console.error('Profile listener error:', error);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);

    const setPresence = async (isOnline: boolean) => {
      try {
        await setDoc(userDocRef, { isOnline, lastActiveAt: serverTimestamp() }, { merge: true });
      } catch (e) {
        console.error('Presence update error:', e);
      }
    };

    setPresence(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setPresence(true);
      else setPresence(false);
    });

    return () => {
      sub.remove();
      setPresence(false);
    };
  }, [user?.uid]);

  const signInWithGoogle = async () => {
    try {
      if (!hasNativeGoogleSignin) {
        Alert.alert(
          'Google Sign-In Unavailable',
          'Native Google Sign-In is not available in Expo Go. Please run a development build / real APK that includes the Google Sign-In native module.'
        );
        return;
      }

      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
      });

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();
      const idToken = signInResult?.data?.idToken;

      if (!idToken) {
        Alert.alert('Authentication Error', 'Could not retrieve Google token. Please try again.');
        return;
      }

      const credential = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, credential);
    } catch (error: any) {
      console.error('Google Auth Error:', error);
      if (error?.code === statusCodes.SIGN_IN_CANCELLED) return;
      if (error?.code === statusCodes.IN_PROGRESS) {
        Alert.alert('Please Wait', 'Sign-in is already in progress.');
        return;
      }
      if (error?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Error', 'Google Play Services are not available on this device.');
        return;
      }
      Alert.alert('Sign-In Error', error?.message || 'Something went wrong. Please try again.');
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  const deleteAccount = async () => {
    if (!auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      await setDoc(doc(db, 'users', uid), { deleted: true }, { merge: true });
      await auth.currentUser.delete();
    } catch (error) {
      console.error('Delete account error:', error);
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
