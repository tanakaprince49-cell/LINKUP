import 'react-native-gesture-handler';
import React from 'react';
import { View, ActivityIndicator, Image, TouchableOpacity, StyleSheet, Dimensions, Text, Platform, InteractionManager } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as ExpoLinking from 'expo-linking';
import * as Icons from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ErrorBoundary from './src/components/ErrorBoundary';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { lazyScreen } from './src/lib/lazyScreen';

import DiscoveryDashboardScreen from './src/screens/DiscoveryDashboardScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import EmailAuthScreen from './src/screens/EmailAuthScreen';
import LandingScreen from './src/screens/LandingScreen';

const SwipeScreen = lazyScreen(() => import('./src/screens/SwipeScreen'));
const IdeaDeckScreen = lazyScreen(() => import('./src/screens/IdeaDeckScreen'));
const SearchScreen = lazyScreen(() => import('./src/screens/SearchScreen'));
const AlertsScreen = lazyScreen(() => import('./src/screens/AlertsScreen'));
const MessagesScreen = lazyScreen(() => import('./src/screens/MessagesScreen'));
const ProfileScreen = lazyScreen(() => import('./src/screens/ProfileScreen'));
const ChatScreen = lazyScreen(() => import('./src/screens/ChatScreen'));
const ViewersScreen = lazyScreen(() => import('./src/screens/ViewersScreen'));
const ActiveOpportunityScreen = lazyScreen(() => import('./src/screens/ActiveOpportunityScreen'));
const ActiveOpportunitiesScreen = lazyScreen(() => import('./src/screens/ActiveOpportunitiesScreen'));
const TrendingBuildersScreen = lazyScreen(() => import('./src/screens/TrendingBuildersScreen'));
const RecommendedMatchesScreen = lazyScreen(() => import('./src/screens/RecommendedMatchesScreen'));
const GamificationHubScreen = lazyScreen(() => import('./src/screens/GamificationHubScreen'));
const FounderFlipScreen = lazyScreen(() => import('./src/screens/FounderFlipScreen'));
const PitchPerfectScreen = lazyScreen(() => import('./src/screens/PitchPerfectScreen'));
const NetworkQuizScreen = lazyScreen(() => import('./src/screens/NetworkQuizScreen'));
const DailyFiveScreen = lazyScreen(() => import('./src/screens/DailyFiveScreen'));
const ShipLogScreen = lazyScreen(() => import('./src/screens/ShipLogScreen'));
const CityLeagueScreen = lazyScreen(() => import('./src/screens/CityLeagueScreen'));
const LinkyScreen = lazyScreen(() => import('./src/screens/LinkyScreen'));
const LinkyProfileScreen = lazyScreen(() => import('./src/screens/LinkyProfileScreen'));
const NewsScreen = lazyScreen(() => import('./src/screens/NewsScreen'));
import { GamificationProvider } from './src/contexts/GamificationContext';
import { setupNativeNotificationRuntimeAsync, subscribeToNotificationToasts, subscribeToUnreadNotificationsCount } from './src/lib/notifications';
import { scheduleDailyReminder } from './src/lib/dailyReminder';
import { seedConciergeWelcome } from './src/lib/activation';
import { subscribeToUnreadMessagesCount } from './src/lib/chat';
import OpportunityRadar from './src/components/OpportunityRadar';
import WebAnalytics from './src/components/WebAnalytics';
import PWAInstallPrompt from './src/components/PWAInstallPrompt';
import LinkupAlertProvider from './src/components/LinkupAlertProvider';
import { blurActiveElementOnWeb } from './src/lib/webFocus';
import { hasLinkupPro } from './src/lib/paywall';
import ProCrownBadge from './src/components/ProCrownBadge';
import { useOnlineStatus } from './src/lib/network';
import OfflineScreen from './src/components/OfflineScreen';
import { IS_LOW_END_ANDROID, safeProfileImageUri } from './src/lib/profilePerformance';
import { preloadProfileScreen, scheduleScreenPreloads } from './src/lib/preloadScreens';
import { profileIdFromLink } from './src/lib/profileLinks';
import * as SplashScreen from 'expo-splash-screen';

