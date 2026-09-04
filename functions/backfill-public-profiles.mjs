/**
 * Backfill publicProfiles for accounts the client could not index.
 *
 * From 30 Aug to 4 Sep 2026 every full write to publicProfiles/{uid} was
 * rejected by the security rules ("maximum of 1000 expressions"), so people
 * who signed up in that window exist in users/{uid} but never entered the
 * lean discovery index - invisible in search, swipe, and recommendations on
 * both the app and the web. The client re-indexes itself on next launch, but
 * only when that person opens the app; this makes them findable NOW.
 *
 * Mirrors buildPublicProfileIndex in mobile/src/lib/discoveryProfiles.ts.
 * Keep the two in sync (same fields, same caps, hosted photo URLs only).
 * Idempotent: it only writes when the index doc is missing or older than the
 * user doc, so the hourly sweep can run it safely.
 *
 * PHOTOS. The index is hosted-URLs-only (base64 never enters publicProfiles),
 * but onboarding stores the picked photo as base64 in users/{uid}.profilePic
 * and never uploads it; the profile screen uploads to ImageKit opportunistically
 * and a killed app / dead network loses the hosted URL. Either way the person
 * ends up with profilePic '' in the index: a blank avatar for everyone else.
 * This job hosts such photos on ImageKit through the SAME public lane the app
 * uses (Vercel signer + public key - no private key, no new secret) and writes
 * users/{uid}.profilePicUrl, which both this script and the client index
 * prefer, so the phone's own next re-sync agrees with the server.
 *
 *   cd C:\Users\hp\LINKUP\functions
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\hp\linkup-sa.json"
 *   node backfill-public-profiles.mjs               (dry run)
 *   node backfill-public-profiles.mjs --write       (applies)
 *   node backfill-public-profiles.mjs --write --no-upload   (index only)
 */
import { createHash } from 'node:crypto';
import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId: 'linkup-e0906' });
}
const db = getFirestore();
const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--all');
const NO_UPLOAD = process.argv.includes('--no-upload');

// Same constants as mobile/src/lib/imagekitUpload.ts (public key + signer).
const IMAGEKIT_PUBLIC_KEY = process.env.IMAGEKIT_PUBLIC_KEY || 'public_nCVzK4bEGR6VH/FGJHDvjqB5urQ=';
const IMAGEKIT_AUTH_ENDPOINT = process.env.IMAGEKIT_AUTH_ENDPOINT || 'https://linkup-muqu.vercel.app/api/imagekitAuth';
const IMAGEKIT_AVATAR_FOLDER = '/linkup-avatars';
const MAX_UPLOADS_PER_RUN = Number(process.env.MAX_AVATAR_UPLOADS || 40);

const sha1 = (value) => createHash('sha1').update(value).digest('hex');

/** Upload a base64 avatar exactly like the phone does; returns the hosted URL. */
async function hostAvatar(uid, dataUri) {
  const authRes = await fetch(IMAGEKIT_AUTH_ENDPOINT);
  if (!authRes.ok) throw new Error(`signer responded ${authRes.status}`);
  const { token, expire, signature } = await authRes.json();
  if (!token || !expire || !signature) throw new Error('signer returned no signature');
  const form = new FormData();
  form.append('file', dataUri);
  form.append('fileName', `${uid}.jpg`);
  form.append('folder', IMAGEKIT_AVATAR_FOLDER);
  form.append('useUniqueFileName', 'false');
  form.append('publicKey', IMAGEKIT_PUBLIC_KEY);
  form.append('signature', signature);
  form.append('expire', String(expire));
  form.append('token', token);
  const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) throw new Error(`upload responded ${res.status} ${data?.message || ''}`.trim());
  return String(data.url);
}

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const list = (value, maxItems = 16, maxChars = 80) =>
  Array.isArray(value) ? value.map((entry) => text(entry, maxChars)).filter(Boolean).slice(0, maxItems) : [];
