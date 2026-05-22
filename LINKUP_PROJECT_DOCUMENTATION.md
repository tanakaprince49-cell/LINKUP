# LINKUP Project Documentation

## 1. What LINKUP Is

LINKUP is an AI-powered founder networking platform for ambitious builders. The product is designed to help users find the right cofounders, collaborators, developers, designers, marketers, investors, startup teams, and active opportunities faster than manual social networking.

The mobile app is the primary experience. It combines:

- **AI matchmaking** for compatibility ranking.
- **Advanced people search** for founders, builders, investors, and startup talent.
- **Discovery dashboard** for recommended matches, trending builders, and active opportunities.
- **Swipe discovery** for lightweight matching.
- **Real-time messaging** with chat controls and safety tools.
- **Business-focused profiles** with startup status, skills, reputation, and AI insights.
- **Onboarding intelligence** that trains search and matchmaking.
- **In-app notifications** for matches, messages, views, and activity.
- **Firebase security rules** for access control.
- **Gemini-powered backend AI** through Firebase Cloud Functions.

LINKUP is not meant to feel like Instagram, Facebook, or a LinkedIn clone. It is meant to feel like a live business identity and matching engine for people building serious things.

## 2. High-Level Architecture

```text
LINKUP
├── mobile/                  React Native + Expo mobile app
├── functions/               Firebase Cloud Functions backend
├── firestore.rules          Firestore security model
├── firestore.indexes.json   Firestore index configuration
├── src/                     Older/web React app prototype
├── firebase.json            Firebase deployment config
└── docs/policy files        Privacy, terms, business docs
```

### Main Runtime Flow

1. User opens the mobile app.
2. `mobile/App.tsx` loads auth, theme, navigation, unread notification count, and deep links.
3. `AuthContext` listens to Firebase Auth and the current user profile.
4. If signed out, user sees landing/login.
5. If signed in but not onboarded, user sees onboarding.
6. After onboarding, user enters the main app:
   - Home / Discovery Dashboard
   - Search
   - Connections
   - Notifications
7. User data is stored in Firestore.
8. AI features call Firebase Cloud Functions instead of exposing Gemini keys in the app.

## 3. Main Mobile Features

### Authentication

Files:

- `mobile/src/contexts/AuthContext.tsx`
- `mobile/src/screens/LandingScreen.tsx`
- `mobile/src/screens/EmailAuthScreen.tsx`
- `mobile/src/lib/firebase.ts`

Authentication supports:

- Firebase Auth state persistence.
- Email/password sign up and sign in.
- Native Google Sign-In for development builds / real APKs.
- Logout.
- Account deletion.
- Local onboarding persistence fallback.

Important behavior:

- The app no longer creates public placeholder users named `New Builder`.
- New users start with light theme.
- New users default to:
  - `isStealthMode: false`
  - `isVisible: true`
  - `turboConnect: false`
  - `hideOnlineStatus: false`

### Onboarding

File:

- `mobile/src/screens/OnboardingScreen.tsx`

Onboarding collects structured profile data used by search, discovery, and AI matching.

It includes:

- Explanation page telling users to answer carefully.
- Name.
- Bio.
- Age.
- Country.
- City.
- Profile photo.
- Optional swipe photos.
- Identity role:
  - Founder
  - Developer
  - Designer
  - Investor
  - Marketer
  - Student
  - Operator
- Role-specific question paths.
- Goals.
- Industries.
- Skills and stack.
- Experience level.
- Commitment.
- Startup stage.
- Funding stage.
- Availability.
- Work style.
- Personality questions.

The output is saved to `users/{uid}` in Firestore and becomes the profile used for matching.

### Discovery Dashboard / Home

File:

- `mobile/src/screens/DiscoveryDashboardScreen.tsx`

The dashboard replaces a random feed as the app’s main home experience.

It shows:

