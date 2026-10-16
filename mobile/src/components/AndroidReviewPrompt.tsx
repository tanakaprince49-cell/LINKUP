import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { recordReviewVisit, requestAutomaticReview } from '../lib/appReview';
import { SAFE_REVIEW_ROUTES } from '../lib/reviewPolicy';

export default function AndroidReviewPrompt({ userId, ready, routeName }: { userId?: string; ready: boolean; routeName?: string }) {
  useEffect(() => {
    if (Platform.OS !== 'android' || !userId || !ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const onActive = () => {
      clear();
      void recordReviewVisit(userId);
      if (!SAFE_REVIEW_ROUTES.has(routeName || '')) return;
      timer = setTimeout(() => {
        void requestAutomaticReview(userId, () => !cancelled && AppState.currentState === 'active');
      }, 15_000);
    };
    if (AppState.currentState === 'active') onActive();
    const listener = AppState.addEventListener('change', (state) => state === 'active' ? onActive() : clear());
    return () => { cancelled = true; clear(); listener.remove(); };
  }, [userId, ready, routeName]);
  return null;
}
