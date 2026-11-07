import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import PaywallModal from './PaywallModal';
import { hasLinkupPro } from '../lib/paywall';
import { currentInvite, manualInvite, recordInviteShown, snoozeInvite } from '../lib/plusInvite';
import type { InviteDecision } from '../lib/plusInviteSchedule';

type DueInvite = Extract<InviteDecision, { due: true }>;

/**
 * The PLUS paywall used to be reactive: it only appeared when a member bumped
 * into a gate (four saved profiles, the viewers list, a four-post week). Most
 * members never bumped into one, so most members never saw a paywall at all —
 * which is exactly why it looked broken.
 *
 * This mounts once, inside the signed-in tree, and asks the schedule three times
 * a day at times that are never the same twice (see plusInviteSchedule.ts). One
 * benefit leads; the copy is written from that member's own brief; "Not now" is
 * a real answer and counts.
 */
export default function PlusInviteWatcher() {
  const { user, profile } = useAuth();
  const [invite, setInvite] = useState<DueInvite | null>(null);
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  const checking = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  // Deep links from PLUS emails: /app/?plus=1 opens the wall the member asked for.
  const requestedByLink = useRef(false);
  useEffect(() => {
    if (requestedByLink.current || Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    if (!/[?&]plus=1/.test(String(window.location?.search || ''))) return;
    if (!user?.uid || hasLinkupPro(profile)) return;
    requestedByLink.current = true;
    const decision = manualInvite({ uid: user.uid, profile });
    if (decision.due) setInvite(decision);
  }, [user?.uid, profile]);

  useEffect(() => {
    if (!user?.uid || hasLinkupPro(profile) || invite) return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || checking.current || AppState.currentState !== 'active') return;
      checking.current = true;
      try {
        const decision = await currentInvite({ uid: user.uid, profile, appActive: AppState.currentState === 'active' });
        if (cancelled || !decision.due) return;
        await recordInviteShown(user.uid, decision.slot);
        if (!cancelled) setInvite(decision);
      } finally {
        checking.current = false;
      }
    };
    void check();
    // A minute is fine: the schedule works in hours, and this keeps the app from
    // waking the radio for a modal nobody is waiting for.
    const timer = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.uid, profile, appActive, invite]);

  if (!invite) return null;

  return (
    <PaywallModal
      visible
      feature={invite.feature.feature}
      invite={{
        headline: invite.headline,
        subline: invite.subline,
        feature: invite.feature.feature,
        moreLine: invite.moreLine,
        onSnooze: () => {
          void snoozeInvite(user?.uid || '', invite.slot);
          setInvite(null);
        },
      }}
      onClose={() => {
        void snoozeInvite(user?.uid || '', invite.slot);
        setInvite(null);
      }}
    />
  );
}
