// Hourly cleanup for expired legacy intros and the independent weekly
// Founder Spotlight. Retired Linky bots, follow-ups, reminders, AI nudges,
// GitHub scans, and investor-demo cache warming are intentionally not run.
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
console.log(`legacy-intro cleanup: pending=${json?.pendingIntros ?? 0}; expired=${json?.expiredIntros ?? 0}; Founder Spotlight=${JSON.stringify(json?.weeklyFounderSpotlight ?? null)}`);

// Preserve the independent Builder League seasonal-award job. The endpoint
// no longer delivers retired Linky reminder/pulse/GitHub notifications.
const response=await fetch(`${BASE}/api/linky?action=builderCron`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(70000)});
if(!response.ok)throw new Error(`Seasonal award job failed (${response.status})`);
const result=await response.json();
console.log(`seasonal awards: ${JSON.stringify(result.seasons ?? null)}`);
