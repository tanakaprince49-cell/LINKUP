import 'react-native-gesture-handler';
import React from 'react';
import { View, ActivityIndicator, Image, TouchableOpacity, StyleSheet, Dimensions, Text, Platform, InteractionManager } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as ExpoLinking from 'expo-linking';
import * as Icons from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import SwipeScreen from './src/screens/SwipeScreen';
import IdeaDeckScreen from './src/screens/IdeaDeckScreen';
import DiscoveryDashboardScreen from './src/screens/DiscoveryDashboardScreen';
import SearchScreen from './src/screens/SearchScreen';
import MatchScreen from './src/screens/MatchScreen';
import AlertsScreen from './src/screens/AlertsScreen';
import MessagesScreen from './src/screens/MessagesScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import ChatScreen from './src/screens/ChatScreen';
import ViewersScreen from './src/screens/ViewersScreen';
import EmailAuthScreen from './src/screens/EmailAuthScreen';
import EmailVerificationScreen from './src/screens/EmailVerificationScreen';
import LandingScreen from './src/screens/LandingScreen';
import ActiveOpportunityScreen from './src/screens/ActiveOpportunityScreen';
import ActiveOpportunitiesScreen from './src/screens/ActiveOpportunitiesScreen';
import TrendingBuildersScreen from './src/screens/TrendingBuildersScreen';
import RecommendedMatchesScreen from './src/screens/RecommendedMatchesScreen';
import { setupNativeNotificationRuntimeAsync, subscribeToNotificationToasts, subscribeToUnreadNotificationsCount } from './src/lib/notifications';
import { subscribeToUnreadMessagesCount } from './src/lib/chat';
import OpportunityRadar from './src/components/OpportunityRadar';
import WebAnalytics from './src/components/WebAnalytics';
import PWAInstallPrompt from './src/components/PWAInstallPrompt';
import LinkupAlertProvider from './src/components/LinkupAlertProvider';
import { blurActiveElementOnWeb } from './src/lib/webFocus';
import { hasLinkupPro } from './src/lib/paywall';
import { IS_LOW_END_ANDROID, safeProfileImageUri } from './src/lib/profilePerformance';
import { preloadProfileScreen, scheduleScreenPreloads } from './src/lib/preloadScreens';

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
      backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
      borderBottomColor: COLORS.primary,
      borderBottomWidth: 2,
    }]}>
      <View style={styles.headerContent}>
        <Text style={[styles.headerTitle, { color: textColor(isDark) }]}>
          {title === 'LINKUP' ? (
            <>LIN<Text style={{ color: COLORS.primary }}>KUP</Text></>
          ) : (
            <Text style={{ letterSpacing: 1 }}>{title}</Text>
          )}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.headerIconBtn, {
              backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard,
              borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
            }]}
            onPress={() => {
              const parentNav = navigation.getParent?.() || navigation;
              parentNav.navigate('Alerts');
            }}
          >
            <SafeIcon name="Bell" size={18} color={isDark ? '#E5E7EB' : '#4B5563'} />
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
              backgroundColor: isDark ? COLORS.darkCard : COLORS.lightCard,
              borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
            }]}
            onPressIn={preloadProfileScreen}
            onPress={() => {
              if (user?.uid) navigation.navigate('Profile', { userId: user.uid });
            }}
          >
            {profilePhoto ? (
              <Image source={{ uri: profilePhoto }} style={styles.headerAvatar} />
            ) : (
              <SafeIcon name="User" size={18} color={isDark ? '#E5E7EB' : '#4B5563'} />
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
    Search: 'Search',
    Inbox: 'Chat',
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
        tabBarIcon: ({ focused }) => {
          const iconMap: Record<string, { active: string; inactive: string }> = {
            Dashboard: { active: 'Compass', inactive: 'Compass' },
            Swipe: { active: 'Zap', inactive: 'Zap' },
            Search: { active: 'Search', inactive: 'Search' },
            Inbox: { active: 'MessageSquare', inactive: 'MessageSquare' },
          };
          const iconName = (focused ? iconMap[route.name]?.active : iconMap[route.name]?.inactive) || 'Circle';

          return (
            <View style={styles.tabIconContainer}>
              <View style={[
                styles.tabIconInner,
                focused && {
                  backgroundColor: isDark ? 'rgba(251,230,24,0.15)' : 'rgba(251,230,24,0.2)',
                  shadowColor: COLORS.primary,
                  shadowOpacity: 0.25,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 4,
                },
              ]}>
                <SafeIcon
                  name={iconName}
                  size={22}
                  color={focused ? COLORS.primary : (isDark ? '#8E8E93' : '#636366')}
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
        tabBarInactiveTintColor: isDark ? '#8E8E93' : '#636366',
        tabBarShowLabel: true,
        tabBarLabel: tabLabels[route.name] || route.name,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '900',
          letterSpacing: 0.5,
          marginTop: 2,
          marginBottom: 4,
        },
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: Math.max(0, insets.bottom - 2),
          height: 66 + insets.bottom,
          borderRadius: 20,
          backgroundColor: isDark ? COLORS.darkBgSec : COLORS.lightBgSec,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder,
          paddingTop: 6,
          paddingBottom: insets.bottom > 0 ? 4 : 0,
          justifyContent: 'center',
          elevation: IS_LOW_END_ANDROID ? 0 : 12,
          shadowColor: '#000',
          shadowOpacity: IS_LOW_END_ANDROID ? 0 : 0.2,
          shadowRadius: IS_LOW_END_ANDROID ? 0 : 16,
          shadowOffset: { width: 0, height: IS_LOW_END_ANDROID ? 0 : 6 },
        },
        sceneContainerStyle: {
          backgroundColor: isDark ? COLORS.darkBg : COLORS.lightBg,
        },
        headerShown: true,
        header: (props) => {
          const titles: Record<string, string> = {
            Dashboard: 'LINKUP',
            Swipe: 'DISCOVER',
            Search: 'SEARCH',
            Inbox: 'MESSAGES',
          };
          return <AppHeader navigation={props.navigation} title={titles[props.route.name] || 'LINKUP'} />;
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DiscoveryDashboardScreen} />
      <Tab.Screen name="Swipe" component={SwipeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Inbox" component={MessagesScreen} />
    </Tab.Navigator>
  );
}

function AppContent() {
  const { user, profile, loading, authVersion, isOnboarded } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const webPathname =
    Platform.OS === 'web' ? String((globalThis as any)?.location?.pathname || '') : '';
  const isPublicSharedWebPath =
    webPathname.startsWith('/profile/') || webPathname.startsWith('/opportunity/');
  const requiresEmailVerification = Boolean(
    user?.email &&
      !user.emailVerified &&
      user.providerData?.some((provider) => provider.providerId === 'password')
  );
  const navigationStateKey = `${user?.uid || 'guest'}-${isOnboarded ? 'onboarded' : 'new'}-${requiresEmailVerification ? 'unverified' : 'verified'}-${authVersion}`;

  React.useEffect(() => {
    if (Platform.OS === 'web') return;
    setupNativeNotificationRuntimeAsync().catch((error) => {
      console.warn('Native notification runtime unavailable:', error);
    });
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

  if (loading) return (
    <View style={{ flex: 1, ...appBackground(isDark), alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={COLORS.primary} />
    </View>
  );

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
          animation: IS_LOW_END_ANDROID ? 'none' : Platform.OS === 'android' ? 'simple_push' : 'fade_from_bottom',
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
        ) : requiresEmailVerification ? (
          <>
            <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
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
              options={{ animation: Platform.OS === 'android' ? 'none' : 'fade_from_bottom' }}
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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <LinkupAlertProvider>
            <AuthProvider>
              <AppContent />
            </AuthProvider>
          </LinkupAlertProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.primary,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  headerContent: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    position: 'relative',
    overflow: 'visible',
  },
  headerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  headerBadgeBubble: {
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
  headerBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#FFF',
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 38,
    width: 48,
    position: 'relative',
  },
  tabIconInner: {
    width: 40,
    height: 34,
    borderRadius: 12,
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
