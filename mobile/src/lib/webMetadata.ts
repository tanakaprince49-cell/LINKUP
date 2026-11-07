import copy from '../../../shared/app-seo.json';
import { webAppPath } from './webPaths';

const titles: Record<string, string> = {
  EmailAuth: 'Sign in', Onboarding: 'Professional profile setup',
  Dashboard: 'Discover professionals', LinkyHome: 'Team matching and role recommendations',
  Feed: 'Startup directory', Messages: 'Messages', Inbox: 'Messages',
  Chat: 'Conversation', News: 'Community blogs', Profile: 'Professional profile',
  Alerts: 'Notifications', MyConnections: 'Professional connections',
  ActiveOpportunities: 'Collaboration opportunities', ActiveOpportunity: 'Project opportunity',
  RecommendedMatches: 'Recommended professionals', IdeaDeck: 'Startup ideas',
  Campaigns: 'Campaign manager',
  CreateCampaign: 'Create a campaign', CreatePost: 'Publish a startup',
  BuilderWorkspace: 'Private builder workspace', Workspace: 'Private builder workspace',
  ShipLog: 'Progress log',
  GamificationHub: 'Professional development',
  Viewers: 'Profile insights', FounderFlip: 'Founder Flip', PitchPerfect: 'Pitch Perfect', NetworkQuiz: 'Business knowledge quiz',
};

let lastCanonicalRouteTitle = '';
let activeBackgroundTitle: string | null = null;

export function routeMetadata(routeName?: string) {
  const isPublic = routeName === 'Landing';
  return {
    title: isPublic ? copy.title : `${titles[routeName || ''] || 'Professional network'} | LINKUP`,
    description: copy.description,
    robots: isPublic ? 'index,follow' : 'noindex,follow',
    canonical: isPublic ? copy.landingUrl : null,
  };
}

// This is inert on native. Route names and profile data never become keywords.
export function syncWebMetadata(routeName?: string) {
  if (typeof document === 'undefined') return;
  const meta = routeMetadata(routeName);
  lastCanonicalRouteTitle = meta.title;
  document.title = activeBackgroundTitle || meta.title;
  const setMeta = (key: string, value: string, property = false) => {
    const attr = property ? 'property' : 'name';
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
    if (!element) { element = document.createElement('meta'); element.setAttribute(attr, key); document.head.appendChild(element); }
    element.content = value;
  };
  setMeta('description', meta.description);
  setMeta('robots', meta.robots);
  setMeta('og:title', meta.title, true);
  setMeta('og:description', meta.description, true);
  setMeta('twitter:title', meta.title);
  setMeta('twitter:description', meta.description);
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const ogUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (meta.canonical) {
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    canonical.href = meta.canonical;
    setMeta('og:url', meta.canonical, true);
    if (!document.getElementById('linkup-app-schema')) {
      const schema = document.createElement('script');
      schema.id = 'linkup-app-schema'; schema.type = 'application/ld+json';
      schema.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebApplication', name: copy.name, url: copy.landingUrl, description: copy.description, applicationCategory: 'BusinessApplication', operatingSystem: 'Android, Web' });
      document.head.appendChild(schema);
    }
  } else {
    canonical?.remove(); ogUrl?.remove();
    // Do not keep public landing schema on account, billing, or message screens.
    document.getElementById('linkup-app-schema')?.remove();
  }
}

export interface WebDynamicTabInput {
  variant: string;
  webIconFile?: string;
  themeColor?: string;
  badgeCount?: number;
  backgroundTitle?: string | null;
}

export function applyWebDynamicTabAppearance({
  variant = 'default',
  webIconFile = 'icon-default.png',
  themeColor = '#FBE618',
  badgeCount = 0,
  backgroundTitle = null,
}: WebDynamicTabInput) {
  if (typeof document === 'undefined') return;

  // 1. Dynamic tab title (reverts immediately to route metadata title when backgroundTitle is null)
  activeBackgroundTitle = backgroundTitle || null;
  if (activeBackgroundTitle) {
    document.title = activeBackgroundTitle;
  } else if (lastCanonicalRouteTitle) {
    document.title = lastCanonicalRouteTitle;
  }

  // 2. Dynamic tab favicon (reverts immediately to standard cat favicon on 'default')
  const iconHref = variant === 'default'
    ? webAppPath('/favicon.ico?v=cat1')
    : webAppPath(`/icons/${webIconFile}?v=occ1`);
  const iconType = variant === 'default' ? 'image/x-icon' : 'image/png';

  const ensureLink = (rel: string) => {
    let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!el) {
      el = document.createElement('link');
      el.rel = rel;
      document.head.appendChild(el);
    }
    if (el.getAttribute('href') !== iconHref) {
      el.type = iconType;
      el.href = iconHref;
    }
  };
  ensureLink('icon');
  ensureLink('shortcut icon');

  // 3. Theme-color tint in mobile browsers / installed PWA window bar
  let themeMeta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeMeta && themeColor) {
    themeMeta.content = themeColor;
  }

  // 4. Web App Badging API (installed PWA dock / taskbar badge, clears immediately at 0)
  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const count = Math.max(0, Math.floor(Number(badgeCount) || 0));
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      nav.setAppBadge(count).catch(() => {});
    } else if (count === 0 && typeof nav.clearAppBadge === 'function') {
      nav.clearAppBadge().catch(() => {});
    }
  }
}
