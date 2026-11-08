// Authorization for the client data endpoint (api/db.js), ported from
// firestore.rules. The app used to talk to Firestore directly and the rules
// were the only thing between a signed-in member and everyone else's data;
// now every client read/write lands here, so the same decisions are made
// server-side against MongoDB instead.
//
// Scope note: this ports WHO may read/write WHAT (ownership, participants,
// server-only collections, and the paid-field lock on profiles). The very
// granular per-field shape validators in the rules (string length caps etc.)
// are not re-implemented — document size is bounded by the 4.5 MB function
// payload, and the security-critical checks (you cannot mint PLUS, read
// someone else's notifications, or write server-owned ledgers) are all here.

// Fields a client may never stamp on its own profile: the server
// (billing webhooks / api endpoints) owns PLUS and identity authority.
const PROFILE_ENTITLEMENT_FIELDS = [
  'isPro', 'plan', 'subscriptionPlan', 'subscriptionStatus',
  'proUnlockedAt', 'subscriptionUpdatedAt', 'entitlements',
  'billingProvider', 'subscriptionProductId', 'subscriptionTransactionId',
  'subscriptionPurchaseToken', 'linkupPlus', 'role', 'isAdmin',
  'banned', 'deleted',
];

// publicProfiles mirrors users/{uid}; these keys are server-stamped there.
const PUBLIC_PROFILE_LOCKED_FIELDS = [
  'isPro', 'isVerified', 'verificationProgram', 'plan',
  'subscriptionPlan', 'subscriptionStatus', 'turboConnect',
];

// Collections only the server may touch (rules: allow read, write: if false,
// plus everything the rules never opened, which Firestore default-denied).
const SERVER_ONLY = new Set([
  'swipes', 'retentionPulses', 'emailReceipts', 'emailPrefs',
  'emailRecipientLocks', 'pushReceipts', 'webPushDevices', 'systemJobs',
  'systemConfig', 'clientErrors', 'clientErrorRates', 'blogs', 'stories',
  'intents', 'ventureProfiles', 'vcBridgeRates', 'vcDealOffers',
  'campaignRewards', 'linkyCache', 'lvlupAiCache', 'linkyPairs',
  'linkyScout', 'linkyMeta', 'linkyState', 'linkyUsage', 'linkyOutreach',
  'introSuggestions', 'intros', 'introDrafts', 'outreachIntents',
  'botUsers', 'botLinks', 'builderStates', 'builderContributions',
  'builderRooms', 'roomMessages', 'builderInvites', 'builderEvents',
  'builderRates', 'builderScheduler', 'weeklyCofounderAssignments',
  'weeklyCofounderMatches', 'weeklyFounderSpotlights',
]);

const ADMIN_EMAILS = ['tanakaprince49@gmail.com'];
const POST_COUNTER_FIELDS = ['likesCount', 'dislikesCount', 'commentsCount', 'viewsCount', 'likedBy', 'dislikedBy', 'viewedBy'];

const hasAny = (obj, fields) => !!obj && fields.some((f) => Object.prototype.hasOwnProperty.call(obj, f));
const keysOf = (obj) => Object.keys(obj || {});

// A self-service PLUS cancellation writes the paid fields back to the free
// values; that one shape is allowed through (mirrors validProCancelData).
function isProCancel(patch) {
  return patch && patch.isPro === false && patch.plan === 'free' &&
    patch.subscriptionPlan === 'free' &&
    ['canceled', 'cancelled', 'inactive', 'expired'].includes(String(patch.subscriptionStatus || ''));
}

export async function isAdminUser(db, uid, email) {
  if (!uid) return false;
  if (email && ADMIN_EMAILS.includes(String(email).toLowerCase())) return true;
  try {
    const admins = await db.collection('config').doc('admins').get();
    const uids = admins.exists ? (admins.data()?.uids || []) : [];
    if (Array.isArray(uids) && uids.includes(uid)) return true;
    const me = await db.collection('users').doc(uid).get();
    return !!(me.exists && me.data()?.isAdmin === true);
  } catch {
    return false;
  }
}

const isParticipant = (match, uid) =>
  !!match && !!uid &&
  ((Array.isArray(match.userIds) && match.userIds.includes(uid)) ||
   (match.participants && match.participants[uid] === true));

// Per-document read check used for get and for post-filtering list results.
// `data` is the stored document (without _id); returns true if uid may read it.
export function canReadDoc(collection, data, uid) {
  if (!data) return false;
  switch (collection) {
    case 'publicProfiles': return true;
    case 'users': return !!uid;
    case 'config': case 'leagueChampions': case 'campaigns': case 'posts':
    case 'postComments': case 'postReplies': return !!uid;
    case 'userPrivate': case 'presence': return !!uid && data !== null; // doc-level uid handled by caller
    case 'notifications': return !!uid && data.userId === uid;
    case 'matches': return isParticipant(data, uid);
    case 'messages': return !!uid; // participant check happens in db.js via parent match
    case 'connectionRequests': return !!uid && (data.senderId === uid || data.recipientId === uid);
    case 'savedProfiles': return !!uid && (data.ownerId === uid || data.profileId === uid);
    case 'ideaSwipes': return !!uid && (data.swiperId === uid || data.ideaOwnerId === uid);
    case 'gameChallenges': return !!uid && (data.senderId === uid || data.recipientId === uid);
    case 'profileViews': case 'profileClicks':
      return !!uid && (data.profileId === uid || data.viewerId === uid);
    case 'reports': return !!uid && data.reporterId === uid;
    case 'blocks': return !!uid && (data.blockedById === uid || data.blockedUserId === uid);
    case 'campaignAccounts': return !!uid; // own-doc only, enforced in db.js
    case 'webTransactions': return !!uid && data.uid === uid;
    case 'webSubscriptions': return !!uid; // own-doc only, enforced in db.js
    default: return false;
  }
}