// Hold the native splash until the JS side paints one stable frame in the
// final theme/screen. Kills the light-then-dark "blink" on Android cold start.
void SplashScreen.preventAutoHideAsync().catch(() => {});

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef<any>();

const runAfterStartup = (task: () => void) => {
  if (Platform.OS !== 'android') {
    const timeout = setTimeout(task, 0);
    return () => clearTimeout(timeout);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const interaction = InteractionManager.runAfterInteractions(() => {
    timeout = setTimeout(task, 900);
  });

  return () => {
    interaction.cancel?.();
    if (timeout) clearTimeout(timeout);
  };
};

const linking: any = {
  prefixes: [ExpoLinking.createURL('/'), 'linkup://'],
  config: {
    screens: {
      Landing: 'landing',
      EmailAuth: 'login',
      EmailVerification: 'verify-email',
      Onboarding: 'onboarding',
      Main: {
        screens: {
          Dashboard: '',
          Swipe: 'swipe-deck',
          Search: 'search',
          Inbox: 'inbox',
        },
      },
      Profile: 'profile/:userId',
      Messages: 'messages',
      Alerts: 'alerts',
      Matches: 'connections',
      Chat: 'chat/:matchId',
      ArchivedChats: 'messages/archived',
      SwipeDeck: 'swipe',
      IdeaDeck: 'ideas',
      Viewers: 'viewers',
      ActiveOpportunity: 'opportunity/:userId',
      ActiveOpportunities: 'opportunities',
      TrendingBuilders: 'trending-builders',
      RecommendedMatches: 'recommended-matches',
      FounderFlip: 'FounderFlip',
      PitchPerfect: 'PitchPerfect',
      NetworkQuiz: 'NetworkQuiz',
      DailyFive: 'daily-five',
      ShipLog: 'ship',
      CityLeague: 'league',
    },
  },
};

// Import custom theme settings
import { COLORS, appBackground, liquidGlass, textColor } from './src/theme/theme';

// Safe Icon Helper
const SafeIcon = ({ name, size = 20, color = COLORS.primary, fill = "transparent" }: any) => {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) return <View style={{ width: size, height: size, backgroundColor: color + '20' }} />;
  return <IconComponent size={size} color={color} fill={fill} />;
};