- Recommended matches.
- Trending builders.
- Active opportunities.
- Startup/team suggestions.
- Nearby or relevant professionals.

It uses:

- Firestore public profile queries.
- `isDiscoverableProfile`.
- Local compatibility ranking fallback.
- AI ranking through `rankCandidatesWithAI`.

### Swipe Discovery

File:

- `mobile/src/screens/SwipeScreen.tsx`

Swipe discovery provides a Tinder-like builder discovery flow, but for professional/startup matching.

It supports:

- Card stack of discoverable profiles.
- Smooth native-driver animations.
- Like / skip actions.
- Mutual match detection.
- Match notification creation.
- Direct match creation through `ensureDirectMatch`.
- Profile view tracking.

Swipe data is stored in:

- `swipes`
- `matches`
- `notifications`
- `profileViews`

### Search

Files:

- `mobile/src/screens/SearchScreen.tsx`
- `mobile/src/lib/gemini.ts`
- `functions/src/index.ts`

Search is intended to be one of LINKUP’s strongest premium features.

It supports:

- Name and username search.
- Skills.
- Industry.
- Role / occupation.
- Location.
- Availability.
- Experience.
- Funding/startup filters.
- Verified-only style filtering.
- Compatibility threshold.
- Natural-language AI search filter extraction.

Example user searches:

- “AI engineer”
- “Fintech founder”
- “React developer”
- “Marketing cofounder with SaaS experience”
- “Student entrepreneur building healthcare startup”

AI search uses the callable Cloud Function `aiAssist` with task `searchFilters`.

### Connections / Matches

Files:

- `mobile/src/screens/MatchScreen.tsx`
- `mobile/src/screens/MessagesScreen.tsx`
- `mobile/src/lib/chat.ts`

The connections area shows matched users and conversations.

It supports:

- Participant-backed match documents.
- Secure inbox querying through `participants.<uid> == true`.
- Pinned conversations.
- Important conversations.
- Archived conversations.
- Deleted-for-me conversations.
- Archived chats window.

`mobile/src/lib/chat.ts` creates deterministic direct match IDs from two user IDs so both sides share one conversation document.

### Messaging / Chat

File:

- `mobile/src/screens/ChatScreen.tsx`

Chat supports:

- Real-time Firestore messages.
- Message timestamps.
- Reply-to-message by swiping.
- Delete own messages.
- Last message metadata updates.
- In-app message notifications.
- AI warm intro generation.
- Profile quick open.
- Mute notifications.
- Pin conversation.
- Archive chat.
- Mark important.
- Invite to team.
- Schedule meeting.
- Share contact card.
- Confidential mode marker.
- Export conversation as text.
- Block/unblock user.
- Delete conversation locally.
- Secured chat label.

Security note:

- The UI says **secured chat**, not “end-to-end encrypted,” because true E2EE is not implemented yet.
- Messages are protected by Firebase Auth and Firestore rules, but Firestore stores plaintext message content.

### Notifications

Files:

- `mobile/src/screens/AlertsScreen.tsx`
- `mobile/src/lib/notifications.ts`

Notifications include:

- Match alerts.
- Message alerts.
- Profile view alerts.
- Like alerts.
- System alerts.
- Unread badge count in bottom navigation.

Push token handling:

- Push tokens are saved to `userPrivate/{uid}`, not public profile documents.
- Expo Go has push notification limitations; real push notification testing requires a development build or real APK.

### Profile Page

File:

- `mobile/src/screens/ProfileScreen.tsx`

Profiles are business-focused instead of social-media-focused.

They include:

- Profile photo.
- Swipe photos.
- Display name and handle.
- Occupation.
- Startup/company.
- Location.
- Shareable profile link.
- AI compatibility badge when viewing others.
- Looking-for section.
- Startup status.
- Funding status.
- Availability.
- Networking intent.
- Industry interests.
- Founder reputation metrics.
- AI match insights.
- Vibe intro link.
- Bio.
- Skills and stack.
- Profile viewers analytics.
- Startup analyzer.
- Settings and preferences.

