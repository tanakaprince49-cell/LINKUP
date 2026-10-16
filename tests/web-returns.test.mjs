import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkoutOrigin,checkoutReturnUrls,LEGACY_APP_ORIGIN,CUSTOM_APP_ORIGINS} from '../api/_webReturns.js';
const req=origin=>({headers:{origin}});
test('custom-domain clients always return into /app/, including cached clients without a mount',()=>{
  for(const origin of CUSTOM_APP_ORIGINS)for(const mount of ['/app','',undefined,'//attacker.example','/other'])assert.deepEqual(checkoutReturnUrls(req(origin),mount),{successUrl:origin+'/app/',cancelUrl:origin+'/app/'});
});
test('original app origin and /app aliases remain supported',()=>{
  for(const [mount,path] of [['','/'],[undefined,'/'],['/app','/app/']])assert.deepEqual(checkoutReturnUrls(req(LEGACY_APP_ORIGIN),mount),{successUrl:LEGACY_APP_ORIGIN+path,cancelUrl:LEGACY_APP_ORIGIN+path});
});
test('stale old-domain, marketing-root and unsafe override values cannot break the return flow',()=>{
  const origin=CUSTOM_APP_ORIGINS[0];
  for(const candidate of [LEGACY_APP_ORIGIN,LEGACY_APP_ORIGIN+'/app/',origin,origin+'/',origin+'/features',origin+'/application','http://www.linkupbuild.com/app/','https://evil.example/app/','javascript:alert(1)','/app/','https://user:pass@www.linkupbuild.com/app/','https://www.linkupbuild.com/app/{CHECKOUT_SESSION_ID}',null]) {
    const urls=checkoutReturnUrls(req(origin),'/app',{successUrl:candidate,cancelUrl:candidate});assert.equal(urls.successUrl,origin+'/app/',String(candidate));assert.equal(urls.cancelUrl,origin+'/app/');
  }
});
test('valid same-origin app return overrides survive without unsupported query placeholders',()=>{
  const origin=CUSTOM_APP_ORIGINS[0];
  for(const path of ['/app/','/app/landing','/app/login']) {
    const urls=checkoutReturnUrls(req(origin),'/app',{successUrl:origin+path+'?session={CHECKOUT_SESSION_ID}#test',cancelUrl:origin+path});assert.equal(urls.successUrl,origin+path);assert.equal(urls.cancelUrl,origin+path);
  }
  assert.equal(checkoutReturnUrls(req(origin),'/app',{successUrl:origin+'/app'}).successUrl,origin+'/app/');
  assert.equal(checkoutReturnUrls(req(LEGACY_APP_ORIGIN),'',{successUrl:LEGACY_APP_ORIGIN+'/landing'}).successUrl,LEGACY_APP_ORIGIN+'/landing');
});
test('host fallbacks accept only supported origins and cannot be spoofed into external redirects',()=>{
  assert.equal(checkoutOrigin({headers:{'x-forwarded-host':'www.linkupbuild.com'}}),CUSTOM_APP_ORIGINS[0]);
  assert.equal(checkoutOrigin({headers:{host:'linkup-muqu.vercel.app'}}),LEGACY_APP_ORIGIN);
  for(const origin of ['https://evil.example','https://www.linkupbuild.com.evil.example','https://www.linkupbuild.com/path','http://www.linkupbuild.com','https://www.linkupbuild.com:1234', ['https://www.linkupbuild.com']])assert.equal(checkoutOrigin(req(origin)),LEGACY_APP_ORIGIN);
  assert.equal(checkoutOrigin({headers:{'x-forwarded-host':'evil.example',host:'evil.example'}}),LEGACY_APP_ORIGIN);
});
