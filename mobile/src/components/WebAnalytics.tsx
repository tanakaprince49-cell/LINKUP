import React from 'react';
import { Platform } from 'react-native';
import { Analytics } from '@vercel/analytics/react';

export default function WebAnalytics() {
  if (Platform.OS !== 'web') return null;
  return <Analytics />;
}