// Global Header Component
const AppHeader = ({ navigation, title }: any) => {
  const { theme } = useTheme();
  const { user, profile } = useAuth();
  const isDark = theme === 'dark';
  const [unreadNotifications, setUnreadNotifications] = React.useState(0);
  const profilePhoto = safeProfileImageUri(profile?.profilePic, IS_LOW_END_ANDROID ? 140_000 : 260_000);
  const isPro = hasLinkupPro(profile);

  React.useEffect(() => {
    if (!user?.uid) {
      setUnreadNotifications(0);
      return;
    }
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    const cancelStartupTask = runAfterStartup(() => {
      if (cancelled) return;
      unsubscribe = subscribeToUnreadNotificationsCount(user.uid, setUnreadNotifications);
    });

    return () => {
      cancelled = true;
      cancelStartupTask();
      unsubscribe?.();
    };
  }, [user?.uid]);

  return (
    <SafeAreaView edges={['top']} style={[styles.headerContainer, {
      backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
    }]}>
      <View style={styles.headerContent}>
        <View style={styles.headerBrand}>
          {title === 'LINKUP' ? (
            <>
              <Text style={[styles.headerLogoText, { color: textColor(isDark) }]}>LINK</Text>
              <View style={styles.headerLogoAccent}>
                <Text style={styles.headerLogoAccentText}>UP</Text>
              </View>
            </>
          ) : (
            <Text style={[styles.headerTabTitle, { color: textColor(isDark) }]}>{title}</Text>
          )}
          <View style={{ marginLeft: 8 }}>
            <ProCrownBadge />
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.headerIconBtn, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            }]}
            onPress={() => {
              const parentNav = navigation.getParent?.() || navigation;
              parentNav.navigate('Alerts');
            }}
          >
            <SafeIcon name="Bell" size={17} color={isDark ? '#E5E7EB' : '#4B5563'} />
            {unreadNotifications > 0 && (
              <View style={styles.headerBadgeBubble}>
                <Text style={styles.headerBadgeText} numberOfLines={1}>
                  {unreadNotifications > 99 ? '99+' : String(unreadNotifications)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerIconBtn, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            }]}
            onPressIn={preloadProfileScreen}
            onPress={() => {
              if (user?.uid) navigation.navigate('Profile', { userId: user.uid });
            }}
          >
            {profilePhoto ? (
              <Image source={{ uri: profilePhoto }} style={styles.headerAvatar} />
            ) : (
              <SafeIcon name="User" size={17} color={isDark ? '#E5E7EB' : '#4B5563'} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

function TabNavigator({ navigation }: any) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const [unreadMessages, setUnreadMessages] = React.useState(0);
  const tabLabels: Record<string, string> = {
    Dashboard: 'Explore',
    Swipe: 'Discover',
    Hub: 'Play',
    Search: 'Search',
    Inbox: 'Chat',
    News: 'News',
  };

  React.useEffect(() => {
    if (!user?.uid) {
      setUnreadMessages(0);
      return;
    }
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    const cancelStartupTask = runAfterStartup(() => {
      if (cancelled) return;
      unsubscribe = subscribeToUnreadMessagesCount(user.uid, setUnreadMessages);
    });

    return () => {
      cancelled = true;
      cancelStartupTask();
      unsubscribe?.();
    };
  }, [user?.uid]);

  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      detachInactiveScreens={Platform.OS !== 'web'}
      screenOptions={({ route }) => ({
        lazy: true,
        freezeOnBlur: true,
        tabBarIcon: ({ focused }) => {
          const iconMap: Record<string, { active: string; inactive: string }> = {
            Dashboard: { active: 'Compass', inactive: 'Compass' },
            Swipe: { active: 'Zap', inactive: 'Zap' },
            Hub: { active: 'Gamepad2', inactive: 'Gamepad2' },
            Search: { active: 'Search', inactive: 'Search' },
            Inbox: { active: 'MessageSquare', inactive: 'MessageSquare' },
            News: { active: 'Newspaper', inactive: 'Newspaper' },
          };
          const iconName = (focused ? iconMap[route.name]?.active : iconMap[route.name]?.inactive) || 'Circle';

          return (
            <View style={styles.tabIconContainer}>
              <View style={[
                styles.tabIconInner,
                focused && {
                  backgroundColor: isDark ? 'rgba(251,230,24,0.12)' : 'rgba(251,230,24,0.18)',
                  shadowColor: COLORS.primary,
                  shadowOpacity: 0.2,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 3,
                },
              ]}>
                <SafeIcon
                  name={iconName}
                  size={21}
                  color={focused ? COLORS.primary : (isDark ? '#6B7280' : '#9CA3AF')}
                  fill={focused ? COLORS.primary : 'transparent'}
                />
              </View>
              {route.name === 'Inbox' && unreadMessages > 0 && (
                <View style={styles.badgeBubble}>
                  <Text style={styles.badgeText} numberOfLines={1}>
                    {unreadMessages > 99 ? '99+' : String(unreadMessages)}
                  </Text>
                </View>
              )}
            </View>
          );
        },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: isDark ? '#6B7280' : '#9CA3AF',
        tabBarShowLabel: true,
        tabBarLabel: tabLabels[route.name] || route.name,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0,
          marginTop: 1,
        },
        tabBarStyle: {
          backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg,
          borderTopWidth: 1,
          borderTopColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
          height: 54 + insets.bottom,
          paddingTop: 0,
          paddingBottom: insets.bottom > 0 ? 2 : 4,
          paddingHorizontal: 4,
          elevation: IS_LOW_END_ANDROID ? 0 : 10,
          shadowColor: '#000',
          shadowOpacity: IS_LOW_END_ANDROID ? 0 : 0.08,
          shadowRadius: IS_LOW_END_ANDROID ? 0 : 12,
          shadowOffset: { width: 0, height: IS_LOW_END_ANDROID ? 0 : -3 },
        },
        sceneContainerStyle: {
          backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg,
        },
        headerShown: true,
        header: (props) => {
          const titles: Record<string, string> = {
            Dashboard: 'LINKUP',
            Swipe: 'Discover',
            Hub: 'Play',
            Search: 'Search',
            Inbox: 'Messages',
            News: 'News',
          };
          return <AppHeader navigation={props.navigation} title={titles[props.route.name] || 'LINKUP'} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DiscoveryDashboardScreen} />
      <Tab.Screen name="Swipe" component={SwipeScreen}
        options={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />
      <Tab.Screen name="Hub" component={GamificationHubScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Inbox" component={MessagesScreen} options={{ headerShown: false }} />
      <Tab.Screen name="News" component={NewsScreen} />
    </Tab.Navigator>
  );
}

function AppContent() {
  const { user, profile, loading, authVersion, isOnboarded } = useAuth();
  const { theme, themeReady } = useTheme();
  const isDark = theme === 'dark';
  const online = useOnlineStatus();
  const [offlineRetry, setOfflineRetry] = React.useState(0);
  const webPathname =
    Platform.OS === 'web' ? String((globalThis as any)?.location?.pathname || '') : '';
  const isPublicSharedWebPath =
    webPathname.startsWith('/profile/') || webPathname.startsWith('/opportunity/');
  const navigationStateKey = `${user?.uid || 'guest'}-${isOnboarded ? 'onboarded' : 'new'}-${authVersion}`;

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    setupNativeNotificationRuntimeAsync().catch((error) => {
      console.warn('Native notification runtime unavailable:', error);
    });
  }, []);

  // Reveal only when the theme is hydrated AND auth+profile resolved, so the
  // first painted frame is already the final screen in the final theme.
  React.useEffect(() => {
    if (!themeReady || loading) return;
    void SplashScreen.hideAsync().catch(() => {});
  }, [themeReady, loading]);

  // Absolute failsafe: never trap anyone on the splash screen.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      void SplashScreen.hideAsync().catch(() => {});
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const openNotificationTarget = React.useCallback((data: any) => {
    if (!navigationRef.isReady()) return;
    const targetUrl = String(data?.url || data?.targetUrl || '');

    if (data?.matchId || targetUrl.startsWith('/chat/')) {
      const matchId = String(data?.matchId || targetUrl.replace('/chat/', '')).trim();
      if (matchId) {
        navigationRef.navigate('Chat', { matchId });
        return;
      }
    }

    if (targetUrl.startsWith('/opportunity/')) {
      const userId = targetUrl.replace('/opportunity/', '').trim();
      if (userId) {
        navigationRef.navigate('ActiveOpportunity', { userId });
        return;
      }
    }

    if (data?.type === 'game_challenge') {
      const gameMap: Record<string, string> = {
        founderflip: 'FounderFlip',
        pitchperfect: 'PitchPerfect',
        networkquiz: 'NetworkQuiz',
      };
      const screen = gameMap[String(data?.gameType || '')];
      if (screen) {
        navigationRef.navigate(screen);
        return;
      }
    }

    if (data?.fromId && (data?.type === 'like' || data?.type === 'view' || data?.type === 'match')) {
      navigationRef.navigate('Profile', { userId: String(data.fromId) });
      return;
    }

    navigationRef.navigate('Main', { screen: 'Alerts' });
  }, []);

  React.useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    const cancelStartupTask = runAfterStartup(() => {
      if (cancelled) return;
      import('./src/lib/notifications')
        .then((m) => {
          if (!cancelled) return m.registerForPushNotificationsAsync(user.uid);
        })
        .catch((error) => {
          console.warn('Notifications setup unavailable:', error);
        });
    });

    return () => {
      cancelled = true;
      cancelStartupTask();
    };
  }, [user?.uid]);

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    let subscription: { remove: () => void } | undefined;
    let cancelled = false;

    import('expo-notifications')
      .then((Notifications) => {
        if (cancelled) return;
        subscription = Notifications.addNotificationResponseReceivedListener((response) => {
          openNotificationTarget(response.notification.request.content.data);
        });
        Notifications.getLastNotificationResponseAsync?.()
          .then((response) => {
            if (response && !cancelled) {
              openNotificationTarget(response.notification.request.content.data);
            }
          })
          .catch(() => {});
      })
      .catch((error) => {
        console.warn('Notification tap handling unavailable:', error);
      });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [openNotificationTarget]);

  React.useEffect(() => {
    if (!user?.uid) return;

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    const cancelStartupTask = runAfterStartup(() => {
      if (cancelled) return;
      unsubscribe = subscribeToNotificationToasts(user.uid);
    });

    return () => {
      cancelled = true;
      cancelStartupTask();
      unsubscribe?.();
    };
  }, [user?.uid]);

  React.useEffect(() => {
    if (!user?.uid || !isOnboarded) return;
    scheduleScreenPreloads();
  }, [user?.uid, isOnboarded]);

  React.useEffect(() => {
    if (!user?.uid) return;
    scheduleDailyReminder(user.uid);
  }, [user?.uid]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || user?.uid) return;
    const location = (globalThis as any)?.location;
    const history = (globalThis as any)?.history;
    const pathname = String(location?.pathname || '');
    const publicPaths = new Set(['', '/', '/landing', '/login']);
    const isPublicSharedPath = pathname.startsWith('/profile/') || pathname.startsWith('/opportunity/');

    if (history?.replaceState && !publicPaths.has(pathname) && !isPublicSharedPath) {
      history.replaceState(null, '', '/landing');
    }
  }, [user?.uid]);

  // Shared LINKUP profile links (/profile/<uid>) must survive the login jump:
  // remember who the visitor came to see, then drop them on that profile once
  // they are signed in (and onboarded).
  const pendingSharedProfileRef = React.useRef(
    Platform.OS === 'web' ? profileIdFromLink(String((globalThis as any)?.location?.pathname || '')) : ''
  );
  React.useEffect(() => {
    if (Platform.OS !== 'web' || !user?.uid || !isOnboarded) return;
    const target = pendingSharedProfileRef.current;
    pendingSharedProfileRef.current = '';
    if (!target || target === user.uid) return;
    const timer = setTimeout(() => {
      if (navigationRef.isReady()) {
        (navigationRef as any).navigate('Profile', { userId: target });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [user?.uid, isOnboarded]);

  // Onboarding's "Finish now" sets this flag so brand-new users land directly
  // on their own profile to keep editing, instead of the dashboard.
  React.useEffect(() => {
    if (!user?.uid || !isOnboarded) return;
    let cancelled = false;
    AsyncStorage.getItem('@linkup/pendingSelfProfileSetup')
      .then((value) => {
        if (cancelled || value !== '1') return;
        void AsyncStorage.removeItem('@linkup/pendingSelfProfileSetup').catch(() => {});
        setTimeout(() => {
          if (navigationRef.isReady()) (navigationRef as any).navigate('Profile');
        }, 450);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.uid, isOnboarded]);

  if (loading) return (
    <View style={{ flex: 1, ...appBackground(isDark), alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={COLORS.primary} />
    </View>
  );

  if (!online) {
    return <OfflineScreen onRetry={() => setOfflineRetry((n) => n + 1)} />;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      key={navigationStateKey}
      linking={linking}
      onStateChange={blurActiveElementOnWeb}
    >
      <Stack.Navigator
        key={navigationStateKey}
        screenOptions={{
          headerShown: false,
          freezeOnBlur: true,
          animation: Platform.OS === 'android' || Platform.OS === 'web' ? 'none' : 'fade_from_bottom',
        }}
      >
        {!user ? (
          <>
            <Stack.Screen name="Landing" component={LandingScreen} />
            <Stack.Screen name="EmailAuth" component={EmailAuthScreen} />
            {isPublicSharedWebPath ? (
              <>
                <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ animation: Platform.OS === 'android' ? 'none' : 'fade_from_bottom' }}
            />
                <Stack.Screen name="ActiveOpportunity" component={ActiveOpportunityScreen} />
              </>
            ) : null}
          </>
        ) : !isOnboarded ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
          </>
        )}
        {user ? (
          <>
            <Stack.Screen
              name="Profile"
              component={ProfileScreen}
              options={{ animation: Platform.OS === 'android' ? 'none' : Platform.OS === 'web' ? 'none' : 'fade_from_bottom' }}
            />
            <Stack.Screen name="Alerts" component={AlertsScreen} />
            <Stack.Screen name="Messages" component={MessagesScreen} />
            <Stack.Screen name="ArchivedChats" component={MessagesScreen} initialParams={{ archivedOnly: true }} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="SwipeDeck" component={SwipeScreen} />
            <Stack.Screen name="IdeaDeck" component={IdeaDeckScreen} />
            <Stack.Screen name="Viewers" component={ViewersScreen} />
            <Stack.Screen name="ActiveOpportunity" component={ActiveOpportunityScreen} />
            <Stack.Screen name="ActiveOpportunities" component={ActiveOpportunitiesScreen} />
            <Stack.Screen name="TrendingBuilders" component={TrendingBuildersScreen} />
            <Stack.Screen name="RecommendedMatches" component={RecommendedMatchesScreen} />
            <Stack.Screen name="FounderFlip" component={FounderFlipScreen} />
            <Stack.Screen name="PitchPerfect" component={PitchPerfectScreen} />
            <Stack.Screen name="NetworkQuiz" component={NetworkQuizScreen} />
            <Stack.Screen name="Linky" component={LinkyScreen} options={{ animation: Platform.OS === 'android' ? 'none' : 'slide_from_right' }} />
            <Stack.Screen name="LinkyProfile" component={LinkyProfileScreen} options={{ animation: Platform.OS === 'android' ? 'none' : 'slide_from_right' }} />
            <Stack.Screen name="DailyFive" component={DailyFiveScreen} />
            <Stack.Screen name="ShipLog" component={ShipLogScreen} />
            <Stack.Screen name="CityLeague" component={CityLeagueScreen} />
          </>
        ) : null}
      </Stack.Navigator>
      {Platform.OS === 'web' ? (
        <>
          <OpportunityRadar />
          <WebAnalytics />
          <PWAInstallPrompt />
        </>
      ) : null}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App() {
  const RootView = Platform.OS === 'web'
    ? (({ children }: { children: React.ReactNode }) => <View style={{ flex: 1 }}>{children}</View>)
    : GestureHandlerRootView;

  return (
    <ErrorBoundary screenName="App">
      <RootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <LinkupAlertProvider>
              <AuthProvider>
                <GamificationProvider>
                  <ErrorBoundary screenName="App Content">
                    <AppContent />
                  </ErrorBoundary>
                </GamificationProvider>
              </AuthProvider>
            </LinkupAlertProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </RootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  headerContent: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerLogoText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  headerLogoAccent: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  headerLogoAccentText: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#111',
  },
  headerTabTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  headerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  headerBadgeBubble: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  headerBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    width: 52,
    position: 'relative',
  },
  tabIconInner: {
    width: 36,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeBubble: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    zIndex: 20,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0,
  },
});
