import { InteractionManager, Platform } from 'react-native';

let profileScreenPreloaded = false;

export const preloadProfileScreen = () => {
  if (profileScreenPreloaded) return;
  profileScreenPreloaded = true;
  require('../screens/ProfileScreen');
};

export const scheduleScreenPreloads = () => {
  InteractionManager.runAfterInteractions(() => {
    const delay = Platform.OS === 'android' ? 400 : 80;
    setTimeout(preloadProfileScreen, delay);
    setTimeout(() => {
      require('../screens/ChatScreen');
      require('../screens/AlertsScreen');
    }, delay + 500);
  });
};