Profile settings include:

- Stealth Mode.
- Public Discovery.
- Turbo Connect.
- Dark Mode.
- Hide Online Status.
- Logout.
- Delete account.

The profile page also has:

- Pull-to-refresh.
- Manual refresh button.
- Stable ON/OFF switch states.
- Profile edit mode.

### Profile View Analytics

Files:

- `mobile/src/lib/analytics.ts`
- `mobile/src/screens/ViewersScreen.tsx`

Profile analytics stores view events in `profileViews`.

It supports:

- Tracking profile viewers.
- Showing who viewed your profile.
- Avoiding public list access to all analytics.

### Active Opportunities

Files:

- `mobile/src/screens/ActiveOpportunitiesScreen.tsx`
- `mobile/src/screens/ActiveOpportunityScreen.tsx`
- `mobile/src/lib/discovery.ts`

Active opportunities surface builders or startups looking for:

- Cofounders.
- Developers.
- Designers.
- Marketers.
- Investors.
- Mentors.
- Startup teams.

The detail page opens a full opportunity/profile view with a back button and messaging entry.

### Trending Builders

File:

- `mobile/src/screens/TrendingBuildersScreen.tsx`

Trending builders are ranked by:

- Earned score.
- Profile completeness.
- Skills.
- Industries.
- Projects.
- Turbo Connect boost.
- Activity signals.

### AI Startup Analyzer

Files:

- `mobile/src/screens/ProfileScreen.tsx`
- `mobile/src/lib/ai.ts`
- `functions/src/index.ts`

The startup analyzer lets a user enter a startup idea and receive:

- Score from 1–100.
- Verdict.
- Target customer.
- Market potential.
- Competition.
- Differentiation.
- Monetization.
- Key risks.
- Next validation step.

The mobile app calls `analyzeStartupIdea`, which calls the backend `aiAssist` task `startupAnalyzer`.

## 4. AI Backend Architecture

### Core Principle

LINKUP uses a token-efficient AI architecture:

1. Use normal code/database filtering first.
2. Use local ranking as a fallback.
3. Send only a shortlist to Gemini.
4. Cache AI match results.
5. Never expose Gemini secrets in the mobile app.

### Firebase Cloud Functions

File:

- `functions/src/index.ts`

Exports:

- `aiAssist`
- `rankCandidates`

### `aiAssist`

Callable function used for general AI tasks.

Supported tasks:

- `startupAnalyzer`
- `searchFilters`
- `profileInsights`
- `warmIntro`
- `matchingExplanation`
- `aiComment`
- `buildFeedback`

Security:

- Requires Firebase Auth.
- Uses `GEMINI_API_KEY` as a Firebase Functions secret.
- Clips payload size before sending to Gemini.

### `rankCandidates`

Callable function used for AI matchmaking.

Flow:

1. Verify user is authenticated.
2. Read current user profile.
3. Read candidate profiles.
4. Compute a cheap pre-score using:
   - Skills
   - Industries
   - Commitment
   - Availability
   - Looking-for fit
   - Personality answers
   - Role answers
5. Shortlist the top candidates.
6. Check `aiMatches/{pairId}` cache.
7. If cached and profile hashes match, return cached result.
8. If not cached, ask Gemini for compatibility score and reason.
9. Save the result in `aiMatches`.

### AI Cache

Collection:

- `aiMatches`

Purpose:

- Prevent repeated Gemini calls.
- Reduce cost.
- Improve speed.
- Keep scores stable until relevant profile data changes.

## 5. Firebase Data Model

### `users/{uid}`

Stores public builder profile data:

