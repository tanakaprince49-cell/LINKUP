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
console.log(`housekeeping: pendingIntros=${json?.pendingIntros} expiredIntros=${json?.expiredIntros} githubCommitsRecorded=${json?.githubAutoSync?.commitsRecorded ?? 0} telegram=${JSON.stringify(json?.telegram || {})}`);

// Native push and in-app builder reminders run under the same authenticated
// scheduler. Each call advances a persisted cursor; later users cannot starve.
let delivered=0;
let pulsed=0;
let pulseEmails=0;
let emailMode='disabled';
for(let page=0;page<20;page++) {
 const response=await fetch(`${BASE}/api/linky?action=builderCron`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(70000)});
 if(!response.ok)throw new Error(`Builder reminder job failed (${response.status})`);
 const result=await response.json();delivered+=Number(result.delivered||0);
 pulsed+=Number(result?.pulse?.pulsed||0);
 pulseEmails+=Number(result?.pulse?.emailsSent||0);
 if(result?.email?.available)emailMode=result.email.provider||'enabled';
 if(!result.nextCursor)break;
}
console.log(`builder reminders delivered=${delivered}; dailyPulses=${pulsed} (emails=${pulseEmails}); email=${emailMode}`);

// Keep the LvlUp partnership demo AI cache warm across rotating theses.
const theses=['','AI agents','SaaS','Fintech','Consumer','Climate','Dev tools'];
const thesis=theses[new Date().getUTCHours()%theses.length];
const warmRes=await fetch(`https://www.linkupbuild.com/app/api/publicSeo?mode=lvlup${thesis?'&q='+encodeURIComponent(thesis):''}`,{signal:AbortSignal.timeout(15000)}).catch(()=>null);
console.log(`lvlup warm (${thesis||'default'}): HTTP ${warmRes?.status||'skipped'}`);

const testEmail=String(process.env.LINKY_TEST_EMAIL||'').trim();
if(testEmail){
 const emailRes=await fetch(`${BASE}/api/linky?action=testEmail`,{
  method:'POST',
  headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify({to:testEmail}),
  signal:AbortSignal.timeout(20000),
 });
 const emailPayload=await emailRes.text();
 console.log(`linky testEmail (${testEmail}): HTTP ${emailRes.status} ${emailPayload}`);
 if(!emailRes.ok)process.exit(1);
}
