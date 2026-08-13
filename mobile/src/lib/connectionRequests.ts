import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { directMatchId, ensureDirectMatch } from './chat';
import { safeProfileImageUri } from './profilePerformance';

export type ConnectionRequestStatus = 'pending' | 'approved' | 'rejected';

export type ConnectionRequest = {
  id: string;
  senderId: string;
  recipientId: string;
  status: ConnectionRequestStatus;
  senderName?: string;
  senderPic?: string;
  matchId?: string;
  message?: string;
  contextType?: 'idea';
  ideaId?: string;
  ideaTitle?: string;
};

export function connectionRequestId(senderId: string, recipientId: string) {
  return `${senderId}_${recipientId}`;
}

const safeContactImage = (value?: string) => {
  return safeProfileImageUri(value || '', 900_000);
};

export type ConnectionGateStatus = 'none' | 'pending_out' | 'pending_in' | 'approved' | 'rejected';

export type ConnectionGate = {
  status: ConnectionGateStatus;
  requestId?: string;
};

const gateFromPair = (out?: ConnectionRequest | null, inn?: ConnectionRequest | null): ConnectionGate => {
  if (out?.status === 'approved' || inn?.status === 'approved') {
    return { status: 'approved', requestId: out?.id || inn?.id };
  }
  if (out?.status === 'pending') return { status: 'pending_out', requestId: out.id };
  if (inn?.status === 'pending') return { status: 'pending_in', requestId: inn.id };
  if (out?.status === 'rejected') return { status: 'rejected', requestId: out.id };
  return { status: 'none' };
};

export async function resolveConnectionGate(me: string, them: string): Promise<ConnectionGate> {
  if (!me || !them) return { status: 'none' };
  const outRef = doc(db, 'connectionRequests', connectionRequestId(me, them));
  const inRef = doc(db, 'connectionRequests', connectionRequestId(them, me));
  const [outSnap, inSnap] = await Promise.all([getDoc(outRef).catch(() => null), getDoc(inRef).catch(() => null)]);
  const out = outSnap?.exists() ? ({ id: outSnap.id, ...(outSnap.data() as any) } as ConnectionRequest) : null;
  const inn = inSnap?.exists() ? ({ id: inSnap.id, ...(inSnap.data() as any) } as ConnectionRequest) : null;
  return gateFromPair(out, inn);
}

export function subscribeToConnectionGate(
  me: string,
  them: string,
  onChange: (gate: ConnectionGate) => void
) {
  if (!me || !them) {
    onChange({ status: 'none' });
    return () => {};
  }
  let out: ConnectionRequest | null = null;
  let inn: ConnectionRequest | null = null;
  const emit = () => onChange(gateFromPair(out, inn));
  const unsubOut = onSnapshot(
    doc(db, 'connectionRequests', connectionRequestId(me, them)),
    (snap) => {
      out = snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as ConnectionRequest) : null;
      emit();
    },
    () => {
      out = null;
      emit();
    }
  );
  const unsubIn = onSnapshot(
    doc(db, 'connectionRequests', connectionRequestId(them, me)),
    (snap) => {
      inn = snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as ConnectionRequest) : null;
      emit();
    },
    () => {
      inn = null;
      emit();
    }
  );
  return () => {
    unsubOut();
    unsubIn();
  };
}

export async function startTalkOrRequest(input: {
  senderId: string;
  recipientId: string;
  senderName?: string;
  senderPic?: string;
  message?: string;
}) {
  const gate = await resolveConnectionGate(input.senderId, input.recipientId);
  if (gate.status === 'approved') {
    const matchId = await ensureDirectMatch(input.senderId, input.recipientId);
    return { action: 'chat' as const, matchId, gate };
  }
  if (gate.status === 'pending_out') return { action: 'pending' as const, gate };
  if (gate.status === 'pending_in') return { action: 'incoming' as const, gate };
  if (gate.status === 'rejected') return { action: 'rejected' as const, gate };
  await requestConnection(input);
  return { action: 'sent' as const, gate: { status: 'pending_out' as const } };
}

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
  message,
  contextType,
  ideaId,
  ideaTitle,
}: {
  senderId: string;
  recipientId: string;
  senderName?: string;
  senderPic?: string;
  message?: string;
  contextType?: 'idea';
  ideaId?: string;
  ideaTitle?: string;
}) {
  const requestId = connectionRequestId(senderId, recipientId);
  const requestRef = doc(db, 'connectionRequests', requestId);
  const existing = await getDoc(requestRef).catch(() => null);
  const safeSenderPic = safeContactImage(senderPic);
  const safeMessage = String(message || '').trim().slice(0, 600);
  const safeIdeaId = String(ideaId || '').trim().slice(0, 120);
  const safeIdeaTitle = String(ideaTitle || '').trim().slice(0, 140);

  if (existing?.exists()) {
    return { id: existing.id, ...(existing.data() as any) } as ConnectionRequest;
  }

  await setDoc(requestRef, {
    senderId,
    recipientId,
    senderName: senderName || 'Someone',
    senderPic: safeSenderPic,
    status: 'pending',
    ...(safeMessage ? { message: safeMessage } : {}),
    ...(contextType === 'idea' ? { contextType: 'idea' } : {}),
    ...(safeIdeaId ? { ideaId: safeIdeaId } : {}),
    ...(safeIdeaTitle ? { ideaTitle: safeIdeaTitle } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const notificationContent = (
    contextType === 'idea' && safeIdeaTitle
      ? `wants to connect about "${safeIdeaTitle}"${safeMessage ? `: ${safeMessage}` : '.'}`
      : safeMessage || 'requested to talk with you.'
  ).slice(0, 500);

  await addDoc(collection(db, 'notifications'), {
    userId: recipientId,
    fromId: senderId,
    fromName: senderName || 'Someone',
    fromPic: safeSenderPic,
    type: 'connection_request',
    content: notificationContent,
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
    message: safeMessage,
    ...(contextType === 'idea' ? { contextType: 'idea' as const } : {}),
    ideaId: safeIdeaId,
    ideaTitle: safeIdeaTitle,
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
