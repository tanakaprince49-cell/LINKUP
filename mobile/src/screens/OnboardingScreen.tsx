import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, liquidGlass, textColor } from '../theme/theme';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import * as ImagePicker from 'expo-image-picker';
import { imageAssetToDataUri } from '../lib/imageUploadLimits';
import { notifyUser } from '../lib/notify';
import { publicProfileLink } from '../lib/profileLinks';
import { LINKUP_ROLE_OPTIONS, roleInfoFor } from '../lib/roles';
import { seedConciergeWelcome } from '../lib/activation';

type Choice = { id: string; label: string; desc?: string };
type RoleQuestion = { id: string; title: string; subtitle: string; choices: Choice[]; multi?: boolean };
type PersonalityQuestion = {
  id: string;
  title: string;
  a: { id: string; label: string };
  b: { id: string; label: string };
};

const identityChoices: Choice[] = LINKUP_ROLE_OPTIONS;

const goalsChoices: Choice[] = [
  { id: 'Cofounder', label: 'Cofounder' },
  { id: 'Startup team', label: 'Startup team' },
  { id: 'Networking', label: 'Networking' },
  { id: 'Hiring', label: 'Hiring' },
  { id: 'Investment', label: 'Investment' },
  { id: 'Mentorship', label: 'Mentorship' },
];

const investorGoalsChoices: Choice[] = [
  { id: 'Invest', label: 'Invest' },
  { id: 'Deal flow', label: 'Deal flow' },
  { id: 'Mentor', label: 'Mentor' },
  { id: 'Networking', label: 'Networking' },
];

const builderGoalsChoices: Choice[] = [
  { id: 'Cofounder', label: 'Cofounder' },
  { id: 'Startup team', label: 'Startup team' },
  { id: 'Networking', label: 'Networking' },
  { id: 'Freelance work', label: 'Freelance work' },
  { id: 'Hiring', label: 'Hiring' },
  { id: 'Mentorship', label: 'Mentorship' },
];

const industryChoices: Choice[] = [
  { id: 'Automation', label: 'Automation' },
  { id: 'SaaS', label: 'SaaS' },
  { id: 'Fintech', label: 'Fintech' },
  { id: 'Healthtech', label: 'Healthtech' },
  { id: 'Gaming', label: 'Gaming' },
  { id: 'E-commerce', label: 'E-commerce' },
  { id: 'Crypto', label: 'Crypto' },
  { id: 'Education', label: 'Education' },
  { id: 'Media', label: 'Media' },
];

const skillChoices: Choice[] = [
  { id: 'Frontend', label: 'Frontend' },
  { id: 'Backend', label: 'Backend' },
  { id: 'UI/UX', label: 'UI/UX' },
  { id: 'Sales', label: 'Sales' },
  { id: 'Marketing', label: 'Marketing' },
  { id: 'Finance', label: 'Finance' },
  { id: 'Product', label: 'Product management' },
  { id: 'ML engineering', label: 'ML engineering' },
];

const founderSkillChoices: Choice[] = [
  { id: 'Sales', label: 'Sales' },
  { id: 'Product Strategy', label: 'Product strategy' },
  { id: 'Fundraising', label: 'Fundraising' },
  { id: 'Partnerships', label: 'Partnerships' },
  { id: 'Growth', label: 'Growth' },
  { id: 'Community', label: 'Community' },
];

const developerSkillChoices: Choice[] = [
  { id: 'React', label: 'React' },
  { id: 'Node.js', label: 'Node.js' },
  { id: 'Python', label: 'Python' },
  { id: 'ML', label: 'ML' },
  { id: 'Mobile', label: 'Mobile' },
  { id: 'DevOps', label: 'DevOps' },
];

const designerSkillChoices: Choice[] = [
  { id: 'UI Design', label: 'UI design' },
  { id: 'UX Research', label: 'UX research' },
  { id: 'Brand Design', label: 'Brand design' },
  { id: 'Design Systems', label: 'Design systems' },
  { id: 'Motion', label: 'Motion' },
  { id: 'Figma', label: 'Figma' },
];

const investorSkillChoices: Choice[] = [
  { id: 'Deal Sourcing', label: 'Deal sourcing' },
  { id: 'Due Diligence', label: 'Due diligence' },
  { id: 'Portfolio Support', label: 'Portfolio support' },
  { id: 'Founder Coaching', label: 'Founder coaching' },
  { id: 'Fintech', label: 'Fintech' },
  { id: 'SaaS', label: 'SaaS' },
];

const marketerSkillChoices: Choice[] = [
  { id: 'Performance Marketing', label: 'Performance' },
  { id: 'Brand Marketing', label: 'Brand' },
  { id: 'Content Strategy', label: 'Content' },
  { id: 'Community Growth', label: 'Community' },
  { id: 'SEO', label: 'SEO' },
  { id: 'Partnerships', label: 'Partnerships' },
];

const studentSkillChoices: Choice[] = [
  { id: 'Hackathons', label: 'Hackathons' },
  { id: 'Prototyping', label: 'Prototyping' },
  { id: 'Coding', label: 'Coding' },
  { id: 'Design', label: 'Design' },
  { id: 'Research', label: 'Research' },
  { id: 'Growth', label: 'Growth' },
];

const operatorSkillChoices: Choice[] = [
  { id: 'People Ops', label: 'People ops' },
  { id: 'Product Ops', label: 'Product ops' },
  { id: 'Finance Ops', label: 'Finance ops' },
  { id: 'Growth Ops', label: 'Growth ops' },
  { id: 'Hiring', label: 'Hiring' },
  { id: 'Partnerships', label: 'Partnerships' },
];

const salesSkillChoices: Choice[] = [
  { id: 'Outbound Sales', label: 'Outbound' },
  { id: 'Partnerships', label: 'Partnerships' },
  { id: 'CRM', label: 'CRM' },
  { id: 'Negotiation', label: 'Negotiation' },
  { id: 'Account Management', label: 'Accounts' },
  { id: 'Revenue Ops', label: 'Revenue ops' },
];

const productSkillChoices: Choice[] = [
  { id: 'Product Strategy', label: 'Strategy' },
  { id: 'Roadmapping', label: 'Roadmaps' },
  { id: 'User Research', label: 'User research' },
  { id: 'Analytics', label: 'Analytics' },
  { id: 'Growth Loops', label: 'Growth loops' },
  { id: 'MVP Scoping', label: 'MVP scoping' },
];

const creatorSkillChoices: Choice[] = [
  { id: 'Short-form Video', label: 'Short-form' },
  { id: 'Audience Growth', label: 'Audience' },
  { id: 'Storytelling', label: 'Storytelling' },
  { id: 'Brand Deals', label: 'Brand deals' },
  { id: 'Community', label: 'Community' },
  { id: 'Content Production', label: 'Production' },
];

