import React from 'react';
import { Analytics } from '@vercel/analytics/react';

export default function WebAnalytics() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return null;
  }
  return <Analytics />;
}
