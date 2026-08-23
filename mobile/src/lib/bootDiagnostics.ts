import { collection, getDocs, limit, onSnapshot, query } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Connection Doctor — cold-start diagnostics logged to the Metro/Expo terminal
 * with a greppable prefix. Tells us PRECISELY which Firestore lane is dead on
 * a given device/network instead of "nothing loads".
 *
 * Paste everything starting with [LINKUP-DIAG] when reporting issues.
 */

const BUILD_STAMP = 'diag-3 (white monochrome + 24h radar hold)';
const TAG = '[LINKUP-DIAG]';

const now = () => Date.now();

const probe = async <T,>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; info: string }> => {
  const started = now();
  try {
    const result: any = await fn();
    const ms = now() - started;
    const size = typeof result?.size === 'number' ? ` docs=${result.size}` : '';
    console.log(`${TAG} ✅ ${label} ok in ${ms}ms${size}`);
    return { ok: true, ms, info: size.trim() };
  } catch (error: any) {
    const ms = now() - started;
    const code = error?.code || error?.name || 'unknown';
    const message = String(error?.message || error).slice(0, 140);
    console.log(`${TAG} ❌ ${label} FAILED in ${ms}ms code=${code} msg=${message}`);
    return { ok: false, ms, info: `${code} ${message}` };
  }
};

export const runBootDiagnostics = (uid: string | undefined) => {
  // Fire-and-forget: never blocks the app, only logs.
  void (async () => {
    console.log(`${TAG} ================= CONNECTION DOCTOR =================`);
    console.log(`${TAG} build: ${BUILD_STAMP}`);
    console.log(`${TAG} auth: ${uid ? `signed-in uid=${uid.slice(0, 8)}…` : 'NOT SIGNED IN'}`);
    console.log(`${TAG} time: ${new Date().toISOString()}`);

    await probe('one-shot publicProfiles (lean index)', () =>
      getDocs(query(collection(db, 'publicProfiles'), limit(20)))
    );
    await probe('one-shot users (legacy path)', () =>
      getDocs(query(collection(db, 'users'), limit(3)))
    );

    // Stream probe: does onSnapshot deliver within 8s on this network?
    await new Promise<void>((resolve) => {
      const started = now();
      let finished = false;
      const finish = (ok: boolean, extra = '') => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsub();
        console.log(
          ok
            ? `${TAG} ✅ live stream delivered in ${now() - started}ms`
            : `${TAG} ❌ live stream NO DELIVERY within 8s ${extra}`
        );
        resolve();
      };
      const timer = setTimeout(() => finish(false, '(stream hang — race architecture will cover this)'), 8000);
      const unsub = onSnapshot(
        query(collection(db, 'publicProfiles'), limit(1)),
        () => finish(true),
        (error) => finish(false, `err=${error?.code || 'unknown'}`)
      );
    });

    console.log(`${TAG} ====================================================`);
  })();
};
