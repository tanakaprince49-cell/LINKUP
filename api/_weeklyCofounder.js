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

export async function generateAiCofounderNarrative(pair, { aiText = geminiText } = {}) {
  const nameA = cleanText(pair?.profileA?.displayName || 'Builder A', 50);
  const nameB = cleanText(pair?.profileB?.displayName || 'Builder B', 50);
  const fallbackHeadline = `${(pair?.aOffers?.[0] || pair?.profileA?.occupation || 'Product')} × ${(pair?.bOffers?.[0] || pair?.profileB?.occupation || 'Growth')}`;
  const fallbackWhyForA = [pair?.cardForA?.why?.shared, pair?.cardForA?.why?.complement].filter(Boolean).join(' ') ||
    `${nameB} brings ${(pair?.bOffers || ['complementary execution']).join(', ')} to complement your ${(pair?.aOffers || ['builder strengths']).join(', ')}.`;
  const fallbackWhyForB = [pair?.cardForB?.why?.shared, pair?.cardForB?.why?.complement].filter(Boolean).join(' ') ||
    `${nameA} brings ${(pair?.aOffers || ['complementary execution']).join(', ')} to complement your ${(pair?.bOffers || ['builder strengths']).join(', ')}.`;
  const fallbackSprint = pair?.firstSprintTask || pair?.cardForA?.tiny_task || 'Spend 20 minutes scoping one shared prototype and customer test.';

  if (typeof aiText !== 'function') {
    return {
      aiHeadline: fallbackHeadline,
      aiWhyForA: fallbackWhyForA,
      aiWhyForB: fallbackWhyForB,
      aiWhyMutual: fallbackWhyForA,
      aiFirstSprint: fallbackSprint,
      source: 'engine',
    };
  }

  try {
    const prompt = [
      'You are the LINKUP Co-Founder Matching AI.',
      'A deterministic co-founder matching algorithm already verified this 1-of-1 mutual weekly co-founder pair.',
      'Write concise, factual, high-conviction co-founder introduction copy grounded strictly in the provided profile facts.',
      'Do not use percentages, "soulmate", "vibes", or unsupported claims.',
      'Return STRICT JSON with schema:',
      '{"headline":"short 4-7 word synergy title","whyForA":"1-2 sentences to Builder A explaining why Builder B is their co-founder fit","whyForB":"1-2 sentences to Builder B explaining why Builder A is their co-founder fit","firstSprint":"one concrete 20-minute first meeting build/validation task"}',
      `Builder A: ${JSON.stringify({
        name: nameA,
        occupation: pair?.profileA?.occupation,
        skills: (pair?.profileA?.skills || []).slice(0, 6),
        lookingFor: (pair?.profileA?.lookingFor || []).slice(0, 5),
        goals: cleanText(pair?.profileA?.goals || pair?.profileA?.bio, 160),
        offers: pair?.aOffers,
      })}`,
      `Builder B: ${JSON.stringify({
        name: nameB,
        occupation: pair?.profileB?.occupation,
        skills: (pair?.profileB?.skills || []).slice(0, 6),
        lookingFor: (pair?.profileB?.lookingFor || []).slice(0, 5),
        goals: cleanText(pair?.profileB?.goals || pair?.profileB?.bio, 160),
        offers: pair?.bOffers,
      })}`,
      `Algorithm evidence: ${JSON.stringify({
        sharedForA: pair?.cardForA?.why?.shared,
        complementForA: pair?.cardForA?.why?.complement,
        sharedDomains: pair?.sharedDomains,
      })}`,
    ].join('\n');

    const raw = await aiText(prompt, {
      temperature: 0.1,
      maxOutputTokens: 320,
      responseMimeType: 'application/json',
    });
    const text = String(raw || '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1));
      return {
        aiHeadline: cleanText(parsed.headline, 80) || fallbackHeadline,
        aiWhyForA: cleanText(parsed.whyForA, 240) || fallbackWhyForA,
        aiWhyForB: cleanText(parsed.whyForB, 240) || fallbackWhyForB,
        aiWhyMutual: cleanText(parsed.whyForA, 240) || fallbackWhyForA,
        aiFirstSprint: cleanText(parsed.firstSprint, 180) || fallbackSprint,
        source: 'ai+engine',
      };
    }
  } catch {
    // Graceful fallback to deterministic LINKUP engine copy
  }

  return {
    aiHeadline: fallbackHeadline,
    aiWhyForA: fallbackWhyForA,
    aiWhyForB: fallbackWhyForB,
    aiWhyMutual: fallbackWhyForA,
    aiFirstSprint: fallbackSprint,
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

function formatViewerPayload(matchDoc, viewerUid, partnerProfile, gate, window) {
  const isA = String(matchDoc.uidA) === String(viewerUid);
  const card = isA ? matchDoc.cardForA : matchDoc.cardForB;
  const myOffers = isA ? matchDoc.aOffers : matchDoc.bOffers;
  const partnerOffers = isA ? matchDoc.bOffers : matchDoc.aOffers;
  const aiIntro = isA ? (matchDoc.aiWhyForA || matchDoc.aiWhyMutual) : (matchDoc.aiWhyForB || matchDoc.aiWhyMutual);

  return {
    pairId: matchDoc.pairId,
    weekKey: matchDoc.weekKey || window.key,
    weekStart: matchDoc.weekStart || window.start,
    weekEnd: matchDoc.weekEnd || window.end,
    daysRemaining: window.daysRemaining,
    viewerUid,
    partnerUid: isA ? matchDoc.uidB : matchDoc.uidA,
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
    symmetryVerified: true,
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
      message: cleanText(input.message || 'Interested in meeting as this week’s 1-of-1 potential co-founder match on LINKUP.', 300),
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
