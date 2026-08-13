import { Project, UserProfile } from '../types';

export const cleanUsername = (value: string) =>
  value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

export const displayNameFor = (profile: Partial<UserProfile> | any) => {
  const direct = String(profile?.displayName || '').trim();
  if (direct && direct !== 'Builder' && direct !== 'New Builder') return direct;

  const fullName = String(profile?.fullName || profile?.name || '').trim();
  if (fullName) return fullName;

  const composed = [profile?.firstName, profile?.lastName]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ');
  if (composed) return composed;

  const emailName = String(profile?.email || '').split('@')[0]?.trim();
  return emailName || 'Builder';
};

export const handleFor = (profile: Partial<UserProfile>) =>
  `@${cleanUsername(String((profile as any).username || displayNameFor(profile) || 'builder')) || 'builder'}`;

export const isSyntheticProfile = (profile: any) =>
  !!profile &&
  (!!profile.isBot ||
    String(profile.uid || '').startsWith('demo-') ||
    String(profile.uid || '').startsWith('bot-'));

export const isDiscoverableProfile = (profile: any) =>
  !!profile && !profile.deleted && !profile.isStealthMode && profile.isVisible !== false && !isSyntheticProfile(profile);

export const earnedScore = (profile: any) => {
  const skills = Array.isArray(profile?.skills) ? profile.skills.length : 0;
  const industries = Array.isArray(profile?.industries) ? profile.industries.length : 0;
  const lookingFor = Array.isArray(profile?.lookingFor) ? profile.lookingFor.length : 0;
  const photos = Array.isArray(profile?.photos) ? profile.photos.length : 0;
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
  const resume = profile?.resume || {};
  const shippedProducts = Array.isArray(resume.shippedProducts) ? resume.shippedProducts.length : 0;
  const startupAttempts = Array.isArray(resume.startupAttempts) ? resume.startupAttempts.length : 0;
  const projectEvidence = projects.reduce((total: number, project: any) => {
    const status = String(project?.status || '').toLowerCase();
    return total + (project?.title ? 4 : 0) + (project?.description ? 5 : 0) + (status === 'live' ? 8 : status === 'mvp' ? 5 : 2);
  }, 0);
  const profileCompleteness =
    (profile?.displayName ? 8 : 0) +
    (profile?.bio ? 10 : 0) +
    (profile?.profilePic ? 10 : 0) +
    (profile?.city && profile?.country ? 7 : 0) +
    Math.min(18, skills * 3) +
    Math.min(12, industries * 3) +
    Math.min(12, lookingFor * 4) +
    Math.min(8, photos * 2);
  const activity =
    Math.min(28, Number(profile?.streakCount || 0) * 5) +
    Math.min(24, Number(resume.buildStreaks || 0) * 6) +
    (profile?.lastActiveAt ? 10 : 0) +
    (profile?.onboarded ? 12 : 0);
  const execution =
    Math.min(34, projectEvidence) +
    Math.min(18, shippedProducts * 9) +
    Math.min(14, startupAttempts * 7) +
    (profile?.hasExit ? 18 : 0) +
    (profile?.isVerified ? 10 : 0);
  const collaboration =
    Math.min(26, lookingFor * 6) +
    Math.min(22, skills * 3) +
    Math.min(12, industries * 3) +
    (profile?.availability ? 10 : 0) +
    (profile?.networkingIntent ? 10 : 0);
  const score = profileCompleteness * 0.35 + collaboration * 0.2 + activity * 0.2 + execution * 0.2 + (profile?.isVerified ? 5 : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
};

const asList = (value: any) => (Array.isArray(value) ? value.map((x) => String(x)).filter(Boolean) : []);
const normalizeSignal = (value: unknown) => String(value ?? '').trim().toLowerCase();
const activeNeedPattern =
  /\b(co[- ]?founder|technical co[- ]?founder|cto|hiring|hire|recruit|startup team|team member|collaborator|collaboration|partner|partnership|investment|investor|funding|capital|mentor|mentorship|advisor|developer|engineer|designer|marketer|growth|sales|operator|beta user|beta tester|internship|freelance|client|talent)\b/i;
const passiveNeedPattern = /\b(networking|casual networking|open to networking|friends|learning|learn|community)\b/i;
const inactiveProjectPattern = /\b(done|complete|completed|closed|archived|paused|inactive|cancelled|canceled)\b/i;
const activeAvailabilityPattern = /\b(hiring|recruiting|seeking|looking for|open to collaboration|actively building)\b/i;

export const hasActiveOpportunityIntent = (profile: any) => {
  if (!profile || profile.deleted || profile.isStealthMode || profile.isVisible === false || isSyntheticProfile(profile)) return false;

  const lookingFor = asList(profile.lookingFor).map(normalizeSignal);
  const explicitNeeds = lookingFor.filter((need) => activeNeedPattern.test(need) && !passiveNeedPattern.test(need));
  const availability = normalizeSignal(profile.availability);
  const activeAvailability = activeAvailabilityPattern.test(availability) && !/not available|open to networking/.test(availability);
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const activeProjects = projects.filter((project: any) => {
    const title = String(project?.title || '').trim();
    const description = String(project?.description || '').trim();
    const status = normalizeSignal(project?.status || profile?.startupStage);
    return (title || description) && !inactiveProjectPattern.test(status);
  });
  const contextText = [
    profile.goals,
    profile.bio,
    profile.networkingIntent,
    profile?.startupStage,
    profile.occupation,
    profile.company,
    ...activeProjects.flatMap((project: any) => [project?.title, project?.description, project?.status]),
  ]
    .map(normalizeSignal)
    .join(' ');
  const textHasNeed = activeNeedPattern.test(contextText);
  const hasBuildContext = activeProjects.length > 0 || /\b(idea|mvp|traction|scaling|fundraising|revenue|building|launch|startup|project)\b/.test(contextText);

  return (explicitNeeds.length > 0 || activeAvailability || textHasNeed) && hasBuildContext;
};

export const activeOpportunityScore = (profile: any) => {
  if (!hasActiveOpportunityIntent(profile)) return 0;

  const lookingFor = asList(profile.lookingFor).map(normalizeSignal);
  const explicitNeeds = lookingFor.filter((need) => activeNeedPattern.test(need) && !passiveNeedPattern.test(need)).length;
  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  const activeProjectCount = projects.filter((project: any) => {
    const title = String(project?.title || '').trim();
    const description = String(project?.description || '').trim();
    const status = normalizeSignal(project?.status || profile?.startupStage);
    return (title || description) && !inactiveProjectPattern.test(status);
  }).length;
  const availability = normalizeSignal(profile.availability);
  const activeAvailability = activeAvailabilityPattern.test(availability) ? 1 : 0;

  return (
    Math.min(50, explicitNeeds * 24) +
    Math.min(36, activeProjectCount * 18) +
    activeAvailability * 18 +
    (activeNeedPattern.test(normalizeSignal(profile.goals || profile.bio || profile.networkingIntent)) ? 12 : 0) +
    (profile.turboConnect ? 5 : 0) +
    earnedScore(profile) * 0.08
  );
};

export const opportunityDetails = (profile: any, selectedProject?: Project | null) => {
  const lookingFor = asList(profile?.lookingFor);
  const skills = asList(profile?.skills);
  const industries = asList(profile?.industries);
  const projects = Array.isArray(profile?.projects) ? profile.projects : [];
  const project = selectedProject || projects[0];
  const roleNeed = lookingFor.length ? lookingFor.slice(0, 3).join(', ') : 'Collaborators';
  const title = project?.title ? `${project.title}` : `${displayNameFor(profile)} is building`;
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
