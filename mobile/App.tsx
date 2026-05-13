import React from 'react';
import { View, ActivityIndicator, Image, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Home, Search, Users, Bell, MessageSquare, User, Plus } from 'lucide-react-native';

import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';

import FeedScreen from './src/screens/FeedScreen';
import LandingScreen from './src/screens/LandingScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SwipeScreen from './src/screens/SwipeScreen';
import MatchScreen from './src/screens/MatchScreen';
import AlertsScreen from './src/screens/AlertsScreen';
import MessagesScreen from './src/screens/MessagesScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import CreatePostScreen from './src/screens/CreatePostScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabNavigator({ navigation }: any) {
  const { theme } = useTheme();
  const { profile } = useAuth();
  const isDark = theme === 'dark';

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let icon;
          if (route.name === 'Feed') icon = Home;
          else if (route.name === 'Swipe') icon = Search;
          else if (route.name === 'Matches') icon = Users;
          else if (route.name === 'Alerts') icon = Bell;
          else if (route.name === 'Post') icon = Plus;

          const IconComponent = icon || Home;
          const isPostButton = route.name === 'Post';

          return (
            <View style={[
              { alignItems: 'center', justifyContent: 'center' },
              isPostButton && {
                backgroundColor: '#FBE618',
                width: 56,
                height: 56,
                borderRadius: 28,
                marginTop: -20,
                elevation: 5,
                shadowColor: '#FBE618',
                shadowOpacity: 0.3,
                shadowRadius: 10,
              }
            ]}>
              <IconComponent 
                size={isPostButton ? 30 : (focused ? 26 : 22)} 
                color={isPostButton ? '#000000' : color} 
                strokeWidth={isPostButton ? 3 : (focused ? 2.5 : 2)} 
              />
              {focused && !isPostButton && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#FBE618', marginTop: 4 }} />}
            </View>
          );
        },
        tabBarActiveTintColor: '#FBE618',
        tabBarInactiveTintColor: isDark ? '#888888' : '#CCCCCC',
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#1A1A1A' : '#FFFFFF',
          borderTopWidth: 0,
          height: 80,
          paddingBottom: 20,
          elevation: 20,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 15,
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="Swipe" component={SwipeScreen} />
      <Tab.Screen 
        name="Post" 
        component={View} 
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('CreatePost');
          },
        })}
      />
      <Tab.Screen name="Matches" component={MatchScreen} />
      <Tab.Screen name="Alerts" component={AlertsScreen} />
      <Tab.Screen name="Messages" component={MessagesScreen} />
    </Tab.Navigator>
  );
}

function AppContent() {
  const { user, profile, loading } = useAuth();
  const { theme } = useTheme();

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: theme === 'dark' ? '#050508' : '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#FBE618" />
    </View>
  );

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Landing" component={LandingScreen} />
        ) : profile && !profile.onboarded ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ presentation: 'modal' }} />
          </>
        )}
      </Stack.Navigator>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
