import { FieldPath, collection, doc, getDoc, limit, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { buildConversationProfileSnapshot, loadConversationProfile } from './conversationProfiles';

export function directMatchId(userId: string, otherUserId: string) {
  return [userId, otherUserId].sort().join('_');
}

type EnsureDirectMatchOptions = {
  currentUserProfile?: any;
  otherUserProfile?: any;
};

export async function ensureDirectMatch(userId: string, otherUserId: string, options: EnsureDirectMatchOptions = {}) {
  const matchId = directMatchId(userId, otherUserId);
  const matchRef = doc(db, 'matches', matchId);
  const participants = {
    [userId]: true,
    [otherUserId]: true,
  };
  const [currentProfile, otherProfile] = await Promise.all([
    loadConversationProfile(userId, options.currentUserProfile || { uid: userId }).catch(() =>
      buildConversationProfileSnapshot(userId, options.currentUserProfile || {})
    ),
    loadConversationProfile(otherUserId, options.otherUserProfile || { uid: otherUserId }).catch(() =>
      buildConversationProfileSnapshot(otherUserId, options.otherUserProfile || {})
    ),
  ]);
  const participantProfiles = {
    [userId]: buildConversationProfileSnapshot(userId, currentProfile),
    [otherUserId]: buildConversationProfileSnapshot(otherUserId, otherProfile),
  };

  try {
    await setDoc(
      matchRef,
      {
        userIds: [userId, otherUserId],
        participants,
        participantProfiles,
        timestamp: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    const snap = await getDoc(matchRef).catch(() => null);
    if (!snap?.exists()) throw error;
  }

  return matchId;
}

export function subscribeToUnreadMessagesCount(
  userId: string,
  onCount: (count: number) => void
) {
  if (!userId) {
    onCount(0);
    return () => {};
  }

  const matchesQuery = query(
    collection(db, 'matches'),
    where(new FieldPath('participants', userId), '==', true),
    limit(80)
  );

  return onSnapshot(
    matchesQuery,
    (snapshot) => {
      const total = snapshot.docs.reduce((sum, matchDoc) => {
        const data = matchDoc.data() as any;
        if (Array.isArray(data.deletedBy) && data.deletedBy.includes(userId)) return sum;
        return sum + Math.max(0, Number(data.unreadBy?.[userId] || 0));
      }, 0);
      onCount(total);
    },
    (error) => {
      console.warn('Unread messages unavailable:', error);
      onCount(0);
    }
  );
}