const freelancerSkillChoices: Choice[] = [
  { id: 'Client Delivery', label: 'Delivery' },
  { id: 'Portfolio Building', label: 'Portfolio' },
  { id: 'Project Scoping', label: 'Scoping' },
  { id: 'Remote Collaboration', label: 'Remote work' },
  { id: 'Consulting', label: 'Consulting' },
  { id: 'Proposal Writing', label: 'Proposals' },
];

const expertSkillChoices: Choice[] = [
  { id: 'Advisory', label: 'Advisory' },
  { id: 'Due Diligence', label: 'Due diligence' },
  { id: 'Compliance', label: 'Compliance' },
  { id: 'Finance', label: 'Finance' },
  { id: 'Research', label: 'Research' },
  { id: 'Strategy', label: 'Strategy' },
];

const aiDataSkillChoices: Choice[] = [
  { id: 'Machine Learning', label: 'ML' },
  { id: 'Data Analysis', label: 'Data analysis' },
  { id: 'Automation', label: 'Automation' },
  { id: 'Prompt Engineering', label: 'Prompting' },
  { id: 'Python', label: 'Python' },
  { id: 'Data Pipelines', label: 'Pipelines' },
];

const experienceChoices: Choice[] = [
  { id: 'Beginner', label: 'Beginner' },
  { id: 'Intermediate', label: 'Intermediate' },
  { id: 'Experienced', label: 'Experienced' },
  { id: 'Exited founder', label: 'Exited founder' },
];

const workStyleChoices: Choice[] = [
  { id: 'Fast-paced', label: 'Fast-paced' },
  { id: 'Structured', label: 'Structured' },
  { id: 'Experimental', label: 'Experimental' },
  { id: 'Analytical', label: 'Analytical' },
  { id: 'Creative', label: 'Creative' },
];

const commitmentChoices: Choice[] = [
  { id: 'Weekends only', label: 'Weekends only' },
  { id: 'Part-time', label: 'Part-time' },
  { id: 'Full-time', label: 'Full-time' },
  { id: 'Actively building', label: 'Actively building' },
];

const startupStageChoices: Choice[] = [
  { id: 'Idea stage', label: 'Idea stage' },
  { id: 'MVP', label: 'MVP' },
  { id: 'Early traction', label: 'Early traction' },
  { id: 'Scaling', label: 'Scaling' },
];

const fundingStageChoices: Choice[] = [
  { id: 'Pre-revenue', label: 'Pre-revenue' },
  { id: 'Bootstrapped', label: 'Bootstrapped' },
  { id: 'Angel-backed', label: 'Angel-backed' },
  { id: 'Raised funding', label: 'Raised funding' },
];

const availabilityChoices: Choice[] = [
  { id: 'Available Now', label: 'Available Now' },
  { id: 'Busy but Open', label: 'Busy but Open' },
  { id: 'Hiring', label: 'Hiring' },
  { id: 'Open to Networking', label: 'Open to Networking' },
  { id: 'Not Available', label: 'Not Available' },
];

const roleSkillChoicesByRole: Record<string, Choice[]> = {
  Founder: founderSkillChoices,
  Developer: developerSkillChoices,
  Designer: designerSkillChoices,
  Investor: investorSkillChoices,
  Marketer: marketerSkillChoices,
  Student: studentSkillChoices,
  Operator: operatorSkillChoices,
  'Co-founder': founderSkillChoices,
  'Sales / Business Development': salesSkillChoices,
  'Product Manager': productSkillChoices,
  'Creator / Influencer': creatorSkillChoices,
  'Mentor / Advisor': expertSkillChoices,
  Freelancer: freelancerSkillChoices,
  'Recruiter / Talent Scout': salesSkillChoices,
  'Finance / Accountant': expertSkillChoices,
  'Legal / Compliance': expertSkillChoices,
  Researcher: expertSkillChoices,
  'Community Builder': marketerSkillChoices,
  'Content Strategist / Copywriter': creatorSkillChoices,
  'Data / AI Specialist': aiDataSkillChoices,
};

