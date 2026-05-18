import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert, AppState, NativeModules } from 'react-native';
import {
  GoogleAuthProvider,
  User,
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';

const GOOGLE_WEB_CLIENT_ID =
  '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoAuthAttempted, setAutoAuthAttempted] = useState(false);

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
        // Keep development flow simple: auto-sign in anonymously if no session.
        // Onboarding still runs before access to the network.
        if (!autoAuthAttempted) {
          setAutoAuthAttempted(true);
          try {
            await signInAnonymously(auth);
            return;
          } catch (e) {
            console.error('Anonymous sign-in failed:', e);
          }
        }
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
            username: (authenticatedUser.displayName || 'builder')
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .slice(0, 14),
            bio: '',
            profilePic: authenticatedUser.photoURL || '',
            photos: [],
            occupation: 'Founder',
            company: '',
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
            availability: 'Open',
            timezone: '',
            languages: ['English'],
            lookingFor: ['Networking'],
            startupStage: 'Idea',
            fundingStage: 'Pre-revenue',
            workStyle: '',
            education: '',
            remoteOnly: false,
            willingToRelocate: false,
            teamSizePreference: 'Solo Founder',
            reputationScore: 0,
            streakCount: 0,
            founderScore: 50,
            reputationMetrics: {
              reliability: 70,
              responseRate: 70,
              collaboration: 70,
              consistency: 60,
              completion: 60,
            },
            aiMatchInsights: '',
            networkingIntent: 'Serious Builder',
            onboarded: false,
            isVisible: true,
            isBot: false,
            isOnline: true,
            lastActiveAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            circles: [],
            personalityAnswers: {},
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

      // Lazily require the native module so Expo Go doesn't crash at import time.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GoogleSignin, statusCodes } = require('@react-native-google-signin/google-signin') as any;

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
      const statusCodes = (require('@react-native-google-signin/google-signin') as any)?.statusCodes;
      if (statusCodes && error?.code === statusCodes.SIGN_IN_CANCELLED) return;
      if (statusCodes && error?.code === statusCodes.IN_PROGRESS) {
        Alert.alert('Please Wait', 'Sign-in is already in progress.');
        return;
      }
      if (statusCodes && error?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Error', 'Google Play Services are not available on this device.');
        return;
      }
      Alert.alert('Sign-In Error', error?.message || 'Something went wrong. Please try again.');
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const trimmedEmail = String(email || '').trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Missing Info', 'Enter email + password.');
      return;
    }

    try {
      if (auth.currentUser?.isAnonymous) {
        const cred = EmailAuthProvider.credential(trimmedEmail, password);
        await linkWithCredential(auth.currentUser, cred);
        return;
      }

      await createUserWithEmailAndPassword(auth, trimmedEmail, password);
    } catch (e: any) {
      console.error('Email sign-up error:', e);
      Alert.alert('Sign Up Error', e?.message || 'Could not create account.');
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    const trimmedEmail = String(email || '').trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Missing Info', 'Enter email + password.');
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
    } catch (e: any) {
      console.error('Email sign-in error:', e);
      Alert.alert('Sign In Error', e?.message || 'Could not sign in.');
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
    <AuthContext.Provider value={{ user, profile, loading, signInWithGoogle, signUpWithEmail, signInWithEmail, logout, deleteAccount }}>
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