const hostedUri = (value) => {
  const uri = text(value, Number.MAX_SAFE_INTEGER);
  if (!uri || uri.startsWith('data:') || !/^https?:\/\//i.test(uri) || uri.length > 2048) return '';
  return uri;
};
const compactProject = (project, index) => ({
  id: text(project?.id || `project_${index}`, 100),
  title: text(project?.title, 120),
  description: text(project?.description, 300),
  status: text(project?.status, 80),
  lookingFor: list(project?.lookingFor, 6, 80),
  tags: list(project?.tags, 6, 80),
});
const compactIdea = (idea, index) => ({
  id: text(idea?.id || `idea_${index}`, 100),
  title: text(idea?.title, 120),
  description: text(idea?.description, 300),
  stage: text(idea?.stage, 80),
  lookingFor: list(idea?.lookingFor, 6, 80),
  tags: list(idea?.tags, 6, 80),
});
const SOCIAL_KEYS = ['linkedin', 'github', 'tiktok', 'instagram', 'twitter', 'portfolio'];
const sanitizeSocialLinks = (value) => {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const key of SOCIAL_KEYS) {
    const v = text(value[key], 240);
    if (v) out[key] = v;
  }
  return out;
};
const displayNameFor = (p) => {
  const direct = text(p.displayName, 100);
  if (direct && direct !== 'Builder' && direct !== 'New Builder') return direct;
  const full = text(p.fullName || p.name, 100);
  if (full) return full;
  const composed = [p.firstName, p.lastName].map((x) => text(x, 50)).filter(Boolean).join(' ');
  if (composed) return composed;
  const emailName = text(String(p.email || '').split('@')[0], 100);
  return emailName || 'Builder';
};
const toMillis = (v) => (v?.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0);

/** Same gate as the client: who may appear in the public index at all. */
function buildIndex(uid, p) {
  if (!uid || p.deleted || p.isStealthMode === true || p.isVisible === false || p.onboarded === false || p.isBot) return null;
  if (uid.startsWith('demo-') || uid.startsWith('bot-')) return null;
  const name = displayNameFor(p);
  const photoCandidates = [
    p.profilePicUrl, p.photoURL, p.photoUrl, p.avatarUrl, p.avatar, p.picture, p.imageUrl, p.profileImage, p.profilePic,
    ...(Array.isArray(p.photos) ? p.photos : []),
  ];
  const pic = hostedUri(photoCandidates.find((v) => typeof v === 'string' && v.trim()));
  return {
    uid,
    displayName: name,
    username: text(p.username, 40),
    searchName: name.toLowerCase(),
    searchUsername: text(p.username, 40).toLowerCase(),
    bio: text(p.bio, 700),
    profilePic: pic,
    occupation: text(p.occupation, 100),
    company: text(p.company, 120),
    country: text(p.country, 80),
    city: text(p.city, 80),
    age: Number(p.age || 0) || 0,
    skills: list(p.skills, 20, 80),
    interests: list(p.interests, 20, 80),
    industries: list(p.industries, 16, 80),
    lookingFor: list(p.lookingFor, 16, 80),
    goals: text(p.goals, 420),
    experience: text(p.experience, 80),
    personalityType: text(p.personalityType, 80),
    commitmentLevel: text(p.commitmentLevel, 80),
    startupStage: text(p.startupStage, 80),
    fundingStage: text(p.fundingStage, 80),
    availability: text(p.availability, 80),
    timezone: text(p.timezone, 80),
    languages: list(p.languages, 12, 80),
    workStyle: text(p.workStyle, 80),
    education: text(p.education, 80),
    networkingIntent: text(p.networkingIntent, 120),
    ambition: text(p.ambition, 120),
    remoteOnly: !!p.remoteOnly,
    willingToRelocate: !!p.willingToRelocate,
    teamSizePreference: text(p.teamSizePreference, 80),
    projects: Array.isArray(p.projects) ? p.projects.slice(0, 5).map(compactProject) : [],
    startupIdeas: Array.isArray(p.startupIdeas) ? p.startupIdeas.slice(0, 8).map(compactIdea) : [],
    profileViews: Number(p.profileViews || 0) || 0,
    profileClicks: Number(p.profileClicks || p.clicks || 0) || 0,
    profileSaves: Number(p.profileSaves || p.saves || 0) || 0,
    responseRate: Number(p.responseRate || 0) || 0,
    isVisible: p.isVisible !== false,
    isStealthMode: !!p.isStealthMode,
    turboConnect: !!p.turboConnect,
    hideOnlineStatus: !!p.hideOnlineStatus,
    isVerified: !!p.isVerified,
    verificationProgram: text(p.verificationProgram, 80),
    isPro: !!p.isPro,
    plan: text(p.plan, 40),
    subscriptionPlan: text(p.subscriptionPlan, 40),
    subscriptionStatus: text(p.subscriptionStatus, 40),
    socialLinks: sanitizeSocialLinks(p.socialLinks),
    onboarded: !!p.onboarded,
    deleted: false,
    lastActiveAt: p.lastActiveAt || null,
    updatedAt: new Date().toISOString(),
  };
}