- `uid`
- `displayName`
- `username`
- `profileLink`
- `bio`
- `profilePic`
- `photos`
- `occupation`
- `company`
- `age`
- `country`
- `city`
- `skills`
- `interests`
- `industries`
- `lookingFor`
- `experience`
- `personalityType`
- `personalityAnswers`
- `roleAnswers`
- `commitmentLevel`
- `startupStage`
- `fundingStage`
- `availability`
- `workStyle`
- `networkingIntent`
- `circles`
- `isVisible`
- `isStealthMode`
- `turboConnect`
- `hideOnlineStatus`
- `onboarded`
- `aiMatchInsights`

### `userPrivate/{uid}`

Owner-only private user data:

- Push tokens.
- Private notification metadata.

### `presence/{uid}`

Online status:

- `isOnline`
- `lastActiveAt`

Presence reads are blocked when the target user has `hideOnlineStatus: true`.

### `blocks/{blockId}`

Block records:

- `blockedById`
- `blockedUserId`
- `timestamp`

Block IDs are deterministic:

```text
{blockerUid}_{blockedUid}
```

### `swipes/{swipeId}`

Swipe/like actions:

- `fromId`
- `toId`
- `type`
- `timestamp`

### `matches/{matchId}`

Conversation metadata:

- `userIds`
- `participants`
- `timestamp`
- `lastMessage`
- `lastMessageTime`
- `pinnedBy`
- `archivedBy`
- `importantBy`
- `mutedUntilBy`
- `deletedBy`
- `confidentialBy`

### `matches/{matchId}/messages/{messageId}`

Chat messages:

- `senderId`
- `content`
- `timestamp`
- `type`
- `replyToMessageId`
- `replyToSenderId`
- `replyToText`

### `notifications/{notificationId}`

In-app notifications:

- `userId`
- `fromId`
- `fromName`
- `fromPic`
- `type`
- `content`
- `matchId`
- `isRead`
- `timestamp`

### `profileViews/{profileId_viewerId}`

Profile viewer analytics:

- `profileId`
- `viewerId`
- `viewerName`
- `viewerPic`
- `createdAt`
- `lastViewedAt`

## 6. Firestore Security Model

File:

- `firestore.rules`

Security strategy:

- Default deny all reads/writes.
- Public profile listing only shows `isVisible == true` and `isStealthMode == false`.
- Direct profile `get` works for signed-in users unless blocked by the target.
- Users can only create/update their own profile.
- `New Builder` placeholder display names are blocked.
- Push tokens are stored in owner-only `userPrivate`.
- Presence cannot be listed globally.
- Hidden online users block presence reads.
- Blocks can only be created by the blocker.
- Swipes can only be created by the sending user.
- AI match cache is read-only to involved users and written only by Admin SDK.
- Matches require participant maps.
- Match docs cannot be deleted by clients.
- Messages can only be created/read by participants.
- Users can delete only their own messages.
- Notifications are only readable by the notification owner.
- Profile views can only be listed by the profile owner.

## 7. File-by-File Guide

### Root Files

| File | Purpose |
|---|---|
| `.env.example` | Example environment variable file for the web app Gemini key. |
| `firebase.json` | Firebase deployment configuration for Firestore rules, Functions, and Hosting. |
| `firebase-blueprint.json` | Firebase/AI Studio blueprint metadata. |
| `firebase-applet-config.json` | Firebase config used by the web/root app. |
| `firestore.rules` | Firestore database security rules. |
| `firestore.indexes.json` | Firestore index configuration. |
| `index.html` | Vite web app HTML entry. |
| `LINKUP_BUSINESS_PLAN.md` | Business/product planning document. |
| `LINKUP_PROJECT_DOCUMENTATION.md` | This full technical/product documentation file. |
| `linkedin-posts.md` | Content/marketing post drafts. |
| `metadata.json` | Project metadata. |
| `package.json` | Root web app dependencies and scripts. |
| `package-lock.json` | Root dependency lockfile. |
| `PRIVACY_POLICY.md` | Privacy policy. |
| `README.md` | Original run instructions for the web/AI Studio app. |
| `TERMS_OF_SERVICE.md` | Terms of service. |
| `tsconfig.json` | Root TypeScript configuration. |
| `vite.config.ts` | Vite build/dev server configuration. |