const roleQuestionBanks: Record<string, RoleQuestion[]> = {
  Founder: [
    {
      id: 'founderNeed',
      title: 'First missing piece',
      subtitle: 'Who would unlock your next level fastest?',
      multi: true,
      choices: [
        { id: 'Technical Cofounder', label: 'Technical Cofounder' },
        { id: 'Designer', label: 'Designer' },
        { id: 'Growth Marketer', label: 'Growth Marketer' },
        { id: 'Operator', label: 'Operator' },
        { id: 'Investor', label: 'Investor' },
      ],
    },
  ],
  Developer: [
    {
      id: 'devTrack',
      title: 'Developer track',
      subtitle: 'Where are you strongest right now?',
      choices: [
        { id: 'Frontend Engineer', label: 'Frontend Engineer' },
        { id: 'Backend Engineer', label: 'Backend Engineer' },
        { id: 'ML Engineer', label: 'ML Engineer' },
        { id: 'Mobile Developer', label: 'Mobile Developer' },
        { id: 'Full-stack Builder', label: 'Full-stack Builder' },
        { id: 'DevOps', label: 'DevOps' },
      ],
    },
    {
      id: 'devBuildMode',
      title: 'Build mode',
      subtitle: 'What kind of startup environment suits you best?',
      choices: [
        { id: 'Greenfield MVPs', label: 'Greenfield MVPs' },
        { id: 'Scaling Products', label: 'Scaling Products' },
        { id: 'Automation Products', label: 'Automation Products' },
        { id: 'Consumer Apps', label: 'Consumer Apps' },
        { id: 'Hackathon Speed', label: 'Hackathon Speed' },
      ],
    },
  ],
  Designer: [
    {
      id: 'designTrack',
      title: 'Design lane',
      subtitle: 'Which design role sounds most like you?',
      choices: [
        { id: 'Product Designer', label: 'Product Designer' },
        { id: 'Brand Designer', label: 'Brand Designer' },
        { id: 'UX Researcher', label: 'UX Researcher' },
        { id: 'Design Systems', label: 'Design Systems' },
        { id: 'Motion Designer', label: 'Motion Designer' },
      ],
    },
    {
      id: 'designApproach',
      title: 'Design approach',
      subtitle: 'How do you like to shape products?',
      choices: [
        { id: 'Research-led', label: 'Research-led' },
        { id: 'Rapid Prototyping', label: 'Rapid Prototyping' },
        { id: 'Brand-first', label: 'Brand-first' },
        { id: 'Systems Thinking', label: 'Systems Thinking' },
        { id: 'Founder Partner', label: 'Founder Partner' },
      ],
    },
  ],
  Investor: [
    {
      id: 'investorStage',
      title: 'Deal stage',
      subtitle: 'What stage of builders do you prefer backing?',
      choices: [
        { id: 'Idea Stage', label: 'Idea Stage' },
        { id: 'MVP', label: 'MVP' },
        { id: 'Early Traction', label: 'Early Traction' },
        { id: 'Seed', label: 'Seed' },
        { id: 'Growth Stage', label: 'Growth Stage' },
      ],
    },
    {
      id: 'investorStyle',
      title: 'Investor style',
      subtitle: 'How do you help founders beyond capital?',
      choices: [
        { id: 'Hands-on Operator', label: 'Hands-on Operator' },
        { id: 'Strategic Advisor', label: 'Strategic Advisor' },
        { id: 'Network Opener', label: 'Network Opener' },
        { id: 'Talent Connector', label: 'Talent Connector' },
        { id: 'Quiet Capital', label: 'Quiet Capital' },
      ],
    },
  ],
  Marketer: [
    {
      id: 'marketingTrack',
      title: 'Marketing lane',
      subtitle: 'What kind of growth work describes you best?',
      choices: [
        { id: 'Performance Marketer', label: 'Performance Marketer' },
        { id: 'Brand Strategist', label: 'Brand Strategist' },
        { id: 'Content Lead', label: 'Content Lead' },
        { id: 'Community Builder', label: 'Community Builder' },
        { id: 'Partnerships Lead', label: 'Partnerships Lead' },
      ],
    },
    {
      id: 'marketingStyle',
      title: 'Growth style',
      subtitle: 'How do you like driving demand?',
      choices: [
        { id: 'Experiments Fast', label: 'Experiments Fast' },
        { id: 'Narrative & Brand', label: 'Narrative & Brand' },
        { id: 'Data-led Funnels', label: 'Data-led Funnels' },
        { id: 'Audience Community', label: 'Audience Community' },
        { id: 'Launch Campaigns', label: 'Launch Campaigns' },
      ],
    },
  ],
  Student: [
    {
      id: 'studentTrack',
      title: 'Student path',
      subtitle: 'What kind of builder are you becoming?',
      choices: [
        { id: 'Student Founder', label: 'Student Founder' },
        { id: 'Hacker', label: 'Hacker' },
        { id: 'Designer', label: 'Designer' },
        { id: 'Growth Builder', label: 'Growth Builder' },
        { id: 'Investor Scout', label: 'Investor Scout' },
      ],
    },
    {
      id: 'studentStyle',
      title: 'Learning style',
      subtitle: 'How do you grow fastest?',
      choices: [
        { id: 'Learn by Shipping', label: 'Learn by Shipping' },
        { id: 'Learn by Research', label: 'Learn by Research' },
        { id: 'Hackathons', label: 'Hackathons' },
        { id: 'Campus Clubs', label: 'Campus Clubs' },
        { id: 'Online Communities', label: 'Online Communities' },
      ],
    },
  ],
  Operator: [
    {
      id: 'operatorTrack',
      title: 'Operations lane',
      subtitle: 'What systems do you own best?',
      choices: [
        { id: 'People Ops', label: 'People Ops' },
        { id: 'Product Ops', label: 'Product Ops' },
        { id: 'Growth Ops', label: 'Growth Ops' },
        { id: 'Finance Ops', label: 'Finance Ops' },
        { id: 'Business Ops', label: 'Business Ops' },
      ],
    },
    {
      id: 'operatorStyle',
      title: 'Execution style',
      subtitle: 'What environment fits you best?',
      choices: [
        { id: 'Early-stage Chaos', label: 'Early-stage Chaos' },
        { id: 'Scaling Teams', label: 'Scaling Teams' },
        { id: 'Founder Right Hand', label: 'Founder Right Hand' },
        { id: 'Remote Systems', label: 'Remote Systems' },
        { id: 'Cross-functional Glue', label: 'Cross-functional Glue' },
      ],
    },
  ],
};

const safeQuestionId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'builder';

const genericRoleQuestions = (role: string): RoleQuestion[] => {
  const info = roleInfoFor(role);
  const key = safeQuestionId(info.id);
  return [
    {
      id: `${key}_path`,
      title: `${info.badge} path`,
      subtitle: `What kind of ${info.label.toLowerCase()} opportunity fits you best?`,
      choices: [
        { id: 'Startup team', label: 'Startup team' },
        { id: 'Freelance work', label: 'Freelance work' },
        { id: 'Mentorship', label: 'Mentorship' },
        { id: 'Partnerships', label: 'Partnerships' },
        { id: 'Hiring', label: 'Hiring' },
      ],
    },
    {
      id: `${key}_impact`,
      title: 'Best contribution',
      subtitle: 'What should people come to you for first?',
      multi: true,
      choices: [
        { id: 'Strategy', label: 'Strategy' },
        { id: 'Execution', label: 'Execution' },
        { id: 'Creative direction', label: 'Creative direction' },
        { id: 'Network access', label: 'Network access' },
        { id: 'Specialist expertise', label: 'Specialist expertise' },
      ],
    },
  ];
};

