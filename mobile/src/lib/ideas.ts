import { Project, StartupIdea, UserProfile } from '../types';
import { displayNameFor } from './discovery';

export type IdeaDeckItem = StartupIdea & {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerPic?: string;
  ownerOccupation?: string;
  ownerCity?: string;
  ownerCountry?: string;
  ownerVerified?: boolean;
  source: 'startupIdea' | 'project';
};

export const safeIdeaId = (value: unknown) => {
  const base = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
  return base || `idea_${Date.now()}`;
};

export const normalizeIdeaDraft = (idea: any, uid: string, index: number): StartupIdea => ({
  id: safeIdeaId(idea?.id || `${uid}_idea_${index}_${Date.now()}`),
  title: String(idea?.title || '').trim(),
  description: String(idea?.description || '').trim(),
  stage: String(idea?.stage || idea?.status || 'Idea Stage').trim(),
  lookingFor: Array.isArray(idea?.lookingFor)
    ? idea.lookingFor.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
    : String(idea?.lookingFor || '')
        .split(/[,\n;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 8),
  tags: Array.isArray(idea?.tags)
    ? idea.tags.map((entry: unknown) => String(entry || '').trim()).filter(Boolean).slice(0, 8)
    : String(idea?.tags || '')
        .split(/[,\n;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 8),
});

const ideaFromProject = (project: Project, uid: string, index: number): StartupIdea => ({
  id: safeIdeaId(`project_${project.id || uid}_${index}`),
  title: String(project.title || '').trim(),
  description: String(project.description || '').trim(),
  stage: project.status || 'mvp',
  lookingFor: [],
  tags: [project.status || 'project'].filter(Boolean),
});

export const collectIdeaDeck = (profiles: UserProfile[], currentUid?: string): IdeaDeckItem[] => {
  const seen = new Set<string>();
  const items: IdeaDeckItem[] = [];

  profiles.forEach((profile) => {
    if (!profile?.uid || profile.uid === currentUid) return;

    const rawIdeas = Array.isArray((profile as any).startupIdeas) ? (profile as any).startupIdeas : [];
    const projectFallback =
      rawIdeas.length === 0 && Array.isArray((profile as any).projects)
        ? (profile as any).projects.map((project: Project, index: number) => ideaFromProject(project, profile.uid, index))
        : [];

    [...rawIdeas, ...projectFallback].forEach((rawIdea: any, index) => {
      const idea = normalizeIdeaDraft(rawIdea, profile.uid, index);
      if (!idea.title && !idea.description) return;
      const id = safeIdeaId(`${profile.uid}_${idea.id || idea.title || index}`);
      if (seen.has(id)) return;
      seen.add(id);
      items.push({
        ...idea,
        id,
        title: idea.title || `${displayNameFor(profile)}'s idea`,
        description: idea.description || `${displayNameFor(profile)} wants collaborators for this idea.`,
        ownerId: profile.uid,
        ownerName: displayNameFor(profile),
        ownerPic: profile.profilePic || '',
        ownerOccupation: (profile as any).occupation || '',
        ownerCity: profile.city || '',
        ownerCountry: profile.country || '',
        ownerVerified: !!(profile as any).isVerified,
        source: rawIdeas.length > 0 ? 'startupIdea' : 'project',
      });
    });
  });

  return items;
};
