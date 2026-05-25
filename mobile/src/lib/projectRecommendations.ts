import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { handleFor } from './discovery';
import { Project, UserProfile } from '../types';

export type ProjectRecommendation = {
  id: string;
  project: Project;
  owner: UserProfile;
  score: number;
  reason: string;
  matchingSignals: string[];
  roleNeed: string;
};

const checkedProjectAlertIds = new Set<string>();

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

const toList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(normalize).filter(Boolean);
  const normalized = normalize(value);
  return normalized ? [normalized] : [];
};

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const compactId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

const flattenAnswers = (answers?: Record<string, string | string[]>) =>
  Object.values(answers || {}).flatMap((value) => toList(value));

const userSignals = (profile: UserProfile | null | undefined) =>
  uniq([
    ...toList(profile?.occupation),
    ...toList(profile?.skills),
    ...toList(profile?.interests),
    ...toList(profile?.industries),
    ...toList(profile?.lookingFor),
    ...toList(profile?.startupStage),
    ...toList(profile?.availability),
    ...flattenAnswers(profile?.roleAnswers),
    ...flattenAnswers(profile?.personalityAnswers),
  ]);

const projectSignals = (owner: UserProfile, project: Project) =>
  uniq([
    ...toList(project.title),
    ...toList(project.description),
    ...toList(project.status),
    ...toList(owner.occupation),
    ...toList(owner.skills),
    ...toList(owner.industries),
    ...toList(owner.interests),
    ...toList(owner.lookingFor),
    ...toList(owner.startupStage),
    ...toList(owner.availability),
    ...flattenAnswers(owner.roleAnswers),
  ]);

const projectText = (owner: UserProfile, project: Project) =>
  [
    project.title,
    project.description,
    project.status,
    owner.bio,
    owner.company,
    owner.goals,
    owner.occupation,
    ...(Array.isArray(owner.lookingFor) ? owner.lookingFor : []),
    ...(Array.isArray(owner.skills) ? owner.skills : []),
    ...(Array.isArray(owner.industries) ? owner.industries : []),
  ]
    .map(normalize)
    .join(' ');

const getRoleNeed = (owner: UserProfile) => {
  const lookingFor = Array.isArray(owner.lookingFor) ? owner.lookingFor.filter(Boolean) : [];
  return lookingFor.length ? lookingFor.slice(0, 3).join(', ') : 'Collaborators';
};

const statusIsOngoing = (status: unknown) => {
  const value = normalize(status);
  if (!value) return true;
  return !/(done|complete|completed|closed|archived|paused|inactive|cancelled|canceled)/.test(value);
};

export function getOngoingProjects(owner: UserProfile): ProjectRecommendation['project'][] {
  const rows = Array.isArray(owner.projects) ? owner.projects : [];
  return rows
    .map((project: any, index) => {
      const title = String(project?.title || '').trim();
      const description = String(project?.description || '').trim();
      if (!title && !description) return null;
      const status = String(project?.status || owner.startupStage || 'mvp').trim().toLowerCase();
      if (!statusIsOngoing(status)) return null;
      return {
        id: String(project?.id || `${owner.uid || 'project'}_${index}`),
        title: title || `${owner.displayName || 'Builder'} project`,
        description: description || owner.bio || 'Ongoing LINKUP project looking for aligned builders.',
        link: project?.link ? String(project.link) : undefined,
        status: status === 'live' ? 'live' : status === 'idea' ? 'idea' : 'mvp',
      } as Project;
    })
    .filter(Boolean) as Project[];
}

export function scoreProjectFit(
  me: UserProfile | null | undefined,
  owner: UserProfile,
  project: Project
): ProjectRecommendation | null {
  if (!me || !owner || !project || me.uid === owner.uid || (owner as any).deleted) return null;

  const mySignals = userSignals(me);
  const signals = projectSignals(owner, project);
  const searchable = projectText(owner, project);
  const exactMatches = mySignals.filter((signal) => signals.includes(signal));
  const textMatches = mySignals.filter((signal) => signal.length >= 3 && searchable.includes(signal));
  const ownerLookingFor = toList(owner.lookingFor);
  const myRole = normalize(me.occupation);
  const mySkills = toList(me.skills);
  const roleNeedMatches =
    !!myRole &&
    ownerLookingFor.some(
      (need) =>
        need.includes(myRole) ||
        myRole.includes(need) ||
        (need.includes('technical') && mySkills.some((skill) => /react|node|python|ai|backend|frontend|mobile|flutter|swift|dev/.test(skill))) ||
        (need.includes('designer') && mySkills.some((skill) => /figma|ui|ux|design|brand/.test(skill))) ||
        (need.includes('marketer') && mySkills.some((skill) => /marketing|growth|sales|seo|content/.test(skill)))
    );
  const sameMarket = normalize(me.country) && normalize(owner.country) && normalize(me.country) === normalize(owner.country);
  const activeIntent = ownerLookingFor.length > 0 || /open|available|hiring|team|cofounder|collaboration/i.test(String(owner.availability || ''));

  const score =
    Math.min(32, exactMatches.length * 8) +
    Math.min(24, textMatches.length * 6) +
    (roleNeedMatches ? 22 : 0) +
    (sameMarket ? 6 : 0) +
    (activeIntent ? 12 : 0) +
    ((owner as any).turboConnect ? 4 : 0);

  if (score < 42) return null;

  const matchingSignals = uniq([
    ...exactMatches.slice(0, 3),
    ...textMatches.slice(0, 3),
    roleNeedMatches ? 'role fit' : '',
    sameMarket ? 'same market' : '',
  ]).slice(0, 5);

  return {
    id: `${owner.uid}_${project.id}`,
    owner,
    project,
    score: Math.min(99, Math.round(score)),
    reason: matchingSignals.length ? matchingSignals.slice(0, 3).join(' + ') : 'strong project fit',
    matchingSignals,
    roleNeed: getRoleNeed(owner),
  };
}

export function getBestProjectRecommendations(
  me: UserProfile | null | undefined,
  people: UserProfile[],
  limitCount = 5
) {
  return people
    .flatMap((owner) => getOngoingProjects(owner).map((project) => scoreProjectFit(me, owner, project)))
    .filter(Boolean)
    .sort((left, right) => right!.score - left!.score)
    .slice(0, limitCount) as ProjectRecommendation[];
}

export async function maybeCreateProjectRecommendationAlerts(
  userId: string,
  me: UserProfile | null | undefined,
  people: UserProfile[]
) {
  if (!userId || !me || people.length === 0) return [];

  const recommendations = getBestProjectRecommendations(me, people, 3);
  await Promise.all(
    recommendations.map(async (recommendation) => {
      const notificationId = `project_${compactId(userId)}_${compactId(recommendation.owner.uid)}_${compactId(recommendation.project.id)}`;
      if (checkedProjectAlertIds.has(notificationId)) return;
      checkedProjectAlertIds.add(notificationId);

      const notificationRef = doc(db, 'notifications', notificationId);
      const existing = await getDoc(notificationRef).catch(() => null);
      if (existing?.exists()) return;

      const ownerName = recommendation.owner.displayName || 'A builder';
      const content =
        `Project Match: ${recommendation.project.title} by ${ownerName} fits you (${recommendation.reason}). Tap to view.`;

      await setDoc(notificationRef, {
        userId,
        fromId: recommendation.owner.uid,
        fromName: handleFor(recommendation.owner),
        fromPic: recommendation.owner.profilePic || '',
        type: 'system',
        content: content.slice(0, 480),
        isRead: false,
        timestamp: serverTimestamp(),
      });
    })
  );

  return recommendations;
}
