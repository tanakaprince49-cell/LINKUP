/**
 * The same web export runs at / on the original Vercel origin and at /app
 * behind the marketing site's prefix-stripping reverse proxy. Native builds
 * have no browser pathname and retain their existing URLs.
 */
export function webBasePath(
  pathname = String((globalThis as any)?.location?.pathname || '')
): '' | '/app' {
  return pathname === '/app' || pathname.startsWith('/app/') ? '/app' : '';
}

/** The application route without its public mount, for auth/public-route guards. */
export function webRoutePath(pathname = String((globalThis as any)?.location?.pathname || '')): string {
  return pathname.slice(webBasePath(pathname).length) || '/';
}

/** Prefix an internal, origin-relative path exactly once. Never use for external URLs. */
export function webAppPath(path = '/', basePath: '' | '/app' = webBasePath()): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('webAppPath requires an origin-relative application path');
  }
  if (!basePath || path === basePath || path.startsWith(`${basePath}/`) ||
      path.startsWith(`${basePath}?`) || path.startsWith(`${basePath}#`)) return path;
  return `${basePath}${path}`;
}

/** Keep the app home inside the /app/ PWA scope, including with a query string. */
export function scopedNavigationPath(path: string, basePath: '' | '/app' = webBasePath()): string {
  return basePath ? path.replace(/^\/app(?=$|[?#])/, '/app/') : path;
}