const personalityQuestionsByRole: Record<string, readonly PersonalityQuestion[]> = {
  Founder: [
    {
      id: 'founder_execution',
      title: 'Prototype fast or plan the company first?',
      a: { id: 'Prototype fast', label: 'Prototype fast' },
      b: { id: 'Plan the company', label: 'Plan the company' },
    },
    {
      id: 'founder_risk',
      title: 'Bold bets or measured moves?',
      a: { id: 'Bold bets', label: 'Bold bets' },
      b: { id: 'Measured moves', label: 'Measured moves' },
    },
    {
      id: 'founder_team',
      title: 'Recruit early or grind solo first?',
      a: { id: 'Recruit early', label: 'Recruit early' },
      b: { id: 'Grind solo first', label: 'Grind solo first' },
    },
    {
      id: 'founder_growth',
      title: 'Sales-led or product-led momentum?',
      a: { id: 'Sales-led', label: 'Sales-led' },
      b: { id: 'Product-led', label: 'Product-led' },
    },
  ],
  Developer: [
    {
      id: 'developer_build',
      title: 'Prototype quickly or architect carefully?',
      a: { id: 'Prototype quickly', label: 'Prototype quickly' },
      b: { id: 'Architect carefully', label: 'Architect carefully' },
    },
    {
      id: 'developer_work',
      title: 'Deep solo work or active pair building?',
      a: { id: 'Deep solo work', label: 'Deep solo work' },
      b: { id: 'Pair building', label: 'Pair building' },
    },
    {
      id: 'developer_quality',
      title: 'Clean systems or fast hacks to learn?',
      a: { id: 'Clean systems', label: 'Clean systems' },
      b: { id: 'Fast hacks', label: 'Fast hacks' },
    },
    {
      id: 'developer_motivation',
      title: 'Product empathy or technical challenge first?',
      a: { id: 'Product empathy', label: 'Product empathy' },
      b: { id: 'Technical challenge', label: 'Technical challenge' },
    },
  ],
  Designer: [
    {
      id: 'designer_priority',
      title: 'Brand expression or product usability first?',
      a: { id: 'Brand expression', label: 'Brand expression' },
      b: { id: 'Product usability', label: 'Product usability' },
    },
    {
      id: 'designer_speed',
      title: 'Polish deeply or iterate fast?',
      a: { id: 'Polish deeply', label: 'Polish deeply' },
      b: { id: 'Iterate fast', label: 'Iterate fast' },
    },
    {
      id: 'designer_research',
      title: 'Research first or intuition first?',
      a: { id: 'Research first', label: 'Research first' },
      b: { id: 'Intuition first', label: 'Intuition first' },
    },
    {
      id: 'designer_team',
      title: 'Workshops with the team or solo exploration?',
      a: { id: 'Team workshops', label: 'Team workshops' },
      b: { id: 'Solo exploration', label: 'Solo exploration' },
    },
  ],
  Investor: [
    {
      id: 'investor_conviction',
      title: 'Founder chemistry or market size first?',
      a: { id: 'Founder chemistry', label: 'Founder chemistry' },
      b: { id: 'Market size', label: 'Market size' },
    },
    {
      id: 'investor_stage_preference',
      title: 'Early experiments or proven traction?',
      a: { id: 'Early experiments', label: 'Early experiments' },
      b: { id: 'Proven traction', label: 'Proven traction' },
    },
    {
      id: 'investor_style',
      title: 'Conviction-led or data-led decisions?',
      a: { id: 'Conviction-led', label: 'Conviction-led' },
      b: { id: 'Data-led', label: 'Data-led' },
    },
    {
      id: 'investor_support',
      title: 'Hands-on support or light-touch capital?',
      a: { id: 'Hands-on support', label: 'Hands-on support' },
      b: { id: 'Light-touch capital', label: 'Light-touch capital' },
    },
  ],
  Marketer: [
    {
      id: 'marketer_focus',
      title: 'Performance or brand-first marketing?',
      a: { id: 'Performance', label: 'Performance' },
      b: { id: 'Brand-first', label: 'Brand-first' },
    },
    {
      id: 'marketer_channel',
      title: 'Paid growth or organic community?',
      a: { id: 'Paid growth', label: 'Paid growth' },
      b: { id: 'Organic community', label: 'Organic community' },
    },
    {
      id: 'marketer_planning',
      title: 'Run experiments fast or plan campaigns deeply?',
      a: { id: 'Experiment fast', label: 'Experiment fast' },
      b: { id: 'Plan deeply', label: 'Plan deeply' },
    },
    {
      id: 'marketer_signal',
      title: 'Storytelling or analytics as your superpower?',
      a: { id: 'Storytelling', label: 'Storytelling' },
      b: { id: 'Analytics', label: 'Analytics' },
    },
  ],
  Student: [
    {
      id: 'student_learning',
      title: 'Learn by shipping or learn by studying?',
      a: { id: 'Learn by shipping', label: 'Learn by shipping' },
      b: { id: 'Learn by studying', label: 'Learn by studying' },
    },
    {
      id: 'student_team',
      title: 'Campus team energy or solo build energy?',
      a: { id: 'Campus team', label: 'Campus team' },
      b: { id: 'Solo build', label: 'Solo build' },
    },
    {
      id: 'student_goal',
      title: 'Big startup ambition or skill-building first?',
      a: { id: 'Big startup ambition', label: 'Big startup ambition' },
      b: { id: 'Skill-building first', label: 'Skill-building first' },
    },
    {
      id: 'student_project',
      title: 'Hackathons or long-term projects?',
      a: { id: 'Hackathons', label: 'Hackathons' },
      b: { id: 'Long-term projects', label: 'Long-term projects' },
    },
  ],
  Operator: [
    {
      id: 'operator_priority',
      title: 'Systems first or speed first?',
      a: { id: 'Systems first', label: 'Systems first' },
      b: { id: 'Speed first', label: 'Speed first' },
    },
    {
      id: 'operator_process',
      title: 'Process rigor or flexible execution?',
      a: { id: 'Process rigor', label: 'Process rigor' },
      b: { id: 'Flexible execution', label: 'Flexible execution' },
    },
    {
      id: 'operator_team',
      title: 'Enable teams or own the execution directly?',
      a: { id: 'Enable teams', label: 'Enable teams' },
      b: { id: 'Own execution', label: 'Own execution' },
    },
    {
      id: 'operator_stage',
      title: 'Scale readiness or MVP hustle?',
      a: { id: 'Scale readiness', label: 'Scale readiness' },
      b: { id: 'MVP hustle', label: 'MVP hustle' },
    },
  ],
};

const genericPersonalityQuestions = (role: string): readonly PersonalityQuestion[] => [
  {
    id: `${safeQuestionId(role)}_pace`,
    title: 'Move fast or build carefully?',
    a: { id: 'Move fast', label: 'Move fast' },
    b: { id: 'Build carefully', label: 'Build carefully' },
  },
  {
    id: `${safeQuestionId(role)}_team`,
    title: 'Lead from the front or support the team?',
    a: { id: 'Lead from front', label: 'Lead from front' },
    b: { id: 'Support the team', label: 'Support the team' },
  },
  {
    id: `${safeQuestionId(role)}_signal`,
    title: 'Creative intuition or analytical proof?',
    a: { id: 'Creative intuition', label: 'Creative intuition' },
    b: { id: 'Analytical proof', label: 'Analytical proof' },
  },
  {
    id: `${safeQuestionId(role)}_work`,
    title: 'Independent work or constant collaboration?',
    a: { id: 'Independent work', label: 'Independent work' },
    b: { id: 'Constant collaboration', label: 'Constant collaboration' },
  },
];

function buildCircles(input: {
  role: string;
  industries: string[];
  skills: string[];
  experience: string;
}) {
  const circles: string[] = [];
  if (input.role) circles.push(`${input.role}s`);
  input.industries.slice(0, 3).forEach((i) => circles.push(`${i} Builders`));
  if (input.skills.some((s) => s.toLowerCase().includes('ai'))) circles.push('Automation Builders');
  if (input.skills.some((s) => s.toLowerCase().includes('frontend'))) circles.push('Frontend Builders');
  if (input.skills.some((s) => s.toLowerCase().includes('backend'))) circles.push('Backend Builders');
  if (input.experience) circles.push(input.experience);
  return Array.from(new Set(circles)).slice(0, 8);
}

const StepTitle = ({ title, subtitle, isDark }: { title: string; subtitle: string; isDark: boolean }) => (
  <View style={{ marginBottom: 22 }}>
    <Text style={[styles.title, { color: textColor(isDark) }]}>{title}</Text>
    <Text style={[styles.subtitle, { color: textColor(isDark, 'secondary') }]}>{subtitle}</Text>
  </View>
);

