import { db } from './firebase';
import {
  doc, setDoc, getDoc, onSnapshot, collection, query, where,
  updateDoc, arrayUnion, Timestamp, deleteDoc,
} from 'firebase/firestore';

export type GameType = 'founderflip' | 'pitchperfect' | 'networkquiz';

export interface GameChallenge {
  id: string;
  senderId: string;
  recipientId: string;
  gameType: GameType;
  senderName: string;
  senderPic?: string;
  message?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  respondedAt?: number;
}

export function challengeId(userId: string, connectionId: string): string {
  const parts = [userId, connectionId].sort();
  return `challenge_${parts[0]}_${parts[1]}`;
}

export async function sendGameChallenge(params: {
  senderId: string;
  recipientId: string;
  gameType: GameType;
  senderName: string;
  senderPic?: string;
  message?: string;
}): Promise<void> {
  const id = challengeId(params.senderId, params.recipientId);
  const ref = doc(db, 'gameChallenges', id);

  const existing = await getDoc(ref);
  if (existing.exists() && existing.data().status === 'pending') {
    return;
  }

  const challenge: GameChallenge = {
    id,
    senderId: params.senderId,
    recipientId: params.recipientId,
    gameType: params.gameType,
    senderName: params.senderName,
    senderPic: params.senderPic,
    message: params.message,
    status: 'pending',
    createdAt: Date.now(),
  };

  await setDoc(ref, challenge);

  const notifRef = doc(collection(db, 'notifications'));
  await setDoc(notifRef, {
    id: notifRef.id,
    userId: params.recipientId,
    fromId: params.senderId,
    type: 'game_challenge',
    title: `${params.senderName} challenged you!`,
    body: `Can you beat their ${params.gameType} score?`,
    isRead: false,
    createdAt: Timestamp.now(),
    data: {
      gameType: params.gameType,
      challengeId: id,
    },
  });
}

export function subscribeToChallenges(
  userId: string,
  onChange: (challenges: GameChallenge[]) => void,
): () => void {
  const q = query(
    collection(db, 'gameChallenges'),
    where('recipientId', '==', userId),
    where('status', '==', 'pending'),
  );
  const unsub = onSnapshot(q, (snap) => {
    const list: GameChallenge[] = [];
    snap.forEach((d) => list.push(d.data() as GameChallenge));
    onChange(list);
  });
  return unsub;
}

export async function respondToChallenge(
  challengeId: string,
  status: 'accepted' | 'declined',
): Promise<void> {
  const ref = doc(db, 'gameChallenges', challengeId);
  await updateDoc(ref, {
    status,
    respondedAt: Date.now(),
  });
}

export async function getChallengeByUsers(
  userId: string, connectionId: string,
): Promise<GameChallenge | null> {
  const id = challengeId(userId, connectionId);
  const snap = await getDoc(doc(db, 'gameChallenges', id));
  if (snap.exists()) return snap.data() as GameChallenge;
  return null;
}