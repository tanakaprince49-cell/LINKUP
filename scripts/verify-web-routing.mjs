// Read-only HTTP audit except unauthenticated checkout/status POSTs, which
// must stop at 401 before transactions/provider calls. Never POST a webhook.
import assert from 'node:assert/strict';
const original='https://linkup-muqu.vercel.app';
const marketing='https://www.linkupbuild.com';
const app=marketing+'/app';
const expected=process.env.EXPECTED_APP_SHA || '';
async function get(url,init={}) {
  const res=await fetch(url,{...init,signal:AbortSignal.timeout(40000)});
  const body=await res.text();return {res,body};
}
const entries=body=>[...body.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
const marker=body=>body.match(/__LINKUP_BUILD__\s*=\s*"([^"]+)"/)?.[1];
const source=await get(original+'/landing');
assert.equal(source.res.status,200);
const scripts=entries(source.body);assert.ok(scripts.length>=3 && scripts.every(s=>s.startsWith('/app/_expo/')));
if(expected)assert.equal(marker(source.body),expected.slice(0,12));
for(const path of ['/app','/app/','/app/landing','/app/login','/app/index.html']) {
  const {res,body}=await get(marketing+path);assert.equal(res.status,200,path);assert.deepEqual(entries(body),scripts,path);assert.equal(marker(body),marker(source.body),path);console.log('PASS app entry',path,'build',marker(body));
}
const home=await get(marketing+'/');assert.equal(home.res.status,200);assert.ok(entries(home.body).some(s=>s.startsWith('/assets/')));assert.ok(!marker(home.body));console.log('PASS marketing homepage remains separate');
const asset=await get(marketing+scripts[0]);assert.equal(asset.res.status,200);assert.match(asset.res.headers.get('content-type'),/javascript/);assert.doesNotMatch(asset.body,/^\s*<!doctype/i);console.log('PASS exported app JavaScript');
const manifest=await get(app+'/manifest.webmanifest');assert.equal(manifest.res.status,200);const data=JSON.parse(manifest.body);assert.equal(new URL(data.scope,app+'/manifest.webmanifest').href,app+'/');assert.equal(new URL(data.start_url,app+'/manifest.webmanifest').href,app+'/');console.log('PASS PWA scope/start URL');
const worker=await get(app+'/service-worker.js');assert.equal(worker.res.status,200);assert.match(worker.res.headers.get('content-type'),/javascript/);console.log('PASS PWA worker');
for(const base of [original,app]) {
  const webhook=await get(base+'/api/payonifyWebhook');assert.equal(webhook.res.status,405);assert.match(webhook.body,/Method not allowed/);
  for(const name of ['payonifyCheckout','payonifyStatus']) {
    const result=await get(base+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json',Origin:marketing},body:'{}'});assert.equal(result.res.status,401,base+'/'+name);assert.ok(JSON.parse(result.body).error);console.log('PASS payment authentication guard',base+'/api/'+name);
  }
  console.log('PASS webhook handler reachable',base+'/api/payonifyWebhook');
}
const robots=await get(marketing+'/robots.txt');assert.match(robots.body,/Sitemap: https:\/\/www.linkupbuild.com\/app\/sitemap.xml/);console.log('PASS authoritative robots advertises app sitemap');
for(const path of ['/sitemap.xml','/sitemap-profiles-0.xml']) {const result=await get(app+path);assert.equal(result.res.status,200);assert.match(result.res.headers.get('content-type'),/xml/);assert.match(result.body,/<(?:sitemapindex|urlset)\b/);console.log('PASS profile sitemap',path);}
console.log('ALL LIVE ROUTING CHECKS PASSED. This does NOT prove sign-in or a paid checkout/webhook delivery.');
