import React from 'react';
import { Platform } from 'react-native';
import { Analytics } from '@vercel/analytics/react';

export default function WebAnalytics() {
  if (Platform.OS !== 'web') return null;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return null;
  }
  return <Analytics />;
}
