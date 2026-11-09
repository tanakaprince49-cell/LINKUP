import { geminiText } from './_gemini.js';
import { sendWeeklyCofounderIntroEmails } from './_emailNotify.js';
import {
  assignWeeklyCofounderPairs,
  cofounderPairId,
  cofounderWeekWindow,
  eligibility,
  scoreMutualCofounderPair,
} from '../shared/linkup-match.js';

const cleanText = (value, max = 220) =>
  String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const directMatchIdFor = (a, b) => [String(a || '').trim(), String(b || '').trim()].filter(Boolean).sort().join('_');

function sanitizePublicPartnerProfile(profile = {}) {
  if (!profile || !profile.uid) return null;
  return {
    uid: String(profile.uid),
    displayName: cleanText(profile.displayName || profile.name || profile.username || 'Builder', 80),
    username: cleanText(profile.username || '', 60),
    bio: cleanText(profile.bio || '', 420),
    goals: cleanText(profile.goals || '', 320),
    profilePic: String(profile.profilePic || profile.photoURL || ''),
    occupation: cleanText(profile.occupation || profile.role || 'Founder & Builder', 80),
    company: cleanText(profile.company || '', 80),
    city: cleanText(profile.city || '', 60),
    country: cleanText(profile.country || '', 60),
    skills: Array.isArray(profile.skills) ? profile.skills.slice(0, 12).map((s) => cleanText(s, 40)).filter(Boolean) : [],
    industries: Array.isArray(profile.industries) ? profile.industries.slice(0, 8).map((s) => cleanText(s, 40)).filter(Boolean) : [],
    lookingFor: Array.isArray(profile.lookingFor) ? profile.lookingFor.slice(0, 8).map((s) => cleanText(s, 50)).filter(Boolean) : [],
    startupStage: cleanText(profile.startupStage || '', 50),
    commitmentLevel: cleanText(profile.commitmentLevel || '', 50),
    availability: profile.availability || '',
    isVerified: !!profile.isVerified,
    reputationScore: Number(profile.reputationScore || 0),
    projects: Array.isArray(profile.projects)
      ? profile.projects.slice(0, 3).map((p, i) => ({
          id: String(p?.id || `project_${i}`),
          title: cleanText(p?.title || '', 100),
          description: cleanText(p?.description || '', 220),
          status: cleanText(p?.status || '', 60),
          lookingFor: Array.isArray(p?.lookingFor) ? p.lookingFor.slice(0, 5) : [],
          tags: Array.isArray(p?.tags) ? p.tags.slice(0, 5) : [],
        }))
      : [],
  };
}

