import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { eligibleForReview, reviewState, withReviewVisit, type ReviewState } from './reviewPolicy';

const key = (uid: string) => `linkup:app-review:v1:${uid}`;
const PLAY_PAGE = 'https://play.google.com/store/apps/details?id=com.tana.linkup&showAllReviews=true';
let queue: Promise<unknown> = Promise.resolve();
let blockers = 0;
export function blockAppReviews() {
  blockers += 1;
  let released = false;
  return () => { if (!released) { released = true; blockers = Math.max(0, blockers - 1); } };
}
function serial<T>(work: () => Promise<T>): Promise<T> {
  const pending = queue.then(work, work);
  queue = pending.then(() => undefined, () => undefined);
  return pending;
}
async function read(uid: string): Promise<ReviewState> {
  const raw = await AsyncStorage.getItem(key(uid));
  return reviewState(raw ? JSON.parse(raw) : null);
}
export async function recordReviewVisit(uid: string) {
  if (Platform.OS !== 'android' || !uid) return;
  await serial(async () => {
    const state = withReviewVisit(await read(uid));
    await AsyncStorage.setItem(key(uid), JSON.stringify(state));
  }).catch(() => undefined);
}
export async function recordReviewAction(uid: string) {
  if (Platform.OS !== 'android' || !uid) return;
  await serial(async () => {
    const state = withReviewVisit(await read(uid));
    await AsyncStorage.setItem(key(uid), JSON.stringify({ ...state, actions: state.actions + 1 }));
  }).catch(() => undefined);
}
export async function requestAutomaticReview(uid: string, isStillIdle: () => boolean) {
  const safe = () => blockers === 0 && isStillIdle();
  if (Platform.OS !== 'android' || !uid || !safe()) return;
  await serial(async () => {
    const state = await read(uid);
    if (!eligibleForReview(state) || !safe()) return;
    // Lazy loading keeps the native module out of web startup. A new Android
    // binary is required; older binaries safely skip if the module is absent.
    const StoreReview = await import('expo-store-review');
    if (!(await StoreReview.isAvailableAsync()) || !safe()) return;
    // Store an ATTEMPT before launch. Play does not tell us whether a dialog
    // appeared or a rating was submitted. Never label the member as "rated".
    await AsyncStorage.setItem(key(uid), JSON.stringify({ ...state, requestedAt: [...state.requestedAt, Date.now()] }));
    if (safe()) await StoreReview.requestReview();
  }).catch(() => undefined);
}
// A user-initiated button opens Play directly; the automatic API may be silently
// suppressed by Google, so it must not power a visible Rate button.
export async function openPlayReview() {
  if (Platform.OS !== 'android') return;
  try { await Linking.openURL('market://details?id=com.tana.linkup&showAllReviews=true'); }
  catch { await Linking.openURL(PLAY_PAGE); }
}
