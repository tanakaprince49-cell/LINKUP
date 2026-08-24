// WEB flavor storage: localStorage is already synchronous, and this file
// keeps expo-sqlite OUT of the web bundle entirely — its wa-sqlite wasm
// worker cannot be resolved by the Metro web exporter and kills the build.
export const kvGetSync = (key: string): string | null => {
  try {
    return (globalThis as any)?.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export const kvSetSync = (key: string, value: string): void => {
  try {
    (globalThis as any)?.localStorage?.setItem(key, value);
  } catch {
    /* persistence is best-effort */
  }
};
