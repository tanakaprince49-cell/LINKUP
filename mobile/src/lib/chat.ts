import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export function directMatchId(userId: string, otherUserId: string) {
  return [userId, otherUserId].sort().join('_');
}

export async function ensureDirectMatch(userId: string, otherUserId: string) {
  const matchId = directMatchId(userId, otherUserId);
  const matchRef = doc(db, 'matches', matchId);
  const participants = {
    [userId]: true,
    [otherUserId]: true,
  };

  try {
    await setDoc(
      matchRef,
      {
        userIds: [userId, otherUserId],
        participants,
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