// Decide a write. `patch` = fields the client is changing; `resulting` =
// the full document after the write; `existing` = current doc or null.
export function canWrite({ collection, action, uid, docId, patch, resulting, existing }) {
  if (!uid) return false;
  if (SERVER_ONLY.has(collection)) return false;
  const patchKeys = keysOf(patch);
  switch (collection) {
    case 'users': {
      if (docId !== uid) return false;
      if (action === 'delete') return true;
      if (hasAny(patch, PROFILE_ENTITLEMENT_FIELDS)) {
        // Only the self-cancel shape may touch paid fields, and never the
        // authority keys (role/isAdmin/banned/...).
        const authority = ['role', 'isAdmin', 'banned', 'deleted', 'entitlements', 'linkupPlus',
          'billingProvider', 'subscriptionProductId', 'subscriptionTransactionId',
          'subscriptionPurchaseToken', 'proUnlockedAt'];
        if (hasAny(patch, authority) || !isProCancel(patch)) return false;
      }
      return true;
    }
    case 'publicProfiles': {
      if (docId !== uid) return false;
      if (action === 'delete') return true;
      return !hasAny(patch, PUBLIC_PROFILE_LOCKED_FIELDS);
    }
    case 'userPrivate':
      return docId === uid;
    case 'presence':
      return docId === uid && action !== 'list';
    case 'notifications': {
      if (action === 'create') return resulting.userId === uid || resulting.fromId === uid;
      if (!existing || existing.userId !== uid) return false;
      if (action === 'delete') return true;
      return patchKeys.every((k) => k === 'isRead');
    }
    case 'matches': {
      if (action === 'create') {
        return Array.isArray(resulting.userIds) && resulting.userIds.length === 2 &&
          resulting.userIds.includes(uid);
      }
      if (action === 'delete') return false;
      if (!isParticipant(existing, uid)) return false;
      if (patch.userIds && JSON.stringify(patch.userIds) !== JSON.stringify(existing.userIds)) return false;
      return true;
    }
    case 'messages': {
      // Participant-of-parent verification happens in db.js (needs lookup).
      if (action === 'create') return resulting.senderId === uid;
      if (action === 'delete') return !!existing && existing.senderId === uid;
      return patchKeys.every((k) => k === 'reactions');
    }
    case 'connectionRequests': {
      if (action === 'create') return resulting.senderId === uid;
      if (action === 'delete') return false;
      if (!existing || existing.recipientId !== uid || existing.status !== 'pending') return false;
      return patchKeys.every((k) => ['status', 'reviewedAt', 'updatedAt'].includes(k)) &&
        ['approved', 'rejected'].includes(String(patch.status || existing.status));
    }
    case 'savedProfiles': {
      if (action === 'create') return resulting.ownerId === uid;
      return !!existing && existing.ownerId === uid;
    }
    case 'ideaSwipes': {
      if (action === 'create' || action === 'update') {
        return resulting.swiperId === uid && docId === `${resulting.ideaId}_${uid}`;
      }
      return !!existing && existing.swiperId === uid;
    }
    case 'gameChallenges': {
      if (action === 'create') return resulting.senderId === uid;
      if (action === 'delete') return false;
      return !!existing && (existing.senderId === uid || existing.recipientId === uid);
    }
    case 'profileViews': case 'profileClicks': {
      if (action === 'create') return resulting.viewerId === uid;
      if (action === 'delete') return false;
      return !!existing && existing.viewerId === uid &&
        patchKeys.every((k) => ['viewerName', 'viewerPic', 'lastViewedAt', 'lastClickedAt'].includes(k));
    }
    case 'reports':
      return action === 'create' && resulting.reporterId === uid;
    case 'blocks': {
      if (action === 'create') {
        return resulting.blockedById === uid && String(docId).startsWith(`${uid}_`);
      }
      if (action === 'delete') return !!existing && existing.blockedById === uid;
      return false;
    }
    case 'campaigns': {
      if (action === 'create') return resulting.ownerId === uid && resulting.status === 'pending_review';
      if (action === 'delete') return false;
      // Admin / owner-creative / stats-bump branches resolved in db.js.
      return !!existing && (existing.ownerId === uid ||
        patchKeys.every((k) => ['statsImpressions', 'statsClicks'].includes(k)));
    }
    case 'campaignAccounts':
      return docId === uid && action !== 'delete';
    case 'posts': {
      if (action === 'create') return resulting.authorId === uid;
      if (!existing) return false;
      if (action === 'delete') return existing.authorId === uid;
      return existing.authorId === uid ||
        patchKeys.every((k) => POST_COUNTER_FIELDS.includes(k));
    }
    case 'postComments': {
      if (action === 'create') return resulting.userId === uid && !!resulting.postId;
      if (action === 'delete') return !!existing && existing.userId === uid; // post-author branch in db.js
      return patchKeys.every((k) => k === 'likes');
    }
    case 'postReplies': {
      if (action === 'create') return resulting.userId === uid && !!resulting.commentId;
      if (action === 'delete') return !!existing && existing.userId === uid;
      return patchKeys.every((k) => k === 'likes');
    }
    default:
      return false;
  }
}

export { SERVER_ONLY, isParticipant };
