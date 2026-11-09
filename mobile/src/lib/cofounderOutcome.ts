import { doc, onSnapshot, serverTimestamp, setDoc } from './firestoreCompat';
import { db } from './firebase';

/**
 * Meeting outcomes: after a connection is accepted and two people actually
 * meet, the viewer records whether this person will become their co-founder.
 * A decline always carries a reason. These verdicts are the training signal
 * the matcher can actually learn from — pairs a member met and declined are
 * never paired again (see loadDeclinedPairIds in api/_weeklyCofounder.js).
 */
export type CofounderOutcomeValue = 'accepted' | 'declined' | 'not_met';

export type CofounderOutcome = {
  outcome?: CofounderOutcomeValue;
  reason?: string;
  reasonText?: string;
};

export const DECLINE_REASONS = [
  'Our skills overlapped too much',
  'Different stage or pace',
  'No chemistry',
  'Timing is not right',
  'Location or remote friction',
  'They are not looking for a co-founder',
  'Other',
] as const;

export function cofounderOutcomeId(viewerUid: string, partnerUid: string) {
  return `${viewerUid}_${partnerUid}`;
}

export function subscribeCofounderOutcome(
  viewerUid: string,
  partnerUid: string,
  onChange: (outcome: CofounderOutcome | null) => void
) {
  if (!viewerUid || !partnerUid) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, 'cofounderOutcomes', cofounderOutcomeId(viewerUid, partnerUid)),
    (snap) => onChange(snap.exists() ? ((snap.data() as any) as CofounderOutcome) : null),
    () => onChange(null)
  );
}

export async function recordCofounderOutcome(input: {
  viewerUid: string;
  partnerUid: string;
  viewerName?: string;
  partnerName?: string;
  outcome: CofounderOutcomeValue;
  reason?: string;
  reasonText?: string;
}) {
  const ref = doc(db, 'cofounderOutcomes', cofounderOutcomeId(input.viewerUid, input.partnerUid));
  await setDoc(
    ref,
    {
      viewerUid: input.viewerUid,
      partnerUid: input.partnerUid,
      viewerName: String(input.viewerName || '').slice(0, 80),
      partnerName: String(input.partnerName || '').slice(0, 80),
      outcome: input.outcome,
      reason: String(input.reason || '').slice(0, 80),
      reasonText: String(input.reasonText || '').slice(0, 400),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}
