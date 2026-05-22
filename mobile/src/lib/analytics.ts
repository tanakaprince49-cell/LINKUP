import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

type TrackProfileViewInput = {
  profileId?: string;
  viewerId?: string;
  viewerName?: string;
  viewerPic?: string;
  notify?: boolean;
};

export async function trackProfileView({
  profileId,
  viewerId,
  viewerName,
  viewerPic,
  notify = true,
}: TrackProfileViewInput) {
  if (!profileId || !viewerId || profileId === viewerId) return;

  const viewRef = doc(db, 'profileViews', `${profileId}_${viewerId}`);
  let alreadyTracked = false;
  let viewSaved = false;

  try {
    const existing = await getDoc(viewRef);
    alreadyTracked = existing.exists();
  } catch (error) {
    console.warn('Profile view lookup skipped:', error);
  }

  try {
    await setDoc(
      viewRef,
      {
        profileId,
        viewerId,
        viewerName: viewerName || 'Builder',
        viewerPic: viewerPic || '',
        ...(alreadyTracked ? {} : { createdAt: serverTimestamp() }),
        lastViewedAt: serverTimestamp(),
      },
      { merge: true }
    );
    viewSaved = true;
  } catch (error) {
    console.warn('Profile view event skipped:', error);
  }

  if (!viewSaved || !notify || alreadyTracked) return;

  try {
    await addDoc(collection(db, 'notifications'), {
      userId: profileId,
      fromId: viewerId,
      fromName: viewerName || 'Someone',
      fromPic: viewerPic || '',
      type: 'view',
      content: 'viewed your profile.',
      timestamp: serverTimestamp(),
      isRead: false,
    });
  } catch (error) {
    console.warn('Profile view notification skipped:', error);
  }
}