### Root Web Prototype: `src/`

The root `src/` folder is the older React/Vite web prototype. The mobile app is currently the main product surface, but the web files remain useful for landing pages, UI ideas, and feature reference.

| File | Purpose |
|---|---|
| `src/App.tsx` | Main web app shell and route composition. |
| `src/main.tsx` | Web React entry point. |
| `src/index.css` | Global web styles. |
| `src/types.ts` | Shared web TypeScript types. |
| `src/contexts/AuthContext.tsx` | Web auth context. |
| `src/contexts/ThemeContext.tsx` | Web theme context. |
| `src/lib/ai.ts` | Web AI helper using OpenRouter/Gemini-era implementation. |
| `src/lib/firebase.ts` | Web Firebase initialization. |
| `src/constants/demoData.ts` | Demo/static data for the web prototype. |
| `src/components/Navigation.tsx` | Web navigation component. |
| `src/components/BlockModal.tsx` | Web blocking modal. |
| `src/components/ReportModal.tsx` | Web reporting modal. |
| `src/components/CreatePostModal.tsx` | Web post creation modal. |
| `src/components/StartupAnalyzer.tsx` | Web startup analyzer component. |
| `src/pages/LandingPage.tsx` | Web landing page. |
| `src/pages/OnboardingPage.tsx` | Web onboarding page. |
| `src/pages/FeedPage.tsx` | Web feed page. |
| `src/pages/SwipePage.tsx` | Web swipe/discovery page. |
| `src/pages/ProfilePage.tsx` | Web profile page. |
| `src/pages/MessagesPage.tsx` | Web messaging page. |
| `src/pages/MatchPage.tsx` | Web match page. |
| `src/pages/NotificationsPage.tsx` | Web notifications page. |

### Firebase Functions: `functions/`

| File | Purpose |
|---|---|
| `functions/package.json` | Cloud Functions dependencies and build scripts. |
| `functions/package-lock.json` | Functions dependency lockfile. |
| `functions/tsconfig.json` | TypeScript config for Cloud Functions. |
| `functions/src/index.ts` | Backend AI and matchmaking Cloud Functions. |

### Mobile Config Files

| File | Purpose |
|---|---|
| `mobile/.env.example` | Example mobile environment file. Gemini secrets should not be exposed here. |
| `mobile/app.json` | Expo app config, package ID, icon, splash, scheme, Google Sign-In plugin. |
| `mobile/babel.config.js` | Expo Babel config. |
| `mobile/eas.json` | EAS build configuration. |
| `mobile/firebase-applet-config.json` | Firebase config imported by the mobile app. |
| `mobile/google-services.json` | Android Firebase/Google services config. |
| `mobile/index.ts` | Expo/React Native entry file. |
| `mobile/package.json` | Mobile app dependencies and scripts. |
| `mobile/package-lock.json` | Mobile dependency lockfile. |
| `mobile/tsconfig.json` | Mobile TypeScript configuration. |

### Mobile Assets

| File | Purpose |
|---|---|
| `mobile/assets/logo.png.png` | App logo asset. |
| `mobile/assets/splash-icon.png.png` | Splash screen image. |
| `mobile/assets/PLACE_LOGO_HERE.txt` | Asset placeholder/instruction file. |

### Mobile Root

| File | Purpose |
|---|---|
| `mobile/App.tsx` | Main mobile navigation, auth routing, deep links, bottom tabs, notification badge, theme/app providers. |
| `mobile/src/types.ts` | TypeScript models for users, matches, messages, notifications, posts, stories, blocks, projects. |

### Mobile Contexts

