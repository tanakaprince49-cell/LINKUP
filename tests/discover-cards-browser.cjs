// The crowned portrait and the two new Discover sections, rendered for real.
//
//   LAUNCH_BROWSER_TOOLS=<prefix>/node_modules node tests/discover-cards-browser.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');

const tools = process.env.LAUNCH_BROWSER_TOOLS || path.resolve('node_modules');
const { build } = require(path.join(tools, 'esbuild'));
const { chromium } = require(path.join(tools, 'playwright'));

const root = path.resolve(__dirname, '..');
const mobile = path.join(root, 'mobile');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'linkup-discover-cards-'));
const shots = process.env.LAUNCH_SHOTS;

const source = `import React from 'react';
import { View } from 'react-native';
import { createRoot } from 'react-dom/client';
import WeeklyPortrait from '${mobile}/src/components/WeeklyPortrait.tsx';
import ProfileStrengthCard from '${mobile}/src/components/ProfileStrengthCard.tsx';
import DemandStrip from '${mobile}/src/components/DemandStrip.tsx';
import WeeklyDossier from '${mobile}/src/components/WeeklyDossier.tsx';

const ME = {
  uid: 'tanaka',
  displayName: 'Tanaka Moyo',
  occupation: 'Product Engineer',
  city: 'Harare',
  country: 'Zimbabwe',
  skills: ['React Native', 'Postgres', 'Product'],
  industries: ['Fintech'],
  lookingFor: ['Technical Co-Founder'],
  goals: 'Ship the matching engine to a thousand builders and watch which pairs actually build companies together.',
  profilePic: 'https://cdn.example/tanaka.png',
  projects: [{ title: 'LINKUP' }], // no link: the top gap on purpose
};

const PEOPLE = [
  { uid: 'a', lookingFor: ['React Native dev'], country: 'Zimbabwe', industries: ['Fintech'] },
  { uid: 'b', lookingFor: ['product management'], country: 'Kenya', industries: ['Fintech'] },
  { uid: 'c', lookingFor: ['Growth'], country: 'Zimbabwe' },
  { uid: 'd', lookingFor: ['react'], country: 'Zimbabwe' },
];


const DEEP = {
  headline: 'Builder of rails × seller of rails',
  whyChosen:
    'You built settlement rails for African merchants; Kuda has spent years putting fintech products in front of those same merchants. '
    + 'The algorithm paired you because the gap in your profile — distribution — is the exact thing Kuda has already done twice. '
    + 'You get a commercial co-founder who does not need to be taught the market. '
    + 'The friction is real: you will disagree about how fast to sell before the product is ready. '
    + 'This week matters because you are both pre-revenue and both said "all in".',
  partnerBrings: [
    { skill: 'B2B distribution', unlocks: 'puts the product in front of fifty merchants before you finish the beta' },
    { skill: 'Sales motion', unlocks: 'tells you which feature to build next, from live deals' },
    { skill: 'Partnerships', unlocks: 'opens the aggregators you cannot reach alone' },
  ],
  youBring: [
    { skill: 'Payments rails', unlocks: 'lets Kuda promise instant settlement without hiring an engineering team' },
    { skill: 'Postgres & backend', unlocks: 'turns a merchant wishlist into a working pilot in weeks' },
    { skill: 'AI invoicing', unlocks: 'gives Kuda a second product to sell to the same merchants' },
  ],
  sharedGround: ['Fintech', 'SME payments', 'Harare', 'Pre-revenue, all in'],
  firstSprint: 'Draft the self-serve signup screen together and name three merchants to test it with.',
  source: 'ai+engine',
};

const card = { padding: 16, borderRadius: 20, marginBottom: 16 };

createRoot(document.getElementById('root')).render(
  <View style={{ padding: 16, width: 390 }}>
    <View style={[{ backgroundColor: '#FFFFFF' }, card]}>
      <WeeklyPortrait
        uid="kuda"
        name="Kuda Chipo"
        handle="@kuda"
        roleLine="Growth & GTM Lead · MerchantScale"
        location="Harare, Zimbabwe"
        stage="MVP"
        profilePic="https://cdn.example/kuda.png"
        verified
      />
    </View>
    <View style={[{ backgroundColor: '#12151E' }, card]}>
      <WeeklyPortrait
        uid="kuda"
        name="Kuda Chipo"
        handle="@kuda"
        roleLine="Growth & GTM Lead · MerchantScale"
        location="Harare, Zimbabwe"
        stage="MVP"
        profilePic="https://cdn.example/kuda.png"
        verified
        isDark
      />
    </View>
    <View style={card}>
      <ProfileStrengthCard profile={ME} onFix={() => {}} />
    </View>
    <View style={card}>
      <DemandStrip me={ME} people={PEOPLE} onOpenLinky={() => {}} />
    </View>
    <View testID="dossier-wrap" style={[{ backgroundColor: '#FFFFFF' }, card]}>
      <WeeklyDossier
        partnerFirst="Kuda"
        headline={DEEP.headline}
        whyChosen={DEEP.whyChosen}
        partnerBrings={DEEP.partnerBrings}
        youBring={DEEP.youBring}
        sharedGround={DEEP.sharedGround}
        firstSprint={DEEP.firstSprint}
        source={DEEP.source}
      />
    </View>
    {/* Too small a pool: the strip must stay out of the way entirely. */}
    <View testID="small-pool" style={card}>
      <DemandStrip me={ME} people={PEOPLE.slice(0, 2)} onOpenLinky={() => {}} />
    </View>
  </View>
);`;

