import { Project, UserProfile } from '../types';

export const cleanUsername = (value: string) =>
  value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

export const handleFor = (profile: Partial<UserProfile>) =>
  `@${cleanUsername(String((profile as any).username || profile.displayName || 'builder')) || 'builder'}`;

export const isDiscoverableProfile = (profile: any) =>
  !!profile && !profile.deleted && !profile.isStealthMode && profile.isVisible !== false;

export const earnedScore = (profile: any) => {
  const skills = Array.isArray(profile?.skills) ? profile.skills.length : 0;
  const industries = Array.isArray(profile?.industries) ? profile.industries.length : 0;
  const lookingFor = Array.isArray(profile?.lookingFor) ? profile.lookingFor.length : 0;
  const photos = Array.isArray(profile?.photos) ? profile.photos.length : 0;
  const projects = Array.isArray(profile?.projects) ? profile.projects.length : 0;
  const score =
    (profile?.displayName ? 10 : 0) +
    (profile?.bio ? 12 : 0) +
    (profile?.profilePic ? 12 : 0) +
    (profile?.city && profile?.country ? 8 : 0) +
    Math.min(18, skills * 4) +
    Math.min(12, industries * 4) +
    Math.min(10, lookingFor * 5) +
    Math.min(8, photos * 3) +
    Math.min(8, projects * 4) +
    Math.min(10, Number(profile?.streakCount || 0) * 2) +
    (profile?.isVerified ? 8 : 0) +
    (profile?.onboarded ? 6 : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
};

const asList = (value: any) => (Array.isArray(value) ? value.map((x) => String(x)).filter(Boolean) : []);

export const opportunityDetails = (profile: any, selectedProject?: Project | null) => {
  const lookingFor = asList(profile?.lookingFor);
  const skills = asList(profile?.skills);
  const industries = asList(profile?.industries);
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
  const project = selectedProject || projects[0];
  const roleNeed = lookingFor.length ? lookingFor.slice(0, 3).join(', ') : 'Collaborators';
  const title = project?.title ? `${project.title}` : `${profile?.displayName || 'Builder'} is building`;
  const summary =
    project?.description ||
    profile?.bio ||
    `${profile?.occupation || 'Builder'} looking for ${roleNeed.toLowerCase()} in ${industries[0] || 'startup'} spaces.`;

  return {
    title,
    summary,
    roleNeed,
    stage: project?.status || profile?.startupStage || 'Open',
    availability: profile?.availability || 'Open',
    location: [profile?.city, profile?.country].filter(Boolean).join(', ') || 'Remote',
    tags: [...lookingFor, ...skills, ...industries].slice(0, 8),
    project,
  };
};
