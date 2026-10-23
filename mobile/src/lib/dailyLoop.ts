import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { builderCall } from './builder';
import { db } from './firebase';
import { displayNameFor, earnedScore, hasActiveOpportunityIntent } from './discovery';

export const todayKey = () => new Date().toISOString().slice(0, 10);

const dailyFiveKey = (uid: string) => `linkup:daily-five:${uid}:${todayKey()}`;
const ideaHabitKey = (uid: string) => `linkup:idea-habit:${uid}`;
const lastRepSyncKey = (uid: string) => `linkup:rep-sync:${uid}`;

export type DailyFiveCard =
  | { id: string; kind: 'person'; title: string; subtitle: string; userId: string; pic?: string }
  | { id: string; kind: 'opportunity'; title: string; subtitle: string; userId: string; pic?: string }
  | { id: string; kind: 'idea'; title: string; subtitle: string }
  | { id: string; kind: 'roast'; title: string; subtitle: string };

export type ShipLogEntry = {
  id: string;
  text: string;
  link?: string;
  createdAt: string;
};

export const loadDailyFiveProgress = async (uid: string) => {
  try {
    const raw = await AsyncStorage.getItem(dailyFiveKey(uid));
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      doneIds: Array.isArray(parsed.doneIds) ? parsed.doneIds as string[] : [],
      completed: !!parsed.completed,
    };
  } catch {
    return { doneIds: [] as string[], completed: false };
  }
};

export const saveDailyFiveProgress = async (uid: string, doneIds: string[], completed: boolean) => {
  await AsyncStorage.setItem(dailyFiveKey(uid), JSON.stringify({ doneIds, completed, updatedAt: Date.now() }));
};

export const buildDailyFive = (me: any, people: any[]): DailyFiveCard[] => {
  const pool = (people || []).filter((p) => p?.uid && p.uid !== me?.uid);
  const ranked = [...pool].sort((a, b) => earnedScore(b) - earnedScore(a));
  const peopleCards = ranked.slice(0, 3).map((p) => ({
    id: `person_${p.uid}`,
    kind: 'person' as const,
    title: displayNameFor(p),
    subtitle: [(p.occupation || 'Builder'), [p.city, p.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    userId: p.uid,
    pic: p.profilePic,
  }));
  const opp = pool.find((p) => hasActiveOpportunityIntent(p));
  const cards: DailyFiveCard[] = [...peopleCards];
  if (opp) {
    cards.push({
      id: `opp_${opp.uid}`,
      kind: 'opportunity',
      title: `${displayNameFor(opp)} is seeking collaborators`,
      subtitle: Array.isArray(opp.lookingFor) ? opp.lookingFor.slice(0, 3).join(', ') : 'Open to collaborators',
      userId: opp.uid,
      pic: opp.profilePic,
    });
  }
  cards.push({
    id: 'idea_habit',
    kind: 'idea',
    title: "Review a startup opportunity",
    subtitle: "Review a startup concept and identify the expertise required to develop it.",
  });
  cards.push({
    id: 'roast',
    kind: 'roast',
    title: "Share a business milestone",
    subtitle: "Record a concise progress update to keep your activity-based reputation current.",
  });
  return cards.slice(0, 5);
};

export const getIdeaHabit = async (uid: string) => {
  try {
    const raw = await AsyncStorage.getItem(ideaHabitKey(uid));
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      lastDate: String(parsed.lastDate || ''),
      lastIdeaId: String(parsed.lastIdeaId || ''),
      lastNeed: String(parsed.lastNeed || ''),
    };
  } catch {
    return { lastDate: '', lastIdeaId: '', lastNeed: '' };
  }
};

export const markIdeaHabitDone = async (uid: string, ideaId: string, need: string) => {
  await AsyncStorage.setItem(
    ideaHabitKey(uid),
    JSON.stringify({ lastDate: todayKey(), lastIdeaId: ideaId, lastNeed: need, updatedAt: Date.now() })
  );
};

export const decayingRepScore = (profile: any, extra: { shipCount?: number; idleDays?: number } = {}) => {
  const ships = Number(extra.shipCount ?? (Array.isArray(profile?.shipLogs) ? profile.shipLogs.length : 0));
  const base = earnedScore(profile);
  const shipBoost = Math.min(36, ships * 8);
  const idleDays = Number(extra.idleDays || 0);
  const decay = Math.min(40, Math.max(0, Math.floor(idleDays / 7) * 8));
  return Math.max(0, Math.min(100, Math.round(base * 0.55 + shipBoost - decay)));
};

export const daysSince = (iso?: string) => {
  if (!iso) return 30;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 30;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

export const normalizeShipLogs = (value: unknown): ShipLogEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => ({
      id: String(entry?.id || `ship_${index}`),
      text: String(entry?.text || '').trim().slice(0, 180),
      link: String(entry?.link || '').trim().slice(0, 2048),
      createdAt: String(entry?.createdAt || ''),
    }))
    .filter((entry) => entry.text);
};

export const uniqueShipDays = (logs: ShipLogEntry[]) =>
  new Set(logs.map((log) => String(log.createdAt || '').slice(0, 10)).filter(Boolean)).size;

export const SHIP_VERIFY_DAYS = 3;

/** Legacy callers use the same authoritative contribution transaction. */
export async function persistShipAndRep(uid: string, profile: any, nextLogs: ShipLogEntry[]) {
  if(!uid||!nextLogs[0])throw new Error('Add a progress update first.');
  const first=nextLogs[0];
  const result=await builderCall('shipUpdate',{key:first.id,text:first.text,link:first.link||''});
  return {...result,reputationScore:Number(profile?.reputationScore)||0,shippedDays:result.days.length,earnedShipBadge:false};
}

export async function syncDecayingRep(uid: string, profile: any) {
  if (!uid) return;
  try {
    const last = await AsyncStorage.getItem(lastRepSyncKey(uid));
    if (last === todayKey()) return;
    const logs = normalizeShipLogs(profile?.shipLogs);
    const idleDays = daysSince(logs[0]?.createdAt || profile?.lastShippedAt);
    const reputationScore = decayingRepScore(profile, { shipCount: logs.length, idleDays });
    if (Number(profile?.reputationScore) !== reputationScore) {
      await setDoc(doc(db, 'users', uid), { reputationScore, lastActiveAt: serverTimestamp() }, { merge: true });
    }
    await AsyncStorage.setItem(lastRepSyncKey(uid), todayKey());
  } catch (error) {
    console.warn('Rep sync skipped:', error);
  }
}
