import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  EmailAuthProvider,
  User,
  createUserWithEmailAndPassword,
  getRedirectResult,
  linkWithCredential,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  verifyBeforeUpdateEmail,
} from 'firebase/auth';
import { deleteDoc, deleteField, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';

const GOOGLE_WEB_CLIENT_ID =
  '70946124449-9nbp25ptm4vovihcrcoahafbhtaq0usn.apps.googleusercontent.com';

let warnedPresenceRules = false;
const onboardingStorageKey = (uid: string) => `linkup:onboarded:${uid}`;
const profileCacheKey = (uid: string) => `linkup:profile:${uid}`;

const readCachedProfile = async (uid: string) => {
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeCachedProfile = async (uid: string, profileData: any) => {
  try {
    await AsyncStorage.setItem(profileCacheKey(uid), JSON.stringify(profileData || {}));
  } catch {
    // Cache is only for instant UI hydration.
  }
};

const currentWebHost = () => {
  if (Platform.OS !== 'web') return '';
  const location = (globalThis as any)?.location;
  return location?.host || location?.hostname || '';
};

const replaceWebRoute = (path: string) => {
  if (Platform.OS !== 'web') return;
  const history = (globalThis as any)?.history;
  if (history?.replaceState) {
    history.replaceState(null, '', path);
  }
};

const describeAuthError = (flow: string, error: any) => {
  const code = String(error?.code || error?.name || 'unknown');
  const message = String(error?.message || error || 'No Firebase message returned.');
  const host = currentWebHost();
  let hint = 'Try again. If this keeps happening, copy this error and check Firebase Authentication settings.';

  if (code.includes('unauthorized-domain')) {
    hint = `Add "${host}" to Firebase Console > Authentication > Settings > Authorized domains, then redeploy.`;
  } else if (code.includes('operation-not-allowed')) {
    hint = 'Enable the Google sign-in provider in Firebase Console > Authentication > Sign-in method.';
  } else if (code.includes('popup-closed-by-user')) {
    hint = 'The Google window was closed before login finished. Keep it open until Google redirects back.';
  } else if (code.includes('popup-blocked')) {
    hint = 'The browser blocked the Google popup. Allow popups for this site and try again.';
  } else if (code.includes('network-request-failed')) {
    hint = 'Network request failed. Check connection, ad blockers, VPN, or browser privacy settings.';
  } else if (message.toLowerCase().includes('cookie') || message.toLowerCase().includes('storage') || message.toLowerCase().includes('initial state')) {
    hint = 'Google auth needs same-site browser storage. Open LINKUP directly in Chrome/Safari and make sure Vercel rewrites /__/auth to Firebase Hosting.';
  } else if (
    code.includes('invalid-request') ||
    message.toLowerCase().includes('redirect_uri_mismatch') ||
    message.toLowerCase().includes('access blocked') ||
    message.toLowerCase().includes('request is invalid')
  ) {
    hint =
      'Google rejected the OAuth redirect. Use the Firebase auth domain in the app and make sure Google provider is enabled in Firebase Authentication.';
  }

  return `${flow}\nCode: ${code}\nHost: ${host || 'native app'}\nFix: ${hint}\nFirebase: ${message}`;
};

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

const loadNativeGoogleSignIn = () => {
  try {
    return require('@react-native-google-signin/google-signin') as any;
  } catch (error) {
    console.error('Native Google Sign-In module unavailable:', error);
    return null;
  }
};

const getGoogleIdToken = async (GoogleSignin: any, signInResult: any) => {
  if (signInResult?.type === 'cancelled') return null;
  const tokenFromSignIn = signInResult?.data?.idToken || signInResult?.idToken;
  if (tokenFromSignIn) return tokenFromSignIn;

  const tokens = await GoogleSignin.getTokens?.().catch(() => null);
  return tokens?.idToken || null;
};

const cleanUsernameFromAuth = (authUser: User) => {
  const raw = authUser.displayName || authUser.email?.split('@')[0] || 'builder';
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || `builder${authUser.uid.slice(0, 5)}`;
};

const buildLocalUserProfile = (authUser: User, onboarded: boolean): any => {
  const authName = authUser.displayName || authUser.email?.split('@')[0] || 'Builder';
  return {
    uid: authUser.uid,
    displayName: authName,
    username: cleanUsernameFromAuth(authUser),
    profileLink: `linkup://profile/${authUser.uid}`,
    bio: '',
    profilePic: '',
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
    reputationScore: 0,
    streakCount: 0,
    founderScore: 0,
    reputationMetrics: {
      reliability: 0,
      responseRate: 0,
      collaboration: 0,
      consistency: 0,
      completion: 0,
    },
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
    onboarded,
    isVisible: onboarded ? false : true,
    isStealthMode: false,
    turboConnect: false,
    hideOnlineStatus: false,
    isBot: false,
    isVerified: false,
    verificationProgram: '',
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
    hasExit: false,
  };
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authVersion: number;
  isOnboarded: boolean;
  authError: string | null;
  clearAuthError: () => void;
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
  const [authError, setAuthError] = useState<string | null>(null);
  const isOnboarded = Boolean(user?.uid && (profile?.onboarded || completedOnboardingUid === user.uid));

  useEffect(() => {
    if (!loading) return;
    const timeout = setTimeout(() => {
      if (!auth.currentUser || profile) {
        setLoading(false);
      }
    }, Platform.OS === 'web' ? 10000 : 12000);
    return () => clearTimeout(timeout);
  }, [loading, profile]);

  const syncSignedInUserProfile = async (authUser: User) => {
    const userDocRef = doc(db, 'users', authUser.uid);
    setUser(authUser);
    setLoading(true);
    setAuthError(null);

    try {
      const userSnap = await getDoc(userDocRef);
      if (userSnap.exists()) {
        const rawProfile = userSnap.data() as any;
        const storedOnboarded = await readStoredOnboarding(authUser.uid);
        const inferredOnboarded = Boolean(rawProfile.onboarded || hasCompletedProfileSignals(rawProfile) || storedOnboarded);

        if (inferredOnboarded) {
          await AsyncStorage.setItem(onboardingStorageKey(authUser.uid), 'true');
          setCompletedOnboardingUid(authUser.uid);
          if (!rawProfile.onboarded) {
            setDoc(userDocRef, { onboarded: true }, { merge: true }).catch(() => {});
          }
        } else {
          await AsyncStorage.removeItem(onboardingStorageKey(authUser.uid)).catch(() => {});
          setCompletedOnboardingUid(null);
        }

        setProfile({
          ...buildLocalUserProfile(authUser, inferredOnboarded),
          ...rawProfile,
          uid: authUser.uid,
          onboarded: inferredOnboarded,
        } as UserProfile);
        writeCachedProfile(authUser.uid, {
          ...rawProfile,
          uid: authUser.uid,
          onboarded: inferredOnboarded,
        }).catch(() => {});
        setAuthVersion((value) => value + 1);
        setLoading(false);
        return;
      }

      await AsyncStorage.removeItem(onboardingStorageKey(authUser.uid)).catch(() => {});
      setCompletedOnboardingUid(null);
      setProfile(buildLocalUserProfile(authUser, false) as UserProfile);
      setAuthVersion((value) => value + 1);
      setLoading(false);
    } catch (error) {
      const storedOnboarded = await readStoredOnboarding(authUser.uid);
      if (storedOnboarded) {
        setCompletedOnboardingUid(authUser.uid);
      } else {
        setCompletedOnboardingUid(null);
      }
      setProfile(buildLocalUserProfile(authUser, storedOnboarded) as UserProfile);
      setAuthVersion((value) => value + 1);
      setLoading(false);
      console.warn('Signed-in profile sync unavailable:', error);
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let cancelled = false;

    const completeWebRedirect = async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
        const result = await getRedirectResult(auth);
        if (result?.user) {
          await syncSignedInUserProfile(result.user);
        }
      } catch (error: any) {
        if (cancelled) return;
        console.error('Google redirect completion error:', error);
        const friendlyError = describeAuthError('Google redirect completion failed.', error);
        setAuthError(friendlyError);
        const code = String(error?.code || '');
        if (code.includes('unauthorized-domain')) {
          Alert.alert(
            'Google Sign-In Setup Needed',
            'Add this web domain to Firebase Console > Authentication > Settings > Authorized domains, then try again.'
          );
        }
      }
    };

    completeWebRedirect();

    return () => {
      cancelled = true;
    };
  }, []);

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
      setLoading(true);
      setCompletedOnboardingUid(null);

      const storedOnboardedBeforeSnapshot = await readStoredOnboarding(authenticatedUser.uid);
      const cachedProfileBeforeSnapshot = await readCachedProfile(authenticatedUser.uid);
      if (storedOnboardedBeforeSnapshot) {
        setCompletedOnboardingUid(authenticatedUser.uid);
        setProfile({
          ...buildLocalUserProfile(authenticatedUser, true),
          ...(cachedProfileBeforeSnapshot || {}),
          uid: authenticatedUser.uid,
          onboarded: true,
        } as UserProfile);
        setLoading(false);
      } else {
        setProfile(null);
      }

      unsubscribeProfile = onSnapshot(
        userDocRef,
        async (docSnap) => {
          const storedOnboarded = await readStoredOnboarding(authenticatedUser.uid);

          if (docSnap.exists()) {
            const rawProfile = docSnap.data() as any;
            const inferredOnboarded = Boolean(rawProfile.onboarded || hasCompletedProfileSignals(rawProfile) || storedOnboarded);
            const data = {
              ...buildLocalUserProfile(authenticatedUser, inferredOnboarded),
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
            } else {
              setCompletedOnboardingUid(null);
              AsyncStorage.removeItem(onboardingStorageKey(authenticatedUser.uid)).catch(() => {});
            }
            if (inferredOnboarded && !rawProfile.onboarded) {
              updateDoc(userDocRef, { onboarded: true }).catch(() => {});
            }
            setProfile(data);
            writeCachedProfile(authenticatedUser.uid, data).catch(() => {});
            setLoading(false);
            return;
          }

          const newProfile = buildLocalUserProfile(authenticatedUser, false);
          setCompletedOnboardingUid(null);
          AsyncStorage.removeItem(onboardingStorageKey(authenticatedUser.uid)).catch(() => {});

          setProfile(newProfile as UserProfile);
          setLoading(false);
        },
        (error) => {
          console.error('Profile listener error:', error);
          readStoredOnboarding(authenticatedUser.uid)
            .then((storedOnboarded) => {
              if (storedOnboarded) {
                setCompletedOnboardingUid(authenticatedUser.uid);
                setProfile(buildLocalUserProfile(authenticatedUser, true) as UserProfile);
              } else {
                setCompletedOnboardingUid(null);
                setProfile(buildLocalUserProfile(authenticatedUser, false) as UserProfile);
              }
            })
            .finally(() => {
              setLoading(false);
            });
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
    setAuthError(null);
    try {
      if (Platform.OS === 'web') {
        const provider = new GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        provider.setCustomParameters({
          prompt: 'select_account',
        });

        await setPersistence(auth, browserLocalPersistence);
        const result = await signInWithPopup(auth, provider);
        if (result?.user) {
          await syncSignedInUserProfile(result.user);
        }
        return;
      }

      const googleModule = loadNativeGoogleSignIn();
      if (!googleModule?.GoogleSignin) {
        Alert.alert(
          'Google Sign-In Unavailable',
          'Native Google Sign-In is not available in Expo Go. Please run a development build / real APK that includes the Google Sign-In native module.'
        );
        return;
      }

      const { GoogleSignin } = googleModule;

      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        offlineAccess: false,
        forceCodeForRefreshToken: false,
        profileImageSize: 120,
      });

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signOut?.().catch(() => {});
      const signInResult = await GoogleSignin.signIn();
      const idToken = await getGoogleIdToken(GoogleSignin, signInResult);

      if (!idToken) {
        Alert.alert('Authentication Cancelled', 'Google did not return an ID token. Please choose an account and try again.');
        return;
      }

      const credential = GoogleAuthProvider.credential(idToken);
      const signedIn = await signInWithCredential(auth, credential);
      await syncSignedInUserProfile(signedIn.user);
    } catch (error: any) {
      console.error('Google Auth Error:', error);
      const friendlyError = describeAuthError('Google sign-in failed.', error);
      setAuthError(friendlyError);
      if (Platform.OS !== 'web') {
        try {
          const statusCodes = loadNativeGoogleSignIn()?.statusCodes;
          if (statusCodes && error?.code === statusCodes.SIGN_IN_CANCELLED) return;
          if (statusCodes && error?.code === statusCodes.IN_PROGRESS) {
            Alert.alert('Please Wait', 'Sign-in is already in progress.');
            return;
          }
          if (statusCodes && error?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
            Alert.alert('Error', 'Google Play Services are not available on this device.');
            return;
          }
        } catch {
          // Native status codes are unavailable outside the native Google module.
        }
        const code = String(error?.code || error?.message || '');
        if (code.includes('10') || code.toLowerCase().includes('developer_error')) {
          Alert.alert(
            'Google Setup Error',
            'Firebase is missing the Android SHA-1/SHA-256 for com.tana.linkup. Add your app signing fingerprints in Firebase Project Settings, download the new google-services.json, then rebuild the APK.'
          );
          return;
        }
      }

      const code = String(error?.code || '');
      if (Platform.OS === 'web' && code.includes('unauthorized-domain')) {
        Alert.alert(
          'Google Sign-In Setup Needed',
          'Add your Vercel domain to Firebase Console > Authentication > Settings > Authorized domains, then redeploy.'
        );
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
        Alert.alert('Account already exists', 'That email is already registered. Tap SIGN IN instead, or use Forgot Password if you need a new password.');
        return;
      }
      if (code.includes('weak-password')) {
        Alert.alert('Password too weak', 'Use at least 6 characters for your password.');
        return;
      }
      if (code.includes('invalid-email')) {
        Alert.alert('Invalid email', 'Enter a valid email address and try again.');
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
      const result = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      await syncSignedInUserProfile(result.user);
    } catch (e: any) {
      console.error('Email sign-in error:', e);
      const code = String(e?.code || '');
      if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
        Alert.alert('Sign In Failed', 'Email or password is incorrect. If this account exists, use Forgot Password to reset it.');
        return;
      }
      if (code.includes('invalid-email')) {
        Alert.alert('Invalid email', 'Enter a valid email address and try again.');
        return;
      }
      if (code.includes('too-many-requests')) {
        Alert.alert('Try again later', 'Too many failed attempts. Wait a bit, then try again or reset your password.');
        return;
      }
      Alert.alert('Sign In Error', e?.message || 'Could not sign in.');
    }
  };

  const logout = async () => {
    try {
      replaceWebRoute('/landing');
      await signOut(auth);
      setUser(null);
      setProfile(null);
      setCompletedOnboardingUid(null);
      setAuthVersion((value) => value + 1);
    } catch (error) {
      console.error('Sign out error:', error);
      setAuthError(describeAuthError('Logout failed.', error));
    } finally {
      replaceWebRoute('/landing');
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
        `We sent a password reset link to ${trimmedEmail}. It might land in spam, junk, or promotions, so check those folders too.`
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
    const nextProfile = Object.assign({}, profile || {}, profilePatch, { uid, onboarded: true }) as unknown as UserProfile;
    setProfile(nextProfile);
    writeCachedProfile(uid, nextProfile).catch(() => {});
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
        authError,
        clearAuthError: () => setAuthError(null),
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
