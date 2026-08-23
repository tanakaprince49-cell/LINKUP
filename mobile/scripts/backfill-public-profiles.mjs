// One-time backfill: copy every existing user profile into the lean
// `publicProfiles` index that discovery/league/inbox read from.
//
// WHY: the index fills itself when each user opens the app, but until enough
// people open it the app falls back to downloading FAT raw user docs (with
// base64 photos) — that's the "5 minute loads". Run this once from your
// laptop, then the app only ever sips lean docs.
//
// USAGE (Windows PowerShell, from C:\Users\hp\LINKUP\mobile):
//   node scripts/backfill-public-profiles.mjs you@email.com yourpassword
//
// Cost: ONE full users read (~all docs) + one index write per user. After it
// finishes the fat-read path is never needed again.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { initializeFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.log('Usage: node scripts/backfill-public-profiles.mjs <email> <password>');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, '..', 'firebase-applet-config.json'), 'utf8'));

const app = getApps().length ? getApps()[0] : initializeApp(config);
const auth = getAuth(app);
const db = initializeFirestore(app, { experimentalForceLongPolling: true, ignoreUndefinedProperties: true });

const text = (v, max = 240) => String(v ?? '').trim().slice(0, max);
const list = (v, maxItems = 16, maxChars = 80) =>
  Array.isArray(v) ? v.map((e) => text(e, maxChars)).filter(Boolean).slice(0, maxItems) : [];
const IMG_CAP = 240_000;
const img = (v) => {
  const s = String(v || '');
  if (!s) return '';
  if (s.startsWith('data:') && s.length > IMG_CAP) return '';
  return s;
};
const compactProject = (p, i) => ({ id: text(p?.id || `project_${i}`, 100), title: text(p?.title, 120), description: text(p?.description, 300), status: text(p?.status, 80), lookingFor: list(p?.lookingFor, 6, 80), tags: list(p?.tags, 6, 80) });
const compactIdea = (p, i) => ({ id: text(p?.id || `idea_${i}`, 100), title: text(p?.title, 120), description: text(p?.description, 300), stage: text(p?.stage, 80), lookingFor: list(p?.lookingFor, 6, 80), tags: list(p?.tags, 6, 80) });

const SOCIAL_KEYS = ['linkedin', 'github', 'tiktok', 'instagram', 'twitter', 'portfolio'];
const socials = (v) => {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of SOCIAL_KEYS) {
      const val = text(v[k], 240);
      if (val) out[k] = val;
    }
  }
  return out;
};

function buildIndex(uid, p) {
  if (!p || p.deleted || p.isStealthMode === true || p.isVisible === false || p.onboarded === false) return null;
  const displayName = text(p.displayName || p.fullName || p.name, 100);
  if (!displayName) return null;
  return {
    uid,
    displayName,
    username: text(p.username, 40),
    searchName: displayName.toLowerCase(),
    searchUsername: text(p.username, 40).toLowerCase(),
    bio: text(p.bio, 700),
    profilePic: img(p.profilePic),
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
    profileClicks: Number(p.profileClicks || 0) || 0,
    profileSaves: Number(p.profileSaves || 0) || 0,
    responseRate: Number(p.responseRate || 0) || 0,
    isVisible: p.isVisible !== false,
    isStealthMode: !!p.isStealthMode,
    turboConnect: !!p.turboConnect,
    hideOnlineStatus: !!p.hideOnlineStatus,
    isVerified: !!p.isVerified,
    verificationProgram: text(p.verificationProgram, 80),
    isPro: !!(p.isPro || p.plan === 'pro' || p.subscriptionPlan === 'pro'),
    plan: text(p.plan, 40),
    subscriptionPlan: text(p.subscriptionPlan, 40),
    subscriptionStatus: text(p.subscriptionStatus, 40),
    socialLinks: socials(p.socialLinks),
    onboarded: !!p.onboarded,
    deleted: false,
    lastActiveAt: p.lastActiveAt?.toDate ? p.lastActiveAt.toDate().toISOString() : (p.lastActiveAt || null),
    updatedAt: new Date().toISOString(),
  };
}

console.log('Signing in as', email, '...');
await signInWithEmailAndPassword(auth, email, password);
console.log('Signed in ✓ Reading users (this is the ONE fat read, ever)...');

const snap = await getDocs(collection(db, 'users'));
console.log(`Got ${snap.size} user docs. Writing lean index docs...`);

let batch = writeBatch(db);
let pending = 0;
let written = 0;
for (const d of snap.docs) {
  const index = buildIndex(d.id, d.data());
  if (!index) continue;
  batch.set(doc(db, 'publicProfiles', d.id), index, { merge: true });
  pending++;
  if (pending >= 400) {
    await batch.commit();
    written += pending;
    console.log(`  ...${written} index docs written`);
    batch = writeBatch(db);
    pending = 0;
  }
}
if (pending) {
  await batch.commit();
  written += pending;
}
console.log(`DONE ✅ ${written} lean publicProfiles docs written.`);
console.log('From now on, Search/Discovery/League/Inbox read lean docs only.');
await signOut(auth);
process.exit(0);
