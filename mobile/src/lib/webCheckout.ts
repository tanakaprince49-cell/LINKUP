// Web checkout calls. Relative /api URLs on purpose: the web app and the
// Vercel functions share an origin, so there is nothing to CORS-configure and
// nothing hard-coded to localhost.
//
// GOOGLE PLAY POLICY: this module is web-only. Never render a Payonify button
// or deep-link to these endpoints from inside the Android app — Play forbids
// steering its users to an external checkout. Callers must branch on
// Platform.OS and keep the native path on expo-iap.
import { auth } from './firebase';

const PENDING_KEY = 'linkup:payonify:pending-ref';

export type PayonifyStartResult = {
  checkoutUrl: string;
  sessionId: string;
  reference: string;
  amount: number;
  currency: string;
  label: string;
  tier: string;
  months: number;
};

export type PayonifyStatusResult = {
  reference: string;
  status: string;
  entitlement: {
    uid: string;
    plus?: { status: string; endsAt: number | null; planKey: string };
    campaigns?: { status: string; endsAt: number | null; planKey: string };
  } | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in first, then start your payment.');
  const token = await user.getIdToken();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * Start a Payonify checkout. Resolves with the URL to send the browser to; the
 * caller is responsible for navigating there.
 *
 * @param planKey one of WEB_TERMS in shared/pricing.js
 */
export async function startPayonifyCheckout(planKey: string): Promise<PayonifyStartResult> {
  const headers = await authHeaders();
  const res = await fetch('/api/payonifyCheckout', {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan: planKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.checkoutUrl) {
    throw new Error(data?.error || `Payonify could not start checkout (${res.status}).`);
  }
  rememberPendingReference(data.reference);
  return data as PayonifyStartResult;
}

/**
 * Ask the server whether a payment landed. This is the safety net for a missed
 * webhook — the server reports the state its webhook wrote.
 */
export async function checkPayonifyPayment(reference: string): Promise<PayonifyStatusResult> {
  const headers = await authHeaders();
  const res = await fetch('/api/payonifyStatus', {
    method: 'POST',
    headers,
    body: JSON.stringify({ reference }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Could not check payment (${res.status}).`);
  return data as PayonifyStatusResult;
}

// ---------------------------------------------------------------------------
// The browser leaves the app entirely for Payonify's hosted page, so the
// pending reference is parked in sessionStorage and picked up again on return.
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function rememberPendingReference(reference: string) {
  storage()?.setItem(PENDING_KEY, String(reference || ''));
}

export function takePendingReference(): string | null {
  const store = storage();
  if (!store) return null;
  const value = store.getItem(PENDING_KEY);
  if (value) store.removeItem(PENDING_KEY);
  return value || null;
}

export function clearPendingReference() {
  storage()?.removeItem(PENDING_KEY);
}
