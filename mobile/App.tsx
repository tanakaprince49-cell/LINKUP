import 'react-native-gesture-handler';
import React from 'react';
import { View, ActivityIndicator, Image, TouchableOpacity, StyleSheet, Dimensions, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
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
import { subscribeToUnreadNotificationsCount } from './src/lib/notifications';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Safe Icon Helper
const SafeIcon = ({ name, size = 20, color = "#FBE618", fill = "transparent" }: any) => {
  const IconComponent = (Icons as any)[name];
  if (!IconComponent) return <View style={{ width: size, height: size, backgroundColor: color + '20' }} />;
  return <IconComponent size={size} color={color} fill={fill} />;
};

// Global Header Component
const AppHeader = ({ navigation, title }: any) => {
  const { theme } = useTheme();
  const { logout } = useAuth();
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
            onPress={() => navigation.navigate('Profile')}
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

  React.useEffect(() => {
    if (!user?.uid) return;
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
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: isDark ? '#1A1A1A' : '#EEEEEE',
          height: 85,
          paddingBottom: 25,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          elevation: 0,
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
  const { user, profile, loading } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  React.useEffect(() => {
    if (user) {
      import('./src/lib/notifications').then(m => m.registerForPushNotificationsAsync(user.uid));
    }
  }, [user]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#FBE618" />
    </View>
  );

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }}>
        {user && !profile?.onboarded ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Main" component={TabNavigator} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          </>
        )}
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="Messages" component={MessagesScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="SwipeDeck" component={SwipeScreen} />
        <Stack.Screen name="Viewers" component={ViewersScreen} />
      </Stack.Navigator>
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
    height: 40,
    width: 40,
  },
  focusedDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FBE618',
    position: 'absolute',
    bottom: -8,
  },
  badgeBubble: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFF',
    letterSpacing: 0.5,
  },
});