| File | Purpose |
|---|---|
| `mobile/src/contexts/AuthContext.tsx` | Firebase Auth state, profile listener, onboarding state, Google sign-in, email auth, presence updates, logout, account deletion. |
| `mobile/src/contexts/ThemeContext.tsx` | Persistent light/dark theme state. Defaults first-time users to light mode. |

### Mobile Libraries

| File | Purpose |
|---|---|
| `mobile/src/lib/ai.ts` | Mobile AI wrapper for startup analyzer, warm intro, feedback, comments, and matching explanation through Cloud Functions. |
| `mobile/src/lib/analytics.ts` | Profile view tracking and profile view notification creation. |
| `mobile/src/lib/chat.ts` | Deterministic direct match IDs and match creation/upgrading. |
| `mobile/src/lib/discovery.ts` | Discovery utilities: username cleanup, profile visibility checks, earned scores, opportunity summaries. |
| `mobile/src/lib/firebase.ts` | Mobile Firebase initialization, Auth persistence, Firestore setup, Functions setup, error logging helper. |
| `mobile/src/lib/gemini.ts` | Mobile wrapper for AI search filters and profile insights through Cloud Functions. |
| `mobile/src/lib/imageUploadLimits.ts` | Converts picked images to safe data URIs and enforces size limits for Firestore/base64 media. |
| `mobile/src/lib/matchmaking.ts` | Calls `rankCandidates` Cloud Function and provides local compatibility fallback ranking. |
| `mobile/src/lib/notifications.ts` | Expo notification setup, push token save, unread notification count subscription. |
| `mobile/src/lib/security.ts` | Client helpers for block/unblock and block-state checks. |
| `mobile/src/lib/storage.ts` | Zero-cost media helper that stores/returns base64 or URL strings instead of Firebase Storage. |

### Mobile Screens

| File | Purpose |
|---|---|
| `mobile/src/screens/ActiveOpportunitiesScreen.tsx` | Lists active builder/startup opportunities. |
| `mobile/src/screens/ActiveOpportunityScreen.tsx` | Detailed view for one active opportunity/builder. |
| `mobile/src/screens/AlertsScreen.tsx` | In-app notifications list and read handling. |
| `mobile/src/screens/ChatScreen.tsx` | Real-time chat screen with message replies, chat options, block/unblock, archive, mute, pin, export, team invite, and secured-chat label. |
| `mobile/src/screens/CreatePostScreen.tsx` | Legacy post creation flow for feed-style content. |
| `mobile/src/screens/DiscoveryDashboardScreen.tsx` | Main home dashboard for recommended matches, trending builders, and active opportunities. |
| `mobile/src/screens/EmailAuthScreen.tsx` | Email/password login and sign-up screen. |
| `mobile/src/screens/FeedScreen.tsx` | Legacy feed/post/comment UI retained from earlier social feed version. |
| `mobile/src/screens/LandingScreen.tsx` | Public entry/landing screen before auth. |
| `mobile/src/screens/MatchScreen.tsx` | Connections/matches screen. |
| `mobile/src/screens/MessagesScreen.tsx` | Inbox and archived chats list. |
| `mobile/src/screens/OnboardingScreen.tsx` | Role-aware onboarding flow that trains profile/search/matching. |
| `mobile/src/screens/ProfileScreen.tsx` | Profile view/edit/settings, startup analyzer, profile analytics, reputation, AI insights. |
| `mobile/src/screens/SearchScreen.tsx` | Advanced people search and AI-assisted filter parsing. |
| `mobile/src/screens/SwipeScreen.tsx` | Swipe deck for builder discovery and matching. |
| `mobile/src/screens/TrendingBuildersScreen.tsx` | Full page list of trending builders. |
| `mobile/src/screens/ViewersScreen.tsx` | Profile viewer analytics screen. |

## 8. Important Feature-to-File Map

