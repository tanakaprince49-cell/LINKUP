// Payment return URLs must keep the browser on the origin where its pending
// reference and Firebase session were stored. This does not change webhooks.
export const LEGACY_APP_ORIGIN = 'https://linkup-muqu.vercel.app';
export const CUSTOM_APP_ORIGINS = ['https://www.linkupbuild.com', 'https://linkupbuild.com'];
const ORIGINS = new Set([LEGACY_APP_ORIGIN, ...CUSTOM_APP_ORIGINS]);
const value = input => typeof input === 'string' ? input.trim() : '';

function knownOrigin(input) {
  try {
    const url = new URL(value(input));
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return '';
    return ORIGINS.has(url.origin) ? url.origin : '';
  } catch { return ''; }
}

export function checkoutOrigin(req) {
  const headers = req?.headers || {};
  return knownOrigin(headers.origin) ||
    knownOrigin('https://' + value(headers['x-forwarded-host'])) ||
    knownOrigin('https://' + value(headers.host)) || LEGACY_APP_ORIGIN;
}

export function checkoutReturnUrls(req, requestedMount, config = {}) {
  const origin = checkoutOrigin(req);
  // Older cached clients might omit appBasePath. The marketing domain must
  // never send a paid member to the marketing homepage in that case.
  const mounted = CUSTOM_APP_ORIGINS.includes(origin) || requestedMount === '/app';
  const fallback = `${origin}${mounted ? '/app/' : '/'}`;
  const resolve = candidate => {
    try {
      const url = new URL(value(candidate));
      if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) return fallback;
      if (mounted && !/^\/app(?:\/|$)/.test(url.pathname)) return fallback;
      if (/[{}\\]/.test(url.pathname) || /%(?:7b|7d|5c|2f)/i.test(url.pathname)) return fallback;
      // Payonify requires plain URLs (no checkout placeholder/query string).
      // Preserve /app/ rather than stripping its slash back out of PWA scope.
      const path = url.pathname === '/app' ? '/app/' : url.pathname;
      return url.origin + path;
    } catch { return fallback; }
  };
  return { successUrl: resolve(config.successUrl), cancelUrl: resolve(config.cancelUrl) };
}
