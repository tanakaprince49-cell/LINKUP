import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { opportunityDetails } from './discovery';
import { UserProfile } from '../types';

export type OpportunityAlert = {
  profile: UserProfile;
  score: number;
  reason: string;
  title: string;
  summary: string;
};

const checkedAlertIds = new Set<string>();

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

const toList = (value: unknown) => {
  if (Array.isArray(value)) return value.map(normalize).filter(Boolean);
  const normalized = normalize(value);
  return normalized ? [normalized] : [];
};

const flattenAnswers = (answers?: Record<string, string | string[]>) =>
  Object.values(answers || {}).flatMap((value) => toList(value));

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const compactId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

const containsSignal = (text: string, signals: string[]) =>
  signals.filter((signal) => signal.length >= 3 && text.includes(signal));

const sharedSignals = (left: string[], right: string[]) => {
  const rightSet = new Set(right);
  return left.filter((signal) => rightSet.has(signal));
};

const userSignals = (profile: UserProfile | null | undefined) =>
  unique([
    ...toList(profile?.skills),
    ...toList(profile?.interests),
    ...toList(profile?.industries),
    ...toList(profile?.lookingFor),
    ...toList(profile?.occupation),
    ...flattenAnswers(profile?.roleAnswers),
    ...flattenAnswers(profile?.personalityAnswers),
  ]);

const opportunitySignals = (profile: UserProfile) => {
  const details = opportunityDetails(profile);
  const project = details.project || {};
  return unique([
    ...toList(profile.skills),
    ...toList(profile.industries),
    ...toList(profile.lookingFor),
    ...toList(profile.occupation),
    ...toList(profile.startupStage),
    ...toList(profile.availability),
    ...toList(project.title),
    ...toList(project.description),
    ...toList(details.title),
    ...toList(details.summary),
    ...toList(details.roleNeed),
  ]);
};

export function scoreOpportunityFit(me: UserProfile | null | undefined, candidate: UserProfile): OpportunityAlert | null {
  if (!me || !candidate || me.uid === candidate.uid || (candidate as any).deleted) return null;

  const details = opportunityDetails(candidate);
  const mySignals = userSignals(me);
  const candidateSignals = opportunitySignals(candidate);
  const searchableText = [
    details.title,
    details.summary,
    details.roleNeed,
    details.stage,
    candidate.bio,
    candidate.goals,
    candidate.occupation,
    candidate.company,
  ].map(normalize).join(' ');

  const exactMatches = sharedSignals(mySignals, candidateSignals);
  const textMatches = containsSignal(searchableText, mySignals);
  const myRole = normalize(me.occupation);
  const lookingFor = toList(candidate.lookingFor);
  const roleNeedMatches =
    !!myRole &&
    lookingFor.some((need) => need.includes(myRole) || myRole.includes(need) || need.includes('cofounder'));
  const sameLocation =
    normalize(me.country) && normalize(candidate.country) && normalize(me.country) === normalize(candidate.country);
  const activeOpportunity =
    lookingFor.length > 0 ||
    (Array.isArray(candidate.projects) && candidate.projects.length > 0) ||
    /open|available|hiring|team|cofounder|collaboration/i.test(String(candidate.availability || ''));

  const score =
    Math.min(36, exactMatches.length * 9) +
    Math.min(24, textMatches.length * 8) +
    (roleNeedMatches ? 18 : 0) +
    (sameLocation ? 6 : 0) +
    (activeOpportunity ? 18 : 0) +
    (candidate.turboConnect ? 5 : 0);

  if (score < 38 || !activeOpportunity) return null;

  const reasonParts = unique([
    ...exactMatches.slice(0, 2),
    ...textMatches.slice(0, 2),
    roleNeedMatches ? 'role fit' : '',
    sameLocation ? 'same market' : '',
  ]).slice(0, 3);

  return {
    profile: candidate,
    score: Math.min(99, Math.round(score)),
    reason: reasonParts.length ? reasonParts.join(' + ') : 'strong fit with your interests',
    title: details.title,
    summary: details.summary,
  };
}

export function getBestOpportunityAlerts(
  me: UserProfile | null | undefined,
  people: UserProfile[],
  limitCount = 3
): OpportunityAlert[] {
  return people
    .map((candidate) => scoreOpportunityFit(me, candidate))
    .filter(Boolean)
    .sort((left, right) => right!.score - left!.score)
    .slice(0, limitCount) as OpportunityAlert[];
}

export async function maybeCreateOpportunityAlerts(
  userId: string,
  me: UserProfile | null | undefined,
  people: UserProfile[]
) {
  if (!userId || !me || people.length === 0) return [];

  const alerts = getBestOpportunityAlerts(me, people, 3);
  await Promise.all(
    alerts.map(async (alert) => {
      const notificationId = `opportunity_${compactId(userId)}_${compactId(alert.profile.uid)}`;
      if (checkedAlertIds.has(notificationId)) return;
      checkedAlertIds.add(notificationId);

      const notificationRef = doc(db, 'notifications', notificationId);
      const existing = await getDoc(notificationRef).catch(() => null);
      if (existing?.exists()) return;

      const name = alert.profile.displayName || 'A builder';
      const content = `AI Opportunity: ${name} is working on something that matches you (${alert.reason}). Tap to view.`;
      await setDoc(notificationRef, {
        userId,
        fromId: alert.profile.uid,
        fromName: name,
        fromPic: alert.profile.profilePic || '',
        type: 'system',
        content: content.slice(0, 480),
        isRead: false,
        timestamp: serverTimestamp(),
      });
    })
  );

  return alerts;
}