/** A named contribution in the dossier: what one founder brings, and what it unlocks. */
const doesList = (value, max = 3) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((entry) => ({
      skill: cleanText(entry?.skill || entry?.name || '', 60),
      unlocks: cleanText(entry?.unlocks || entry?.for || entry?.value || '', 140),
    }))
    .filter((entry) => {
      if (!entry.skill) return false;
      const key = entry.skill.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
};

/**
 * Deterministic dossier — the same shape the AI returns, assembled only from
 * facts the algorithm already verified. Used when the model is unavailable so
 * the deep read is never blank, and never invented.
 */
export function buildEngineDossier(pair = {}) {
  const nameA = cleanText(pair?.profileA?.displayName || 'Builder A', 50);
  const nameB = cleanText(pair?.profileB?.displayName || 'Builder B', 50);
  const aOffers = (Array.isArray(pair?.aOffers) ? pair.aOffers : []).map((o) => cleanText(o, 60)).filter(Boolean);
  const bOffers = (Array.isArray(pair?.bOffers) ? pair.bOffers : []).map((o) => cleanText(o, 60)).filter(Boolean);
  const sharedDomains = (Array.isArray(pair?.sharedDomains) ? pair.sharedDomains : []).map((d) => cleanText(d, 40)).filter(Boolean);
  const sharedA = cleanText(pair?.cardForA?.why?.shared, 220);
  const sharedB = cleanText(pair?.cardForB?.why?.shared, 220);
  const complementA = cleanText(pair?.cardForA?.why?.complement, 220);
  const complementB = cleanText(pair?.cardForB?.why?.complement, 220);
  const placeA = [pair?.profileA?.city, pair?.profileA?.country].filter(Boolean).join(', ');
  const placeB = [pair?.profileB?.city, pair?.profileB?.country].filter(Boolean).join(', ');
  const overlap = sharedDomains.length ? `You both work in ${sharedDomains.slice(0, 3).join(', ')}.` : '';
  const joins = (parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  // Three contributions each, always: the offers the algorithm verified first,
  // then the person's own skills, so a thin profile still reads as a whole person.
  const bring = (offers, profile, forName) => {
    const seen = new Set();
    const merged = [...offers, ...(Array.isArray(profile?.skills) ? profile.skills : []), 'Execution']
      .map((value) => cleanText(value, 60))
      .filter((value) => {
        const key = value.toLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return merged.slice(0, 3).map((skill) => ({
      skill,
      unlocks: `lets ${forName} stop carrying the ${skill.toLowerCase()} work alone`,
    }));
  };

  return {
    headline: `${(aOffers[0] || pair?.profileA?.occupation || 'Product')} × ${(bOffers[0] || pair?.profileB?.occupation || 'Growth')}`,
    whyChosenForA: joins([
      sharedA || overlap,
      complementA,
      placeB ? `${nameB} is building from ${placeB}.` : '',
    ]) || `${nameB} brings ${(bOffers.length ? bOffers : ['complementary execution']).join(', ')} against your ${(aOffers.length ? aOffers : ['builder strengths']).join(', ')}.`,
    whyChosenForB: joins([
      sharedB || overlap,
      complementB,
      placeA ? `${nameA} is building from ${placeA}.` : '',
    ]) || `${nameA} brings ${(aOffers.length ? aOffers : ['complementary execution']).join(', ')} against your ${(bOffers.length ? bOffers : ['builder strengths']).join(', ')}.`,
    whatABrings: bring(aOffers, pair?.profileA, nameB),
    whatBBrings: bring(bOffers, pair?.profileB, nameA),
    sharedGround: [
      ...sharedDomains.slice(0, 3),
      ...(placeA && placeA === placeB ? [placeA] : []),
      ...(pair?.profileA?.startupStage && pair?.profileA?.startupStage === pair?.profileB?.startupStage ? [cleanText(pair.profileA.startupStage, 40)] : []),
    ].filter(Boolean).slice(0, 4),
    firstSprint: cleanText(pair?.firstSprintTask || pair?.cardForA?.tiny_task, 200) || 'Spend 20 minutes scoping one shared prototype and one customer to test it with.',
    source: 'engine',
  };
}

export async function generateAiCofounderNarrative(pair, { aiText = geminiText } = {}) {
  const nameA = cleanText(pair?.profileA?.displayName || 'Builder A', 50);
  const nameB = cleanText(pair?.profileB?.displayName || 'Builder B', 50);
  const engineDossier = buildEngineDossier(pair);
  const fallbackWhyForA = engineDossier.whyChosenForA;
  const fallbackWhyForB = engineDossier.whyChosenForB;
  const fallbackHeadline = engineDossier.headline;
  const fallbackSprint = engineDossier.firstSprint;

  if (typeof aiText !== 'function') {
    return {
      aiHeadline: fallbackHeadline,
      aiWhyForA: fallbackWhyForA,
      aiWhyForB: fallbackWhyForB,
      aiWhyMutual: fallbackWhyForA,
      aiFirstSprint: fallbackSprint,
      aiDossier: engineDossier,
      source: 'engine',
    };
  }

  const facts = (profile = {}) => JSON.stringify({
    name: cleanText(profile?.displayName, 60),
    occupation: cleanText(profile?.occupation || profile?.role, 60),
    company: cleanText(profile?.company, 60),
    skills: (profile?.skills || []).slice(0, 8).map((s) => cleanText(s, 40)),
    lookingFor: (profile?.lookingFor || []).slice(0, 6).map((s) => cleanText(s, 50)),
    industries: (profile?.industries || []).slice(0, 5).map((s) => cleanText(s, 40)),
    stage: cleanText(profile?.startupStage, 40),
    commitment: cleanText(profile?.commitmentLevel, 40),
    place: [profile?.city, profile?.country].filter(Boolean).join(', '),
    goals: cleanText(profile?.goals || profile?.bio, 320),
    projects: (Array.isArray(profile?.projects) ? profile.projects : []).slice(0, 3).map((p) => ({
      title: cleanText(p?.title, 80),
      description: cleanText(p?.description, 180),
      status: cleanText(p?.status, 40),
      lookingFor: (p?.lookingFor || []).slice(0, 4).map((s) => cleanText(s, 40)),
    })),
  });

  try {
    const prompt = [
      'You are the LINKUP Co-Founder Matching AI.',
      'The deterministic LINKUP algorithm has already picked these two people as each other\'s one featured co-founder introduction this week.',
      'Your job is the dossier they read before deciding whether to reach out. It has to be deep, specific and earned — the reasoning a sharp founder would give a friend about why these two should talk this week.',
      'HARD RULES:',
      '- Ground every claim in the facts below. Never invent employers, degrees, funding, revenue, follower counts or achievements. If something is thin, describe the gap instead of filling it.',
      '- No percentages, no scores, no "soulmate", no "vibes", no horoscopes, no generic hype adjectives standing in for evidence.',
      '- Write to each founder in second person ("you"), direct and a little blunt, like someone who read both profiles twice.',
      '- whyChosenForA / whyChosenForB: 4 to 6 sentences each. Cover: (1) the actual mechanism — what specifically in the two profiles triggered the pairing, quoting the evidence; (2) what each person gains that they cannot easily get elsewhere right now; (3) the honest risk or friction in the pairing; (4) why this week, given their stage and goals.',
      '- whatABrings / whatBBrings: exactly 3 entries each, each {"skill": concrete capability from that person\'s profile, "unlocks": one clause of at most 18 words saying what it lets the OTHER person do that they cannot do alone}.',
      '- sharedGround: 2 to 4 fragments of genuine overlap (domain, stage, place, audience, tools, ambition), each at most 8 words. Empty array if there is no real overlap.',
      '- firstSprint: one concrete 20-minute action for their first call, with a named artefact or question.',
      'Return STRICT JSON, no prose outside it, with schema:',
      '{"headline":"4-7 word pairing title, no punctuation tricks","whyChosenForA":"...","whyChosenForB":"...","whatABrings":[{"skill":"...","unlocks":"..."}],"whatBBrings":[{"skill":"...","unlocks":"..."}],"sharedGround":["..."],"firstSprint":"..."}',
      `Builder A facts: ${facts(pair?.profileA)}`,
      `Builder B facts: ${facts(pair?.profileB)}`,
      `What each already offers, per the algorithm: ${JSON.stringify({ aOffers: pair?.aOffers || [], bOffers: pair?.bOffers || [] })}`,
      `Algorithm evidence: ${JSON.stringify({
        sharedDomains: pair?.sharedDomains || [],
        sharedForA: cleanText(pair?.cardForA?.why?.shared, 220),
        complementForA: cleanText(pair?.cardForA?.why?.complement, 220),
        sharedForB: cleanText(pair?.cardForB?.why?.shared, 220),
        complementForB: cleanText(pair?.cardForB?.why?.complement, 220),
        band: pair?.band?.label,
      })}`,
    ].join('\n');

    const raw = await aiText(prompt, {
      temperature: 0.35,
      maxOutputTokens: 1400,
      responseMimeType: 'application/json',
    });
    const text = String(raw || '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1));
      const dossier = {
        headline: cleanText(parsed.headline, 80) || engineDossier.headline,
        whyChosenForA: cleanText(parsed.whyChosenForA, 1400) || engineDossier.whyChosenForA,
        whyChosenForB: cleanText(parsed.whyChosenForB, 1400) || engineDossier.whyChosenForB,
        whatABrings: doesList(parsed.whatABrings).length ? doesList(parsed.whatABrings) : engineDossier.whatABrings,
        whatBBrings: doesList(parsed.whatBBrings).length ? doesList(parsed.whatBBrings) : engineDossier.whatBBrings,
        sharedGround: (Array.isArray(parsed.sharedGround) ? parsed.sharedGround : [])
          .map((entry) => cleanText(entry, 60))
          .filter(Boolean)
          .slice(0, 4),
        firstSprint: cleanText(parsed.firstSprint, 220) || engineDossier.firstSprint,
        source: 'ai+engine',
      };
      return {
        aiHeadline: dossier.headline,
        aiWhyForA: dossier.whyChosenForA,
        aiWhyForB: dossier.whyChosenForB,
        aiWhyMutual: dossier.whyChosenForA,
        aiFirstSprint: dossier.firstSprint,
        aiDossier: dossier,
        source: 'ai+engine',
      };
    }
  } catch {
    // Graceful fallback to the deterministic LINKUP dossier: never blank, never invented.
  }

  return {
    aiHeadline: fallbackHeadline,
    aiWhyForA: fallbackWhyForA,
    aiWhyForB: fallbackWhyForB,
    aiWhyMutual: fallbackWhyForA,
    aiFirstSprint: fallbackSprint,
    aiDossier: engineDossier,
    source: 'engine',
  };
}

async function loadEligiblePool(db, { limit = 160 } = {}) {
  const profilesByUid = new Map();
  try {
    const usersSnap = await db.collection('users').limit(limit).get();
    for (const doc of usersSnap?.docs || []) {
      const data = doc.data() || {};
      const uid = String(doc.id || data.uid || '').trim();
      if (!uid || data.deleted || data.banned || data.isStealthMode || data.isVisible === false || data.onboarded === false) {
        continue;
      }
      profilesByUid.set(uid, { ...data, uid });
    }
  } catch {}

  try {
    const publicSnap = await db.collection('publicProfiles').limit(limit).get();
    for (const doc of publicSnap?.docs || []) {
      const data = doc.data() || {};
      const uid = String(doc.id || data.uid || '').trim();
      if (!uid) continue;
      const existing = profilesByUid.get(uid);
      if (existing) {
        profilesByUid.set(uid, { ...data, ...existing, uid });
      } else if (!data.deleted && !data.banned && !data.isStealthMode && data.isVisible !== false && data.onboarded !== false) {
        profilesByUid.set(uid, { ...data, uid });
      }
    }
  } catch {}

  return Array.from(profilesByUid.values());
}

async function resolveMutualGateState(db, viewerUid, partnerUid, matchData = {}) {
  const interests = matchData?.interests || {};
  let viewerInterested = !!interests[viewerUid]?.interested;
  let partnerInterested = !!interests[partnerUid]?.interested;

  try {
    const outSnap = await db.collection('connectionRequests').doc(`${viewerUid}_${partnerUid}`).get();
    const inSnap = await db.collection('connectionRequests').doc(`${partnerUid}_${viewerUid}`).get();
    const outStatus = outSnap?.exists ? outSnap.data()?.status : null;
    const inStatus = inSnap?.exists ? inSnap.data()?.status : null;
    if (outStatus === 'pending' || outStatus === 'approved') viewerInterested = true;
    if (inStatus === 'pending' || inStatus === 'approved') partnerInterested = true;
    if (outStatus === 'approved' || inStatus === 'approved') {
      viewerInterested = true;
      partnerInterested = true;
    }
  } catch {}

  const mutualInterest = !!(matchData?.mutualInterest || (viewerInterested && partnerInterested));
  const matchId = mutualInterest ? directMatchIdFor(viewerUid, partnerUid) : '';
  return { viewerInterested, partnerInterested, mutualInterest, matchId };
}

/**
 * The dossier as this member should read it: their own reason for the pairing,
 * what the partner brings them, and what they bring the partner.
 */
export function dossierForViewer(matchDoc, isA, aiIntro = '') {
  const stored = matchDoc?.aiDossier;
  const cleanList = (value) => (Array.isArray(value) ? value.filter((entry) => entry && entry.skill) : []);
  if (!stored) {
    // A pair locked before the dossier existed still gets a readable deep read.
    const engine = buildEngineDossier({
      profileA: matchDoc?.profileA,
      profileB: matchDoc?.profileB,
      aOffers: matchDoc?.aOffers,
      bOffers: matchDoc?.bOffers,
      sharedDomains: matchDoc?.sharedDomains,
      cardForA: matchDoc?.cardForA,
      cardForB: matchDoc?.cardForB,
      firstSprintTask: matchDoc?.firstSprintTask,
    });
    return {
      headline: matchDoc?.aiHeadline || engine.headline,
      whyChosen: cleanText(isA ? engine.whyChosenForA : engine.whyChosenForB, 1600) || aiIntro,
      partnerBrings: isA ? engine.whatBBrings : engine.whatABrings,
      youBring: isA ? engine.whatABrings : engine.whatBBrings,
      sharedGround: engine.sharedGround,
      firstSprint: engine.firstSprint,
      source: 'engine',
    };
  }
  return {
    headline: cleanText(stored.headline || matchDoc?.aiHeadline, 90),
    whyChosen: cleanText(isA ? stored.whyChosenForA : stored.whyChosenForB, 1600) || aiIntro,
    partnerBrings: cleanList(isA ? stored.whatBBrings : stored.whatABrings),
    youBring: cleanList(isA ? stored.whatABrings : stored.whatBBrings),
    sharedGround: Array.isArray(stored.sharedGround) ? stored.sharedGround.slice(0, 4) : [],
    firstSprint: cleanText(stored.firstSprint || matchDoc?.aiFirstSprint, 220),
    source: cleanText(stored.source || matchDoc?.aiSource, 20) || 'engine',
  };
}

function formatViewerPayload(matchDoc, viewerUid, partnerProfile, gate, window) {
  const isA = String(matchDoc.uidA) === String(viewerUid);
  const card = isA ? matchDoc.cardForA : matchDoc.cardForB;
  const myOffers = isA ? matchDoc.aOffers : matchDoc.bOffers;
  const partnerOffers = isA ? matchDoc.bOffers : matchDoc.aOffers;
  const aiIntro = isA ? (matchDoc.aiWhyForA || matchDoc.aiWhyMutual) : (matchDoc.aiWhyForB || matchDoc.aiWhyMutual);
  const partnerUid = isA ? matchDoc.uidB : matchDoc.uidA;

  return {
    pairId: matchDoc.pairId,
    weekKey: matchDoc.weekKey || window.key,
    weekStart: matchDoc.weekStart || window.start,
    weekEnd: matchDoc.weekEnd || window.end,
    daysRemaining: window.daysRemaining,
    viewerUid,
    partnerUid,
    partner: sanitizePublicPartnerProfile(partnerProfile),
    score: Number(matchDoc.score || 80),
    display: Number(matchDoc.display || 0.8),
    mutualFit: Number(matchDoc.mutualFit || 0.75),
    mutualUtility: Number(matchDoc.mutualUtility || 0.75),
    cofounderSynergy: Number(matchDoc.cofounderSynergy || 0.78),
    band: matchDoc.band || { id: 'strong', min: 0.7, label: 'Strong fit', line: 'Both of you are looking for this' },
    why: card?.why || {
      shared: matchDoc.whyShared || 'Shared builder momentum and aligned startup goals.',
      complement: matchDoc.whyComplement || 'Complementary co-founder skill sets.',
    },
    reason: aiIntro || [card?.why?.shared, card?.why?.complement].filter(Boolean).join(' '),
    opener: card?.opener || '',
    tinyTask: matchDoc.aiFirstSprint || matchDoc.firstSprintTask || card?.tiny_task || '',
    agenda: card?.agenda || [],
    slot: card?.slot || 'complement',
    cites: card?.cites || [],
    myOffers: Array.isArray(myOffers) ? myOffers : [],
    partnerOffers: Array.isArray(partnerOffers) ? partnerOffers : [],
    sharedDomains: Array.isArray(matchDoc.sharedDomains) ? matchDoc.sharedDomains : [],
    aiHeadline: matchDoc.aiHeadline || '',
    aiIntro: aiIntro || '',
    dossier: dossierForViewer(matchDoc, isA, aiIntro),
    /**
     * Both sides of a pair must read the same pair. Rather than assert it, read
     * it off the record: both profiles stored, both offer ledgers stored, both
     * cards written, and this viewer's side resolving to a real partner. If any
     * of that is missing the payload says so instead of pretending.
     */
    symmetryVerified: Boolean(
      matchDoc.profileA
      && matchDoc.profileB
      && Array.isArray(matchDoc.aOffers)
      && Array.isArray(matchDoc.bOffers)
      && matchDoc.cardForA
      && matchDoc.cardForB
      && partnerUid
      && String(partnerUid) !== String(viewerUid)
    ),
    emailSent: !!(matchDoc.emailsSent?.[viewerUid]),
    bothEmailsSent: !!(matchDoc.emailsSent?.[matchDoc.uidA] && matchDoc.emailsSent?.[matchDoc.uidB]),
    viewerInterested: gate.viewerInterested,
    partnerInterested: gate.partnerInterested,
    mutualInterest: gate.mutualInterest,
    matchId: gate.matchId,
  };
}

/**
 * Persist a matched weekly pair {uidA, uidB} symmetrically and send both introduction emails.
 */
async function commitWeeklyPairAndNotify(db, edge, window, options = {}) {
  const now = options.now || Date.now();
  const weekKey = window.key;
  const pairId = edge.pairId;
  const pairDocId = `${weekKey}_${pairId}`;
  const assignARef = db.collection('weeklyCofounderAssignments').doc(`${weekKey}_${edge.uidA}`);
  const assignBRef = db.collection('weeklyCofounderAssignments').doc(`${weekKey}_${edge.uidB}`);
  const pairRef = db.collection('weeklyCofounderMatches').doc(pairDocId);

  const narrative = await generateAiCofounderNarrative(edge, options);

  const record = {
    pairId,
    pairDocId,
    weekKey,
    weekStart: window.start,
    weekEnd: window.end,
    uidA: edge.uidA,
    uidB: edge.uidB,
    profileA: sanitizePublicPartnerProfile(edge.profileA),
    profileB: sanitizePublicPartnerProfile(edge.profileB),
    score: edge.score,
    display: edge.display,
    mutualFit: edge.mutualFit,
    mutualUtility: edge.mutualUtility,
    cofounderSynergy: edge.cofounderSynergy,
    band: edge.band,
    cardForA: edge.cardForA,
    cardForB: edge.cardForB,
    aOffers: edge.aOffers,
    bOffers: edge.bOffers,
    sharedDomains: edge.sharedDomains,
    whyMutual: edge.whyMutual,
    firstSprintTask: narrative.aiFirstSprint || edge.firstSprintTask,
    aiHeadline: narrative.aiHeadline,
    aiWhyForA: narrative.aiWhyForA,
    aiWhyForB: narrative.aiWhyForB,
    aiWhyMutual: narrative.aiWhyMutual,
    aiFirstSprint: narrative.aiFirstSprint,
    aiDossier: narrative.aiDossier,
    aiSource: narrative.source,
    interests: {},
    mutualInterest: false,
    emailsSent: {},
    createdAt: now,
    updatedAt: now,
  };

  let committed = null;
  if (typeof db.runTransaction === 'function') {
    committed = await db.runTransaction(async (tx) => {
      const [snapA, snapB, snapPair] = await Promise.all([
        tx.get(assignARef),
        tx.get(assignBRef),
        tx.get(pairRef),
      ]);
      if (snapPair?.exists) return snapPair.data();
      if (snapA?.exists || snapB?.exists) return null;
      tx.set(pairRef, record);
      tx.set(assignARef, {
        uid: edge.uidA,
        partnerUid: edge.uidB,
        pairId,
        pairDocId,
        weekKey,
        createdAt: now,
      });
      tx.set(assignBRef, {
        uid: edge.uidB,
        partnerUid: edge.uidA,
        pairId,
        pairDocId,
        weekKey,
        createdAt: now,
      });
      return record;
    });
  } else {
    await pairRef.set(record);
    await assignARef.set({ uid: edge.uidA, partnerUid: edge.uidB, pairId, pairDocId, weekKey, createdAt: now });
    await assignBRef.set({ uid: edge.uidB, partnerUid: edge.uidA, pairId, pairDocId, weekKey, createdAt: now });
    committed = record;
  }

  if (!committed) return null;

  // Send both people their personalized mutual co-founder introduction emails
  const emailResult = await sendWeeklyCofounderIntroEmails(db, {
    ...committed,
    profileA: edge.profileA,
    profileB: edge.profileB,
    aiIntroForA: committed.aiWhyForA,
    aiIntroForB: committed.aiWhyForB,
  }, options).catch(() => ({ sentA: false, sentB: false }));

  const emailsSent = {
    ...(committed.emailsSent || {}),
    [edge.uidA]: !!(emailResult?.sentA || committed.emailsSent?.[edge.uidA]),
    [edge.uidB]: !!(emailResult?.sentB || committed.emailsSent?.[edge.uidB]),
  };
  committed.emailsSent = emailsSent;
  await pairRef.set({ emailsSent, updatedAt: now }, { merge: true }).catch(() => {});

  return committed;
}

/**
 * Retrieve or assign the viewer's single 1-of-1 mutual potential co-founder for the week.
 */
export async function getOrAssignWeeklyCofounder(db, uid, options = {}) {
  if (!db || !uid) return { match: null, reason: 'missing_context' };
  const now = options.now || Date.now();
  const window = cofounderWeekWindow(now);
  const weekKey = String(options.weekKey || window.key);

  // 1. Check if viewer already has a locked 1:1 co-founder assignment for this week
  const assignRef = db.collection('weeklyCofounderAssignments').doc(`${weekKey}_${uid}`);
  const assignSnap = await assignRef.get().catch(() => null);
  if (assignSnap?.exists) {
    const assignData = assignSnap.data() || {};
    const pairRef = db.collection('weeklyCofounderMatches').doc(String(assignData.pairDocId || `${weekKey}_${assignData.pairId}`));
    const pairSnap = await pairRef.get().catch(() => null);
    if (pairSnap?.exists) {
      const matchData = pairSnap.data() || {};
      const partnerUid = String(matchData.uidA) === String(uid) ? String(matchData.uidB) : String(matchData.uidA);
      const partnerSnap = await db.collection('users').doc(partnerUid).get().catch(() => null);
      const partnerProfile = partnerSnap?.exists
        ? { uid: partnerUid, ...partnerSnap.data() }
        : (String(matchData.uidA) === String(uid) ? matchData.profileB : matchData.profileA);

      // Ensure intro emails were attempted for both people
      if (!matchData.emailsSent?.[matchData.uidA] || !matchData.emailsSent?.[matchData.uidB]) {
        const viewerSnap = await db.collection('users').doc(uid).get().catch(() => null);
        const viewerProfile = viewerSnap?.exists ? { uid, ...viewerSnap.data() } : null;
        const fullA = String(matchData.uidA) === String(uid) ? (viewerProfile || matchData.profileA) : (partnerProfile || matchData.profileA);
        const fullB = String(matchData.uidB) === String(uid) ? (viewerProfile || matchData.profileB) : (partnerProfile || matchData.profileB);
        const emailResult = await sendWeeklyCofounderIntroEmails(db, {
          ...matchData,
          profileA: fullA,
          profileB: fullB,
          aiIntroForA: matchData.aiWhyForA,
          aiIntroForB: matchData.aiWhyForB,
        }, options).catch(() => null);
        if (emailResult) {
          matchData.emailsSent = {
            ...(matchData.emailsSent || {}),
            [matchData.uidA]: !!(emailResult.sentA || matchData.emailsSent?.[matchData.uidA]),
            [matchData.uidB]: !!(emailResult.sentB || matchData.emailsSent?.[matchData.uidB]),
          };
          await pairRef.set({ emailsSent: matchData.emailsSent }, { merge: true }).catch(() => {});
        }
      }

      // Pairs locked before the deep dossier existed get one written now, so a
      // member who already has this week's introduction reads the full read
      // instead of two thin lines. Retried at most every six hours.
      const lastDossierAttempt = Number(matchData.aiDossierAttemptAt || 0);
      const dossierStale = !matchData.aiDossier || lastDossierAttempt < now - 6 * 3600 * 1000;
      if (dossierStale) {
        const viewerSnap = await db.collection('users').doc(uid).get().catch(() => null);
        const viewerProfile = viewerSnap?.exists ? { uid, ...viewerSnap.data() } : null;
        const profileA = String(matchData.uidA) === String(uid) ? viewerProfile || matchData.profileA : partnerProfile || matchData.profileA;
        const profileB = String(matchData.uidB) === String(uid) ? viewerProfile || matchData.profileB : partnerProfile || matchData.profileB;
        const narrative = await generateAiCofounderNarrative({
          uidA: matchData.uidA,
          uidB: matchData.uidB,
          profileA,
          profileB,
          aOffers: matchData.aOffers,
          bOffers: matchData.bOffers,
          sharedDomains: matchData.sharedDomains,
          cardForA: matchData.cardForA,
          cardForB: matchData.cardForB,
          band: matchData.band,
          firstSprintTask: matchData.firstSprintTask,
        }, options).catch(() => null);
        if (narrative?.aiDossier) {
          matchData.aiDossier = narrative.aiDossier;
          matchData.aiHeadline = matchData.aiHeadline || narrative.aiHeadline;
          const patch = { aiDossierAt: now, aiDossierAttemptAt: now };
          if (narrative.source === 'ai+engine') {
            patch.aiDossier = narrative.aiDossier;
            patch.aiDossierSource = narrative.source;
          }
          await pairRef.set(patch, { merge: true }).catch(() => {});
        }
      }

      const gate = await resolveMutualGateState(db, uid, partnerUid, matchData);
      return {
        weekKey,
        match: formatViewerPayload(matchData, uid, partnerProfile, gate, window),
      };
    }
  }

  // 2. Load pool of eligible builders and pair all currently unpaired builders symmetrically
  const allProfiles = await loadEligiblePool(db);
  const viewerProfile = allProfiles.find((p) => String(p.uid) === String(uid));
  if (!viewerProfile) {
    const directSnap = await db.collection('users').doc(uid).get().catch(() => null);
    if (!directSnap?.exists) return { weekKey, match: null, reason: 'viewer_not_found' };
    const vData = directSnap.data() || {};
    if (vData.deleted || vData.banned) return { weekKey, match: null, reason: 'viewer_ineligible' };
    allProfiles.push({ ...vData, uid });
  }

  // Exclude builders who are already locked to another partner this week
  const alreadyPairedUids = new Set();
  for (const profile of allProfiles) {
    if (String(profile.uid) === String(uid)) continue;
    const snap = await db.collection('weeklyCofounderAssignments').doc(`${weekKey}_${profile.uid}`).get().catch(() => null);
    if (snap?.exists) {
      const data = snap.data() || {};
      if (String(data.partnerUid) !== String(uid)) {
        alreadyPairedUids.add(String(profile.uid));
      }
    }
  }

  const unpairedPool = allProfiles.filter((p) => !alreadyPairedUids.has(String(p.uid)));
  const assignment = assignWeeklyCofounderPairs(unpairedPool, { now, weekKey });
  const myEdge = assignment.pairs.find((edge) => String(edge.uidA) === String(uid) || String(edge.uidB) === String(uid));

  if (!myEdge) {
    return { weekKey, match: null, reason: 'no_eligible_partner' };
  }

  const committed = await commitWeeklyPairAndNotify(db, myEdge, { ...window, key: weekKey }, options);
  if (!committed) {
    return { weekKey, match: null, reason: 'concurrent_assignment' };
  }

  const partnerUid = String(committed.uidA) === String(uid) ? String(committed.uidB) : String(committed.uidA);
  const partnerProfile = String(committed.uidA) === String(uid) ? myEdge.profileB : myEdge.profileA;
  const gate = await resolveMutualGateState(db, uid, partnerUid, committed);

  return {
    weekKey,
    match: formatViewerPayload(committed, uid, partnerProfile, gate, { ...window, key: weekKey }),
  };
}

/**
 * Record a builder's interest in meeting their weekly co-founder.
 * When BOTH builders express interest, automatically unlocks their direct match room.
 */
export async function expressWeeklyCofounderInterest(db, uid, input = {}, options = {}) {
  const now = options.now || Date.now();
  const window = cofounderWeekWindow(now);
  const weekKey = String(input.weekKey || window.key);
  const partnerUid = String(input.partnerUid || '').trim();
  if (!db || !uid || !partnerUid || uid === partnerUid) {
    return { ok: false, reason: 'invalid_input' };
  }

  const pairId = cofounderPairId(uid, partnerUid);
  const pairDocId = `${weekKey}_${pairId}`;
  const pairRef = db.collection('weeklyCofounderMatches').doc(pairDocId);
  const pairSnap = await pairRef.get().catch(() => null);

  // Verify that {uid, partnerUid} is indeed the valid weekly co-founder pair
  if (pairSnap?.exists) {
    const data = pairSnap.data() || {};
    if (
      !(
        (String(data.uidA) === String(uid) && String(data.uidB) === String(partnerUid)) ||
        (String(data.uidB) === String(uid) && String(data.uidA) === String(partnerUid))
      )
    ) {
      return { ok: false, reason: 'not_weekly_partner' };
    }
  }

  const existingInterests = pairSnap?.exists ? pairSnap.data()?.interests || {} : {};
  const updatedInterests = {
    ...existingInterests,
    [uid]: { interested: true, at: now },
  };

  // Check if partner has also expressed interest (via weekly match doc OR connectionRequests)
  let partnerInterested = !!updatedInterests[partnerUid]?.interested;
  const inReqRef = db.collection('connectionRequests').doc(`${partnerUid}_${uid}`);
  const outReqRef = db.collection('connectionRequests').doc(`${uid}_${partnerUid}`);
  const [inReqSnap, outReqSnap] = await Promise.all([
    inReqRef.get().catch(() => null),
    outReqRef.get().catch(() => null),
  ]);

  if (inReqSnap?.exists && ['pending', 'approved'].includes(inReqSnap.data()?.status)) {
    partnerInterested = true;
    updatedInterests[partnerUid] = updatedInterests[partnerUid] || { interested: true, at: now };
  }

  const mutualInterest = partnerInterested;
  const matchId = directMatchIdFor(uid, partnerUid);

  if (mutualInterest) {
    // Both are interested! Approve connection requests and create the direct match room so they can meet.
    if (inReqSnap?.exists) {
      await inReqRef.set({ status: 'approved', reviewedAt: now, updatedAt: now }, { merge: true }).catch(() => {});
    }
    await outReqRef.set({
      senderId: uid,
      recipientId: partnerUid,
      status: 'approved',
      matchId,
      weeklyCofounderWeek: weekKey,
      updatedAt: now,
      createdAt: outReqSnap?.exists ? (outReqSnap.data()?.createdAt || now) : now,
    }, { merge: true }).catch(() => {});

    const sortedUsers = [String(uid), String(partnerUid)].sort();
    await db.collection('matches').doc(matchId).set({
      users: sortedUsers,
      type: 'direct',
      weeklyCofounderWeek: weekKey,
      lastMessage: 'Mutual Weekly Co-Founder Match unlocked! Say hello and schedule your 20-minute intro.',
      lastMessageTime: new Date(now),
      updatedAt: new Date(now),
    }, { merge: true }).catch(() => {});
  } else {
    await outReqRef.set({
      senderId: uid,
      recipientId: partnerUid,
      status: 'pending',
      weeklyCofounderWeek: weekKey,
      message: cleanText(input.message || 'Interested in meeting as this week’s co-founder match on LINKUP.', 300),
      createdAt: now,
      updatedAt: now,
    }, { merge: true }).catch(() => {});
  }

  await pairRef.set({
    pairId,
    weekKey,
    uidA: uid < partnerUid ? uid : partnerUid,
    uidB: uid < partnerUid ? partnerUid : uid,
    interests: updatedInterests,
    mutualInterest,
    ...(mutualInterest ? { mutualMatchedAt: now, matchId } : {}),
    updatedAt: now,
  }, { merge: true }).catch(() => {});

  return {
    ok: true,
    weekKey,
    pairId,
    viewerInterested: true,
    partnerInterested,
    mutualInterest,
    matchId: mutualInterest ? matchId : '',
  };
}

/**
 * Batch cron job: pairs all unpaired eligible builders 1-to-1 for the week
 * using the LINKUP algorithm & AI and sends both people in each pair an email
 * introducing both profiles.
 */
export async function runWeeklyCofounderCron(db, now = Date.now(), options = {}) {
  if (!db) return { ok: false, reason: 'no_db' };
  const window = cofounderWeekWindow(now);
  const weekKey = String(options.weekKey || window.key);
  const allProfiles = await loadEligiblePool(db);

  const unpaired = [];
  for (const profile of allProfiles) {
    const snap = await db.collection('weeklyCofounderAssignments').doc(`${weekKey}_${profile.uid}`).get().catch(() => null);
    if (!snap?.exists) unpaired.push(profile);
  }

  const assignment = assignWeeklyCofounderPairs(unpaired, { now, weekKey });
  const committedPairs = [];
  for (const edge of assignment.pairs) {
    const committed = await commitWeeklyPairAndNotify(db, edge, { ...window, key: weekKey }, { ...options, now });
    if (committed) committedPairs.push(committed.pairId);
  }

  return {
    ok: true,
    weekKey,
    eligibleCount: allProfiles.length,
    unpairedCount: unpaired.length,
    pairsCreated: committedPairs.length,
    pairIds: committedPairs,
  };
}
