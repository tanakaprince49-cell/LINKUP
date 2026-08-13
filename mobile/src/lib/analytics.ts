import { addDoc, collection, doc, getDoc, increment, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { MOBILE_LIST_IMAGE_LIMIT, safeProfileImageUri } from './profilePerformance';

const isPermissionDenied = (error: any) => String(error?.code || '').includes('permission-denied');

type TrackProfileViewInput = {
  profileId?: string;
  viewerId?: string;
  viewerName?: string;
  viewerPic?: string;
  notify?: boolean;
};

type TrackProfileClickInput = {
  profileId?: string;
  viewerId?: string;
  viewerName?: string;
  viewerPic?: string;
  action?: string;
};

const cleanClickAction = (action: string) =>
  String(action || 'profile')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24) || 'profile';

export async function trackProfileView({
  profileId,
  viewerId,
  viewerName,
  viewerPic,
  notify = true,
}: TrackProfileViewInput) {
  if (!profileId || !viewerId || profileId === viewerId) return;

  const viewRef = doc(db, 'profileViews', `${profileId}_${viewerId}`);
  const safeViewerPic = safeProfileImageUri(viewerPic, MOBILE_LIST_IMAGE_LIMIT);
  let alreadyTracked = false;
  let viewSaved = false;

  try {
    const existing = await getDoc(viewRef);
    alreadyTracked = existing.exists();
  } catch (error) {
    if (!isPermissionDenied(error)) {
      console.warn('Profile view lookup skipped:', error);
    }
  }

  try {
    await setDoc(
      viewRef,
      {
        profileId,
        viewerId,
        viewerName: viewerName || 'Builder',
        viewerPic: safeViewerPic,
        ...(alreadyTracked ? {} : { createdAt: serverTimestamp() }),
        lastViewedAt: serverTimestamp(),
      },
      { merge: true }
    );
    viewSaved = true;
  } catch (error) {
    if (!isPermissionDenied(error)) {
      console.warn('Profile view event skipped:', error);
    }
  }

  if (!viewSaved || !notify || alreadyTracked) return;

  try {
    await addDoc(collection(db, 'notifications'), {
      userId: profileId,
      fromId: viewerId,
      fromName: viewerName || 'Someone',
      fromPic: safeViewerPic,
      type: 'view',
      content: 'viewed your profile.',
      timestamp: serverTimestamp(),
      isRead: false,
    });
  } catch (error) {
    console.warn('Profile view notification skipped:', error);
  }
}

export async function trackProfileClick({
  profileId,
  viewerId,
  viewerName,
  viewerPic,
  action = 'profile',
}: TrackProfileClickInput) {
  if (!profileId || !viewerId || profileId === viewerId) return;

  const safeAction = cleanClickAction(action);
  const safeViewerPic = safeProfileImageUri(viewerPic);
  const clickRef = doc(db, 'profileClicks', `${profileId}_${viewerId}_${safeAction}`);
  let alreadyTracked = false;

  try {
    const existing = await getDoc(clickRef);
    alreadyTracked = existing.exists();
  } catch (error) {
    if (!isPermissionDenied(error)) {
      console.warn('Profile click lookup skipped:', error);
    }
  }

  try {
    await setDoc(
      clickRef,
      {
        profileId,
        viewerId,
        viewerName: viewerName || 'Builder',
        viewerPic: safeViewerPic,
        action: safeAction,
        ...(alreadyTracked ? {} : { createdAt: serverTimestamp() }),
        lastClickedAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (!alreadyTracked) {
      const bump = {
        profileClicks: increment(1),
        'profileAnalytics.clicks': increment(1),
      };
      setDoc(doc(db, 'users', profileId), bump, { merge: true }).catch(() => {});
      setDoc(doc(db, 'publicProfiles', profileId), bump, { merge: true }).catch(() => {});
    }
  } catch (error) {
    if (!isPermissionDenied(error)) {
      console.warn('Profile click event skipped:', error);
    }
  }
}

export async function trackProfileSave({
  profileId,
  saved,
}: {
  profileId?: string;
  saved: boolean;
}) {
  if (!profileId) return;
  const bump = {
    profileSaves: increment(saved ? 1 : -1),
    'profileAnalytics.saves': increment(saved ? 1 : -1),
  };
  await Promise.all([
    setDoc(doc(db, 'users', profileId), bump, { merge: true }).catch(() => {}),
    setDoc(doc(db, 'publicProfiles', profileId), bump, { merge: true }).catch(() => {}),
  ]);
}
