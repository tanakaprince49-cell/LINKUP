const copy = require('./app-seo.json');
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Only the public landing page is indexable. Authenticated SPA routes are not
// search landing pages. Public member/idea/opportunity pages keep their own SSR SEO.
function headMarkup(publicLanding = false) {
  const parts = [
    `<meta name="description" content="${escape(copy.description)}" />`,
    `<meta name="robots" content="${publicLanding ? 'index,follow' : 'noindex,follow'}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${escape(copy.name)}" />`,
    `<meta property="og:title" content="${escape(copy.title)}" />`,
    `<meta property="og:description" content="${escape(copy.description)}" />`,
    `<meta property="og:image" content="${escape(copy.imageUrl)}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escape(copy.title)}" />`,
    `<meta name="twitter:description" content="${escape(copy.description)}" />`,
    `<meta name="twitter:image" content="${escape(copy.imageUrl)}" />`,
  ];
  if (publicLanding) {
    parts.push(`<link rel="canonical" href="${escape(copy.landingUrl)}" />`, `<meta property="og:url" content="${escape(copy.landingUrl)}" />`);
    // No invented reviews, rankings, download counts or pricing claims.
    const schema = { '@context': 'https://schema.org', '@type': 'WebApplication', name: copy.name, url: copy.landingUrl, description: copy.description, applicationCategory: 'BusinessApplication', operatingSystem: 'Android, Web' };
    parts.push(`<script id="linkup-app-schema" type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`);
  }
  return parts.join('\n');
}
function withHead(html, publicLanding = false) {
  const clean = html.replace(/<!-- linkup-search-meta -->[\s\S]*?<!-- \/linkup-search-meta -->\n?/g, '').replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(copy.title)}</title>`);
  return clean.replace('</head>', `<!-- linkup-search-meta -->\n${headMarkup(publicLanding)}\n<!-- /linkup-search-meta -->\n</head>`);
}
module.exports = { copy, headMarkup, withHead };
