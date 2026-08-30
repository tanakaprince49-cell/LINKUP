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
  /** Seeded sample content — never written to Firestore. */
  demo?: boolean;
};

/**
 * Fifteen seeded ideas.
 *
 * A fresh install (or a quiet network) has no user-generated ideas at all,
 * which left the Idea Deck as an empty screen. These fill it so the flow is
 * demonstrable straight away. Real ideas always take priority: they are only
 * appended when the organic deck is short.
 *
 * `demo: true` is load-bearing — swipe handlers must never persist these or
 * notify their fictional owners.
 */
export const DEMO_IDEAS: IdeaDeckItem[] = [
  {
    id: 'demo_farmlink', title: 'FarmLink', source: 'startupIdea', demo: true,
    description: 'A marketplace that connects smallholder farmers directly to bulk buyers, so produce stops travelling through four middlemen before it gets paid for.',
    stage: 'MVP', lookingFor: ['CTO', 'Distribution partner'], tags: ['AgriTech', 'Marketplace'],
    ownerId: 'demo', ownerName: 'Tendai M.', ownerOccupation: 'Agronomist', ownerCity: 'Harare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_zimremit', title: 'ZimRemit', source: 'startupIdea', demo: true,
    description: 'Cross-border remittances routed through stablecoin rails, cutting the cost of sending money home from about 9% to under 2%.',
    stage: 'Seed', lookingFor: ['Compliance lead', 'Investor'], tags: ['Fintech', 'Payments'],
    ownerId: 'demo', ownerName: 'Chipo N.', ownerOccupation: 'Ex-banker', ownerCity: 'Harare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_ecobrick', title: 'EcoBrick', source: 'startupIdea', demo: true,
    description: 'Building bricks pressed from recycled plastic waste that are cheaper than concrete and rated for load-bearing walls.',
    stage: 'Prototype', lookingFor: ['Manufacturing partner'], tags: ['ClimateTech', 'Hardware'],
    ownerId: 'demo', ownerName: 'Brian K.', ownerOccupation: 'Materials engineer', ownerCity: 'Bulawayo', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_mediqueue', title: 'MediQueue', source: 'startupIdea', demo: true,
    description: 'Clinic queue management over WhatsApp — patients take a ticket from home and get told when the doctor is actually ready.',
    stage: 'MVP', lookingFor: ['Frontend dev', 'Clinic pilot'], tags: ['HealthTech', 'SaaS'],
    ownerId: 'demo', ownerName: 'Dr. Rumbidzai S.', ownerOccupation: 'Physician', ownerCity: 'Harare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_skillforge', title: 'SkillForge', source: 'startupIdea', demo: true,
    description: 'Paid two-week micro-internships that let graduates prove they can do the work before anyone asks for a CV.',
    stage: 'Idea Stage', lookingFor: ['Co-founder', 'Employer partners'], tags: ['EdTech', 'Future of Work'],
    ownerId: 'demo', ownerName: 'Lerato D.', ownerOccupation: 'Learning designer', ownerCity: 'Johannesburg', ownerCountry: 'South Africa',
  },
  {
    id: 'demo_solarsprout', title: 'SolarSprout', source: 'startupIdea', demo: true,
    description: 'Pay-as-you-go solar irrigation on a mobile money meter, so a farmer can water a hectare without buying a pump outright.',
    stage: 'Seed', lookingFor: ['Hardware engineer', 'Grant funding'], tags: ['CleanTech', 'Hardware'],
    ownerId: 'demo', ownerName: ' Farai T.', ownerOccupation: 'Renewable energy', ownerCity: 'Mutare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_tuku', title: 'TukuDelivery', source: 'startupIdea', demo: true,
    description: 'Hyperlocal last-mile delivery built around high-density suburbs, where street addresses barely exist and routing is the whole problem.',
    stage: 'MVP', lookingFor: ['Ops lead', 'Driver network'], tags: ['Logistics', 'Marketplace'],
    ownerId: 'demo', ownerName: 'Kuda Z.', ownerOccupation: 'Operations', ownerCity: 'Harare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_vhura', title: 'Vhura AI', source: 'startupIdea', demo: true,
    description: 'A voice assistant that actually works in Shona and isiNdebele, aimed at the majority of customers call centres currently cannot serve.',
    stage: 'Prototype', lookingFor: ['ML engineer', 'Data partners'], tags: ['AI', 'NLP'],
    ownerId: 'demo', ownerName: 'Nyasha C.', ownerOccupation: 'Research engineer', ownerCity: 'Harare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_chipo', title: 'Chipo Savings', source: 'startupIdea', demo: true,
    description: 'Digitises the stokvel — group savings and rotating payouts — with a ledger everyone in the group can audit.',
    stage: 'MVP', lookingFor: ['Mobile dev', 'Regulatory advice'], tags: ['Fintech', 'Community'],
    ownerId: 'demo', ownerName: 'Sibongile M.', ownerOccupation: 'Product manager', ownerCity: 'Bulawayo', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_buildright', title: 'BuildRight', source: 'startupIdea', demo: true,
    description: 'Vets and reviews contractors for homeowners, with escrow so nobody pays for a roof that was never started.',
    stage: 'Idea Stage', lookingFor: ['Co-founder', 'Insurer partner'], tags: ['Marketplace', 'Trust & Safety'],
    ownerId: 'demo', ownerName: 'Tapiwa G.', ownerOccupation: 'Quantity surveyor', ownerCity: 'Harare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_freshpress', title: 'FreshPress', source: 'startupIdea', demo: true,
    description: 'Cold-pressed juice subscription sourced from small farms, positioned as a daily habit rather than a health fad.',
    stage: 'Revenue', lookingFor: ['Distribution partner'], tags: ['Consumer', 'Subscription'],
    ownerId: 'demo', ownerName: 'Amara O.', ownerOccupation: 'Brand builder', ownerCity: 'Lagos', ownerCountry: 'Nigeria',
  },
  {
    id: 'demo_smartboda', title: 'SmartBoda', source: 'startupIdea', demo: true,
    description: 'Asset financing for motorbike taxi riders, unlocked by their own trip earnings history instead of a credit score they do not have.',
    stage: 'Seed', lookingFor: ['Credit analyst', 'Lender partner'], tags: ['Mobility', 'Fintech'],
    ownerId: 'demo', ownerName: 'Kevin W.', ownerOccupation: 'Credit risk', ownerCity: 'Nairobi', ownerCountry: 'Kenya',
  },
  {
    id: 'demo_codehive', title: 'CodeHive', source: 'startupIdea', demo: true,
    description: 'Back-office for small remote dev studios: contracts, invoicing and time tracking in one place instead of six spreadsheets.',
    stage: 'MVP', lookingFor: ['Design partner', 'First 100 studios'], tags: ['SaaS', 'B2B'],
    ownerId: 'demo', ownerName: 'Munashe P.', ownerOccupation: 'Studio owner', ownerCity: 'Remote', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_umdlandla', title: 'Umdlandla', source: 'startupIdea', demo: true,
    description: 'Ticketing and cashless payments for township events, where the queue at the gate is currently the entire customer experience.',
    stage: 'Prototype', lookingFor: ['Payments integration', 'Event promoters'], tags: ['Events', 'Payments'],
    ownerId: 'demo', ownerName: 'Sihle N.', ownerOccupation: 'Event producer', ownerCity: 'Harare', ownerCountry: 'Zimbabwe',
  },
  {
    id: 'demo_aquapure', title: 'AquaPure', source: 'startupIdea', demo: true,
    description: 'Low-cost IoT water filtration that texts the village when a filter needs changing, so maintenance stops being guesswork.',
    stage: 'Prototype', lookingFor: ['Hardware engineer', 'NGO partner'], tags: ['IoT', 'CleanTech'],
    ownerId: 'demo', ownerName: 'Rutendo V.', ownerOccupation: 'Civil engineer', ownerCity: 'Masvingo', ownerCountry: 'Zimbabwe',
  },
];

/** Trim trailing whitespace that crept into a couple of the seed names. */
export const DEMO_IDEA_COUNT = DEMO_IDEAS.length;

/**
 * Top a deck up with demo ideas until it has at least `min` cards.
 * Real ideas are never displaced; `exclude` drops already-swiped cards so a
 * demo idea cannot come back after being dismissed.
 */
export const fillWithDemoIdeas = (
  ideas: IdeaDeckItem[],
  exclude?: Set<string>,
  min: number = DEMO_IDEA_COUNT
): IdeaDeckItem[] => {
  if (ideas.length >= min) return ideas;
  const seen = new Set(ideas.map((idea) => idea.id));
  const filler = DEMO_IDEAS.filter((idea) => !seen.has(idea.id) && !exclude?.has(idea.id));
  return [...ideas, ...filler.slice(0, Math.max(0, min - ideas.length))];
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
