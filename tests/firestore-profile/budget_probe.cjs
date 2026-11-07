/**
 * Expression-budget probe for firestore.rules (users/{uid}).
 *
 * Firebase silently denies a write once a single evaluation passes 1,000
 * expressions, and the client can never tell that apart from a real denial.
 * This script loads the CURRENT firestore.rules and answers two questions:
 *
 *   1. do the payloads the app actually writes still pass, on create AND update?
 *   2. how many more guard clauses of realistic cost fit before it breaks?
 *
 * Run: npx firebase-tools@13 emulators:exec --config firebase.emulator.json \
 *        --project demo-linkup --only firestore \
 *        "node tests/firestore-profile/budget_probe.cjs"
 */
const fs = require('node:fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');

const rules = fs.readFileSync('firestore.rules', 'utf8');

// A probe clause byte-identical in shape to a real guard, on a field that never changes.
const PROBE = "(!changed.hasAny(['occupation']) || (data.occupation.matches('(?s)^.{0,80}$'))) &&\n          ";
const ANCHOR = "        return (!changed.hasAny(['bio'])";
const insert = (k) => (k ? rules.replace(ANCHOR, () => '        return ' + PROBE.repeat(k) + ANCHOR.slice('        return '.length)) : rules);

const onboarding = {
  uid:'probe', displayName:'Probe Member', username:'probemember',
  profileLink:'https://www.linkupbuild.com/app/p/probe',
  bio:'Building the weekly introduction engine.', age:25, country:'Zimbabwe', city:'Harare',
  occupation:'Founder', roles:['Founder','Student'], goals:'Cofounder, Collaborator',
  lookingFor:['Cofounder','Collaborator'], interests:['Fintech'], industries:['Fintech'],
  skills:['React','Distribution'], experience:'Experienced', workStyle:'Remote',
  commitmentLevel:'Full time', startupStage:'Building MVP', fundingStage:'Bootstrapped',
  availability:'Full time', education:'Student', personalityType:'Founder - Remote',
  personalityAnswers:{style:'Direct'}, roleAnswers:{focus:'Ship weekly'},
  buildingName:'LINKUP', buildingOneLiner:'Weekly introductions to the one person who fills your empty chair.',
  buildingTraction:'beta', missingSeat:'Technical cofounder',
  seatWhy:'I can sell and design; I cannot ship the backend alone.',
  stakes:'Full time on this. No salary since March.', urgency:'next-30-days',
  workPace:'intense', conflictStyle:'direct', decisionStyle:'data', riskAppetite:'high',
  equityView:'equal', weeklyHours:'40-plus', relocateView:'together',
  remoteOnly:false, willingToRelocate:true,
  matchingSignals:['LINKUP','beta','Technical cofounder'],
  projects:[{id:'onboarding-build',title:'LINKUP',description:'Weekly intros.',status:'mvp'}],
  networkingIntent:'Cofounder', circles:['Founders'],
  profilePic:'https://ik.imagekit.io/example/avatar.jpg', photos:[], onboarded:true,
  isStealthMode:false, isVisible:true, turboConnect:false, hideOnlineStatus:false,
  settings:{publicDiscovery:true,stealthMode:false,turboConnect:false,hideOnlineStatus:false,darkMode:false},
};
const identity = { uid:'probe', displayName:'Probe Member', username:'probemember', profileLink:'https://www.linkupbuild.com/app/p/probe' };
const core = { ...identity, occupation:'Founder', roles:['Founder','Student'], company:'LINKUP', bio:'Building a professional network.', city:'Harare', country:'Zimbabwe', age:25, skills:['React'], interests:[], industries:[], lookingFor:[], languages:[], goals:'Build', experience:'Experienced', startupStage:'Building MVP', fundingStage:'Bootstrapped', availability:'Part time', commitmentLevel:'Part time', workStyle:'Remote', networkingIntent:'Collaborators', ambition:'Build', timezone:'Africa/Harare', education:'', remoteOnly:false, willingToRelocate:false, teamSizePreference:'', personalityType:'', isStealthMode:false, hideOnlineStatus:false, isVisible:true, turboConnect:false, founderScore:35, reputationMetrics:{reliability:50,responseRate:0,collaboration:40,consistency:30,completion:20} };
const optional = { roleAnswers:{manualSignals:['Builder']}, resume:{shippedProducts:['LINKUP'],sideProjects:[],startupAttempts:[],hackathonWins:[],buildStreaks:5}, socialLinks:{portfolio:'https://example.com',linkedin:'https://www.linkedin.com/in/fixture',github:'',tiktok:'',instagram:'',twitter:''}, settings:{publicDiscovery:true,stealthMode:false,turboConnect:false,hideOnlineStatus:false,darkMode:false}, vibeMedia:'', photos:[], projects:[{id:'p',title:'LINKUP',description:'A real project fixture',status:'mvp'}], startupIdeas:[] };

