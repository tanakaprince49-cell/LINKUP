/* The same policy source and renderer are mirrored in the app and marketing repositories. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'legal/privacy-policy.json'), 'utf8'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = item => `<a href="${esc(item.url)}">${esc(item.label)}</a>`;
const paragraphs = lines => (lines || []).map(line => `<p>${esc(line)}</p>`).join('\n');
const sections = policy.sections.map((section, index) => `<section id="${esc(section.id)}" aria-labelledby="heading-${esc(section.id)}">
<h2 id="heading-${esc(section.id)}">${index + 1}. ${esc(section.title)}</h2>
${paragraphs(section.paragraphs)}
${section.bullets ? `<ul>${section.bullets.map(line => `<li>${esc(line)}</li>`).join('\n')}</ul>` : ''}
${paragraphs(section.after)}
${section.links ? `<ul class="resources">${section.links.map(item => `<li>${link(item)}</li>`).join('\n')}</ul>` : ''}
<a class="back" href="#contents">Back to contents ↑</a>
</section>`).join('\n');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LINKUP Privacy Policy | Tanaka Gaadzikwa</title>
<meta name="description" content="How LINKUP collects, uses, shares, stores and deletes Google sign-in and other personal information. Operator: Tanaka Gaadzikwa. Ages 16+.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${esc(policy.canonical)}">
<style>
:root{color-scheme:light;--ink:#142020;--muted:#4d5b58;--line:#dce2da;--yellow:#fbe618;--paper:#f7f8f3}*{box-sizing:border-box}html{scroll-padding-top:24px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.75 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:#16543c;text-underline-offset:4px;overflow-wrap:anywhere}a:hover{color:#000}a:focus-visible{outline:3px solid #1a694c;outline-offset:4px}.skip{position:absolute;top:-80px;left:20px;background:white;padding:12px}.skip:focus{top:8px}header,main,footer{max-width:1000px;margin:auto;padding:24px clamp(20px,5vw,56px)}header{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}.brand{font-weight:900;letter-spacing:.1em;color:var(--ink);text-decoration:none}.brand span{display:inline-block;background:var(--yellow);padding:0 8px;margin-right:10px;border-radius:6px}header nav{display:flex;gap:20px;font-size:14px}.hero{border-top:5px solid var(--ink);padding:32px 0}.eyebrow{text-transform:uppercase;font-size:12px;font-weight:800;letter-spacing:.16em;color:var(--muted)}h1{font-size:clamp(38px,7vw,64px);line-height:1.08;letter-spacing:-.045em;margin:14px 0 24px}h2{font-size:clamp(23px,4vw,29px);line-height:1.3;letter-spacing:-.025em;margin:0 0 20px}p,li{overflow-wrap:anywhere}p{margin:0 0 18px}li{margin:0 0 14px}ul{padding-left:22px}.lead{font-size:19px;max-width:800px}.meta{display:flex;gap:12px 28px;flex-wrap:wrap;font-size:14px;color:var(--muted)}.contact{margin-top:24px;padding:20px 24px;border-radius:12px;background:#fff8b8;border:1px solid #ded278}.contact p{margin:0}.contents{padding:26px;border:1px solid var(--line);border-radius:16px;background:#fff}.contents h2{font-size:19px}.contents ol{columns:2;column-gap:40px;padding-left:22px;margin-bottom:0}.contents li{break-inside:avoid;font-size:14px;line-height:1.5;margin:0 0 12px}section[id]{padding:34px 0;border-bottom:1px solid var(--line)}.back{display:inline-block;font-size:13px;color:var(--muted);margin-top:10px}.resources{font-size:14px}footer{font-size:13px;color:var(--muted);padding-bottom:48px}footer nav{display:flex;flex-wrap:wrap;gap:12px 24px;margin-bottom:18px}@media(max-width:620px){.contents ol{columns:1}.contact{padding:18px}.hero{padding-top:24px}main{padding-top:12px}header nav{gap:14px}section[id]{padding:28px 0}}@media print{body{background:white;font-size:11pt}header,main,footer{padding:10px;max-width:none}.contents,.back,.skip,header nav{display:none}section[id]{break-inside:auto}a{color:inherit}.hero{padding:10px 0}h1{font-size:30pt}}
</style>
</head>
<body>
<a class="skip" href="#policy">Skip to privacy policy</a>
<header><a class="brand" href="https://www.linkupbuild.com/"><span>L</span>LINKUP</a><nav aria-label="Website"><a href="https://www.linkupbuild.com/">Home</a><a href="https://www.linkupbuild.com/app/landing">Open app</a></nav></header>
<main id="policy">
<div class="hero"><p class="eyebrow">Legal &amp; privacy · Public policy</p><h1>Privacy Policy</h1><p class="lead">${esc(policy.summary)}</p><div class="meta"><span>Effective: <time datetime="${esc(policy.effectiveDate)}">${esc(new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(policy.effectiveDate+'T00:00:00Z')))}</time></span><span>Operator: ${esc(policy.operator)}</span><span>Minimum age: 16+</span></div><div class="contact"><p><strong>Privacy &amp; deletion contact</strong><br><a href="mailto:${esc(policy.contact)}">${esc(policy.contact)}</a></p></div></div>
<nav class="contents" id="contents" aria-label="Policy contents"><h2>In this policy</h2><ol>${policy.sections.map(s => `<li><a href="#${esc(s.id)}">${esc(s.title)}</a></li>`).join('\n')}</ol></nav>
${sections}
</main>
<footer><nav aria-label="Legal links"><a href="${esc(policy.canonical)}">Privacy policy</a><a href="https://www.linkupbuild.com/app/data-deletion">Account &amp; data deletion</a><a href="https://www.linkupbuild.com/app/child-safety-standards">Child safety standards</a><a href="https://www.linkupbuild.com/#privacy-choices">Privacy choices</a></nav><p>© 2026 LINKUP. Operated by ${esc(policy.operator)}. Android: ${esc(policy.package)}.</p></footer>
</body>
</html>
`;
const md = `# LINKUP Privacy Policy\n\nEffective: ${policy.effectiveDate}\n\nOperator: ${policy.operator} (individual)\n\nContact: ${policy.contact}\n\nCanonical policy: ${policy.canonical}\n\n${policy.summary}\n\n` + policy.sections.map((s, i) => `## ${i + 1}. ${s.title}\n\n${(s.paragraphs || []).join('\n\n')}${s.bullets ? '\n\n' + s.bullets.map(b => '- ' + b).join('\n') : ''}${s.after ? '\n\n' + s.after.join('\n\n') : ''}${s.links ? '\n\n' + s.links.map(l => `[${l.label}](${l.url})`).join('\n\n') : ''}`).join('\n\n') + '\n';
const output = fs.existsSync(path.join(root, 'mobile/public')) ? 'mobile/public/privacy-policy.html' : 'public/privacy.html';
for (const [file, content] of [[output, html], ['PRIVACY_POLICY.md', md]]) {
  const dest = path.join(root, file);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== content) {
      console.error(`${file} is stale. Run node scripts/render-privacy-policy.cjs.`);
      process.exitCode = 1;
    }
  } else {
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.writeFileSync(dest, content);
    console.log(`Updated ${file}`);
  }
}
