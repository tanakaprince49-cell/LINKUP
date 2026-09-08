// Linky hourly housekeeping on Vercel: POST /api/linky?action=cron
// (expires stale intro requests, keeps the Telegram webhook registered).
// Nothing a member sees waits on this: asks are answered in-request.
// Auth = a Google OAuth access token minted from the service account key
// (GOOGLE_APPLICATION_CREDENTIALS), verified server-side against the
// project's *.iam.gserviceaccount.com domain. No extra secret to manage.
import { applicationDefault } from 'firebase-admin/app';

const BASE = process.env.LINKY_API_BASE || 'https://linkup-muqu.vercel.app';
const { access_token: token } = await applicationDefault().getAccessToken();
if (!token) throw new Error('Could not mint an access token from the service account.');

const res = await fetch(`${BASE}/api/linky?action=cron`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: '{}',
  signal: AbortSignal.timeout(70000),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Linky cron HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exit(1);
}
let json = null;
try { json = JSON.parse(text); } catch {}
console.log(`housekeeping: pendingIntros=${json?.pendingIntros} expiredIntros=${json?.expiredIntros} telegram=${JSON.stringify(json?.telegram || {})}`);
