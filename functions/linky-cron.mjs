// Triggers the Linky hourly pass on Vercel: POST /api/linky?action=cron.
// Auth = a Google OAuth access token minted from the service account key
// (GOOGLE_APPLICATION_CREDENTIALS), verified server-side against the
// project's *.iam.gserviceaccount.com domain. No extra secret to manage.
import { applicationDefault } from 'firebase-admin/app';

const BASE = process.env.LINKY_API_BASE || 'https://linkup-muqu.vercel.app';
const { access_token: token } = await applicationDefault().getAccessToken();
if (!token) throw new Error('Could not mint an access token from the service account.');

let total = { processed: 0, cards: 0 };
for (let round = 0; round < 6; round += 1) {
  const res = await fetch(`${BASE}/api/linky?action=cron&batch=4`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(70000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    console.error(`Linky cron HTTP ${res.status}: ${text.slice(0, 400)}`);
    process.exit(1);
  }
  const processed = Array.isArray(json?.processed) ? json.processed : [];
  total.processed += processed.length;
  total.cards += processed.reduce((n, r) => n + Number(r.cards || 0), 0);
  console.log(`round ${round + 1}: active=${json?.activeIntents} expiredIntents=${json?.expiredIntents} expiredIntros=${json?.expiredIntros} processed=${processed.length} remaining=${json?.remaining} telegram=${JSON.stringify(json?.telegram || {})}`);
  if (!json?.remaining) break;
}
console.log(`done: ${total.processed} intents matched, ${total.cards} cards created`);
