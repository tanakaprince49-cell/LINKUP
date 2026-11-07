# Linky — team matching and role recommendations

## Current scope

Linky has two supported workflows:

1. **Find teammates:** describe a project and your own contribution; LINKUP's matching algorithm ranks eligible public member profiles with complementary evidence and recommends roles.
2. **Recommend roles for an existing team:** provide the project and two or three LINKUP profile IDs/links; LINKUP returns evidence-backed role recommendations for those members.

AI may help suggest role gaps or explain recommendations. It does not replace LINKUP's matching algorithm, invent profile evidence, make contact, send an introduction, or guarantee availability or compatibility. The screen keeps profile photos, badges, evidence, uncertainties, and profile links visible so members can review results themselves.

## Implementation map

| Piece | Location |
|---|---|
| Authenticated API action and retired-action gates | `api/linky.js` |
| Team matching and role recommendations | `api/_linky.js` (`teamMatch`) and `shared/team-roles.js` fallback |
| Daily account allowance and PLUS entitlement | `api/_linkyUsage.js` |
| Current mobile/web screen | `mobile/src/screens/LinkyHomeScreen.tsx` |
| Current client API | `mobile/src/lib/linkyApi.ts` |
| Public-profile Search | `api/publicSeo.js` and `api/_searchGlobe.js` |

The matcher rechecks current public eligibility and block relationships before producing results. AI output cannot add a profile unsupported by the deterministic matching result. If AI is unavailable, deterministic complementary-role suggestions remain available. Existing team member IDs are validated against LINKUP accounts; recommendations do not claim that a member has agreed to participate.

## Allowance

Free accounts receive five team matches per UTC day. LINKUP PLUS includes unlimited team matching. Usage records remain server-controlled and are not reset by changing client state. Feature retirement does not delete legacy Linky records or usage history; account and privacy requests follow the current privacy policy.

## Retired features

Conversational assistant chat, general profile-search prompts, external lead search, introduction drafting/approval, post-introduction follow-ups, Linky preferences/audits/Forget controls, Telegram/WhatsApp bot interactions, Codebase Manager actions, LvlUp founder-screening pages, and Linky reminder/pulse automations no longer operate. Legacy app actions return `410 Gone`; Telegram and WhatsApp endpoints acknowledge retired requests without processing them. Their stored records have not been mass-deleted. Do not restore or re-enable these paths without a new product decision and a reviewed data-retention plan.

The app no longer registers the old audit, settings, profile, or LvlUp demo screens. The remaining `LinkyHomeScreen` route is only the two-mode team matcher.

## Validation

```bash
node --test tests/linky-team-only.test.mjs tests/linky-usage.test.mjs tests/search-globe.test.mjs
npm run test:copy
npm --prefix mobile run typecheck
npm --prefix mobile run test:web-paths
```

These local tests do not deploy the API or verify Firebase production data. Confirm production Search only after the latest changes are pushed and deployed; profile-bearing Search responses are intentionally not edge-cached.