async function attempt(rulesText, payload, mode) {
  let env;
  try { env = await initializeTestEnvironment({ projectId: 'demo-linkup', firestore: { rules: rulesText } }); }
  catch (error) { return 'RULES-DO-NOT-COMPILE'; }
  try {
    // Every attempt starts from an empty database: leftover docs would turn a
    // "create" into an "update" (and vice versa) and silently change the cost.
    await env.clearFirestore();
    if (mode === 'update') {
      await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users/probe'), { uid: 'probe', displayName: 'Old name' }));
    }
    const db = env.authenticatedContext('probe').firestore();
    try {
      await setDoc(doc(db, 'users/probe'), payload, mode === 'update' ? { merge: true } : undefined);
      return 'allowed';
    } catch (error) {
      return /maximum of 1000 expressions/.test(String(error.message || error)) ? 'OVER-BUDGET' : 'denied';
    }
  } finally { await env.cleanup(); }
}

// Headroom is measured on the WORST payload the app really writes (the
// two-section save), not the friendliest one: its changed-set pulls in the map
// validators (settings, reputationMetrics, resume, socialLinks) that cost more
// than any single string field.
// Everything a real member can have on file at once: the two-section save plus
// every optional map/list the whitelist allows. This is the true worst case.
const extras = {
  languages:['English'], badges:['founding-member'], circles:['Founders'],
  personalityAnswers:{style:'Direct', pace:'Fast'},
  workStyleCard:{pace:'intense', conflict:'direct', decision:'data', risk:'high', equity:'equal', hours:'40-plus', relocate:'together', focus:'ship'},
  buildingName:'LINKUP', buildingOneLiner:'Weekly introductions to the one person who fills your empty chair.',
  seatWhy:'I can sell and design; I cannot ship the backend alone.', matchingSignals:['LINKUP','beta'], onboarded:true,
};
const WORST = { ...core, ...optional, ...extras, bio: 'Updated bio.' };
async function headroom() {
  let low = 0, high = 60, best = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if ((await attempt(insert(mid), WORST, 'update')) === 'allowed') { best = mid; low = mid + 1; } else high = mid - 1;
  }
  return best;
}

(async () => {
  const rows = [
    ['onboarding payload (55 keys)', onboarding],
    ['two-section save (50 keys)', { ...core, ...optional }],
    ['everything, worst case', { ...core, ...optional, ...extras }],
    ['core only (35 keys)', core],
    ['single bio edit', { bio: 'Updated bio.' }],
  ];
  await attempt(rules, onboarding, 'warm-up'); // compile check
  const results = [];
  for (const [label, payload] of rows) {
    const create = await attempt(rules, payload, 'create');
    const update = await attempt(rules, { ...payload, bio: 'Updated bio.' }, 'update');
    results.push({ label, create, update });
    console.log(`${label.padEnd(32)} create=${create.padEnd(12)} update=${update}`);
  }
  const room = await headroom();
  console.log(`\nheadroom on the two-section save: ${room} extra guard clauses (want >= 10)`);
  // This script is the CI gate, so it has to fail the build itself: a rules file
  // that blocks a real profile save, or that has drifted to within 10 clauses of
  // the ceiling, must break the pipeline rather than print a warning.
  const blocked = results.filter((row) => row.create !== 'allowed' || row.update !== 'allowed');
  if (blocked.length || room < 10) {
    console.error(`\nBUDGET GATE FAILED: ${blocked.length ? blocked.map((row) => row.label).join(', ') + ' blocked; ' : ''}headroom ${room} < 10`);
    process.exit(1);
  }
  console.log('budget gate: passed');
})();
