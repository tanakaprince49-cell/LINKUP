// NATIVE flavor storage: synchronous KV backed by expo-sqlite.
// (The web variant lives in flavorStorage.web.ts — Metro swaps it in on web,
// keeping expo-sqlite's wasm worker OUT of the web bundle, where it breaks
// the production web build.)
import { Storage } from 'expo-sqlite/kv-store';

export const kvGetSync = (key: string): string | null => {
  try {
    return Storage.getItemSync(key);
  } catch {
    return null;
  }
};

export const kvSetSync = (key: string, value: string): void => {
  try {
    Storage.setItemSync(key, value);
  } catch {
    /* persistence is best-effort; never crash a boot over it */
  }
};
