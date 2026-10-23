import copy from '../../../shared/app-seo.json';

const titles: Record<string, string> = {
  EmailAuth: 'Sign in', Onboarding: 'Professional profile setup',
  Dashboard: 'Discover professionals', LinkyHome: 'Linky AI networking assistant',
  Feed: 'Startup directory', Search: 'Professional search', Inbox: 'Messages',
  Chat: 'Conversation', News: 'Startup news', Profile: 'Professional profile',
  Alerts: 'Notifications', MyConnections: 'Professional connections',
  ActiveOpportunities: 'Collaboration opportunities', ActiveOpportunity: 'Project opportunity',
  RecommendedMatches: 'Recommended professionals', IdeaDeck: 'Startup ideas',
  LinkySettings: 'Introduction preferences', Campaigns: 'Product campaigns',
  CreateCampaign: 'Create a campaign', CreatePost: 'Publish a startup',
  BuilderWorkspace: 'Private builder workspace',
  DailyFive: 'Daily briefing', ShipLog: 'Progress log', CityLeague: 'Local rankings',
  GamificationHub: 'Professional development', TrendingBuilders: 'Community rankings',
  Viewers: 'Profile insights', FounderFlip: 'Founder Flip', PitchPerfect: 'Pitch Perfect', NetworkQuiz: 'Business knowledge quiz',
};

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
  document.title = meta.title;
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
  const ogUrl = document.head.querySelector('meta[property="og:url"]');
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