const users = await db.collection('users').get();
console.log(`${WRITE ? 'WRITE' : 'DRY RUN'} - ${users.size} user document(s)${NO_UPLOAD ? ' (uploads off)' : ''}\n`);
let created = 0, refreshed = 0, hidden = 0, current = 0, uploaded = 0, uploadFailed = 0;
let batch = db.batch(), pending = 0;
const flush = async () => { if (pending) { await batch.commit(); batch = db.batch(); pending = 0; } };

for (const userDoc of users.docs) {
  const uid = userDoc.id;
  const p = userDoc.data() || {};
  let index = buildIndex(uid, p);
  const pubRef = db.collection('publicProfiles').doc(uid);
  const pub = await pubRef.get();

  if (!index) {
    // Not discoverable (stealth, hidden, deleted, not onboarded). If a stale
    // index doc exists, remove it - that is what the client would do too.
    if (pub.exists) {
      console.log(`  hide    ${uid}  ${displayNameFor(p)}  (stealth/hidden/deleted)`);
      if (WRITE) { batch.delete(pubRef); pending += 1; }
      hidden += 1;
    }
    continue;
  }

  // Host a base64-only (or changed) photo so the index can carry a URL.
  // profilePicHash remembers which photo the hosted copy was made from, so a
  // later photo change whose own upload failed is re-hosted automatically.
  let userPatch = null;
  const rawPic = typeof p.profilePic === 'string' ? p.profilePic : '';
  if (rawPic.startsWith('data:image') && rawPic.length <= 1_400_000) {
    const hash = sha1(rawPic);
    const hostedNow = hostedUri(p.profilePicUrl);
    // No recorded hash means we cannot know whether an existing hosted URL is
    // this photo or an older one (a changed photo whose upload died leaves
    // the old URL behind), so host it once and record the hash.
    if (!hostedNow || p.profilePicHash !== hash) {
      if (NO_UPLOAD || uploaded >= MAX_UPLOADS_PER_RUN) {
        console.log(`  photo   ${uid}  ${index.displayName}  base64 only - upload skipped this run`);
      } else {
        try {
          const url = WRITE ? await hostAvatar(uid, rawPic) : `${'https://ik.imagekit.io/vjkzaxrro'}${IMAGEKIT_AVATAR_FOLDER}/${uid}.jpg`;
          // ?v= busts the CDN cache when the same file name gets a new photo.
          const versioned = `${url}?v=${hash.slice(0, 10)}`;
          userPatch = { profilePicUrl: versioned, profilePicHash: hash };
          index = buildIndex(uid, { ...p, ...userPatch });
          uploaded += 1;
          console.log(`  photo   ${uid}  ${index.displayName}  ${Math.round(rawPic.length / 1024)}KB base64 -> ${versioned}`);
        } catch (error) {
          uploadFailed += 1;
          console.log(`  photo   ${uid}  ${index.displayName}  upload FAILED: ${error?.message || error}`);
        }
      }
    }
  }
  if (userPatch && WRITE) { batch.set(userDoc.ref, userPatch, { merge: true }); pending += 1; }

  const userUpdated = toMillis(userDoc.updateTime?.toDate?.() || userDoc.updateTime);
  const pubUpdated = pub.exists ? toMillis(pub.data()?.updatedAt) : 0;
  const photoChanged = pub.exists && (pub.data()?.profilePic || '') !== index.profilePic;
  const stale = !pub.exists || FORCE || photoChanged || (userUpdated && pubUpdated && userUpdated > pubUpdated + 60_000) || !pub.data()?.searchName;
  if (!stale) { current += 1; continue; }

  console.log(`  ${pub.exists ? 'refresh' : 'CREATE '} ${uid}  ${index.displayName}  @${index.username || '-'}  ${index.city || ''}${photoChanged ? '  (photo)' : ''}`);
  if (WRITE) { batch.set(pubRef, index, { merge: true }); pending += 1; }
  if (pub.exists) refreshed += 1; else created += 1;
  if (pending >= 400) await flush();
}
await flush();
console.log(`\n${WRITE ? 'Done' : 'Would do'}: create ${created}, refresh ${refreshed}, hide ${hidden}, photos hosted ${uploaded}${uploadFailed ? ` (${uploadFailed} failed)` : ''}; ${current} already current.`);
