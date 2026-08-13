import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export type SafetyFlag =
  | 'scam'
  | 'money'
  | 'off_app'
  | 'personal'
  | 'sexual'
  | 'abuse'
  | 'link_spam';

export type SafetyScan = {
  ok: boolean;
  blocked: boolean;
  flags: SafetyFlag[];
  warning?: string;
};

const PHONE = /(?:\+|00)?[\d][\d\s().-]{8,16}\d/;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const MONEY = /\b(send|wire|transfer|deposit|gift\s*card|western\s*union|moneygram|paypal|cashapp|venmo|bitcoin|btc|usdt|crypto wallet)\b/i;
const SCAM = /\b(guaranteed returns|double your money|investment opportunity|send me \$|otp|one[- ]time password|verify your account|i need you to hold money)\b/i;
const OFF_APP = /\b(whatsapp|telegram|signal me|text me at|call me on|dm me on instagram)\b/i;
const SEXUAL = /\b(send nudes|nude pics|sex chat|hookup tonight)\b/i;
const ABUSE = /\b(kill yourself|i will kill you|rape you)\b/i;
const LINK_SPAM = /(https?:\/\/|www\.)[^\s]{8,}/i;

export function scanMessageSafety(raw: string): SafetyScan {
  const text = String(raw || '').trim();
  if (!text) return { ok: true, blocked: false, flags: [] };

  const flags: SafetyFlag[] = [];
  if (SCAM.test(text)) flags.push('scam');
  if (MONEY.test(text)) flags.push('money');
  if (OFF_APP.test(text)) flags.push('off_app');
  if (PHONE.test(text) || EMAIL.test(text)) flags.push('personal');
  if (SEXUAL.test(text)) flags.push('sexual');
  if (ABUSE.test(text)) flags.push('abuse');
  if (LINK_SPAM.test(text) && (MONEY.test(text) || SCAM.test(text))) flags.push('link_spam');

  if (flags.includes('abuse') || flags.includes('scam')) {
    return {
      ok: false,
      blocked: true,
      flags,
      warning: 'This looks unsafe. LINKUP blocked it. Do not send money, passwords, or threats.',
    };
  }

  if (flags.length) {
    return {
      ok: false,
      blocked: false,
      flags,
      warning: warningFor(flags),
    };
  }

  return { ok: true, blocked: false, flags: [] };
}

const warningFor = (flags: SafetyFlag[]) => {
  if (flags.includes('money') || flags.includes('link_spam')) {
    return 'Money, wallets, and gift cards in chat are a common scam. Stay on LINKUP.';
  }
  if (flags.includes('off_app')) {
    return 'Moving off the app makes it harder to report abuse. Keep talking here until you trust them.';
  }
  if (flags.includes('personal')) {
    return 'That looks like a phone number or email. Share personal details only if you are sure.';
  }
  if (flags.includes('sexual')) {
    return 'Sexual content is not allowed on LINKUP. Keep it professional.';
  }
  return 'This message may not be safe. Review it before sending.';
};

const sendTimes = new Map<string, number[]>();

export function allowSendRate(uid: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const prev = (sendTimes.get(uid) || []).filter((t) => now - t < windowMs);
  if (prev.length >= limit) return false;
  prev.push(now);
  sendTimes.set(uid, prev);
  return true;
}

export async function theyBlockedMe(me: string, them: string) {
  if (!me || !them) return false;
  const snap = await getDoc(doc(db, 'blocks', `${them}_${me}`)).catch(() => null);
  return !!snap?.exists();
}

export async function reportSafetyIssue({
  reporterId,
  reportedUserId,
  matchId,
  messageId,
  reason,
  details,
}: {
  reporterId: string;
  reportedUserId: string;
  matchId?: string;
  messageId?: string;
  reason: string;
  details?: string;
}) {
  await addDoc(collection(db, 'reports'), {
    reporterId,
    reportedUserId,
    matchId: matchId || '',
    messageId: messageId || '',
    reason: String(reason || 'other').slice(0, 40),
    details: String(details || '').slice(0, 800),
    createdAt: serverTimestamp(),
  });
}
