import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GoogleAuthProvider,
  EmailAuthProvider,
  User,
  createUserWithEmailAndPassword,
  linkWithCredential,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { deleteDoc, deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';

const GOOGLE_WEB_CLIENT_ID =
  '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com';

let warnedPresenceRules = false;
const onboardingStorageKey = (uid: string) => `linkup:onboarded:${uid}`;

const readStoredOnboarding = async (uid: string) => {
  try {
    return (await AsyncStorage.getItem(onboardingStorageKey(uid))) === 'true';
  } catch {
    return false;
  }
};

const hasCompletedProfileSignals = (data: any) => {
  const hasList = (value: unknown) => Array.isArray(value) && value.length > 0;
  return Boolean(
    data?.displayName &&
      (
        String(data?.bio || '').trim() ||
        String(data?.country || '').trim() ||
        String(data?.city || '').trim() ||
        String(data?.workStyle || '').trim() ||
        String(data?.commitmentLevel || '').trim() ||
        String(data?.personalityType || '').trim() ||
        hasList(data?.skills) ||
        hasList(data?.industries) ||
        hasList(data?.interests) ||
        (data?.roleAnswers && Object.keys(data.roleAnswers).length > 0) ||
        (data?.personalityAnswers && Object.keys(data.personalityAnswers).length > 0)
      )
  );
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authVersion: number;
  isOnboarded: boolean;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  requestEmailChange: (newEmail: string) => Promise<void>;
  showMfaEnrollmentNotice: () => Promise<void>;
  reloadCurrentUser: () => Promise<User | null>;
  markOnboardingComplete: (profilePatch?: Record<string, unknown>) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authVersion, setAuthVersion] = useState(0);
  const [completedOnboardingUid, setCompletedOnboardingUid] = useState<string | null>(null);
  const isOnboarded = Boolean(user?.uid && (profile?.onboarded || completedOnboardingUid === user.uid));

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
        setCompletedOnboardingUid(null);
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, 'users', authenticatedUser.uid);
      unsubscribeProfile = onSnapshot(
        userDocRef,
        async (docSnap) => {
          const storedOnboarded = await readStoredOnboarding(authenticatedUser.uid);

          if (docSnap.exists()) {
            const rawProfile = docSnap.data() as any;
            const inferredOnboarded = Boolean(rawProfile.onboarded || storedOnboarded || hasCompletedProfileSignals(rawProfile));
            const data = {
              ...(rawProfile as UserProfile),
              uid: authenticatedUser.uid,
              onboarded: inferredOnboarded,
            } as UserProfile;
            if (rawProfile.pushTokens) {
              updateDoc(userDocRef, { pushTokens: deleteField() }).catch(() => {});
            }
            if (inferredOnboarded) {
              setCompletedOnboardingUid(authenticatedUser.uid);
              AsyncStorage.setItem(onboardingStorageKey(authenticatedUser.uid), 'true').catch(() => {});
            }
            if (inferredOnboarded && !rawProfile.onboarded) {
              updateDoc(userDocRef, { onboarded: true }).catch(() => {});
            }
            setProfile(data);
            setLoading(false);
            return;
          }

          const authName = authenticatedUser.displayName || '';
          const authUsername = (authName || authenticatedUser.email?.split('@')[0] || '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 14);

          // Keep a local draft only. Do not write a public placeholder profile before onboarding.
          const newProfile: any = {
            uid: authenticatedUser.uid,
            displayName: authName,
            username: authUsername,
            profileLink: `linkup://profile/${authenticatedUser.uid}`,
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
            aiMatchInsights: '',
            networkingIntent: 'Serious Builder',
            onboarded: storedOnboarded,
            isVisible: true,
            isStealthMode: false,
            turboConnect: false,
            hideOnlineStatus: false,
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
            projects: [],
          };

          if (storedOnboarded) {
            setCompletedOnboardingUid(authenticatedUser.uid);
          }

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
    const presenceRef = doc(db, 'presence', user.uid);

    const setPresence = async (isOnline: boolean) => {
      try {
        // Presence is stored separately to avoid rules conflicts with `users/{uid}` schema validation.
        await setDoc(presenceRef, { isOnline, lastActiveAt: serverTimestamp() }, { merge: true });
      } catch (e) {
        if (!warnedPresenceRules) {
          warnedPresenceRules = true;
          console.warn('Presence unavailable until latest Firestore rules are deployed.', e);
        }
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
        const linked = await linkWithCredential(auth.currentUser, cred);
        await sendEmailVerification(linked.user);
        Alert.alert('Verify your email', `We sent a verification link to ${trimmedEmail}. Check inbox and spam/junk.`);
        return;
      }

      const created = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      await sendEmailVerification(created.user);
      Alert.alert('Verify your email', `We sent a verification link to ${trimmedEmail}. Check inbox and spam/junk.`);
    } catch (e: any) {
      console.error('Email sign-up error:', e);
      const code = String(e?.code || '');
      if (code.includes('operation-not-allowed')) {
        Alert.alert('Email/Password Disabled', 'Enable Email/Password provider in Firebase Console → Authentication → Sign-in method.');
        return;
      }
      if (code.includes('email-already-in-use')) {
        Alert.alert('Email Already Used', 'That email already exists. Tap SIGN IN instead.');
        return;
      }
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

  const resetPassword = async (email: string) => {
    const trimmedEmail = String(email || '').trim();
    if (!trimmedEmail) {
      Alert.alert('Enter your email', 'Add your email first, then tap Forgot password again.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      Alert.alert(
        'Reset email sent',
        `We sent a password reset link to ${trimmedEmail}. Check your inbox and your spam/junk folder if you do not see it.`
      );
    } catch (error: any) {
      console.error('Password reset error:', error);
      const code = String(error?.code || '');
      if (code.includes('user-not-found')) {
        Alert.alert('No account found', 'There is no account using that email yet.');
        return;
      }
      if (code.includes('invalid-email')) {
        Alert.alert('Invalid email', 'Enter a valid email address and try again.');
        return;
      }
      if (code.includes('too-many-requests')) {
        Alert.alert('Try again later', 'Too many reset attempts. Wait a bit, then try again.');
        return;
      }
      Alert.alert('Reset failed', error?.message || 'Could not send reset email.');
    }
  };

  const sendVerificationEmail = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Alert.alert('Not signed in', 'Sign in first, then verify your email.');
      return;
    }

    try {
      await currentUser.reload();
      const refreshedUser = auth.currentUser || currentUser;
      if (refreshedUser.emailVerified) {
        Alert.alert('Already verified', 'Your email address is already verified.');
        return;
      }
      await sendEmailVerification(refreshedUser);
      Alert.alert(
        'Verification email sent',
        `We sent a verification link to ${refreshedUser.email || 'your email'}. Check your inbox and spam/junk folder.`
      );
    } catch (error: any) {
      console.error('Email verification error:', error);
      const code = String(error?.code || '');
      if (code.includes('too-many-requests')) {
        Alert.alert('Try again later', 'Too many verification emails were requested. Wait a bit, then try again.');
        return;
      }
      Alert.alert('Verification failed', error?.message || 'Could not send verification email.');
    }
  };

  const reloadCurrentUser = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return null;
    await currentUser.reload();
    setUser(auth.currentUser);
    setAuthVersion((value) => value + 1);
    return auth.currentUser;
  };

  const markOnboardingComplete = async (profilePatch: Record<string, unknown> = {}) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    await AsyncStorage.setItem(onboardingStorageKey(uid), 'true');
    setCompletedOnboardingUid(uid);
    setProfile((current) => Object.assign({}, current || {}, profilePatch, { uid, onboarded: true }) as unknown as UserProfile);
    setAuthVersion((value) => value + 1);
  };

  const requestEmailChange = async (newEmail: string) => {
    const trimmedEmail = String(newEmail || '').trim();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      Alert.alert('Not signed in', 'Sign in first, then change your email.');
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      Alert.alert('Invalid email', 'Enter the new email address you want to use.');
      return;
    }
    if (trimmedEmail.toLowerCase() === String(currentUser.email || '').toLowerCase()) {
      Alert.alert('Same email', 'This is already your current email address.');
      return;
    }

    try {
      await verifyBeforeUpdateEmail(currentUser, trimmedEmail);
      Alert.alert(
        'Confirm new email',
        `We sent a confirmation link to ${trimmedEmail}. Open it to finish changing your LINKUP email. Check spam/junk too.`
      );
    } catch (error: any) {
      console.error('Email change error:', error);
      const code = String(error?.code || '');
      if (code.includes('requires-recent-login')) {
        Alert.alert('Sign in again', 'For security, log out and sign in again before changing your email.');
        return;
      }
      if (code.includes('email-already-in-use')) {
        Alert.alert('Email already used', 'That email is already attached to another account.');
        return;
      }
      if (code.includes('invalid-email')) {
        Alert.alert('Invalid email', 'Enter a valid email address.');
        return;
      }
      Alert.alert('Email change failed', error?.message || 'Could not send the email change confirmation.');
    }
  };

  const showMfaEnrollmentNotice = async () => {
    Alert.alert(
      'Multi-factor security',
      'Firebase sends multi-factor enrollment notification emails automatically when MFA is enabled in Firebase Authentication and a user enrolls a second factor. This app is ready for the notification, but MFA enrollment must be enabled in your Firebase Console first.'
    );
  };

  const deleteAccount = async () => {
    if (!auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      await Promise.allSettled([
        deleteDoc(doc(db, 'presence', uid)),
        deleteDoc(doc(db, 'userPrivate', uid)),
        deleteDoc(doc(db, 'users', uid)),
        AsyncStorage.removeItem(onboardingStorageKey(uid)),
      ]);
      await auth.currentUser.delete();
    } catch (error) {
      console.error('Delete account error:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authVersion,
        isOnboarded,
        signInWithGoogle,
        signUpWithEmail,
        signInWithEmail,
        resetPassword,
        sendVerificationEmail,
        requestEmailChange,
        showMfaEnrollmentNotice,
        reloadCurrentUser,
        markOnboardingComplete,
        logout,
        deleteAccount,
      }}
    >
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