const probe = () => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const text = (id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el ? el.textContent : null;
  };
  const crown = box('[data-testid="chosen-crown"]');
  const frame = box('[data-testid="weekly-portrait-frame"]');
  const fill = document.querySelector('[data-testid="profile-strength"]');
  const bar = fill ? fill.querySelectorAll('div') : [];
  let fillWidth = 0;
  let trackWidth = 0;
  for (const node of bar) {
    const h = node.getBoundingClientRect().height;
    if (h > 4 && h < 12) {
      const w = node.getBoundingClientRect().width;
      if (w > trackWidth) trackWidth = w;
      if (w < trackWidth || true) fillWidth = Math.max(fillWidth, 0);
    }
  }
  return {
    crown,
    frame,
    crownCount: document.querySelectorAll('[data-testid="chosen-crown"]').length,
    portraitCount: document.querySelectorAll('[data-testid="weekly-portrait"]').length,
    name: text('weekly-portrait-name'),
    flag: (document.body.textContent.match(/1 OF 1/g) || []).length,
    strengthPercent: text('profile-strength-percent'),
    strengthNext: text('profile-strength-next'),
    strengthCta: (document.querySelector('[data-testid="profile-strength"]')?.textContent || '').includes('Add your project'),
    demandNumber: text('demand-strip-number'),
    demandCount: document.querySelectorAll('[data-testid="demand-strip"]').length,
    promise: (document.body.textContent || '').includes('Counts only. One introduction a week stays the rule.'),
    smallPoolStrips: document.querySelectorAll('[data-testid="small-pool"] [data-testid="demand-strip"]').length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dossierWhy: text('weekly-dossier-why'),
    dossierHeight: (() => {
      const el = document.querySelector('[data-testid="weekly-dossier-why"]');
      if (!el) return 0;
      const style = getComputedStyle(el);
      return Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight));
    })(),
    dossierLedgerRows: document.querySelectorAll('[data-testid="dossier-wrap"] [data-testid="weekly-dossier"] div').length,
    dossierText: (document.querySelector('[data-testid="weekly-dossier"]') || {}).textContent || '',
    strongTags: Array.from(document.querySelectorAll('*')).filter((el) => {
      const w = getComputedStyle(el).fontWeight;
      return (w === '900' || Number(w) >= 900) && (el.textContent || '').trim().length > 2;
    }).length,
  };
};

