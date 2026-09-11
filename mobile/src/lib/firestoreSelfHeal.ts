/**
 * WEB ONLY — self-heal for a corrupted Firestore IndexedDB cache.
 *
 * What this error looks like in the console (minified):
 *   Error: FIRESTORE (12.13.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)
 *   CONTEXT: {"Rc":"...INTERNAL ASSERTION FAILED: Unexpected state (ID: b7de) CONTEXT: {\"batchId\":1746}"}
 *
 * Decoded against @firebase/firestore 4.14.1 (the SDK firebase@12.13.0 ships):
 *   - ID b7de (47070) is `removeMutationBatch`'s hard assert that exactly ONE
 *     row exists in the local `mutations` store for a given batchId. When the
 *     persisted cache was written by an older build, or an IndexedDB
 *     transaction was interrupted mid-write, that store ends up with 0 or 2+
 *     rows for a batch — a corrupted cache, not an app bug.
 *   - ID b815 (47125) is `AsyncQueue.enqueue`/`Pc()`. Once the first error
 *     poisons the async queue, EVERY later Firestore call re-throws the same
 *     error, so the app keeps crashing until the page reloads — and a plain
 *     reload does not clear the corrupted cache, so it comes straight back.
 *
 * The SDK offers `terminate()` + `clearIndexedDbPersistence()`, but both
 * enqueue work on that same poisoned queue and re-throw b815. So the only
 * reliable recovery is to drop the Firestore IndexedDB database(s) directly
 * and reload. Firebase Auth lives in a different IndexedDB (`firebaseLocal-
 * StorageDb`), so the user stays signed in.
 *
 * Install it before the app boots (index.ts) so a cache that is already
 * corrupt on load is caught on the first failing operation too.
 */
import { Platform } from 'react-native';

const RESET_AT_KEY = 'linkup:fs-reset-at';
// One reset+reload per tab per 3 minutes, so a persistent bad state cannot
// turn into a reload storm. The reset itself produces a clean database, so
// the throttle only ever fires again if a genuinely new corruption appears.
const THROTTLE_MS = 3 * 60_000;

/** Does this look like a Firestore internal assertion failure? */
const isFirestoreAssertion = (msg: string): boolean =>
  /FIRESTORE/.test(msg) && /INTERNAL ASSERTION FAILED/.test(msg);

/** Extract a string message from a rejected promise reason or an error event. */
const toMessage = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  const any = value as { message?: unknown; toString?: () => string };
  if (any && typeof any.message === 'string') return any.message;
  try {
    return String(value);
  } catch {
    return '';
  }
};

/**
 * Drop every Firestore-named IndexedDB database. Enumerates real names where
 * the browser allows it, and also deletes the computed default name so the
 * reset works even when `indexedDB.databases()` is unavailable.
 */
function dropFirestoreDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();

  const names = new Set<string>();
  // Default database name: firestore/{persistenceKey}/{projectId}/main,
  // persistenceKey defaults to the app name "[DEFAULT]" (see the SDK's
  // `indexedDbStoragePrefix` + the "main" schema suffix).
  names.add('firestore/[DEFAULT]/linkup-e0906/main');

  const deleteOne = (name: string) =>
    new Promise<void>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(name);
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        // blocked: our own page still holds the connection. We reload right
        // after this resolves; unloading closes the connection and the
        // browser finishes the delete before the fresh page opens it again.
        req.onsuccess = done;
        req.onerror = done;
        req.onblocked = done;
      } catch {
        resolve();
      }
    });

  const run = async () => {
    try {
      const dbs = await (indexedDB as unknown as {
        databases?: () => Promise<Array<{ name?: string }>>;
      }).databases?.();
      for (const d of dbs || []) {
        if (d && typeof d.name === 'string' && /^firestore\//.test(d.name)) {
          names.add(d.name);
        }
      }
    } catch {
      // enumeration failed — fall back to the computed default name only
    }
    await Promise.all([...names].map(deleteOne));
  };

  return run();
}

let installed = false;

/** Attach the one-time global handlers. Safe to call more than once. */
export function installFirestoreSelfHeal(): void {
  if (installed) return;
  installed = true;

  // React Native's setUpGlobals.js sets `global.window = global` on native,
  // so `typeof window === 'undefined'` is NOT a web check — native `window`
  // exists but has no addEventListener, and calling it crashes the app with
  // "undefined is not a function". Only the web platform has a real window.
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  const tryReset = async (value: unknown) => {
    const message = toMessage(value);
    if (!isFirestoreAssertion(message)) return;

    try {
      const last = Number(window.sessionStorage?.getItem(RESET_AT_KEY) || 0);
      if (Date.now() - last < THROTTLE_MS) return;
      try {
        window.sessionStorage?.setItem(RESET_AT_KEY, String(Date.now()));
      } catch {
        // storage blocked — proceed without throttling
      }
    } catch {
      // sessionStorage unavailable — proceed
    }

    // Best-effort: drop the cache, then reload. The reload alone also clears
    // the poisoned in-memory queue; the delete is what stops it recurring.
    try {
      await dropFirestoreDatabases();
    } catch {
      // nothing else we can do
    }
    try {
      window.location.reload();
    } catch {
      // reload blocked (rare); the page stays broken but no worse than before
    }
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    void tryReset(event.reason);
  };
  const onError = (event: ErrorEvent) => {
    void tryReset(event.error ?? event.message);
  };

  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError);
}