const PhotoSlot = ({
  label,
  uri,
  onPress,
  isDark,
  circular,
}: {
  label: string;
  uri: string | null;
  onPress: () => void;
  isDark: boolean;
  circular?: boolean;
}) => {
  if (circular) {
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={[
          styles.profilePhotoPicker,
          { borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,18,32,0.12)' },
        ]}
      >
        {uri ? (
          <Image source={{ uri }} style={styles.profilePhotoPickerImg} resizeMode="cover" />
        ) : (
          <View style={styles.profilePhotoPickerEmpty}>
            <View style={styles.profilePhotoPlusCircle}>
              <Text style={styles.profilePhotoPlusText}>+</Text>
            </View>
            <Text style={[styles.profilePhotoEmptyText, { color: textColor(isDark) }]}>Add a photo</Text>
            <Text style={[styles.profilePhotoHint, { color: textColor(isDark, 'muted') }]}>Optional · tap gallery</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[
        styles.photoSlot,
        liquidGlass(isDark, false),
        { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.photoSlotImg} resizeMode="cover" />
      ) : (
        <View style={styles.photoSlotEmpty}>
          <View style={styles.photoPlusCircle}>
            <Text style={styles.photoPlusText}>+</Text>
          </View>
          <Text style={[styles.photoEmptyText, { color: textColor(isDark) }]}>TAP TO ADD</Text>
        </View>
      )}
      <View style={[styles.photoSlotLabel, appBackground(isDark)]}>
        <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1, color: textColor(isDark) }} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const ChoiceGrid = ({
  value,
  onChange,
  choices,
  multi,
  isDark,
}: {
  value: string | string[];
  onChange: (next: string | string[]) => void;
  choices: Choice[];
  multi?: boolean;
  isDark: boolean;
}) => {
  const selected = Array.isArray(value) ? value : [value].filter(Boolean);
  const toggle = (id: string) => {
    if (!multi) return onChange(id);
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next);
  };

  return (
    <View style={styles.grid}>
      {choices.map((c) => {
        const on = selected.includes(c.id);
        return (
          <TouchableOpacity
            key={c.id}
            onPress={() => toggle(c.id)}
            style={[
              styles.choice,
              on && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
              !on && { borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,18,32,0.12)' },
            ]}
          >
            <Text
              style={{
                fontSize: 14,
                fontWeight: '800',
                color: on ? '#111' : textColor(isDark),
              }}
              numberOfLines={2}
            >
              {c.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const SkillsInput = ({
  value,
  onChangeText,
  isDark,
  selectedSkills = [],
}: {
  value: string;
  onChangeText: (text: string) => void;
  isDark: boolean;
  selectedSkills?: string[];
}) => (
  <View style={{ marginTop: 12 }}>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="Type skills too: React, Python, Figma..."
      placeholderTextColor="#666"
      style={[
        styles.textInput,
        liquidGlass(isDark, false),
        { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder, color: textColor(isDark) },
      ]}
      autoCapitalize="words"
    />
    <Text style={{ marginTop: 8, fontSize: 11, color: '#666', fontWeight: '800', lineHeight: 16 }}>
      Add at least one skill. These power search, swipe ranking, and smart matching.
    </Text>
    {selectedSkills.length > 0 ? (
      <View style={styles.selectedSkillsWrap}>
        {selectedSkills.map((skill) => (
          <View key={skill} style={styles.selectedSkillPill}>
            <Text style={styles.selectedSkillText}>{skill.toUpperCase()}</Text>
          </View>
        ))}
      </View>
    ) : (
      <Text style={{ marginTop: 8, fontSize: 11, color: '#999', fontWeight: '800', lineHeight: 16 }}>
        No skills added yet.
      </Text>
    )}
  </View>
);

export default function OnboardingScreen({ navigation }: any) {
  const { user, logout, markOnboardingComplete, isOnboarded } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [ageText, setAgeText] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [profilePicUri, setProfilePicUri] = useState<string>('');
  const [customSkillsText, setCustomSkillsText] = useState('');

  const [role, setRole] = useState('');
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [experience, setExperience] = useState('');
  const [workStyle, setWorkStyle] = useState('');
  const [commitmentLevel, setCommitmentLevel] = useState('');
  const [startupStage, setStartupStage] = useState('');
  const [fundingStage, setFundingStage] = useState('');
  const [availability, setAvailability] = useState('');
  const [personalityAnswers, setPersonalityAnswers] = useState<Record<string, string>>({});
  const [roleAnswers, setRoleAnswers] = useState<Record<string, string | string[]>>({});

  const typedSkills = useMemo(
    () => customSkillsText.split(',').map((s) => s.trim()).filter(Boolean),
    [customSkillsText]
  );
  const finalSkills = useMemo(
    () => Array.from(new Set([...skills, ...typedSkills])).slice(0, 20),
    [skills, typedSkills]
  );

  useEffect(() => {
    setLookingFor([]);
    setIndustries([]);
    setSkills([]);
    setCustomSkillsText('');
    setExperience('');
    setWorkStyle('');
    setCommitmentLevel('');
    setStartupStage('');
    setFundingStage('');
    setAvailability('');
    setPersonalityAnswers({});
    setRoleAnswers({});
  }, [role]);

  // Intentionally do NOT auto-prefill the name. Users must type their real name.

  useEffect(() => {
    if (!isOnboarded || saving) return;
    if (navigation?.reset) {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      navigation?.replace?.('Main');
    }
  }, [isOnboarded, navigation, saving]);

  const pickPhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (lib.status !== 'granted') {
          notifyUser('Permission Denied', 'Please allow photo library access.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: (ImagePicker as any).MediaType?.Images ? [(ImagePicker as any).MediaType.Images] : ['images'],
        allowsEditing: Platform.OS !== 'web',
        aspect: [1, 1],
        quality: 0.1,
        base64: true,
      });

      if (result.canceled) return;
      const asset = result.assets?.[0];
      const { dataUri, error } = await imageAssetToDataUri(asset);
      if (!dataUri) {
        notifyUser('Photo too large', error || 'Please choose a smaller photo.');
        return;
      }

      setProfilePicUri(dataUri);
    } catch (e: any) {
      console.error('pickPhoto error', e);
      notifyUser('Error', e?.message || 'Could not pick photo.');
    }
  };

  const currentPersonalityQuestions = useMemo(
    () => personalityQuestionsByRole[role] || genericPersonalityQuestions(role),
    [role]
  );

  const personalityStep = useMemo(() => {
    return {
      key: 'personality',
      title: `${role || 'Builder'} Personality`,
      subtitle: 'These answers sharpen compatibility and who naturally fits your energy.',
      body: (
        <View style={{ gap: 12 }}>
          {currentPersonalityQuestions.map((q) => {
            const v = personalityAnswers[q.id];
            return (
              <View
                key={q.id}
                style={[
                  styles.card,
                  liquidGlass(isDark),
                  { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
                ]}
              >
                <Text style={[styles.cardTitle, { color: textColor(isDark) }]}>{q.title}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  {[q.a, q.b].map((opt) => {
                    const on = v === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => setPersonalityAnswers((p) => ({ ...p, [q.id]: opt.id }))}
                        style={[
                          styles.choice,
                          { flex: 1 },
                          on && { backgroundColor: COLORS.primary },
                          !on && liquidGlass(isDark, false),
                          { borderColor: isDark ? COLORS.darkBorder : COLORS.lightBorder },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: '900',
                            letterSpacing: 1,
                            color: on ? '#000' : textColor(isDark),
                          }}
                        >
                          {opt.label.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      ),
      canNext: currentPersonalityQuestions.every((q) => !!personalityAnswers[q.id]),
    };
  }, [currentPersonalityQuestions, personalityAnswers, isDark, role]);

  const legacyRoleSteps = useMemo(() => {
    // Role-based onboarding: choose identity, then the questions adapt.
    if (role === 'Investor') {
      return [
        {
          key: 'investor_goals',
          title: 'Investor Intent',
          subtitle: 'What are you here for?',
          body: (
            <ChoiceGrid
              value={lookingFor}
              onChange={(v) => setLookingFor(v as string[])}
              choices={investorGoalsChoices}
              multi
              isDark={isDark}
            />
          ),
          canNext: lookingFor.length > 0,
        },
        {
          key: 'industries',
          title: 'Sectors',
          subtitle: 'Which industries do you invest in?',
          body: (
            <ChoiceGrid
              value={industries}
              onChange={(v) => setIndustries(v as string[])}
              choices={industryChoices}
              multi
              isDark={isDark}
            />
          ),
          canNext: industries.length > 0,
        },
        {
          key: 'funding',
          title: 'Stage Preference',
          subtitle: 'Which stage do you prefer?',
          body: <ChoiceGrid value={fundingStage} onChange={(v) => setFundingStage(String(v))} choices={fundingStageChoices} isDark={isDark} />,
          canNext: !!fundingStage,
        },
        {
          key: 'workStyle',
          title: 'Work Style',
          subtitle: 'How do you collaborate?',
          body: <ChoiceGrid value={workStyle} onChange={(v) => setWorkStyle(String(v))} choices={workStyleChoices} isDark={isDark} />,
          canNext: !!workStyle,
        },
        personalityStep,
      ];
    }

    if (role === 'Developer' || role === 'Designer' || role === 'Marketer' || role === 'Operator' || role === 'Student') {
      return [
        {
          key: 'builder_goals',
          title: 'Your Goals',
          subtitle: 'What are you looking for?',
          body: (
            <ChoiceGrid
              value={lookingFor}
              onChange={(v) => setLookingFor(v as string[])}
              choices={builderGoalsChoices}
              multi
              isDark={isDark}
            />
          ),
          canNext: lookingFor.length > 0,
        },
        {
          key: 'skills',
          title: 'Skills',
          subtitle: 'Select or type your core skills.',
          body: (
            <View>
              <ChoiceGrid
                value={skills}
                onChange={(v) => setSkills(v as string[])}
                choices={skillChoices}
                multi
                isDark={isDark}
              />
              <SkillsInput value={customSkillsText} onChangeText={setCustomSkillsText} isDark={isDark} />
            </View>
          ),
          canNext: finalSkills.length > 0,
        },
        {
          key: 'experience',
          title: 'Experience Level',
          subtitle: 'Choose what matches you best.',
          body: <ChoiceGrid value={experience} onChange={(v) => setExperience(String(v))} choices={experienceChoices} isDark={isDark} />,
          canNext: !!experience,
        },
        {
          key: 'workStyle',
          title: 'Work Style',
          subtitle: 'How do you like to build?',
          body: <ChoiceGrid value={workStyle} onChange={(v) => setWorkStyle(String(v))} choices={workStyleChoices} isDark={isDark} />,
          canNext: !!workStyle,
        },
        personalityStep,
      ];
    }

    // Founder (default)
    return [
      {
        key: 'goals',
        title: 'Your Goals',
        subtitle: 'What are you looking for?',
        body: (
          <ChoiceGrid value={lookingFor} onChange={(v) => setLookingFor(v as string[])} choices={goalsChoices} multi isDark={isDark} />
        ),
        canNext: lookingFor.length > 0,
      },
      {
        key: 'industries',
        title: 'Industries',
        subtitle: 'Select your startup interests.',
        body: (
          <ChoiceGrid value={industries} onChange={(v) => setIndustries(v as string[])} choices={industryChoices} multi isDark={isDark} />
        ),
        canNext: industries.length > 0,
      },
      {
        key: 'skills',
        title: 'Skills',
        subtitle: 'What can you contribute? Select or type at least one.',
        body: (
          <View>
            <ChoiceGrid value={skills} onChange={(v) => setSkills(v as string[])} choices={skillChoices} multi isDark={isDark} />
            <SkillsInput value={customSkillsText} onChangeText={setCustomSkillsText} isDark={isDark} />
          </View>
        ),
        canNext: finalSkills.length > 0,
      },
      {
        key: 'stage',
        title: 'Startup Stage',
        subtitle: 'Where are you right now?',
        body: <ChoiceGrid value={startupStage} onChange={(v) => setStartupStage(String(v))} choices={startupStageChoices} isDark={isDark} />,
        canNext: !!startupStage,
      },
      {
        key: 'funding',
        title: 'Funding',
        subtitle: "What's your current funding stage?",
        body: <ChoiceGrid value={fundingStage} onChange={(v) => setFundingStage(String(v))} choices={fundingStageChoices} isDark={isDark} />,
        canNext: !!fundingStage,
      },
      personalityStep,
    ];
  }, [
    role,
    lookingFor,
    industries,
    skills,
    customSkillsText,
    finalSkills,
    experience,
    workStyle,
    commitmentLevel,
    startupStage,
    fundingStage,
    availability,
    isDark,
    personalityStep,
  ]);

  const roleSteps = useMemo(() => {
    const roleSkillChoices = roleSkillChoicesByRole[role] || skillChoices;
    const roleQuestions = roleQuestionBanks[role] || genericRoleQuestions(role);

    const buildSingleChoiceStep = (
      key: string,
      title: string,
      subtitle: string,
      value: string,
      onChange: (next: string) => void,
      choices: Choice[]
    ) => ({
      key,
      title,
      subtitle,
      body: <ChoiceGrid value={value} onChange={(v) => onChange(String(v))} choices={choices} isDark={isDark} />,
      canNext: !!value,
    });

    const buildMultiChoiceStep = (
      key: string,
      title: string,
      subtitle: string,
      value: string[],
      onChange: (next: string[]) => void,
      choices: Choice[]
    ) => ({
      key,
      title,
      subtitle,
      body: <ChoiceGrid value={value} onChange={(v) => onChange(v as string[])} choices={choices} multi isDark={isDark} />,
      canNext: value.length > 0,
    });

    const buildRoleQuestionStep = (question: RoleQuestion) => {
      const answer = roleAnswers[question.id];
      const value = question.multi
        ? (Array.isArray(answer) ? answer : [])
        : (typeof answer === 'string' ? answer : '');

      return {
        key: question.id,
        title: question.title,
        subtitle: question.subtitle,
        body: (
          <ChoiceGrid
            value={value}
            onChange={(next) => setRoleAnswers((prev) => ({ ...prev, [question.id]: next }))}
            choices={question.choices}
            multi={question.multi}
            isDark={isDark}
          />
        ),
        canNext: question.multi ? (value as string[]).length > 0 : !!value,
      };
    };

    const buildSkillsStep = (title: string, subtitle: string) => ({
      key: 'skills',
      title,
      subtitle,
      body: (
        <View>
          <ChoiceGrid value={skills} onChange={(v) => setSkills(v as string[])} choices={roleSkillChoices} multi isDark={isDark} />
          <SkillsInput value={customSkillsText} onChangeText={setCustomSkillsText} isDark={isDark} selectedSkills={finalSkills} />
        </View>
      ),
      canNext: finalSkills.length > 0,
    });

    switch (role) {
      case 'Investor':
        return [
          buildMultiChoiceStep('investor_goals', 'Investor Intent', 'What are you here for?', lookingFor, setLookingFor, investorGoalsChoices),
          buildSkillsStep('Core Skills For Matching', 'Choose your investor edge so founders and opportunities can match properly.'),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Sectors', 'Which industries do you invest in?', industries, setIndustries, industryChoices),
          personalityStep,
        ];
      case 'Developer':
        return [
          buildMultiChoiceStep('developer_goals', 'Developer Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          buildSkillsStep('Core Skills For Matching', 'Add your stack and strengths so founders can find you.'),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Products You Want To Build', 'Which startup spaces pull you in?', industries, setIndustries, industryChoices),
          buildSingleChoiceStep('experience', 'Experience Level', 'How battle-tested are you right now?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like to build with teams?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Designer':
        return [
          buildMultiChoiceStep('designer_goals', 'Designer Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          buildSkillsStep('Core Skills For Matching', 'Add your design strengths so teams can find the right fit.'),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Products You Want To Shape', 'Which startup spaces would you love to design for?', industries, setIndustries, industryChoices),
          buildSingleChoiceStep('experience', 'Experience Level', 'Where are you in your design journey?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you collaborate best?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Marketer':
        return [
          buildMultiChoiceStep('marketer_goals', 'Marketing Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          buildSkillsStep('Core Skills For Matching', 'Add your growth channels and strengths so builders can discover you.'),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Markets You Understand', 'Which startup spaces do you know best?', industries, setIndustries, industryChoices),
          buildSingleChoiceStep('experience', 'Experience Level', 'How experienced are you in startup growth?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like to execute growth?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Student':
        return [
          buildMultiChoiceStep('student_goals', 'Student Goals', 'What are you hoping to unlock on LINKUP?', lookingFor, setLookingFor, builderGoalsChoices),
          buildSkillsStep('Core Skills For Matching', 'Add what you can do now and what you want to sharpen.'),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Startup Interests', 'Which spaces make you want to build?', industries, setIndustries, industryChoices),
          buildSingleChoiceStep('experience', 'Experience Level', 'How far into building are you?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like working with others?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Operator':
        return [
          buildMultiChoiceStep('operator_goals', 'Operator Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          buildSkillsStep('Core Skills For Matching', 'Add the systems and execution strengths you bring.'),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Operating Environments', 'Which kinds of startups do you want to support?', industries, setIndustries, industryChoices),
          buildSingleChoiceStep('experience', 'Experience Level', 'How experienced are you in operations?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like to run execution?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      default:
        if (role && role !== 'Founder') {
          const info = roleInfoFor(role);
          return [
            buildMultiChoiceStep('role_goals', `${info.badge} Goals`, 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
            buildSkillsStep('Core Skills For Matching', 'Add the strengths people should discover you for.'),
            ...roleQuestions.map(buildRoleQuestionStep),
            buildMultiChoiceStep('industries', 'Focus Areas', 'Which startup spaces do you want to be around?', industries, setIndustries, industryChoices),
            buildSingleChoiceStep('experience', 'Experience Level', 'Where are you in your journey?', experience, setExperience, experienceChoices),
            buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like to collaborate?', workStyle, setWorkStyle, workStyleChoices),
            personalityStep,
          ];
        }
        return [
          buildMultiChoiceStep('founder_goals', 'Founder Goals', 'What are you looking for right now?', lookingFor, setLookingFor, goalsChoices),
          buildSkillsStep('Core Skills For Matching', 'Add the founder strengths you bring so matches are useful.'),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Startup Industries', 'Select the spaces you are building in or obsessed with.', industries, setIndustries, industryChoices),
          buildSingleChoiceStep('commitment', 'Commitment Level', 'How available are you right now?', commitmentLevel, setCommitmentLevel, commitmentChoices),
          buildSingleChoiceStep('stage', 'Startup Stage', 'Where is your startup today?', startupStage, setStartupStage, startupStageChoices),
          buildSingleChoiceStep('funding', 'Funding Stage', 'What is your current funding stage?', fundingStage, setFundingStage, fundingStageChoices),
          buildSingleChoiceStep('availability', 'Availability', 'How open are you for new people and opportunities?', availability, setAvailability, availabilityChoices),
          personalityStep,
        ];
    }
  }, [
    role,
    lookingFor,
    industries,
    skills,
    customSkillsText,
    finalSkills,
    experience,
    workStyle,
    commitmentLevel,
    startupStage,
    fundingStage,
    availability,
    roleAnswers,
    isDark,
    personalityStep,
  ]);

  const lookingForChoices = role === 'Investor' ? investorGoalsChoices : role === 'Founder' || !role ? goalsChoices : builderGoalsChoices;

  const steps = useMemo(
    () => [
      {
        key: 'name',
        title: 'What should people call you?',
        subtitle: 'Use your real name. You can change it later.',
        body: (
          <View>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Full name"
              placeholderTextColor={textColor(isDark, 'muted')}
              style={[
                styles.textInput,
                {
                  borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,18,32,0.12)',
                  color: textColor(isDark),
                },
              ]}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>
        ),
        canNext: displayName.trim().length >= 2,
      },
      {
        key: 'identity',
        title: 'What best describes you?',
        subtitle: 'Pick the lane people should match you on.',
        body: (
          <ChoiceGrid value={role} onChange={(v) => setRole(String(v))} choices={identityChoices} isDark={isDark} />
        ),
        canNext: !!role,
      },
      {
        key: 'goals',
        title: 'Who are you looking for?',
        subtitle: 'Pick at least one. You can add more later.',
        body: (
          <ChoiceGrid
            value={lookingFor}
            onChange={(v) => setLookingFor(v as string[])}
            choices={lookingForChoices}
            multi
            isDark={isDark}
          />
        ),
        canNext: lookingFor.length > 0,
      },
      {
        key: 'photos',
        title: 'Add a face photo?',
        subtitle: 'Optional. Profiles with a photo get more replies.',
        body: (
          <View style={{ alignItems: 'center' }}>
            <PhotoSlot
              label="Profile Photo"
              uri={profilePicUri || null}
              onPress={pickPhoto}
              isDark={isDark}
              circular
            />
          </View>
        ),
        canNext: true,
      },
    ],
    [displayName, lookingFor, lookingForChoices, profilePicUri, role, isDark]
  );

  const current = steps[step];

  useEffect(() => {
    if (step > steps.length - 1) setStep(steps.length - 1);
  }, [steps.length, step]);

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const finalName = displayName.trim();
      const derivedUsername = finalName ? finalName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) : '';
      const circles = buildCircles({ role, industries, skills: finalSkills, experience });
      const roleSignalValues = Object.values(roleAnswers).flatMap((answer) => (Array.isArray(answer) ? answer : answer ? [answer] : []));
      const personalitySignalValues = Object.values(personalityAnswers).filter(Boolean);
      const personalityType = [role, workStyle, roleSignalValues[0], personalitySignalValues[0]].filter(Boolean).join(' - ');
      const networkingIntent = lookingFor[0] || (role ? `${role} Opportunities` : 'Serious Builder');
      const onboardingProfile: Record<string, unknown> = {
        uid: user.uid,
        displayName: finalName,
        ...(derivedUsername ? { username: derivedUsername } : {}),
        profileLink: publicProfileLink(user.uid),
        bio: bio.trim(),
        age: Number(ageText) || 0,
        country: country.trim(),
        city: city.trim(),
        occupation: role,
        goals: lookingFor.join(', '),
        lookingFor,
        interests: industries,
        industries,
        skills: finalSkills,
        experience,
        workStyle,
        commitmentLevel,
        startupStage,
        fundingStage,
        availability: availability || commitmentLevel,
        education: role === 'Student' ? 'Student' : '',
        personalityType,
        personalityAnswers,
        roleAnswers,
        networkingIntent,
        circles,
        profilePic: profilePicUri,
        photos: [],
        onboarded: true,
        isStealthMode: false,
        isVisible: true,
        turboConnect: false,
        hideOnlineStatus: false,
        settings: {
          publicDiscovery: true,
          stealthMode: false,
          turboConnect: false,
          hideOnlineStatus: false,
          darkMode: false,
        },
      } as any;
      await setDoc(doc(db, 'users', user.uid), onboardingProfile, { merge: true });
      await markOnboardingComplete(onboardingProfile);
      void seedConciergeWelcome(user.uid, onboardingProfile);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
      notifyUser('Could not finish onboarding', 'Please deploy the latest Firestore rules, then try again.');
    } finally {
      setSaving(false);
    }
  };

  const fieldBorder = { borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(11,18,32,0.12)' };

  return (
    <SafeAreaView style={[styles.container, appBackground(isDark)]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <View style={styles.wordmark}>
            <Text style={[styles.wordLeft, { color: textColor(isDark) }]}>LINK</Text>
            <View style={styles.wordRight}>
              <Text style={styles.wordRightText}>UP</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={async () => {
              try {
                await logout();
              } catch {}
            }}
            style={[styles.logoutBtn, fieldBorder]}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 13, fontWeight: '800', color: textColor(isDark) }}>Log out</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.stepCount, { color: textColor(isDark, 'muted') }]}>
          Step {step + 1} of {steps.length}
        </Text>
        <View style={[styles.track, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(11,18,32,0.08)' }]}>
          <View style={[styles.fill, { width: `${Math.round(((step + 1) / steps.length) * 100)}%` }]} />
        </View>

        <View style={{ marginTop: 22 }}>
          <StepTitle title={current.title} subtitle={current.subtitle} isDark={isDark} />
          {current.body}
        </View>

        <View style={{ height: 28 }} />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {step > 0 ? (
            <TouchableOpacity
              disabled={saving}
              onPress={() => setStep((s) => Math.max(0, s - 1))}
              style={[styles.btn, styles.ghostBtn, fieldBorder, { flex: 1, opacity: saving ? 0.5 : 1 }]}
            >
              <Text style={[styles.btnText, { color: textColor(isDark) }]}>Back</Text>
            </TouchableOpacity>
          ) : null}

          {step < steps.length - 1 ? (
            <TouchableOpacity
              disabled={!current.canNext || saving}
              onPress={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
              style={[styles.btn, styles.primaryBtn, { flex: 1, opacity: !current.canNext || saving ? 0.5 : 1 }]}
            >
              <Text style={[styles.btnText, { color: '#111' }]}>Continue</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              disabled={!current.canNext || saving}
              onPress={finish}
              style={[styles.btn, styles.primaryBtn, { flex: 1, opacity: !current.canNext || saving ? 0.5 : 1 }]}
            >
              {saving ? <ActivityIndicator color="#111" /> : <Text style={[styles.btnText, { color: '#111' }]}>Enter LINKUP</Text>}
            </TouchableOpacity>
          )}
        </View>

        {step >= 2 ? (
          <TouchableOpacity
            disabled={saving || displayName.trim().length < 2 || !role}
            onPress={finish}
            style={{ marginTop: 16, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '800', color: textColor(isDark, 'muted') }}>Skip extra — do this later</Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  wordLeft: { fontSize: 16, fontWeight: '900', letterSpacing: 1.2 },
  wordRight: { backgroundColor: COLORS.primary, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  wordRightText: { fontSize: 16, fontWeight: '900', letterSpacing: 1.2, color: '#111' },
  stepCount: { fontSize: 13, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 10 },
  fill: { height: 6, backgroundColor: COLORS.primary, borderRadius: 3 },
  title: { fontSize: 30, fontWeight: '900', letterSpacing: -0.8, lineHeight: 36 },
  subtitle: { marginTop: 8, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    minWidth: '47%',
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  logoutBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '600',
  },
  bioInput: {
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  selectedSkillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  selectedSkillPill: {
    borderRadius: 999,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectedSkillText: {
    color: '#111',
    fontSize: 12,
    fontWeight: '800',
  },
  photoSlot: {
    flex: 1,
    height: 150,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoSlotImg: { width: '100%', height: '100%' },
  photoSlotEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 18,
  },
  photoPlusCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlusText: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '800',
    color: '#111',
  },
  photoEmptyText: {
    fontSize: 13,
    fontWeight: '800',
  },
  photoSlotLabel: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: 'center',
  },
  profilePhotoPicker: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    overflow: 'hidden',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  profilePhotoPickerImg: {
    width: 180,
    height: 180,
    borderRadius: 90,
  },
  profilePhotoPickerEmpty: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  profilePhotoPlusCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePhotoPlusText: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '800',
    color: COLORS.primary,
  },
  profilePhotoEmptyText: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  profilePhotoHint: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  profilePhotoPickerLabel: {
    position: 'absolute',
    left: 32,
    right: 32,
    bottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: 'center',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  introText: {
    marginTop: 10,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  introBullets: {
    marginTop: 16,
    gap: 12,
  },
  introBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  introDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginTop: 5,
  },
  introBulletText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  introFooter: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  btn: {
    minHeight: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: { backgroundColor: COLORS.primary },
  ghostBtn: { borderWidth: 1 },
  btnText: { fontSize: 16, fontWeight: '800' },
});
