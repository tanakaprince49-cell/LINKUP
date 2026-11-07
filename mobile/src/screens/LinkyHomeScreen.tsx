import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, BriefcaseBusiness, Users } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { appBackground, textColor, COLORS } from '../theme/theme';
import { linkyTeamMatch, LinkyApiError, TeamMatchResult, TeamMatchTeam } from '../lib/linkyApi';
import PaywallModal from '../components/PaywallModal';
import MemberBadges from '../components/MemberBadges';

type MatchMode = 'find' | 'assign';
const roleList = (value: string) => value.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean).slice(0, 3);
const idsFromText = (value: string) => [...new Set(value.split(/[\s,;\n]+/).map((part) => {
  const match = part.match(/(?:\/p\/|\/profile\/)?([A-Za-z0-9_-]{1,128})\/?(?:[?#].*)?$/);
  return match?.[1] || '';
}).filter(Boolean))].slice(0, 3);

export default function LinkyHomeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { profile } = useAuth();
  const [mode, setMode] = useState<MatchMode>('find');
  const [idea, setIdea] = useState('');
  const [ownRole, setOwnRole] = useState('');
  const [rolesText, setRolesText] = useState('');
  const [teamSize, setTeamSize] = useState<2 | 3>(3);
  const [memberIdsText, setMemberIdsText] = useState('');
  const [result, setResult] = useState<TeamMatchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paywall, setPaywall] = useState('');

  useEffect(() => {
    const fromProfile = profile?.occupation || profile?.skills?.slice(0, 2).join(', ') || '';
    if (fromProfile) setOwnRole((current) => current || fromProfile);
  }, [profile?.uid, profile?.occupation, profile?.skills]);

  const palette = useMemo(() => ({
    surface: dark ? '#17232C' : '#FFFFFF',
    border: dark ? '#30414A' : '#E6E9E2',
    muted: textColor(dark, 'muted'),
    text: textColor(dark),
    field: dark ? '#101A21' : '#F7F8F4',
  }), [dark]);
  const roles = roleList(rolesText);
  const memberUids = idsFromText(memberIdsText);

  const runMatch = async (runMode: MatchMode, explicitIds?: string[]) => {
    if (busy) return;
    if (idea.trim().length < 12) { setError('Describe the project in at least 12 characters.'); return; }
    const ids = explicitIds || memberUids;
    if (runMode === 'assign' && (ids.length < 2 || ids.length > 3)) {
      setError('Enter two or three LINKUP profile IDs or profile links for your existing teammates.');
      return;
    }
    setBusy(true); setError(''); setPaywall('');
    try {
      const next = await linkyTeamMatch({
        mode: runMode,
        idea: idea.trim(),
        ownRole: ownRole.trim(),
        roles,
        memberUids: runMode === 'assign' ? ids : [],
        teamSize,
      });
      setResult(next);
      if (!next.teams.length && next.message) setError(next.message);
    } catch (err) {
      if (err instanceof LinkyApiError && err.status === 402) setPaywall(err.message);
      else setError(err instanceof Error ? err.message : 'The team match could not be completed. Please try again.');
    } finally { setBusy(false); }
  };

  const applyRolesTo = (team: TeamMatchTeam) => {
    const ids = team.members.map((member) => member.uid);
    setMode('assign');
    setMemberIdsText(ids.join(', '));
    void runMatch('assign', ids);
  };

  const memberCard = (member: TeamMatchResult['teams'][number]['members'][number], index: number) => (
    <View key={`${member.uid}-${index}`} style={[styles.member, { borderColor: palette.border, backgroundColor: palette.field }]}>
      {member.image ? <Image source={{ uri: member.image }} style={styles.avatar} /> : <View style={[styles.avatar, styles.initials]}><Text style={{ color: '#FBE618', fontWeight: '900' }}>{member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</Text></View>}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}><Text style={[styles.memberName, { color: palette.text }]}>{member.name}</Text><MemberBadges userId={member.uid} verified={member.verified} size={14} /></View>
        {!!member.title && <Text style={[styles.memberMeta, { color: palette.muted }]}>{[member.title, member.company].filter(Boolean).join(' · ')}</Text>}
        {!!member.city && <Text style={[styles.memberMeta, { color: palette.muted }]}>{member.city}</Text>}
        <View style={styles.roleBadge}><BriefcaseBusiness size={13} color="#0A0B0D" /><Text style={styles.roleBadgeText}>{member.recommendedRole}</Text></View>
        <Text style={[styles.reason, { color: palette.text }]}>{member.why}</Text>
        {!!member.unknowns?.length && <Text style={[styles.memberMeta, { color: palette.muted }]}>Still to verify: {member.unknowns.slice(0, 2).join(' · ')}</Text>}
        <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('Profile', { userId: member.uid })} style={styles.profileLink}>
          <Text style={{ color: dark ? '#9ED8FF' : '#075EA8', fontWeight: '800' }}>View profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, appBackground(dark), { paddingTop: insets.top, backgroundColor: dark ? '#101C24' : '#FBFAF5' }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to LINKUP" onPress={() => navigation.navigate('Dashboard')} style={styles.back}>
          <ArrowLeft size={21} color={palette.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.text }]}>Linky · Team matcher</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>One job: build a complementary team and recommend roles.</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.intro, { backgroundColor: dark ? '#202B27' : '#F2F4E8', borderColor: palette.border }]}>
          <Users size={20} color={COLORS.primaryStrong} />
          <Text style={[styles.introText, { color: palette.text }]}>Describe the ambitious project and your contribution. AI helps identify role gaps; LINKUP’s matching algorithm checks public profile evidence, role fit, and team complementarity.</Text>
        </View>

        <View style={styles.modeRow}>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: mode === 'find' }} onPress={() => { setMode('find'); setError(''); }} style={[styles.modeButton, mode === 'find' && styles.modeActive]}><Text style={styles.modeText}>Find teammates</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: mode === 'assign' }} onPress={() => { setMode('assign'); setError(''); }} style={[styles.modeButton, mode === 'assign' && styles.modeActive]}><Text style={styles.modeText}>Assign roles to a team</Text></TouchableOpacity>
        </View>

        <View style={[styles.form, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.label, { color: palette.text }]}>What are you building?</Text>
          <TextInput accessibilityLabel="Project idea" value={idea} onChangeText={setIdea} maxLength={600} multiline placeholder="Describe the problem, who it helps, and what the team needs to build…" placeholderTextColor={palette.muted} style={[styles.input, styles.ideaInput, { backgroundColor: palette.field, borderColor: palette.border, color: palette.text }]} />
          <Text style={[styles.label, { color: palette.text }]}>Your contribution or role</Text>
          <TextInput accessibilityLabel="Your role and skills" value={ownRole} onChangeText={setOwnRole} maxLength={100} placeholder="Founder, product lead, engineer…" placeholderTextColor={palette.muted} style={[styles.input, { backgroundColor: palette.field, borderColor: palette.border, color: palette.text }]} />
          <Text style={[styles.label, { color: palette.text }]}>Roles to fill <Text style={{ color: palette.muted, fontWeight: '500' }}>(optional; AI can suggest)</Text></Text>
          <TextInput accessibilityLabel="Optional roles to fill" value={rolesText} onChangeText={setRolesText} maxLength={240} placeholder="e.g. hardware engineer, clinical researcher" placeholderTextColor={palette.muted} style={[styles.input, { backgroundColor: palette.field, borderColor: palette.border, color: palette.text }]} />
          {mode === 'find' ? <>
            <Text style={[styles.label, { color: palette.text }]}>Teammates to find</Text>
            <View style={styles.modeRow}>{([2, 3] as const).map((size) => <TouchableOpacity key={size} accessibilityRole="button" accessibilityState={{ selected: teamSize === size }} onPress={() => setTeamSize(size)} style={[styles.sizeButton, teamSize === size && styles.modeActive]}><Text style={styles.modeText}>{size}</Text></TouchableOpacity>)}</View>
          </> : <>
            <Text style={[styles.label, { color: palette.text }]}>Existing teammates’ LINKUP profile IDs or links</Text>
            <TextInput accessibilityLabel="Existing team member profile IDs or links" value={memberIdsText} onChangeText={setMemberIdsText} maxLength={600} multiline placeholder="Paste 2 or 3 profile IDs or /p/ links, separated by commas" placeholderTextColor={palette.muted} style={[styles.input, styles.ideaInput, { backgroundColor: palette.field, borderColor: palette.border, color: palette.text }]} />
          </>}
          {!!roles.length && <Text style={[styles.helper, { color: palette.muted }]}>Role slots: {roles.join(' · ')}</Text>}
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void runMatch(mode)} style={[styles.primaryButton, busy && { opacity: 0.65 }]}>
            {busy ? <ActivityIndicator color="#0A0B0D" /> : <Text style={styles.primaryText}>{mode === 'find' ? 'Find my team' : 'Recommend roles'}</Text>}
          </TouchableOpacity>
        </View>

        {error ? <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: dark ? '#37272A' : '#FFF1F0' }]}><Text style={{ color: dark ? '#FFD5D8' : '#8B1E26', lineHeight: 21 }}>{error}</Text></View> : null}

        {result?.teams.map((team, teamIndex) => (
          <View key={team.id} style={[styles.team, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.teamHeading}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.teamTitle, { color: palette.text }]}>{result.mode === 'assign' ? 'Role plan for your team' : `Suggested team ${result.teams.length > 1 ? teamIndex + 1 : ''}`}</Text>
                <Text style={[styles.helper, { color: palette.muted }]}>{result.ownerName || 'You'} · {result.ownerRole}</Text>
              </View>
              <Text style={styles.fitPill}>{team.score} fit</Text>
            </View>
            <View style={[styles.ownerRole, { borderColor: palette.border }]}><Text style={[styles.helper, { color: palette.muted }]}>YOU</Text><Text style={[styles.roleName, { color: palette.text }]}>{result.ownerRole}</Text></View>
            {team.members.map(memberCard)}
            {result.mode === 'find' && <TouchableOpacity accessibilityRole="button" onPress={() => applyRolesTo(team)} disabled={busy} style={[styles.secondaryButton, { borderColor: palette.border }]}><Text style={{ color: palette.text, fontWeight: '800' }}>Use this team · assign roles</Text></TouchableOpacity>}
          </View>
        ))}
        {result && !result.teams.length && !error ? <View style={[styles.notice, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={{ color: palette.text, lineHeight: 21 }}>{result.message || 'No complete team match yet.'}</Text></View> : null}
        <Text style={[styles.footer, { color: palette.muted }]}>Recommendations use public member-profile evidence. A match is a suggestion, not a claim about availability, commitment, or guaranteed fit. You choose whether to contact anyone.</Text>
      </ScrollView>
      <PaywallModal visible={!!paywall} onClose={() => setPaywall('')} feature="Team matching" description={paywall || 'Upgrade to continue using LINKUP team matching.'} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '900' },
  subtitle: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  content: { width: '100%', maxWidth: 780, alignSelf: 'center', padding: 16, paddingBottom: 40, gap: 14 },
  intro: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  introText: { flex: 1, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeButton: { flex: 1, minHeight: 42, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#E8E6DE' },
  modeActive: { backgroundColor: '#FBE618' },
  modeText: { color: '#0A0B0D', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  sizeButton: { width: 48, minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: '#E8E6DE' },
  form: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 10 },
  label: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  ideaInput: { minHeight: 96, textAlignVertical: 'top' },
  helper: { fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: '#FBE618', marginTop: 4 },
  primaryText: { color: '#0A0B0D', fontWeight: '900', fontSize: 14 },
  notice: { borderWidth: 1, borderColor: '#F1CACA', borderRadius: 14, padding: 13 },
  team: { borderWidth: 1, borderRadius: 20, padding: 15, gap: 12 },
  teamHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamTitle: { fontSize: 17, fontWeight: '900' },
  fitPill: { backgroundColor: '#E8F3E5', color: '#214B2A', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6, fontSize: 11, fontWeight: '900' },
  ownerRole: { borderWidth: 1, borderRadius: 14, padding: 11, gap: 3, backgroundColor: 'rgba(251,230,24,.08)' },
  roleName: { fontSize: 14, fontWeight: '900' },
  member: { borderWidth: 1, borderRadius: 15, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#273642' },
  initials: { alignItems: 'center', justifyContent: 'center' },
  memberName: { fontSize: 14, fontWeight: '900' },
  memberMeta: { fontSize: 11, lineHeight: 16 },
  roleBadge: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: '#FBE618', marginTop: 2 },
  roleBadgeText: { color: '#0A0B0D', fontSize: 11, fontWeight: '900' },
  reason: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  profileLink: { alignSelf: 'flex-start', paddingVertical: 4, marginTop: 1 },
  secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  footer: { textAlign: 'center', fontSize: 11, lineHeight: 17, paddingHorizontal: 8 },
});
