# Firestore quota audit — code-level findings and remediation

**Status:** Static code audit and client-side changes only. No production database was inspected, no collection was deleted, and `firestore.rules` was not changed or deployed.

## Changes made

- **Feed (`mobile/src/screens/FeedScreen.tsx`)**: replaced the unbounded live subscription to every post with a 30-document live first page and cursor-based 30-document fetches as the member scrolls. Removed the per-session `authorId` query and the heuristic deletion of legacy posts. The former cleanup read every post owned by the member and could delete non-startup records based only on document fields; retaining data is safer than guessing.
- **Inbox and chat (`MessagesScreen.tsx`, `ChatScreen.tsx`)**: removed a parallel server `getDocs()` of the same bounded query that was already observed by `onSnapshot()`. Kept the local-cache paint path and live listener.
- **Discovery (`discoveryProfiles.ts`)**: removed a parallel one-shot server fetch for the same two profile windows already listened to live. Kept the two-window wrap behavior, cache paint, and watchdog fallback.
- **Notifications (`notifications.ts`)**: app-shell toasts and unread-count tracking now share one bounded Firestore listener per user instead of maintaining two identical listeners.
- **Chat writes (`ChatScreen.tsx`)**: removed two presence writes that happened after every text/media message. Presence is already maintained centrally by the auth/app-state lifecycle.
- **Appearance controller (`DynamicAppearanceController.tsx`)**: removed a direct listener to `builderContributions/{uid}`. That collection is server/API-owned and not client-readable under the rules; the denied listener never supplied contribution data. Existing fallback appearance behavior remains.

## Rules and billing findings

Firebase's Firestore pricing documentation confirms that rule `get()`, `exists()`, and `getAfter()` document accesses are billed as additional reads when needed to evaluate a mobile/web request. Repeated access to the same dependent document is charged once per request; rule evaluation is also once per request, not once per result document. Consequently, chat rule lookups can add a small number of reads per query/listener request (the match document and, when evaluated, block documents), but the claim that those checks add three reads **per message returned** is not supported by the billing semantics. Listener re-evaluations, reconnects, dependent-document changes, and rules updates can still add those rule-dependent reads. [Firebase pricing documentation](https://firebase.google.com/docs/firestore/pricing)

The block checks protect private conversations and were left intact. The explicit deny-only blocks for legacy/server-owned collections do not themselves execute reads or writes, and deleting those rules would not reduce quota; with no wildcard allow in this ruleset, removing a deny block would normally leave default-deny behavior but is not a quota fix.

## Remaining candidates / limits of this audit

- Message sends still legitimately write a message, conversation metadata/unread state, and (when not muted) a notification. No write was removed where that would silently drop a user-facing capability.
- Swipe, analytics, notification, profile-index, and app-state presence traffic need production request/usage evidence before deciding which writes are redundant. The repository cannot show how often users invoke them.
- Static code cannot identify unused **production data** or prove a feature is unused. Do not purge any collections from this audit alone.
- No Firebase Usage export, Cloud Monitoring series, billing export, production collection inventory, or user-activity evidence was available. So this work targets clear duplicate/unbounded client work; it cannot certify that the daily thresholds will no longer be exceeded.

## Verification

- `npm --prefix mobile run typecheck` — passed.
- `npm --prefix mobile run test:web-paths` — 11 passed, 1 skipped, 0 failed.
- `git diff --check` — passed.
- Mobile dependency install reported 24 existing npm audit findings (2 low, 8 moderate, 12 high, 2 critical); no dependency audit fix was applied.

## Before any production cleanup or rules redesign

1. Compare Firestore document reads/writes over several representative days and against the 50,000/20,000 daily thresholds.
2. Enable/inspect request-level telemetry suitable for the project (Cloud Monitoring and, if needed, Firestore Data Access audit logging) to attribute hot paths; distinguish client query reads from rule-dependent reads.
3. Inventory each production collection and identify its current writers/readers, retention needs, and security purpose. Back up data and obtain explicit scope before deletion.
4. Load-test any rules optimization in the Firestore Emulator, including blocked pairs, legacy documents, query authorization, and offline/reconnect behavior, before deploying.