| Feature | Main Files |
|---|---|
| App navigation | `mobile/App.tsx` |
| Auth | `mobile/src/contexts/AuthContext.tsx`, `mobile/src/screens/EmailAuthScreen.tsx`, `mobile/src/screens/LandingScreen.tsx` |
| Theme | `mobile/src/contexts/ThemeContext.tsx` |
| Onboarding | `mobile/src/screens/OnboardingScreen.tsx` |
| Home dashboard | `mobile/src/screens/DiscoveryDashboardScreen.tsx` |
| Swipe matching | `mobile/src/screens/SwipeScreen.tsx`, `mobile/src/lib/chat.ts` |
| Search | `mobile/src/screens/SearchScreen.tsx`, `mobile/src/lib/gemini.ts` |
| AI matchmaking | `mobile/src/lib/matchmaking.ts`, `functions/src/index.ts` |
| Profile | `mobile/src/screens/ProfileScreen.tsx` |
| Messaging | `mobile/src/screens/ChatScreen.tsx`, `mobile/src/screens/MessagesScreen.tsx` |
| Notifications | `mobile/src/screens/AlertsScreen.tsx`, `mobile/src/lib/notifications.ts` |
| Profile views | `mobile/src/lib/analytics.ts`, `mobile/src/screens/ViewersScreen.tsx` |
| Blocking | `mobile/src/lib/security.ts`, `mobile/src/screens/ChatScreen.tsx`, `firestore.rules` |
| Active opportunities | `mobile/src/screens/ActiveOpportunitiesScreen.tsx`, `mobile/src/screens/ActiveOpportunityScreen.tsx` |
| Startup analyzer | `mobile/src/screens/ProfileScreen.tsx`, `mobile/src/lib/ai.ts`, `functions/src/index.ts` |
| Firestore security | `firestore.rules` |
| Backend AI secrets | `functions/src/index.ts` |

## 9. Run Commands

### Mobile

```bash
cd mobile
npm install
npx expo start
```

Android development build:

```bash
cd mobile
npx expo run:android
```

### Functions

```bash
cd functions
npm install
npm run build
```

### Root Web Prototype

```bash
npm install
npm run dev
```

## 10. Deploy Commands

Deploy Firestore rules:

```bash
firebase deploy --only firestore:rules --project linkup-e0906
```

Deploy Functions:

```bash
firebase deploy --only functions --project linkup-e0906
```

Deploy both:

```bash
firebase deploy --only firestore:rules,functions --project linkup-e0906
```

## 11. Current Security Notes

- Firebase Storage is intentionally not used because it requires unavailable/paid setup for this project.
- Media currently uses base64/data URI handling and Firestore-safe limits.
- Gemini API keys should not be placed in `EXPO_PUBLIC_*` variables.
- Gemini runs through Cloud Functions secrets.
- Push tokens live under `userPrivate/{uid}`.
- Profile listing is limited to public, visible users.
- Presence cannot be listed globally.
- Users can hide their online status.
- Chat is protected by auth/rules but is not true E2EE yet.

## 12. Known Technical Tradeoffs

- Some legacy feed/post/story files still exist from the older social-network version.
- Firestore document size limits matter because media is stored as base64/data URI instead of Firebase Storage.
- Expo Go does not fully support Android remote push notifications with recent Expo SDKs; use a development build or real APK.
- True end-to-end encrypted messaging is not implemented.
- AI ranking depends on deployed Firebase Functions and the configured `GEMINI_API_KEY` secret.
- Some Firestore queries may need indexes as features expand.

## 13. Suggested Next Improvements

- Add a real media/CDN provider when budget allows.
- Implement true end-to-end encryption before claiming E2EE.
- Add server-side notification fanout for push notifications.
- Move reputation scoring to Cloud Functions so users cannot influence trust scores directly.
- Add tests for security rules.
- Add Firestore indexes for advanced search/filter combinations.
- Add account re-authentication flow before delete account.
- Add admin/moderation tools.
- Add a migration script to remove old placeholder/demo profiles from Firestore.
