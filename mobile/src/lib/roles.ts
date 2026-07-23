export type LinkupRole = {
  id: string;
  label: string;
  badge: string;
  group: 'builder' | 'capital' | 'creative' | 'growth' | 'career' | 'expert';
};

export const LINKUP_ROLES: LinkupRole[] = [
  { id: 'Founder', label: 'Founder', badge: 'FOUNDER', group: 'builder' },
  { id: 'Co-founder', label: 'Co-founder', badge: 'CO-FOUNDER', group: 'builder' },
  { id: 'Student', label: 'Student', badge: 'STUDENT', group: 'career' },
  { id: 'Investor', label: 'Investor', badge: 'INVESTOR', group: 'capital' },
  { id: 'Designer', label: 'Designer', badge: 'DESIGNER', group: 'creative' },
  { id: 'Developer', label: 'Developer / Engineer', badge: 'DEVELOPER', group: 'builder' },
  { id: 'Marketer', label: 'Marketer', badge: 'MARKETER', group: 'growth' },
  { id: 'Sales / Business Development', label: 'Sales / Biz Dev', badge: 'SALES', group: 'growth' },
  { id: 'Product Manager', label: 'Product Manager', badge: 'PRODUCT', group: 'builder' },
  { id: 'Creator / Influencer', label: 'Creator / Influencer', badge: 'CREATOR', group: 'creative' },
  { id: 'Mentor / Advisor', label: 'Mentor / Advisor', badge: 'MENTOR', group: 'expert' },
  { id: 'Freelancer', label: 'Freelancer', badge: 'FREELANCER', group: 'career' },
  { id: 'Recruiter / Talent Scout', label: 'Recruiter / Talent Scout', badge: 'TALENT', group: 'career' },
  { id: 'Operator', label: 'Operator / Operations', badge: 'OPERATOR', group: 'builder' },
  { id: 'Finance / Accountant', label: 'Finance / Accountant', badge: 'FINANCE', group: 'expert' },
  { id: 'Legal / Compliance', label: 'Legal / Compliance', badge: 'LEGAL', group: 'expert' },
  { id: 'Researcher', label: 'Researcher', badge: 'RESEARCH', group: 'expert' },
  { id: 'Community Builder', label: 'Community Builder', badge: 'COMMUNITY', group: 'growth' },
  { id: 'Content Strategist / Copywriter', label: 'Content Strategist / Copywriter', badge: 'CONTENT', group: 'creative' },
  { id: 'Data / AI Specialist', label: 'Data / AI Specialist', badge: 'AI / DATA', group: 'builder' },
];

export const LINKUP_ROLE_OPTIONS = LINKUP_ROLES.map(({ id, label }) => ({ id, label }));
export const LINKUP_ROLE_LABELS = LINKUP_ROLES.map((role) => role.id);

export function roleInfoFor(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return { id: 'Builder', label: 'Builder', badge: 'BUILDER', group: 'builder' as const };
  const exact = LINKUP_ROLES.find((role) => role.id.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const partial = LINKUP_ROLES.find((role) =>
    raw.toLowerCase().includes(role.id.toLowerCase()) || role.id.toLowerCase().includes(raw.toLowerCase())
  );
  if (partial) return partial;
  return { id: raw, label: raw, badge: raw.toUpperCase().slice(0, 18), group: 'builder' as const };
}

