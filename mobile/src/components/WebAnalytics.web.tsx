import React, { useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

// Shares the marketing site's choice on the custom-domain /app mount.
// Direct legacy-origin visits have no consent and do not load optional analytics.
function hasConsent() {
  try {
    return typeof window !== 'undefined'
      && !['localhost', '127.0.0.1'].includes(window.location.hostname)
      && window.localStorage.getItem('linkup_cookie_consent') === 'true';
  } catch { return false; }
}

export default function WebAnalytics() {
  const [accepted, setAccepted] = useState(false);
  const previouslyEnabled = useRef(false);
  useEffect(() => {
    const update = () => {
      const next = hasConsent();
      if (previouslyEnabled.current && !next) { window.location.reload(); return; }
      previouslyEnabled.current = next;
      setAccepted(next);
    };
    update();
    window.addEventListener('storage', update);
    window.addEventListener('linkup:analytics-consent', update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('linkup:analytics-consent', update);
    };
  }, []);
  return accepted ? <Analytics /> : null;
}
