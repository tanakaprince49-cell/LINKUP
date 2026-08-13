import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { earnedScore, isDiscoverableProfile } from './discovery';
import type { UserProfile } from '../types';

const lastActiveMs = (profile: any) => {
  const raw = profile?.lastActiveAt;
  if (!raw) return 0;
  if (typeof raw?.toDate === 'function') return raw.toDate().getTime();
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** Fair heat: profile quality + real attention. No Plus / Turbo boost. */
export const leagueHeat = (profile: any) => {
  const quality = earnedScore(profile);
  const views = Math.min(22, Number(profile?.profileViews || profile?.viewedBy?.length || 0) * 0.35);
  const age = Date.now() - lastActiveMs(profile);
  const fresh = !lastActiveMs(profile) ? 0 : age < 3 * 86400000 ? 16 : age < 14 * 86400000 ? 10 : age < 45 * 86400000 ? 4 : 0;
  return quality + views + fresh;
};

export const rankLeague = (people: UserProfile[], me?: UserProfile | null) => {
  const pool = [...people];
  if (me?.uid && isDiscoverableProfile(me) && !pool.some((p) => p.uid === me.uid)) pool.push(me);
  return pool
    .filter((p: any) => p?.uid && isDiscoverableProfile(p))
    .sort((a: any, b: any) => {
      const diff = leagueHeat(b) - leagueHeat(a);
      if (diff !== 0) return diff;
      return String(a.uid).localeCompare(String(b.uid));
    })
    .slice(0, 20);
};

const dayKey = () => new Date().toISOString().slice(0, 10);

export const notifyLeaguePodium = async (podium: UserProfile[], fromId: string) => {
  if (!fromId || podium.length === 0) return;
  const day = dayKey();
  const labels = ['1st', '2nd', '3rd'];
  await Promise.all(
    podium.slice(0, 3).map(async (person, index) => {
      if (!person?.uid) return;
      const rank = index + 1;
      const id = `league_${person.uid}_${day}_${rank}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      await setDoc(
        doc(db, 'notifications', id),
        {
          userId: person.uid,
          fromId,
          fromName: 'Builder League',
          fromPic: '',
          type: 'system',
          content:
            rank === 1
              ? 'You’re #1 on today’s Builder League podium.'
              : `You’re #${rank} (${labels[index]}) on today’s Builder League. Stay active to hold it.`,
          isRead: false,
          timestamp: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    })
  );
};
