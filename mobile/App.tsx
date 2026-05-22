import 'react-native-gesture-handler';
import React from 'react';
import { View, ActivityIndicator, Image, TouchableOpacity, StyleSheet, Dimensions, Text, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as ExpoLinking from 'expo-linking';
import * as Icons from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import SwipeScreen from './src/screens/SwipeScreen';
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
import { subscribeToBrowserNotificationToasts, subscribeToUnreadNotificationsCount } from './src/lib/notifications';
import OpportunityRadar from './src/components/OpportunityRadar';
import WebAnalytics from './src/components/WebAnalytics';
import PWAInstallPrompt from './src/components/PWAInstallPrompt';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

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
          Swipe: '',
          Search: 'search',
          Matches: 'connections',
          Alerts: 'alerts',
        },
      },
      Profile: 'profile/:userId',
      Messages: 'messages',
      Chat: 'chat/:matchId',
      ArchivedChats: 'messages/archived',
      SwipeDeck: 'swipe',
      Viewers: 'viewers',
      ActiveOpportunity: 'opportunity/:userId',
      ActiveOpportunities: 'opportunities',
      TrendingBuilders: 'trending-builders',
      RecommendedMatches: 'recommended-matches',
    },
  },
};

// Safe Icon Helper
const SafeIcon = ({ name, size = 20, color = "#FBE618", fill = "transparent" }: any) => {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) return <View style={{ width: size, height: size, backgroundColor: color + '20' }} />;
  return <IconComponent size={size} color={color} fill={fill} />;
};

// Global Header Component
const AppHeader = ({ navigation, title }: any) => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const isDark = theme === 'dark';

  return (
    <SafeAreaView style={[styles.headerContainer, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <View style={styles.headerContent}>
        <Text style={[styles.headerTitle, { color: isDark ? '#FFF' : '#000' }]}>
          {title === 'LINKUP' ? (
            <>LIN<Text style={{ color: '#FBE618' }}>KUP</Text></>
          ) : title}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={[styles.headerIconBtn, { backgroundColor: isDark ? '#1A1A1F' : '#F8F8F8' }]}
            onPress={() => navigation.navigate('Messages')}
          >
            <SafeIcon name="MessageSquare" size={18} color={isDark ? '#CCC' : '#444'} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.headerIconBtn, { backgroundColor: isDark ? '#1A1A1F' : '#F8F8F8' }]}
            onPress={() => {
              if (user?.uid) navigation.navigate('Profile', { userId: user.uid });
            }}
          >
            <SafeIcon name="User" size={18} color={isDark ? '#CCC' : '#444'} />
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
  const [unreadCount, setUnreadCount] = React.useState(0);
  const tabLabels: Record<string, string> = {
    Swipe: 'Home',
    Search: 'Search',
    Matches: 'Connections',
    Alerts: 'Notifications',
  };

  React.useEffect(() => {
    if (!user?.uid) {
      setUnreadCount(0);
      return;
    }
    const unsub = subscribeToUnreadNotificationsCount(user.uid, setUnreadCount);
    return () => unsub();
  }, [user?.uid]);

  return (
    <Tab.Navigator
      initialRouteName="Swipe"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName = "Home";
          if (focused) {
            if (route.name === 'Swipe') iconName = "Home";
            else if (route.name === 'Search') iconName = "Search";
            else if (route.name === 'Matches') iconName = "Users";
            else if (route.name === 'Alerts') iconName = "Bell";
          } else {
            if (route.name === 'Swipe') iconName = "Home";
            else if (route.name === 'Search') iconName = "Search";
            else if (route.name === 'Matches') iconName = "Users";
            else if (route.name === 'Alerts') iconName = "Bell";
          }

          return (
            <View style={[
              styles.tabIconContainer,
              route.name === 'Alerts' ? styles.alertTabIconContainer : null,
            ]}>
              <SafeIcon 
                name={iconName}
                size={22} 
                color={focused ? '#FBE618' : '#666'} 
                fill={focused ? '#FBE61820' : 'transparent'}
              />
              {route.name === 'Alerts' && unreadCount > 0 && (
                <View style={styles.badgeBubble}>
                  <Text style={styles.badgeText} numberOfLines={1}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                </View>
              )}
              {focused && <View style={styles.focusedDot} />}
            </View>
          );
        },
        tabBarActiveTintColor: '#FBE618',
        tabBarInactiveTintColor: '#666',
        tabBarShowLabel: true,
        tabBarLabel: tabLabels[route.name] || route.name,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '800',
          marginTop: 2,
        },
        tabBarStyle: {
          backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: isDark ? '#1A1A1A' : '#EEEEEE',
          height: 74,
          paddingTop: 7,
          paddingBottom: 8,
          position: 'absolute',
          bottom: 12,
          left: 16,
          right: 16,
          borderRadius: 26,
          elevation: 10,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
        },
        headerShown: true,
        header: (props) => {
          const titles: Record<string, string> = {
            'Swipe': 'DISCOVER',
            'Search': 'SEARCH',
            'Matches': 'CONNECTIONS',
            'Alerts': 'NOTIFICATIONS'
          };
          return <AppHeader navigation={props.navigation} title={titles[route.name] || 'LINKUP'} />;
        }
      })}
    >
      <Tab.Screen name="Swipe" component={DiscoveryDashboardScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Matches" component={MatchScreen} />
      <Tab.Screen name="Alerts" component={AlertsScreen} />
    </Tab.Navigator>
  );
}

