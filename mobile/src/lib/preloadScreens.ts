import { InteractionManager, Platform } from 'react-native';

let profileScreenPreloaded = false;

export const preloadProfileScreen = () => {
  if (profileScreenPreloaded) return;
  profileScreenPreloaded = true;
  require('../screens/ProfileScreen');
};

export const scheduleScreenPreloads = () => {
  InteractionManager.runAfterInteractions(() => {
    setTimeout(preloadProfileScreen, Platform.OS === 'android' ? 250 : 0);
  });
};
