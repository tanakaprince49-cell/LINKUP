import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { directMatchId, ensureDirectMatch } from './chat';

export type ConnectionRequestStatus = 'pending' | 'approved' | 'rejected';

export type ConnectionRequest = {
  id: string;
  senderId: string;
  recipientId: string;
  status: ConnectionRequestStatus;
  senderName?: string;
  senderPic?: string;
  matchId?: string;
};

export function connectionRequestId(senderId: string, recipientId: string) {
  return `${senderId}_${recipientId}`;
}

const safeContactImage = (value?: string) => {
  if (!value) return '';
  return value.length <= 5000 ? value : '';
};

export function subscribeToConnectionRequest(
  senderId: string,
  recipientId: string,
  onChange: (request: ConnectionRequest | null) => void
) {
  if (!senderId || !recipientId) {
    onChange(null);
    return () => {};
  }

  const requestRef = doc(db, 'connectionRequests', connectionRequestId(senderId, recipientId));
  return onSnapshot(
    requestRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      onChange({ id: snapshot.id, ...(snapshot.data() as any) } as ConnectionRequest);
    },
    (error) => {
      console.warn('Connection request status unavailable:', error);
      onChange(null);
    }
  );
}

export async function requestConnection({
  senderId,
  recipientId,
  senderName,
  senderPic,
}: {
  senderId: string;
  recipientId: string;
  senderName?: string;
  senderPic?: string;
}) {
  const requestId = connectionRequestId(senderId, recipientId);
  const requestRef = doc(db, 'connectionRequests', requestId);
  const existing = await getDoc(requestRef).catch(() => null);
  const safeSenderPic = safeContactImage(senderPic);

  if (existing?.exists()) {
    return { id: existing.id, ...(existing.data() as any) } as ConnectionRequest;
  }

  await setDoc(requestRef, {
    senderId,
    recipientId,
    senderName: senderName || 'Someone',
    senderPic: safeSenderPic,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'notifications'), {
    userId: recipientId,
    fromId: senderId,
    fromName: senderName || 'Someone',
    fromPic: safeSenderPic,
    type: 'connection_request',
    content: 'requested to talk with you.',
    requestId,
    isRead: false,
    timestamp: serverTimestamp(),
  });

  return {
    id: requestId,
    senderId,
    recipientId,
    senderName,
    senderPic: safeSenderPic,
    status: 'pending' as const,
  };
}

export async function respondToConnectionRequest({
  requestId,
  responderId,
  senderId,
  approved,
  responderName,
  responderPic,
}: {
  requestId: string;
  responderId: string;
  senderId: string;
  approved: boolean;
  responderName?: string;
  responderPic?: string;
}) {
  const requestRef = doc(db, 'connectionRequests', requestId);
  const matchId = approved ? directMatchId(senderId, responderId) : '';
  const safeResponderPic = safeContactImage(responderPic);

  if (approved) {
    await ensureDirectMatch(senderId, responderId);
  }

  await updateDoc(requestRef, {
    status: approved ? 'approved' : 'rejected',
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'notifications'), {
    userId: senderId,
    fromId: responderId,
    fromName: responderName || 'Someone',
    fromPic: safeResponderPic,
    type: approved ? 'connection_approved' : 'connection_rejected',
    content: approved ? 'approved your request to talk.' : 'rejected your request to talk.',
    requestId,
    ...(approved ? { matchId } : {}),
    isRead: false,
    timestamp: serverTimestamp(),
  });

  return { approved, matchId: approved ? matchId : '' };
}