function AppContent() {
  const { user, profile, loading, authVersion, isOnboarded } = useAuth();
  const { theme, setThemeMode } = useTheme();
  const isDark = theme === 'dark';
  const requiresEmailVerification = Boolean(
    user?.email &&
      !user.emailVerified &&
      user.providerData?.some((provider) => provider.providerId === 'password')
  );
  const navigationStateKey = `${user?.uid || 'guest'}-${isOnboarded ? 'onboarded' : 'new'}-${requiresEmailVerification ? 'unverified' : 'verified'}-${authVersion}`;

  React.useEffect(() => {
    if (!user?.uid) return;
    import('./src/lib/notifications')
      .then((m) => m.registerForPushNotificationsAsync(user.uid))
      .catch((error) => {
        console.warn('Notifications setup unavailable:', error);
      });
  }, [user?.uid]);

  React.useEffect(() => {
    if (!user?.uid || Platform.OS !== 'web') return;
    return subscribeToBrowserNotificationToasts(user.uid);
  }, [user?.uid]);

  React.useEffect(() => {
    if (!user?.uid || isOnboarded) return;
    if (theme !== 'light') {
      setThemeMode('light').catch(() => {});
    }
  }, [user?.uid, isOnboarded, theme, setThemeMode]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || user?.uid) return;
    const location = (globalThis as any)?.location;
    const history = (globalThis as any)?.history;
    const pathname = String(location?.pathname || '');
    const publicPaths = new Set(['', '/', '/landing', '/login']);

    if (history?.replaceState && !publicPaths.has(pathname)) {
      history.replaceState(null, '', '/landing');
    }
  }, [user?.uid]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#FBE618" />
    </View>
  );

  return (
    <NavigationContainer key={navigationStateKey} linking={linking}>
      <Stack.Navigator key={navigationStateKey} screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}>
        {!user ? (
          <>
            <Stack.Screen name="Landing" component={LandingScreen} />
            <Stack.Screen name="EmailAuth" component={EmailAuthScreen} />
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
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Messages" component={MessagesScreen} />
            <Stack.Screen name="ArchivedChats" component={MessagesScreen} initialParams={{ archivedOnly: true }} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="SwipeDeck" component={SwipeScreen} />
            <Stack.Screen name="Viewers" component={ViewersScreen} />
            <Stack.Screen name="ActiveOpportunity" component={ActiveOpportunityScreen} />
            <Stack.Screen name="ActiveOpportunities" component={ActiveOpportunitiesScreen} />
            <Stack.Screen name="TrendingBuilders" component={TrendingBuildersScreen} />
            <Stack.Screen name="RecommendedMatches" component={RecommendedMatchesScreen} />
          </>
        ) : null}
      </Stack.Navigator>
      <OpportunityRadar />
      <WebAnalytics />
      <PWAInstallPrompt />
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A20',
  },
  headerContent: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    fontStyle: 'italic',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FBE61830',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 2,
  },
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
    width: 42,
  },
  alertTabIconContainer: {
    overflow: 'visible',
  },
  focusedDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FBE618',
    position: 'absolute',
    bottom: -3,
  },
  badgeBubble: {
    position: 'absolute',
    top: -13,
    right: -12,
    minWidth: 30,
    height: 30,
    paddingHorizontal: 7,
    borderRadius: 15,
    backgroundColor: '#E30613',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0,
  },
});