(async () => {
  let browser;
  let server;
  try {
    // The icon barrel does not survive a bare esbuild bundle: stub the glyphs.
    // expo-image only matters for disk caching; a plain <img> keeps the layout
    // honest in the harness without pulling native asset resolution.
    const imageStub = path.join(scratch, 'expo-image-stub.js');
    fs.writeFileSync(
      imageStub,
      'import React from "react";\n'
      + 'export const Image = ({ source, style, accessibilityLabel }) => React.createElement("img", {'
      + ' src: typeof source === "string" ? source : source && source.uri, alt: accessibilityLabel || "",'
      + ' style: Object.assign({ objectFit: "cover" }, Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style) });\n'
      + 'export default { Image };\n'
    );
    const iconStub = path.join(scratch, 'lucide-stub.js');
    // Every icon the card graph touches, stubbed from the real export list so a
    // new glyph never silently breaks this harness.
    const iconNames = new Set([
      'MapPin', 'Briefcase', 'Gauge', 'ArrowUpRight', 'Eye', 'Lock', 'Check', 'CheckCircle2',
      'Rocket', 'Target', 'Zap', 'UserCheck', 'Globe', 'MessageSquare', 'Mail', 'ArrowDown',
      'Flame', 'Megaphone', 'Plus', 'TrendingUp', 'Layers', 'ChevronRight', 'ArrowRight',
      'Star', 'Shield', 'Crown', 'Camera', 'Link', 'X', 'Sparkle',
    ]);
    const iconDir = path.join(mobile, 'node_modules', 'lucide-react-native', 'dist', 'esm', 'icons');
    if (fs.existsSync(iconDir)) {
      for (const file of fs.readdirSync(iconDir)) {
        const name = file.replace(/\.js$/, '');
        if (/^[A-Z][A-Za-z0-9]*$/.test(name)) iconNames.add(name);
      }
    }
    fs.writeFileSync(
      iconStub,
      'const I=()=>null;\n' + [...iconNames].map((name) => `export const ${name}=I;`).join('\n') + '\nexport default I;\n'
    );
    await build({
      stdin: { contents: source, resolveDir: mobile, loader: 'tsx' },
      bundle: true,
      platform: 'browser',
      format: 'iife',
      outfile: path.join(scratch, 'app.js'),
      jsx: 'automatic',
      loader: { '.png': 'dataurl' },
      nodePaths: [path.join(mobile, 'node_modules')],
      define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
      resolveExtensions: ['.web.tsx', '.tsx', '.web.ts', '.ts', '.web.jsx', '.jsx', '.web.js', '.js', '.json'],
      alias: {
        'react-native': 'react-native-web',
        'react-native-svg': path.join(mobile, 'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js'),
        'lucide-react-native': iconStub,
        'expo-image': imageStub,
      },
    });

    fs.writeFileSync(
      path.join(scratch, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#F4F5F0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
      #root{width:422px}
    </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`
    );

    server = http.createServer((req, res) => {
      const file = req.url === '/' ? '/index.html' : req.url;
      const full = path.join(scratch, file);
      if (!full.startsWith(scratch) || !fs.existsSync(full)) { res.statusCode = 404; res.end('nope'); return; }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(fs.readFileSync(full));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 430, height: 1400 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await page.waitForSelector('[data-testid="weekly-portrait"]', { timeout: 5000 });

    const seen = await page.evaluate(probe);

    // 1. The crown exists, sits above the picture, and overlaps its top edge.
    assert.equal(seen.portraitCount, 2, 'light and dark portraits both render');
    assert.equal(seen.crownCount, 2, 'each portrait wears its crown');
    assert.ok(seen.crown && seen.frame, 'crown and framed portrait both render');
    assert.ok(seen.crown.bottom > seen.frame.top, 'the crown touches the portrait');
    assert.ok(seen.crown.top < seen.frame.top, 'the crown sits above the portrait');
    const overlap = seen.crown.bottom - seen.frame.top;
    assert.ok(overlap > 4 && overlap < 24, `the crown should rest on the frame, overlapped ${overlap}px`);
    assert.ok(seen.frame.width >= 110, `the portrait is the hero of the card, got ${seen.frame.width}px`);
    assert.equal(seen.flag, 2, 'both portraits are stamped 1 OF 1');
    assert.equal(seen.name, 'Kuda Chipo');

    // 2. Profile strength: a real number, the single next edit, and a verb.
    // Photo, three skills, a long goal, a role and a place — but no project link
    // and only one thing asked for, so 65% with the project as the next edit.
    assert.equal(seen.strengthPercent, '65%');
    assert.match(seen.strengthNext, /One project with a link\./);
    assert.match(seen.strengthNext, /strongest signal the matcher has/);
    assert.ok(seen.strengthCta, 'the card offers the one tap that fixes it');

    // 3. Demand: counts only, the rule restated, and silence on a thin pool.
    assert.equal(seen.demandCount, 1, 'the strip renders once, for the real pool only');
    assert.equal(seen.demandNumber, '3 builders are hunting for react native right now.');
    assert.ok(seen.promise, 'the one-introduction-a-week promise is restated');
    assert.equal(seen.smallPoolStrips, 0, 'a pool of two is not demand worth showing');

    // 4. The deep read: long, complete, and laid out as two ledgers.
    assert.ok(seen.dossierWhy && seen.dossierWhy.length > 450, `the reason is a real argument, got ${seen.dossierWhy && seen.dossierWhy.length} chars`);
    assert.ok(seen.dossierHeight >= 6, `the reason is not clamped to a couple of lines, got ${seen.dossierHeight}`);
    assert.match(seen.dossierText, /WHAT KUDA BRINGS YOU/);
    assert.match(seen.dossierText, /WHAT YOU BRING KUDA/);
    assert.match(seen.dossierText, /SHARED GROUND/);
    assert.match(seen.dossierText, /First twenty minutes|first twenty minutes/);
    assert.match(seen.dossierText, /the exact thing Kuda has already done twice/);
    assert.match(seen.dossierText, /Payments rails/);
    assert.ok(seen.dossierLedgerRows > 20, 'the ledgers are structured rows, not one blob');

    // 5. Nothing overflows the phone width, and the hierarchy is genuinely bold.
    assert.ok(seen.overflow <= 0, `no horizontal overflow, got ${seen.overflow}px`);
    assert.ok(seen.strongTags >= 4, 'the card sets its claims in heavy weight');

    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, 'discover-cards.png'), fullPage: true });
    }

    assert.equal(errors.length, 0, `page errors: ${errors.join(' | ')}`);
    console.log(
      `discover-cards-browser: OK — crown above a ${Math.round(seen.frame.width)}px portrait (${Math.round(
        overlap
      )}px overlap), strength ${seen.strengthPercent} → "${'Add your project'}", demand "${seen.demandNumber}", thin pool silent`
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
