import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import * as ImagePicker from 'expo-image-picker';
import { imageAssetToDataUri } from '../lib/imageUploadLimits';

type Choice = { id: string; label: string; desc?: string };
type RoleQuestion = { id: string; title: string; subtitle: string; choices: Choice[]; multi?: boolean };
type PersonalityQuestion = {
  id: string;
  title: string;
  a: { id: string; label: string };
  b: { id: string; label: string };
};

const identityChoices: Choice[] = [
  { id: 'Founder', label: 'Founder' },
  { id: 'Developer', label: 'Developer' },
  { id: 'Designer', label: 'Designer' },
  { id: 'Investor', label: 'Investor' },
  { id: 'Marketer', label: 'Marketer' },
  { id: 'Student', label: 'Student' },
  { id: 'Operator', label: 'Operator' },
];

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
  { id: 'AI', label: 'AI' },
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
  { id: 'AI engineering', label: 'AI engineering' },
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
  { id: 'AI/ML', label: 'AI/ML' },
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
};

const roleQuestionBanks: Record<string, RoleQuestion[]> = {
  Founder: [
    {
      id: 'founderLane',
      title: 'Founder lane',
      subtitle: 'What do you naturally own inside a startup?',
      choices: [
        { id: 'Vision & Sales', label: 'Vision & Sales' },
        { id: 'Product Strategy', label: 'Product Strategy' },
        { id: 'Growth & GTM', label: 'Growth & GTM' },
        { id: 'Community Builder', label: 'Community Builder' },
        { id: 'Capital & Partnerships', label: 'Capital & Partnerships' },
      ],
    },
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
        { id: 'AI Engineer', label: 'AI Engineer' },
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
        { id: 'AI Products', label: 'AI Products' },
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

function buildCircles(input: {
  role: string;
  industries: string[];
  skills: string[];
  experience: string;
}) {
  const circles: string[] = [];
  if (input.role) circles.push(`${input.role}s`);
  input.industries.slice(0, 3).forEach((i) => circles.push(`${i} Builders`));
  if (input.skills.some((s) => s.toLowerCase().includes('ai'))) circles.push('AI Builders');
  if (input.skills.some((s) => s.toLowerCase().includes('frontend'))) circles.push('Frontend Builders');
  if (input.skills.some((s) => s.toLowerCase().includes('backend'))) circles.push('Backend Builders');
  if (input.experience) circles.push(input.experience);
  return Array.from(new Set(circles)).slice(0, 8);
}

const StepTitle = ({ title, subtitle, isDark }: { title: string; subtitle: string; isDark: boolean }) => (
  <View style={{ marginBottom: 18 }}>
    <Text style={[styles.title, { color: isDark ? '#FFF' : '#000' }]}>{title}</Text>
    <Text style={[styles.subtitle, { color: '#666' }]}>{subtitle}</Text>
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
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[
        styles.photoSlot,
        circular ? styles.photoSlotCircle : null,
        {
          backgroundColor: isDark ? '#16161A' : '#F8F8F8',
          borderColor: isDark ? '#222226' : '#EEEEEE',
        },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={[styles.photoSlotImg, circular ? styles.photoSlotImgCircle : null]} resizeMode="cover" />
      ) : (
        <View style={styles.photoSlotEmpty}>
          <View style={styles.photoPlusCircle}>
            <Text style={styles.photoPlusText}>+</Text>
          </View>
          <Text style={[styles.photoEmptyText, { color: isDark ? '#FFF' : '#000' }]}>TAP TO ADD</Text>
        </View>
      )}
      <View style={[styles.photoSlotLabel, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
        <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1, color: isDark ? '#FFF' : '#000' }} numberOfLines={1}>
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
              {
                backgroundColor: on ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                borderColor: isDark ? '#222226' : '#EEEEEE',
              },
            ]}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '900',
                letterSpacing: 1,
                color: on ? '#000' : (isDark ? '#FFF' : '#000'),
              }}
              numberOfLines={1}
            >
              {c.label.toUpperCase()}
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
}: {
  value: string;
  onChangeText: (text: string) => void;
  isDark: boolean;
}) => (
  <View style={{ marginTop: 12 }}>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="Type skills too: React, Python, Figma..."
      placeholderTextColor="#666"
      style={[
        styles.textInput,
        {
          backgroundColor: isDark ? '#16161A' : '#F8F8F8',
          borderColor: isDark ? '#222226' : '#EEEEEE',
          color: isDark ? '#FFF' : '#000',
        },
      ]}
      autoCapitalize="words"
    />
    <Text style={{ marginTop: 8, fontSize: 11, color: '#666', fontWeight: '800', lineHeight: 16 }}>
      Add at least one skill. These power search, swipe ranking, and AI matching.
    </Text>
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
          Alert.alert('Permission Denied', 'Please allow photo library access.');
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
      const { dataUri, error } = imageAssetToDataUri(asset);
      if (!dataUri) {
        Alert.alert('Photo too large', error || 'Please choose a smaller photo.');
        return;
      }

      setProfilePicUri(dataUri);
    } catch (e: any) {
      console.error('pickPhoto error', e);
      Alert.alert('Error', e?.message || 'Could not pick photo.');
    }
  };

  const currentPersonalityQuestions = useMemo(
    () => personalityQuestionsByRole[role] || personalityQuestionsByRole.Founder,
    [role]
  );

  const personalityStep = useMemo(() => {
    return {
      key: 'personality',
      title: `${role || 'Builder'} Personality`,
      subtitle: 'These answers sharpen AI compatibility and who naturally fits your energy.',
      body: (
        <View style={{ gap: 12 }}>
          {currentPersonalityQuestions.map((q) => {
            const v = personalityAnswers[q.id];
            return (
              <View
                key={q.id}
                style={[
                  styles.card,
                  { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' },
                ]}
              >
                <Text style={[styles.cardTitle, { color: isDark ? '#FFF' : '#000' }]}>{q.title}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  {[q.a, q.b].map((opt) => {
                    const on = v === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        onPress={() => setPersonalityAnswers((p) => ({ ...p, [q.id]: opt.id }))}
                        style={[
                          styles.choice,
                          {
                            flex: 1,
                            backgroundColor: on ? '#FBE618' : (isDark ? '#16161A' : '#F8F8F8'),
                            borderColor: isDark ? '#222226' : '#EEEEEE',
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: '900',
                            letterSpacing: 1,
                            color: on ? '#000' : (isDark ? '#FFF' : '#000'),
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
          key: 'availability',
          title: 'Availability',
          subtitle: 'What’s your current availability?',
          body: <ChoiceGrid value={availability} onChange={(v) => setAvailability(String(v))} choices={availabilityChoices} isDark={isDark} />,
          canNext: !!availability,
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
        key: 'commitment',
        title: 'Commitment Level',
        subtitle: 'How available are you right now?',
        body: <ChoiceGrid value={commitmentLevel} onChange={(v) => setCommitmentLevel(String(v))} choices={commitmentChoices} isDark={isDark} />,
        canNext: !!commitmentLevel,
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
        subtitle: 'What’s your current funding stage?',
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
    const roleQuestions = roleQuestionBanks[role] || roleQuestionBanks.Founder;

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
          <SkillsInput value={customSkillsText} onChangeText={setCustomSkillsText} isDark={isDark} />
        </View>
      ),
      canNext: finalSkills.length > 0,
    });

    switch (role) {
      case 'Investor':
        return [
          buildMultiChoiceStep('investor_goals', 'Investor Intent', 'What are you here for?', lookingFor, setLookingFor, investorGoalsChoices),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Sectors', 'Which industries do you invest in?', industries, setIndustries, industryChoices),
          buildSkillsStep('Investor Strengths', 'Choose the investor skills and edge you bring to founders.'),
          buildSingleChoiceStep('availability', 'Availability', 'What is your current availability?', availability, setAvailability, availabilityChoices),
          personalityStep,
        ];
      case 'Developer':
        return [
          buildMultiChoiceStep('developer_goals', 'Developer Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Products You Want To Build', 'Which startup spaces pull you in?', industries, setIndustries, industryChoices),
          buildSkillsStep('Developer Skills', 'Show your technical stack so founders can see the fit.'),
          buildSingleChoiceStep('experience', 'Experience Level', 'How battle-tested are you right now?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('availability', 'Availability', 'What is your current availability?', availability, setAvailability, availabilityChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like to build with teams?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Designer':
        return [
          buildMultiChoiceStep('designer_goals', 'Designer Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Products You Want To Shape', 'Which startup spaces would you love to design for?', industries, setIndustries, industryChoices),
          buildSkillsStep('Designer Skills', 'Show the design strengths you bring to ambitious teams.'),
          buildSingleChoiceStep('experience', 'Experience Level', 'Where are you in your design journey?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('availability', 'Availability', 'What is your current availability?', availability, setAvailability, availabilityChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you collaborate best?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Marketer':
        return [
          buildMultiChoiceStep('marketer_goals', 'Marketing Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Markets You Understand', 'Which startup spaces do you know best?', industries, setIndustries, industryChoices),
          buildSkillsStep('Marketing Skills', 'Show the channels and strengths you bring to growth.'),
          buildSingleChoiceStep('experience', 'Experience Level', 'How experienced are you in startup growth?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('availability', 'Availability', 'What is your current availability?', availability, setAvailability, availabilityChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like to execute growth?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Student':
        return [
          buildMultiChoiceStep('student_goals', 'Student Goals', 'What are you hoping to unlock on LINKUP?', lookingFor, setLookingFor, builderGoalsChoices),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Startup Interests', 'Which spaces make you want to build?', industries, setIndustries, industryChoices),
          buildSkillsStep('Student Strengths', 'Show the skills you already have and want to sharpen.'),
          buildSingleChoiceStep('experience', 'Experience Level', 'How far into building are you?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('commitment', 'Commitment Level', 'How available are you to build right now?', commitmentLevel, setCommitmentLevel, commitmentChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like working with others?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      case 'Operator':
        return [
          buildMultiChoiceStep('operator_goals', 'Operator Goals', 'What kind of opportunity are you looking for?', lookingFor, setLookingFor, builderGoalsChoices),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Operating Environments', 'Which kinds of startups do you want to support?', industries, setIndustries, industryChoices),
          buildSkillsStep('Operator Skills', 'Show the systems and execution strengths you bring.'),
          buildSingleChoiceStep('experience', 'Experience Level', 'How experienced are you in operations?', experience, setExperience, experienceChoices),
          buildSingleChoiceStep('availability', 'Availability', 'What is your current availability?', availability, setAvailability, availabilityChoices),
          buildSingleChoiceStep('workStyle', 'Work Style', 'How do you like to run execution?', workStyle, setWorkStyle, workStyleChoices),
          personalityStep,
        ];
      default:
        return [
          buildMultiChoiceStep('founder_goals', 'Founder Goals', 'What are you looking for right now?', lookingFor, setLookingFor, goalsChoices),
          ...roleQuestions.map(buildRoleQuestionStep),
          buildMultiChoiceStep('industries', 'Startup Industries', 'Select the spaces you are building in or obsessed with.', industries, setIndustries, industryChoices),
          buildSkillsStep('Founder Strengths', 'Show the founder strengths you bring to the table.'),
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

  const steps = useMemo(
    () => [
      {
        key: 'intro',
        title: 'Answer Carefully',
        subtitle: 'LINKUP uses your answers to recommend cofounders, collaborators, builders, and opportunities.',
        body: (
          <View
            style={[
              styles.card,
              { backgroundColor: isDark ? '#111115' : '#FFFFFF', borderColor: isDark ? '#222226' : '#EEEEEE' },
            ]}
          >
            <Text style={[styles.cardTitle, { color: isDark ? '#FFF' : '#000', fontSize: 14 }]}>
              Better answers = better matches
            </Text>
            <Text style={[styles.introText, { color: isDark ? '#CFCFCF' : '#555' }]}>
              Be honest about your goals, skills, work style, and availability. The AI matching system uses this profile to understand who can actually help you build.
            </Text>
            <View style={styles.introBullets}>
              {[
                'Choose what describes you today, not what sounds impressive.',
                'Add real skills and interests so search can find you.',
                'Answer personality questions correctly for stronger compatibility.',
              ].map((item) => (
                <View key={item} style={styles.introBulletRow}>
                  <View style={styles.introDot} />
                  <Text style={[styles.introBulletText, { color: isDark ? '#EDEDED' : '#222' }]}>{item}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.introFooter, { color: isDark ? '#FBE618' : '#8A7900' }]}>
              This takes one minute. It makes LINKUP feel smart instead of random.
            </Text>
          </View>
        ),
        canNext: true,
      },
      {
        key: 'name',
        title: 'Your Name',
        subtitle: 'What should people call you?',
        body: (
          <View>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Full name"
              placeholderTextColor="#666"
              style={[
                styles.textInput,
                {
                  backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                  borderColor: isDark ? '#222226' : '#EEEEEE',
                  color: isDark ? '#FFF' : '#000',
                },
              ]}
              autoCapitalize="words"
              returnKeyType="done"
            />
            <Text style={{ marginTop: 10, fontSize: 11, color: '#666', fontWeight: '800', lineHeight: 16 }}>
              Use your real name for trust. You can change it later.
            </Text>
          </View>
        ),
        canNext: displayName.trim().length >= 2,
      },
      {
        key: 'bio',
        title: 'Your Bio',
        subtitle: 'In 1–2 lines, what are you building or good at?',
        body: (
          <View>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Example: Execution-focused founder building an AI SaaS. Looking for a technical cofounder."
              placeholderTextColor="#666"
              style={[
                styles.bioInput,
                {
                  backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                  borderColor: isDark ? '#222226' : '#EEEEEE',
                  color: isDark ? '#FFF' : '#000',
                },
              ]}
              multiline
            />
            <Text style={{ marginTop: 10, fontSize: 11, color: '#666', fontWeight: '800', lineHeight: 16 }}>
              This improves matching quality.
            </Text>
          </View>
        ),
        canNext: bio.trim().length >= 10,
      },
      {
        key: 'basics',
        title: 'Basics',
        subtitle: 'A few details to personalize matches.',
        body: (
          <View style={{ gap: 12 }}>
            <TextInput
              value={ageText}
              onChangeText={(t) => setAgeText(t.replace(/[^0-9]/g, '').slice(0, 2))}
              placeholder="Age"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              style={[
                styles.textInput,
                {
                  backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                  borderColor: isDark ? '#222226' : '#EEEEEE',
                  color: isDark ? '#FFF' : '#000',
                },
              ]}
            />
            <TextInput
              value={country}
              onChangeText={setCountry}
              placeholder="Country"
              placeholderTextColor="#666"
              style={[
                styles.textInput,
                {
                  backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                  borderColor: isDark ? '#222226' : '#EEEEEE',
                  color: isDark ? '#FFF' : '#000',
                },
              ]}
              autoCapitalize="words"
            />
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="City"
              placeholderTextColor="#666"
              style={[
                styles.textInput,
                {
                  backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                  borderColor: isDark ? '#222226' : '#EEEEEE',
                  color: isDark ? '#FFF' : '#000',
                },
              ]}
              autoCapitalize="words"
            />
          </View>
        ),
        canNext: (() => {
          const ageNum = Number(ageText);
          return ageNum >= 13 && ageNum <= 99 && country.trim().length >= 2 && city.trim().length >= 2;
        })(),
      },
      {
        key: 'photos',
        title: 'Profile Picture',
        subtitle: 'Add one clear profile picture. Extra swipe photos can be edited later from your profile.',
        body: (
          <View style={{ alignItems: 'center' }}>
            <View style={{ alignItems: 'center' }}>
              <PhotoSlot
                label="Profile Photo"
                uri={profilePicUri || null}
                onPress={pickPhoto}
                isDark={isDark}
                circular
              />
            </View>
            <Text style={{ marginTop: 12, maxWidth: 360, fontSize: 11, color: '#666', fontWeight: '800', lineHeight: 16, textAlign: 'center' }}>
              This circular preview matches how your profile photo will look on LINKUP.
            </Text>
            <Text style={{ marginTop: 8, maxWidth: 420, fontSize: 11, color: '#666', fontWeight: '800', lineHeight: 16, textAlign: 'center' }}>
              Want more swipe photos? Open Profile after onboarding and add them there.
            </Text>
          </View>
        ),
        canNext: !!profilePicUri,
      },
      {
        key: 'identity',
        title: 'Your Identity',
        subtitle: 'What best describes you?',
        body: (
          <ChoiceGrid value={role} onChange={(v) => setRole(String(v))} choices={identityChoices} isDark={isDark} />
        ),
        canNext: !!role,
      },
      ...roleSteps,
    ],
    [
      displayName,
      bio,
      ageText,
      country,
      city,
      profilePicUri,
      role,
      isDark,
      roleSteps,
    ]
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
      const personalityType = [role, workStyle, roleSignalValues[0], personalitySignalValues[0]].filter(Boolean).join(' • ');
      const networkingIntent = lookingFor[0] || (role ? `${role} Opportunities` : 'Serious Builder');
      const onboardingProfile: Record<string, unknown> = {
        uid: user.uid,
        displayName: finalName,
        ...(derivedUsername ? { username: derivedUsername } : {}),
        profileLink: `linkup://profile/${user.uid}`,
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
      } as any;
      await setDoc(doc(db, 'users', user.uid), onboardingProfile, { merge: true });
      await markOnboardingComplete(onboardingProfile);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.uid}`);
      Alert.alert('Could not finish onboarding', 'Please deploy the latest Firestore rules, then try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#0A0A0C' : '#FFFFFF' }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[styles.stepCount, { color: isDark ? '#AAA' : '#666' }]}>ONBOARDING</Text>
          <TouchableOpacity
            onPress={async () => {
              try {
                await logout();
              } catch {}
            }}
            style={[
              styles.logoutBtn,
              { backgroundColor: isDark ? '#16161A' : '#F8F8F8', borderColor: isDark ? '#222226' : '#EEEEEE' },
            ]}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 2, color: isDark ? '#FFF' : '#000' }}>LOG OUT</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.stepCount, { color: isDark ? '#AAA' : '#666' }]}>
          STEP {step + 1} / {steps.length}
        </Text>
        <View style={[styles.track, { backgroundColor: isDark ? '#1A1A1F' : '#EEEEEE' }]}>
          <View style={[styles.fill, { width: `${Math.round(((step + 1) / steps.length) * 100)}%` }]} />
        </View>

        <View style={{ marginTop: 18 }}>
          <StepTitle title={current.title} subtitle={current.subtitle} isDark={isDark} />
          {current.body}
        </View>

        <View style={{ height: 24 }} />

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            disabled={step === 0 || saving}
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            style={[
              styles.btn,
              {
                backgroundColor: isDark ? '#16161A' : '#F8F8F8',
                borderColor: isDark ? '#222226' : '#EEEEEE',
                flex: 1,
                opacity: step === 0 || saving ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[styles.btnText, { color: isDark ? '#FFF' : '#000' }]}>BACK</Text>
          </TouchableOpacity>

          {step < steps.length - 1 ? (
            <TouchableOpacity
              disabled={!current.canNext || saving}
              onPress={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
              style={[styles.btn, { backgroundColor: '#FBE618', flex: 1, opacity: !current.canNext || saving ? 0.5 : 1 }]}
            >
              <Text style={[styles.btnText, { color: '#000' }]}>NEXT</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              disabled={!current.canNext || saving}
              onPress={finish}
              style={[styles.btn, { backgroundColor: '#FBE618', flex: 1, opacity: !current.canNext || saving ? 0.5 : 1 }]}
            >
              {saving ? <ActivityIndicator color="#000" /> : <Text style={[styles.btnText, { color: '#000' }]}>FINISH</Text>}
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 90 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingTop: 22 },
  stepCount: { fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 10 },
  fill: { height: 4, backgroundColor: '#FBE618' },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: 1, color: '#000' },
  subtitle: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#666', lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    minWidth: '48%',
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  logoutBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '800',
  },
  bioInput: {
    minHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  photoSlot: {
    flex: 1,
    height: 150,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoSlotCircle: {
    width: 190,
    height: 190,
    flex: 0,
    borderRadius: 95,
    alignSelf: 'center',
    borderWidth: 3,
    borderColor: '#FBE618',
    backgroundColor: '#FFFBEA',
    shadowColor: '#FBE618',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  photoSlotImg: { width: '100%', height: '100%' },
  photoSlotImgCircle: { borderRadius: 95 },
  photoSlotEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 18,
  },
  photoPlusCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FBE618',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  photoPlusText: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '900',
    color: '#000',
  },
  photoEmptyText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  photoSlotLabel: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#00000010',
    alignItems: 'center',
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
  },
  cardTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  introText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
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
    backgroundColor: '#FBE618',
    marginTop: 5,
  },
  introBulletText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
  },
  introFooter: {
    marginTop: 16,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    lineHeight: 17,
  },
  btn: {
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnText: { fontSize: 12, fontWeight: '900', letterSpacing: 2 },
});
