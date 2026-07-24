import { db } from './firebase';
import {
  doc, setDoc, getDoc, onSnapshot, collection, query, where,
  updateDoc, Timestamp,
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
  status: 'pending' | 'accepted' | 'declined' | 'completed';
  createdAt: number;
  respondedAt?: number;
  senderScore?: number;
  recipientScore?: number;
  senderPlayedAt?: number;
  recipientPlayedAt?: number;
  completedAt?: number;
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
  senderScore?: number;
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
    senderScore: params.senderScore,
    senderPlayedAt: params.senderScore != null ? Date.now() : undefined,
  };

  await setDoc(ref, challenge);

  const notifRef = doc(collection(db, 'notifications'));
  await setDoc(notifRef, {
    userId: params.recipientId,
    fromId: params.senderId,
    fromName: params.senderName,
    fromPic: params.senderPic || null,
    type: 'game_challenge',
    content: `challenged you to ${params.gameType}!`,
    isRead: false,
    timestamp: Timestamp.now(),
    gameType: params.gameType,
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

export async function submitChallengeScore(
  challengeId: string,
  userId: string,
  score: number,
): Promise<void> {
  const ref = doc(db, 'gameChallenges', challengeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() as GameChallenge;
  const isSender = data.senderId === userId;
  const now = Date.now();

  const update: Record<string, any> = {};
  if (isSender) {
    update.senderScore = score;
    update.senderPlayedAt = now;
  } else {
    update.recipientScore = score;
    update.recipientPlayedAt = now;
  }

  const senderScore = isSender ? score : data.senderScore;
  const recipientScore = isSender ? data.recipientScore : score;
  if (senderScore != null && recipientScore != null) {
    update.completedAt = now;
    update.status = 'completed';
  }

  await updateDoc(ref, update);
}

export function subscribeToChallenge(
  challengeId: string,
  onChange: (challenge: GameChallenge | null) => void,
): () => void {
  const unsub = onSnapshot(doc(db, 'gameChallenges', challengeId), (snap) => {
    onChange(snap.exists() ? (snap.data() as GameChallenge) : null);
  });
  return unsub;
}

export async function getChallengeByUsers(
  userId: string, connectionId: string,
): Promise<GameChallenge | null> {
  const id = challengeId(userId, connectionId);
  const snap = await getDoc(doc(db, 'gameChallenges', id));
  if (snap.exists()) return snap.data() as GameChallenge;
  return null;
}